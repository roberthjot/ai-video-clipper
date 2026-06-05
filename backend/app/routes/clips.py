import os
import math
import uuid
import asyncio
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from ..services import gemini_service, video_service, whisper_service, prompts
from ..models.clip import Keyframe
from .upload import get_project_store

router = APIRouter(prefix="/api/clips", tags=["clips"])


class AnalyzeRequest(BaseModel):
    project_id: str
    duration_override: float | None = None


class EditCaptionRequest(BaseModel):
    viral_caption: str


class UpdateModelRequest(BaseModel):
    gemini_model: str


class ModelHealthRequest(BaseModel):
    models: list[str] | None = None


class KeyframeInput(BaseModel):
    """Wire format for a single keyframe coming from the editor modal."""
    time: float          # seconds from clip start
    zoom: float = 1.0
    pan_x: float = 0.0
    pan_y: float = 0.0


class EditTransformRequest(BaseModel):
    """Per-clip edit set by the editor modal (zoom + pan + trim + keyframes).

    `keyframes` semantics:
      - None  → leave clip.keyframes unchanged
      - []    → clear keyframes (revert to static mode)
      - [...] → replace keyframes wholesale
    Trim (start_time/end_time) is independent of keyframes and applies in both
    static and animated modes.
    """
    edit_zoom: float = 1.0
    edit_pan_x: float = 0.0
    edit_pan_y: float = 0.0
    start_time: float | None = None
    end_time: float | None = None
    keyframes: list[KeyframeInput] | None = None


