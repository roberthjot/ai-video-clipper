import os
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
            await asyncio.to_thread(gemini_service.delete_file, active_file)
            raise HTTPException(
                status_code=400,
                detail=f"Video too large for AI: {token_count:,} tokens (max {MAX_TOKENS:,}). "
                       f"Your video is {mins} min. Please use a video under 45 minutes."
            )
        duration = req.duration_override or project.video_duration

        # Transcribe audio with Whisper for more accurate timestamps + subtitles
        transcript = None
        try:
            print("[Whisper] Transcribing audio for timestamp accuracy...")
            transcript = await asyncio.to_thread(whisper_service.transcribe, project.video_path)
            project.transcript = transcript  # Save for subtitle generation later
        except Exception as e:
            print(f"[Whisper] Transcription failed (continuing without it): {e}")

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
                    "Return ONLY the caption text — nothing else."
                )),
            ])],
            config=_types.GenerateContentConfig(temperature=0.5),
        )

        import re as _re
        new_caption = response.text.strip().rstrip(".")
        new_caption = _re.sub(r"[^\w\s']", '', new_caption).strip()
        new_caption = _re.sub(r'\s+', ' ', new_caption).strip()
        new_caption = new_caption[:1].upper() + new_caption[1:].lower() if new_caption else new_caption

        # Update the clip in memory
        clip.viral_caption = new_caption
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
