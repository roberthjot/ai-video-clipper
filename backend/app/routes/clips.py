import os
import math
import uuid
import asyncio
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from ..services import gemini_service, video_service, whisper_service
from .upload import get_project_store

router = APIRouter(prefix="/api/clips", tags=["clips"])


class AnalyzeRequest(BaseModel):
    project_id: str
    duration_override: float | None = None


class EditCaptionRequest(BaseModel):
    viral_caption: str


class UpdateModelRequest(BaseModel):
    gemini_model: str


@router.post("/analyze")
async def analyze_video(req: AnalyzeRequest):
    """Start AI analysis on a project's video."""
    projects = get_project_store()
    if req.project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[req.project_id]

    active_file = None
    try:
        # Start Whisper transcription IN PARALLEL with Gemini upload + processing.
        # Whisper runs on local CPU; Gemini runs on Google's servers — they don't
        # compete for resources. By the time Gemini is ready, Whisper is often done.
        print("[Whisper] Starting transcription in parallel with Gemini upload...")
        whisper_task = asyncio.create_task(
            asyncio.to_thread(whisper_service.transcribe, project.video_path)
        )

        project.status = "uploading"
        file_obj = await asyncio.to_thread(gemini_service.upload_video, project.video_path)

        project.status = "processing"
        active_file = await asyncio.to_thread(gemini_service.wait_for_processing, file_obj)

        # Check token count before analyzing — fail fast with clear message
        project.status = "analyzing"
        token_count = await asyncio.to_thread(gemini_service.count_tokens, active_file)
        project.token_count = token_count
        MAX_TOKENS = 1_048_576
        if token_count > MAX_TOKENS:
            project.status = "error"
            mins = int((project.video_duration or 0) / 60)
            # Cancel the in-flight Whisper task before bailing out
            whisper_task.cancel()
            await asyncio.to_thread(gemini_service.delete_file, active_file)
            raise HTTPException(
                status_code=400,
                detail=f"Video too large for AI: {token_count:,} tokens (max {MAX_TOKENS:,}). "
                       f"Your video is {mins} min. Please use a video under 45 minutes."
            )
        duration = req.duration_override or project.video_duration

        # Wait for Whisper to finish (usually done by now since it ran in parallel)
        transcript = None
        try:
            transcript = await whisper_task
            project.transcript = transcript  # Save for subtitle generation later
            print(f"[Whisper] Transcription ready ({len(transcript.get('words', []))} words)")
        except Exception as e:
            print(f"[Whisper] Transcription failed (continuing without it): {e}")

        # If the video is long enough, switch to chunked analysis (much more
        # accurate timestamps because Gemini focuses on a smaller time window).
        if duration > gemini_service.CHUNK_THRESHOLD_SECONDS:
            print(f"[Analyze] Video is {duration/60:.1f} min — using chunked analysis")
            # We don't need the full-video upload for the chunked path; delete it
            # before processing chunks so we don't hit storage quota.
            await asyncio.to_thread(gemini_service.delete_file, active_file)
            active_file = None
            clips = await _analyze_in_chunks(project, duration, transcript)
        else:
            clips = await asyncio.to_thread(
                gemini_service.analyze_video,
                active_file,
                duration,
                project.clip_count,
                project.min_duration,
                project.custom_prompt,
                0,
                transcript,
                project.gemini_model,
            )

        # Validate each clip's caption against the Whisper transcript so the
        # editor can show a confidence indicator next to each one.
        if transcript:
            for c in clips:
                snippet, conf = gemini_service.validate_caption_against_transcript(
                    c.viral_caption, c.start_time, c.end_time, transcript
                )
                c.transcript_snippet = snippet
                c.match_confidence = conf

        project.clips = clips
        project.status = "ready"

        return {
            "project_id": project.id,
            "status": "ready",
            "clips": [c.model_dump() for c in clips],
            "total": len(clips),
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        project.status = "error"
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Always clean up the Gemini file to free storage quota
        if active_file is not None:
            await asyncio.to_thread(gemini_service.delete_file, active_file)


async def _analyze_in_chunks(project, duration: float, transcript: dict) -> list:
    """Split a long video into chunks of ~10 min, analyze each separately, then
    merge the results. Each chunk gives Gemini a much smaller time window so its
    timestamps stay precise. Chunk-local timestamps are shifted back to the
    original video's global timeline before merging.
    """
    ranges = gemini_service.build_chunk_ranges(duration, gemini_service.CHUNK_DURATION_SECONDS)
    n_chunks = len(ranges)
    clips_per_chunk = max(1, math.ceil(project.clip_count / n_chunks))
    print(f"[Chunked] {n_chunks} chunks, ~{clips_per_chunk} clips each")

    temp_dir = os.path.join(os.path.dirname(__file__), "..", "services", "temp")
    os.makedirs(temp_dir, exist_ok=True)

    all_clips = []
    for idx, (chunk_start, chunk_end) in enumerate(ranges):
        chunk_duration = chunk_end - chunk_start
        chunk_path = os.path.join(temp_dir, f"chunk_{uuid.uuid4().hex}.mp4")
        chunk_file = None
        try:
            print(f"[Chunked] Extracting chunk {idx+1}/{n_chunks}: {chunk_start:.0f}s-{chunk_end:.0f}s")
            await asyncio.to_thread(
                gemini_service.extract_video_chunk,
                project.video_path, chunk_start, chunk_end, chunk_path,
            )
            chunk_file = await asyncio.to_thread(gemini_service.upload_video, chunk_path)
            chunk_file = await asyncio.to_thread(gemini_service.wait_for_processing, chunk_file)

            chunk_transcript = gemini_service.filter_transcript_for_range(
                transcript, chunk_start, chunk_end
            ) if transcript else None

            chunk_clips = await asyncio.to_thread(
                gemini_service.analyze_video,
                chunk_file,
                chunk_duration,
                clips_per_chunk,
                project.min_duration,
                project.custom_prompt,
                0,
                chunk_transcript,
                project.gemini_model,
            )

            # Shift chunk-local timestamps to global video time
            for c in chunk_clips:
                c.start_time = round(c.start_time + chunk_start, 2)
                c.end_time = round(c.end_time + chunk_start, 2)
            all_clips.extend(chunk_clips)
            print(f"[Chunked] Chunk {idx+1}/{n_chunks} done — {len(chunk_clips)} clips")
        except Exception as e:
            print(f"[Chunked] Chunk {idx+1} failed (skipping): {e}")
        finally:
            if chunk_file is not None:
                try:
                    await asyncio.to_thread(gemini_service.delete_file, chunk_file)
                except Exception:
                    pass
            try:
                if os.path.exists(chunk_path):
                    os.remove(chunk_path)
            except Exception:
                pass

    # Sort by global start_time and renumber IDs
    all_clips.sort(key=lambda c: c.start_time)
    for i, c in enumerate(all_clips):
        c.id = i + 1

    # Truncate to user-requested total
    if len(all_clips) > project.clip_count:
        all_clips = all_clips[:project.clip_count]
        for i, c in enumerate(all_clips):
            c.id = i + 1

    return all_clips


@router.get("/{project_id}/download-info")
async def download_clips_info(project_id: str):
    """Download the clips_info.txt file for a project."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    info_path = os.path.join(project.output_dir, "clips_info.txt")

    if not os.path.exists(info_path):
        raise HTTPException(status_code=404, detail="clips_info.txt not found. Export clips first.")

    return FileResponse(info_path, media_type="text/plain", filename="clips_info.txt")


@router.get("/{project_id}")
async def get_clips(project_id: str):
    """Get all clips for a project."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    return {
        "clips": [c.model_dump() for c in project.clips],
        "total": len(project.clips),
    }