@router.post("/analyze")
async def analyze_video(req: AnalyzeRequest):
    """Start AI analysis on a project's video."""
    projects = get_project_store()
    if req.project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[req.project_id]

    active_file = None
    extracted_range_path = None  # if user asked to analyze only a sub-range
    try:
        # If user specified an analyze range, extract just those seconds into a
        # temp file. Both Whisper and Gemini will work on this smaller file;
        # we'll shift timestamps back to the original video timeline at the end.
        analyze_start = float(getattr(project, 'analyze_start', 0.0) or 0.0)
        analyze_duration = float(getattr(project, 'analyze_duration', 0.0) or 0.0)
        needs_extraction = analyze_start > 0 or (
            analyze_duration > 0 and analyze_duration < project.video_duration
        )

        if needs_extraction:
            range_end = analyze_start + (analyze_duration or (project.video_duration - analyze_start))
            temp_dir = os.path.join(os.path.dirname(__file__), "..", "services", "temp")
            os.makedirs(temp_dir, exist_ok=True)
            extracted_range_path = os.path.join(temp_dir, f"analyze_range_{project.id}_{uuid.uuid4().hex[:8]}.mp4")
            print(f"[Analyze] Extracting accurate range {analyze_start:.0f}s — {range_end:.0f}s "
                  f"({(range_end - analyze_start)/60:.1f} min) — this re-encodes (~30s) for "
                  f"frame-accurate timestamps so subtitles align with audio.")
            # accurate=True (default) — re-encodes so Whisper word timestamps
            # match the audio exactly. Stream-copy keyframe snap would drift
            # subtitles by 0-10 seconds depending on the source's keyframe
            # interval, which is what 'subtitles don't match' bug reports trace to.
            await asyncio.to_thread(
                gemini_service.extract_video_chunk,
                project.video_path, analyze_start, range_end, extracted_range_path, True,
            )
            video_for_analysis = extracted_range_path
            effective_duration = range_end - analyze_start
        else:
            video_for_analysis = project.video_path
            effective_duration = project.video_duration
            analyze_start = 0.0  # no shift needed

        # Start Whisper transcription IN PARALLEL with Gemini upload + processing.
        # Whisper runs on local CPU; Gemini runs on Google's servers — they don't
        # compete for resources. By the time Gemini is ready, Whisper is often done.
        print("[Whisper] Starting transcription in parallel with Gemini upload...")
        whisper_task = asyncio.create_task(
            asyncio.to_thread(whisper_service.transcribe, video_for_analysis)
        )

        project.status = "uploading"
        file_obj = await asyncio.to_thread(gemini_service.upload_video, video_for_analysis)

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
        duration = req.duration_override or effective_duration

        # Wait for Whisper to finish (usually done by now since it ran in parallel).
        # IMPORTANT: keep the transcript in EXTRACT-LOCAL timeline (0..duration)
        # while Gemini is analyzing — both Gemini and the transcript see the
        # same time window. We shift both to the ORIGINAL video timeline only
        # AFTER all analysis is done.
        transcript = None
        try:
            transcript = await whisper_task
            print(f"[Whisper] Transcription ready ({len(transcript.get('words', []))} words)")
        except Exception as e:
            print(f"[Whisper] Transcription failed (continuing without it): {e}")

        # If the (effective) video is long enough, switch to chunked analysis.
        # Note: we work on the EXTRACTED file, so chunking divides that, not
        # the original. _analyze_in_chunks receives video_for_analysis explicitly.
        if duration > gemini_service.CHUNK_THRESHOLD_SECONDS:
            print(f"[Analyze] Effective video is {duration/60:.1f} min — using chunked analysis")
            await asyncio.to_thread(gemini_service.delete_file, active_file)
            active_file = None
            clips = await _analyze_in_chunks(project, duration, transcript, video_for_analysis)
        else:
            # Single-shot (videos under the chunked threshold). Wrap in the
            # same retry policy as _analyze_in_chunks so a transient Gemini
            # blip ("empty response") doesn't return 0 clips and force the
            # user to re-upload — most empty-response failures clear within
            # a few seconds when Google's load shifts.
            async def _single_shot_with_retry(max_attempts=3):
                last_err = None
                for attempt in range(1, max_attempts + 1):
                    try:
                        return await asyncio.to_thread(
                            gemini_service.analyze_video,
                            active_file,
                            duration,
                            project.clip_count,
                            project.min_duration,
                            project.custom_prompt,
                            0,
                            transcript,
                            project.gemini_model,
                            getattr(project, 'creator_name', ''),
                        )
                    except Exception as e:
                        last_err = e
                        msg = str(e).lower()
                        # Permanent failures — don't burn retries.
                        if any(p in msg for p in ("quota", "permission", "invalid", "not found", "400 ", "403 ", "404 ")):
                            raise
                        if attempt < max_attempts:
                            delay = 5 if attempt == 1 else 15
                            print(f"[Analyze] single-shot attempt {attempt} failed ({e}) — retrying in {delay}s")
                            await asyncio.sleep(delay)
                raise last_err

            clips = await _single_shot_with_retry()
            print(f"[Analyze] single-shot got {len(clips)}/{project.clip_count} clips")

        # Shift BOTH clips and transcript to the ORIGINAL video timeline if we
        # analyzed a sub-range. After this, all timestamps refer to the original
        # video file, so preview/export/validation all work without any other
        # changes.
        if analyze_start > 0:
            for c in clips:
                c.start_time = round(c.start_time + analyze_start, 2)
                c.end_time = round(c.end_time + analyze_start, 2)
            if transcript:
                for w in transcript.get("words", []):
                    w["start"] = round(w.get("start", 0) + analyze_start, 3)
                    w["end"] = round(w.get("end", 0) + analyze_start, 3)
            print(f"[Analyze] Shifted {len(clips)} clips + transcript by +{analyze_start:.0f}s")

        # Save transcript (now in original-video timeline) for subtitle generation later
        if transcript:
            project.transcript = transcript

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
        # Clean up the extracted range temp file (if any)
        if extracted_range_path and os.path.exists(extracted_range_path):
            try:
                os.remove(extracted_range_path)
                print(f"[Analyze] Cleaned up extracted range file")
            except Exception:
                pass