@router.put("/{project_id}/model")
async def update_project_model(project_id: str, req: UpdateModelRequest):
    """Switch the Gemini model used for re-analysis on this project."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    allowed = {"gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-flash-preview"}
    if req.gemini_model not in allowed:
        raise HTTPException(status_code=400, detail=f"Model must be one of {allowed}")
    projects[project_id].gemini_model = req.gemini_model
    return {"status": "updated", "gemini_model": req.gemini_model}


@router.put("/{project_id}/{clip_id}")
async def edit_clip_caption(project_id: str, clip_id: int, req: EditCaptionRequest):
    """Edit the caption text for a specific clip."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    for clip in project.clips:
        if clip.id == clip_id:
            clip.viral_caption = req.viral_caption
            return {"status": "updated", "clip": clip.model_dump()}

    raise HTTPException(status_code=404, detail="Clip not found")


@router.get("/{project_id}/{clip_id}/preview")
async def preview_clip_frame(project_id: str, clip_id: int):
    """Generate and return a 9:16 preview frame for a clip."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = None
    for c in project.clips:
        if c.id == clip_id:
            clip = c
            break

    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    os.makedirs(project.output_dir, exist_ok=True)
    preview_path = os.path.join(project.output_dir, f"preview_clip_{clip_id}.jpg")
    timestamp = clip.start_time + (clip.duration / 2)

    style = project.style

    try:
        await asyncio.to_thread(
            video_service.generate_preview_frame,
            video_path=project.video_path,
            timestamp=timestamp,
            output_path=preview_path,
            caption_text=clip.viral_caption,
            text_x=style.text_x,
            text_y=style.text_y,
            font_size=style.font_size,
            text_color=style.text_color,
            text_stroke_color=style.text_stroke_color,
            text_stroke_width=style.text_stroke_width,
            watermark_path=style.watermark_path,
            watermark_x=style.watermark_x,
            watermark_y=style.watermark_y,
            watermark_scale=style.watermark_scale,
            watermark_opacity=style.watermark_opacity,
            fill_mode=style.fill_mode,
            split_screen_enabled=style.split_screen_enabled,
            split_image_path=style.split_image_path,
            split_ratio=style.split_ratio,
            flip_horizontal=style.flip_horizontal,
            boost_contrast=style.boost_contrast,
            caption_style=getattr(style, 'caption_style', 'box'),
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Preview generation failed: {str(e)}")

    if not os.path.exists(preview_path):
        raise HTTPException(status_code=500, detail="Preview file not generated")

    return FileResponse(preview_path, media_type="image/jpeg")


@router.get("/{project_id}/{clip_id}/video-preview")
async def preview_clip_video(project_id: str, clip_id: int):
    """Generate and return a short video preview of a clip for playback."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = None
    for c in project.clips:
        if c.id == clip_id:
            clip = c
            break

    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    os.makedirs(project.output_dir, exist_ok=True)
    video_preview_path = os.path.join(project.output_dir, f"preview_clip_{clip_id}.mp4")

    style = project.style

    try:
        await asyncio.to_thread(
            video_service.generate_preview_clip,
            video_path=project.video_path,
            start_time=clip.start_time,
            duration=clip.duration,
            output_path=video_preview_path,
            caption_text=clip.viral_caption,
            text_x=style.text_x,
            text_y=style.text_y,
            font_size=style.font_size,
            text_color=style.text_color,
            text_stroke_color=style.text_stroke_color,
            text_stroke_width=style.text_stroke_width,
            watermark_path=style.watermark_path,
            watermark_x=style.watermark_x,
            watermark_y=style.watermark_y,
            watermark_scale=style.watermark_scale,
            watermark_opacity=style.watermark_opacity,
            fill_mode=style.fill_mode,
            split_screen_enabled=style.split_screen_enabled,
            split_image_path=style.split_image_path,
            split_ratio=style.split_ratio,
            flip_horizontal=style.flip_horizontal,
            boost_contrast=style.boost_contrast,
            caption_style=getattr(style, 'caption_style', 'box'),
            subtitle_style=getattr(style, 'subtitle_style', 'none'),
            transcript=getattr(project, 'transcript', None),
            visual_filter=getattr(style, 'visual_filter', 'none'),
            subtitle_size_scale=getattr(style, 'subtitle_size_scale', 1.0),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Video preview failed: {str(e)}")

    if not os.path.exists(video_preview_path):
        raise HTTPException(status_code=500, detail="Video preview not generated")

    return FileResponse(video_preview_path, media_type="video/mp4")


@router.get("/{project_id}/{clip_id}/instagram-preview")
async def preview_clip_instagram_frame(project_id: str, clip_id: int):
    """Generate a static JPEG in Instagram post format: white bg + caption text + video below."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = None
    for c in project.clips:
        if c.id == clip_id:
            clip = c
            break

    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    os.makedirs(project.output_dir, exist_ok=True)
    ig_frame_path = os.path.join(project.output_dir, f"ig_preview_clip_{clip_id}.jpg")
    timestamp = clip.start_time + (clip.duration / 2)
    style = project.style

    try:
        await asyncio.to_thread(
            video_service.generate_instagram_preview_frame,
            video_path=project.video_path,
            timestamp=timestamp,
            output_path=ig_frame_path,
            caption_text=clip.viral_caption,
            fill_mode=style.ig_fill_mode,
            ig_top_padding=style.ig_top_padding,
            watermark_path=style.watermark_path,
            watermark_x=style.watermark_x,
            watermark_y=style.watermark_y,
            ig_watermark_y=style.ig_watermark_y,
            watermark_scale=style.watermark_scale,
            watermark_opacity=style.watermark_opacity,
            flip_horizontal=style.flip_horizontal,
            boost_contrast=style.boost_contrast,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Instagram preview failed: {str(e)}")

    if not os.path.exists(ig_frame_path):
        raise HTTPException(status_code=500, detail="Instagram preview not generated")

    return FileResponse(ig_frame_path, media_type="image/jpeg")


@router.post("/{project_id}/{clip_id}/reanalyze")
async def reanalyze_clip(project_id: str, clip_id: int):
    """Extract this clip's exact segment and re-analyze with Gemini to fix wrong captions."""
    import uuid as _uuid
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = next((c for c in project.clips if c.id == clip_id), None)
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    # Extract the exact clip segment to a temp file
    temp_dir = os.path.join(os.path.dirname(__file__), "..", "services", "temp")
    os.makedirs(temp_dir, exist_ok=True)
    segment_path = os.path.join(temp_dir, f"reanalyze_{_uuid.uuid4().hex}.mp4")

    FFMPEG_EXE = video_service.FFMPEG_EXE
    duration = clip.end_time - clip.start_time
    extract_cmd = [
        FFMPEG_EXE,
        "-ss", str(clip.start_time),
        "-i", project.video_path,
        "-t", str(duration),
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-c:a", "aac", "-y", segment_path
    ]

    active_file = None
    try:
        result = await asyncio.to_thread(
            __import__("subprocess").run,
            extract_cmd, capture_output=True, timeout=120
        )
        if not os.path.exists(segment_path):
            raise HTTPException(status_code=500, detail="Failed to extract clip segment")

        # Upload just this short segment to Gemini
        active_file = await asyncio.to_thread(gemini_service.upload_video, segment_path)
        active_file = await asyncio.to_thread(gemini_service.wait_for_processing, active_file)

        # Ask Gemini what's actually happening in this short clip
        # Use the same model the user picked when uploading (consistent quota)
        from google.genai import types as _types
        active_model = getattr(project, 'gemini_model', None) or gemini_service.settings.GEMINI_MODEL
        print(f"[Reanalyze] clip {clip_id} using model={active_model}")
        response = await asyncio.to_thread(
            gemini_service.client.models.generate_content,
            model=active_model,
            contents=[_types.Content(role="user", parts=[
                _types.Part.from_uri(file_uri=active_file.uri, mime_type=active_file.mime_type),
                _types.Part.from_text(text=(
                    "Watch this short video clip carefully. "
                    "Write a new viral caption that accurately describes what is ACTUALLY happening in this clip. "
                    "Rules: English only. Maximum 10 words. Third person only (no I/me/my). "
                    "No punctuation except apostrophes. All lowercase except first letter. "
                    "End with EXACTLY ONE emoji from this list (and no other): "
                    "💀 😂 🥺 ✨ 🔥 ❤️ 💪 👀 🤔 ❤️‍🩹 😱 😭 💔 🤯. "
                    "Return ONLY the caption text — nothing else."
                )),
            ])],
            config=_types.GenerateContentConfig(temperature=0.5),
        )

        import re as _re
        new_caption = response.text.strip().rstrip(".")
        # Preserve emoji unicode while stripping other punctuation
        new_caption = _re.sub(
            r"[^\w\s'\U0001F300-\U0001FAFF\U00002600-\U000027BF✀-➿☀-⛿]",
            '', new_caption
        ).strip()
        new_caption = _re.sub(r'\s+', ' ', new_caption).strip()
        # Enforce emoji whitelist (strip any emoji not on our list)
        new_caption = gemini_service.filter_emojis_to_whitelist(new_caption)
        # Case-correct text portion without touching the trailing emoji
        if new_caption:
            m = _re.match(r"^(.*?)(\s*[\U0001F300-\U0001FAFF\U00002600-\U000027BF]+)?\s*$", new_caption)
            if m:
                text_part, emoji_part = m.group(1) or "", m.group(2) or ""
                text_part = text_part[:1].upper() + text_part[1:].lower()
                new_caption = (text_part + emoji_part).strip()

        # Update the clip in memory + re-validate against transcript
        clip.viral_caption = new_caption
        transcript = getattr(project, 'transcript', None)
        if transcript:
            snippet, conf = gemini_service.validate_caption_against_transcript(
                new_caption, clip.start_time, clip.end_time, transcript
            )
            clip.transcript_snippet = snippet
            clip.match_confidence = conf
        return {"status": "updated", "clip": clip.model_dump()}

    except HTTPException:
        raise
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if active_file:
            await asyncio.to_thread(gemini_service.delete_file, active_file)
        if os.path.exists(segment_path):
            try:
                os.remove(segment_path)
            except:
                pass


@router.get("/{project_id}/{clip_id}/instagram-video-preview")
async def preview_clip_instagram(project_id: str, clip_id: int):
    """Generate and return a short Instagram-format video preview of a clip."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = None
    for c in project.clips:
        if c.id == clip_id:
            clip = c
            break

    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    os.makedirs(project.output_dir, exist_ok=True)
    ig_preview_path = os.path.join(project.output_dir, f"ig_preview_clip_{clip_id}.mp4")

    style = project.style

    try:
        await asyncio.to_thread(
            video_service.generate_instagram_preview_clip,
            video_path=project.video_path,
            start_time=clip.start_time,
            duration=clip.duration,
            output_path=ig_preview_path,
            caption_text=clip.viral_caption,
            fill_mode=style.fill_mode,
            watermark_path=style.watermark_path,
            watermark_x=style.watermark_x,
            watermark_y=style.watermark_y,
            watermark_scale=style.watermark_scale,
            watermark_opacity=style.watermark_opacity,
            flip_horizontal=style.flip_horizontal,
            boost_contrast=style.boost_contrast,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Instagram preview failed: {str(e)}")

    if not os.path.exists(ig_preview_path):
        raise HTTPException(status_code=500, detail="Instagram preview not generated")

    return FileResponse(ig_preview_path, media_type="video/mp4")