async def _analyze_in_chunks(project, duration: float, transcript: dict, video_path: str = None) -> list:
    """Split a long video into chunks of ~10 min, analyze each separately, then
    merge the results. Each chunk gives Gemini a much smaller time window so its
    timestamps stay precise. Chunk-local timestamps are shifted back to the
    extracted-file global timeline before merging. (An additional shift by
    analyze_start happens at the caller for original-video timeline.)

    `video_path` overrides project.video_path — used when analyzing a
    pre-extracted sub-range so chunking operates on the extracted file.
    """
    source_video = video_path or project.video_path
    ranges = gemini_service.build_chunk_ranges(duration, gemini_service.CHUNK_DURATION_SECONDS)
    n_chunks = len(ranges)
    # Ask for 1 extra clip per chunk to compensate for dedup at merge time.
    # Without this, asking for 9 with 2 chunks (5+5 = 10 candidates) often
    # ends up at 7-8 after dedup. With +1 per chunk (6+6 = 12 candidates) the
    # dedup hits less often leave us short of the target.
    clips_per_chunk = max(1, math.ceil(project.clip_count / n_chunks) + 1)
    print(f"[Chunked] {n_chunks} chunks, ~{clips_per_chunk} clips each (target {project.clip_count} after dedup)")

    temp_dir = os.path.join(os.path.dirname(__file__), "..", "services", "temp")
    os.makedirs(temp_dir, exist_ok=True)

    # Retry helper: most "empty response" failures from Gemini are transient
    # (server capacity, rate-limit edge cases). We retry the analyze step
    # specifically — extraction/upload rarely fails so they stay one-shot.
    async def _analyze_with_retry(chunk_file, chunk_duration, chunk_transcript, label, max_attempts=3):
        last_err = None
        for attempt in range(1, max_attempts + 1):
            try:
                return await asyncio.to_thread(
                    gemini_service.analyze_video,
                    chunk_file,
                    chunk_duration,
                    clips_per_chunk,
                    project.min_duration,
                    project.custom_prompt,
                    0,
                    chunk_transcript,
                    project.gemini_model,
                    getattr(project, 'creator_name', ''),
                )
            except Exception as e:
                last_err = e
                msg = str(e).lower()
                # Bail out immediately on permanent failures so we don't burn
                # quota retrying something that can't succeed.
                if any(p in msg for p in ("quota", "permission", "invalid", "not found", "400 ", "403 ", "404 ")):
                    raise
                if attempt < max_attempts:
                    # Exponential-ish backoff: 5s, 15s. Most empty-response
                    # blips clear within seconds when Google's load shifts.
                    delay = 5 if attempt == 1 else 15
                    print(f"[Chunked] {label} attempt {attempt} failed ({e}) — retrying in {delay}s")
                    await asyncio.sleep(delay)
        raise last_err

    all_clips = []
    failed_chunks = []
    for idx, (chunk_start, chunk_end) in enumerate(ranges):
        chunk_duration = chunk_end - chunk_start
        chunk_path = os.path.join(temp_dir, f"chunk_{uuid.uuid4().hex}.mp4")
        chunk_file = None
        label = f"Chunk {idx+1}/{n_chunks}"
        try:
            print(f"[Chunked] Extracting {label}: {chunk_start:.0f}s-{chunk_end:.0f}s")
            # accurate=True so chunk timestamps line up with the audio
            # (no keyframe-snap drift across chunk boundaries).
            await asyncio.to_thread(
                gemini_service.extract_video_chunk,
                source_video, chunk_start, chunk_end, chunk_path, True,
            )
            chunk_file = await asyncio.to_thread(gemini_service.upload_video, chunk_path)
            chunk_file = await asyncio.to_thread(gemini_service.wait_for_processing, chunk_file)

            chunk_transcript = gemini_service.filter_transcript_for_range(
                transcript, chunk_start, chunk_end
            ) if transcript else None

            chunk_clips = await _analyze_with_retry(chunk_file, chunk_duration, chunk_transcript, label)

            # Shift chunk-local timestamps to global video time
            for c in chunk_clips:
                c.start_time = round(c.start_time + chunk_start, 2)
                c.end_time = round(c.end_time + chunk_start, 2)
            all_clips.extend(chunk_clips)
            print(f"[Chunked] {label} done — {len(chunk_clips)} clips")
        except Exception as e:
            failed_chunks.append((idx + 1, str(e)))
            print(f"[Chunked] {label} FAILED after retries: {e}")
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

    candidate_count = len(all_clips)

    # Truncate to user-requested total
    if len(all_clips) > project.clip_count:
        all_clips = all_clips[:project.clip_count]
        for i, c in enumerate(all_clips):
            c.id = i + 1

    # Loud summary so we always know whether the user got what they asked for.
    print(
        f"[Chunked] DONE — got {len(all_clips)}/{project.clip_count} clips "
        f"(candidates: {candidate_count}, failed chunks: {len(failed_chunks)}/{n_chunks})"
    )
    if failed_chunks:
        print(f"[Chunked] Failures: {failed_chunks}")
    if len(all_clips) < project.clip_count:
        deficit = project.clip_count - len(all_clips)
        print(
            f"[Chunked] WARNING: short by {deficit} clip(s). "
            f"Likely cause: {'failed chunks (Gemini empty response or rate-limit)' if failed_chunks else 'aggressive dedup'}."
        )

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
    allowed = gemini_service.VIDEO_ANALYSIS_MODELS
    if req.gemini_model not in allowed:
        raise HTTPException(status_code=400, detail=f"Model must be one of {sorted(allowed)}")
    projects[project_id].gemini_model = req.gemini_model
    return {"status": "updated", "gemini_model": req.gemini_model}


@router.post("/model-health")
async def check_model_health(req: ModelHealthRequest):
    """Lightweight availability check for Gemini models.

    Sends a tiny text prompt ("ok"). This helps catch obvious 429/503 failures
    before uploading/analyzing a video, but video requests can still fail later.
    """
    requested = req.models or sorted(gemini_service.VIDEO_ANALYSIS_MODELS)
    models = [m for m in requested if m in gemini_service.VIDEO_ANALYSIS_MODELS]
    if not models:
        raise HTTPException(status_code=400, detail="No valid models provided")

    results = []
    for model in models:
        result = await asyncio.to_thread(gemini_service.check_model_health, model)
        results.append(result)
    return {"models": results}


@router.get("/{project_id}/raw-video")
async def stream_raw_video(project_id: str):
    """Stream the raw uploaded video (used by the in-app editor modal so the
    <video> element can play arbitrary timestamps for live preview)."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    path = projects[project_id].video_path
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Source video missing on disk")
    return FileResponse(path, media_type="video/mp4")


@router.put("/{project_id}/{clip_id}/edit")
async def edit_clip_transform(project_id: str, clip_id: int, req: EditTransformRequest):
    """Save the in-app editor's zoom/pan/trim values for a specific clip."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    for clip in project.clips:
        if clip.id == clip_id:
            clip.edit_zoom = max(0.3, min(3.0, float(req.edit_zoom)))
            clip.edit_pan_x = max(-50.0, min(50.0, float(req.edit_pan_x)))
            clip.edit_pan_y = max(-50.0, min(50.0, float(req.edit_pan_y)))
            if req.start_time is not None:
                clip.start_time = max(0.0, float(req.start_time))
            if req.end_time is not None:
                clip.end_time = max(clip.start_time + 1.0, float(req.end_time))
            clip.duration = clip.end_time - clip.start_time
            # Keyframes replace wholesale. None = no change, [] = clear.
            if req.keyframes is not None:
                clip_dur = clip.duration
                normalised: list[Keyframe] = []
                for kf in req.keyframes:
                    # Clamp time into [0, clip_duration] so keyframes can't
                    # land outside the trimmed range (would make the FFmpeg
                    # expression evaluate constants past clip end).
                    t = max(0.0, min(clip_dur, float(kf.time)))
                    # zoompan can't zoom out below 1.0, so clamp to [1, 3].
                    z = max(1.0, min(3.0, float(kf.zoom)))
                    px = max(-100.0, min(100.0, float(kf.pan_x)))
                    py = max(-100.0, min(100.0, float(kf.pan_y)))
                    normalised.append(Keyframe(time=t, zoom=z, pan_x=px, pan_y=py))
                normalised.sort(key=lambda k: k.time)
                clip.keyframes = normalised
            return {"status": "updated", "clip": clip.model_dump()}
    raise HTTPException(status_code=404, detail="Clip not found")


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

    style = clip.style_override or project.style

    # Keyframes mode: the single-frame preview can't run the full zoompan
    # animation, so we interpolate the keyframes at the clip midpoint and
    # feed those values to the static preview path. The pan ranges differ
    # slightly between overlay-shift (static) and source-crop (zoompan), but
    # for a thumbnail this is close enough — the user sees the real animation
    # via the Play button.
    _kfs = getattr(clip, 'keyframes', []) or []
    if _kfs:
        _interp = video_service.interpolate_keyframes(_kfs, clip.duration / 2)
        _ez = _interp["zoom"]
        _epx = max(-50.0, min(50.0, _interp["pan_x"] / 2))   # halve to roughly match overlay semantics
        _epy = max(-50.0, min(50.0, _interp["pan_y"] / 2))
    else:
        _ez = getattr(clip, 'edit_zoom', 1.0)
        _epx = getattr(clip, 'edit_pan_x', 0.0)
        _epy = getattr(clip, 'edit_pan_y', 0.0)

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
            background_style=getattr(style, 'background_style', 'blur'),
            no_text=getattr(style, 'no_text', False),
            caption_font=getattr(style, 'caption_font', 'calibri'),
            caption_box_radius=getattr(style, 'caption_box_radius', 0.28),
            caption_box_opacity=getattr(style, 'caption_box_opacity', 0.95),
            caption_box_color=getattr(style, 'caption_box_color', '#FFFFFF'),
            caption_box_pad_x=getattr(style, 'caption_box_pad_x', 14),
            caption_box_pad_y=getattr(style, 'caption_box_pad_y', 14),
            no_emojis=getattr(style, 'no_emojis', False),
            edit_zoom=_ez,
            edit_pan_x=_epx,
            edit_pan_y=_epy,
            fill_mode_scale=getattr(style, 'fill_mode_scale', 1.0),
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

    style = clip.style_override or project.style

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
            subtitle_y=getattr(style, 'subtitle_y', 0.0),
            background_style=getattr(style, 'background_style', 'blur'),
            no_text=getattr(style, 'no_text', False),
            caption_font=getattr(style, 'caption_font', 'calibri'),
            caption_box_radius=getattr(style, 'caption_box_radius', 0.28),
            caption_box_opacity=getattr(style, 'caption_box_opacity', 0.95),
            caption_box_color=getattr(style, 'caption_box_color', '#FFFFFF'),
            caption_box_pad_x=getattr(style, 'caption_box_pad_x', 14),
            caption_box_pad_y=getattr(style, 'caption_box_pad_y', 14),
            no_emojis=getattr(style, 'no_emojis', False),
            edit_zoom=getattr(clip, 'edit_zoom', 1.0),
            edit_pan_x=getattr(clip, 'edit_pan_x', 0.0),
            edit_pan_y=getattr(clip, 'edit_pan_y', 0.0),
            fill_mode_scale=getattr(style, 'fill_mode_scale', 1.0),
            keyframes=getattr(clip, 'keyframes', []) or [],
        )
    except Exception as e:
        # Print the full traceback so the actual cause is visible in the
        # backend console (without this, the route just returns 500 and the
        # underlying Python/FFmpeg error is lost).
        import traceback
        traceback.print_exc()
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
    style = clip.style_override or project.style

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
                _types.Part.from_text(text=prompts.render("reanalyze_clip")),
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

    style = clip.style_override or project.style

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
