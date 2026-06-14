"""Editor mode routes — standalone manual editor (no AI clip detection).

Workflow:
1. POST /api/editor/upload — store video, create a Project with ONE ClipData
   covering the full video. No Gemini, no Whisper yet.
2. The frontend uses the existing /api/clips/{id}/1/edit endpoint to trim.
3. POST /api/editor/{id}/transcribe — on demand, extracts only the trimmed
   range and runs Whisper on it (~10s for a 30s clip instead of 20 min for
   the full hour). The transcript is shifted back to the full-video timeline
   so the existing preview/export pipeline works unchanged.
4. The frontend then uses existing endpoints for preview/export.

This route is intentionally thin — it leverages the same Project/ClipData/
StyleConfig models and preview/export services as the main Video Clipper.
"""
import os
import uuid
import shutil
import asyncio
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from ..config import settings
from ..models.project import Project
from ..models.clip import ClipData, Segment
from ..services import video_service, gemini_service, whisper_service
from .upload import get_project_store

router = APIRouter(prefix="/api/editor", tags=["editor"])


class SegmentInput(BaseModel):
    start: float
    end: float
    speed: float = 1.0
    type: str = "video"
    image_path: str | None = None
    duration: float = 0.0
    transition_in: str = "cut"
    transition_duration: float = 0.0


class SegmentsRequest(BaseModel):
    """Replace the clip's timeline segments wholesale."""
    segments: list[SegmentInput]


@router.post("/upload")
async def editor_upload(video: UploadFile = File(...)):
    """Upload a video and create a session for the standalone editor.

    Unlike the main /api/upload, this doesn't trigger Gemini analysis. We
    just store the file, probe its duration, and seed a Project with a
    single ClipData spanning the whole video (the user will trim it
    interactively before adding subtitles).
    """
    project_id = str(uuid.uuid4())[:8]
    upload_path = os.path.join(settings.UPLOAD_DIR, f"{project_id}_{video.filename}")

    with open(upload_path, "wb") as f:
        shutil.copyfileobj(video.file, f)

    duration = video_service.get_video_duration(upload_path)

    # Seed with one clip covering the full video. The frontend's "trim"
    # action reuses /api/clips/{id}/1/edit to set start_time/end_time.
    initial_clip = ClipData(
        id=1,
        start_time=0.0,
        end_time=duration,
        description="manual edit",
        viral_caption="",          # editor mode has no AI caption
        viral_reason="manual editor session",
        viral_score=0,
    )

    project = Project(
        id=project_id,
        video_filename=video.filename,
        video_path=upload_path,
        clip_count=1,
        min_duration=1,
        status="ready",            # skip the AI status flow entirely
        video_duration=duration,
        output_dir=os.path.join(settings.PROJECTS_DIR, project_id),
        clips=[initial_clip],
    )

    projects = get_project_store()
    projects[project_id] = project
    os.makedirs(project.output_dir, exist_ok=True)

    print(f"[Editor] new session project={project_id} file={video.filename} duration={duration:.1f}s")

    return {
        "project_id": project_id,
        "filename": video.filename,
        "duration": duration,
        "clip_id": initial_clip.id,
    }


@router.post("/{project_id}/transcribe")
async def editor_transcribe_trim(project_id: str):
    """Run Whisper on the currently-trimmed range only (not the full video).

    This is triggered when the user clicks "➕ Subtítulos" in the editor —
    they've already trimmed the part they care about, so we only spend
    Whisper time on that small piece. Timestamps in the returned transcript
    are in the FULL-VIDEO timeline (shifted back from the extract-local
    timeline) so the existing preview/export pipeline works as-is.
    """
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    if not project.clips:
        raise HTTPException(status_code=400, detail="No clip defined — call /upload first")

    clip = project.clips[0]      # editor mode always has exactly one clip
    start, end = float(clip.start_time), float(clip.end_time)
    if end - start < 0.5:
        raise HTTPException(status_code=400, detail="Trim range too short — please widen the trim")

    # Extract the trimmed audio to a temp file. We re-encode (accurate=True)
    # so Whisper's word timestamps line up with the source frame accurately —
    # stream-copy + keyframe snap can drift up to 10s, which would make the
    # subtitles desync vs the burned-in caption.
    temp_dir = os.path.join(os.path.dirname(__file__), "..", "services", "temp")
    os.makedirs(temp_dir, exist_ok=True)
    extract_path = os.path.join(temp_dir, f"editor_trim_{project_id}_{uuid.uuid4().hex[:8]}.mp4")

    try:
        print(f"[Editor] extracting trim {start:.1f}–{end:.1f}s ({end-start:.1f}s) for Whisper")
        await asyncio.to_thread(
            gemini_service.extract_video_chunk,
            project.video_path, start, end, extract_path, True,
        )

        print(f"[Editor] running Whisper on extracted trim")
        transcript = await asyncio.to_thread(whisper_service.transcribe, extract_path)
        word_count = len(transcript.get("words", []))
        print(f"[Editor] Whisper done — {word_count} words")

        # Shift transcript times back to the FULL-VIDEO timeline so the
        # existing subtitle generator (which filters by clip.start_time /
        # clip.end_time) finds them at the right place.
        for w in transcript.get("words", []):
            w["start"] = round(w.get("start", 0) + start, 3)
            w["end"] = round(w.get("end", 0) + start, 3)

        project.transcript = transcript

        # Cache the trim range that produced this transcript so the frontend
        # can warn if the user changes the trim afterwards.
        project.analyze_start = start
        project.analyze_duration = end - start

        # Return the words too so the frontend can render subtitles live
        # over the HTML <video> in sync with currentTime — no need to round-
        # trip to FFmpeg for every style/size/position change while editing.
        return {
            "status": "ok",
            "word_count": word_count,
            "language": transcript.get("language", "unknown"),
            "trim_start": start,
            "trim_end": end,
            "words": transcript.get("words", []),
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    finally:
        # Always clean up the temp extract
        if os.path.exists(extract_path):
            try:
                os.remove(extract_path)
            except Exception:
                pass


@router.post("/{project_id}/translate-spanish")
async def editor_translate_spanish(project_id: str):
    """Translate the editor's Whisper transcript to Spanish via Gemini and
    cache the result on the editor clip (clip[0].words_es).

    Idempotent — returns the cache if already translated. Returns the word
    list with timestamps so the frontend can update its live SubtitleOverlay
    immediately without an extra round-trip.

    Editor mode has no AI caption, so caption_es is left empty; only the
    Whisper words are translated.
    """
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    if not project.clips:
        raise HTTPException(status_code=400, detail="No clip — call /upload first")
    clip = project.clips[0]

    transcript = getattr(project, "transcript", None) or {}
    words = transcript.get("words", []) if isinstance(transcript, dict) else []
    if not words:
        raise HTTPException(status_code=400, detail="No transcript — click ➕ Subtítulos first to run Whisper")

    # Idempotent — cached return when already translated for this exact trim
    cached = getattr(clip, "words_es", None) or []
    if cached:
        return {"status": "cached", "words": cached}

    # The transcript words use FULL-VIDEO timestamps (editor_transcribe_trim
    # shifts them back to source time). translate_clip_to_spanish uses the
    # words' actual start/end as the time anchor, so the returned words_es
    # land in the same source-time range and the existing subtitle pipeline
    # picks them up unchanged.
    target_model = getattr(project, "gemini_model", None) or settings.GEMINI_MODEL
    try:
        result = gemini_service.translate_clip_to_spanish(
            caption=clip.viral_caption or "",
            words=words,
            model=target_model,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Translation failed: {e}")

    if not result:
        raise HTTPException(status_code=500, detail="Translation returned empty")

    # Editor has no AI caption box, but we still store caption_es if Gemini
    # returned one (harmless — only used if the user enables a caption later).
    clip.caption_es = result.get("caption_es", "") or ""
    clip.words_es = result.get("words_es", []) or []

    return {"status": "translated", "words": clip.words_es}


class ReframeStyleRequest(BaseModel):
    """Auto-reframe knobs the editor's UI panel sends. All fields optional —
    only the ones the user actually changed need to be in the payload."""
    auto_reframe_enabled: bool | None = None
    auto_reframe_mode: str | None = None         # "all" | "biggest" | "follow"
    auto_reframe_follow_id: int | None = None
    auto_reframe_padding: float | None = None
    auto_reframe_smoothing: float | None = None


@router.post("/{project_id}/analyze-faces")
async def editor_analyze_faces(project_id: str):
    """Run MediaPipe face detection over the editor's current trim and cache
    the resulting face_track on clip[0]. Returns the people list (for the
    Manual-pick grid) and sample count.

    Synchronous — for clips < 5 min this is fast enough (typically 30–60s
    on CPU). Longer trims may take longer; the frontend shows a spinner.
    """
    from ..services import face_track_service

    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    if not project.clips:
        raise HTTPException(status_code=400, detail="No clip — call /upload first")
    clip = project.clips[0]

    if clip.end_time - clip.start_time < 0.5:
        raise HTTPException(status_code=400, detail="Trim too short — widen the trim first")

    try:
        face_track = await asyncio.to_thread(
            face_track_service.analyze_clip,
            project.video_path,
            float(clip.start_time),
            float(clip.end_time),
            5.0,    # sample fps
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Face analysis failed: {str(e)}")

    clip.face_track = face_track
    # Default mode = "all" with auto-reframe disabled; the user has to click
    # "Aplicar al export" to actually turn it on. Reasonable defaults set on
    # the style so the live preview overlay can render before the user picks.
    if project.style.auto_reframe_mode not in ("all", "biggest", "follow"):
        project.style.auto_reframe_mode = "all"

    return {
        "status": "ok",
        "sample_count": len(face_track.get("samples", [])),
        "people": face_track.get("people", []),
        "width": face_track.get("width"),
        "height": face_track.get("height"),
        "start_time": face_track.get("start_time"),
        "end_time": face_track.get("end_time"),
        # The full samples list is large but the frontend uses it for the live
        # viewfinder overlay — sending it once on analyze avoids a follow-up
        # round-trip. ~600 KB for a 5-min clip at 5 FPS, acceptable.
        "samples": face_track.get("samples", []),
    }


@router.post("/{project_id}/reframe-style")
async def editor_update_reframe_style(project_id: str, req: ReframeStyleRequest):
    """Update auto-reframe knobs on the project style. Lightweight — used by
    the inspector sliders + mode picker. Returns the resulting style snapshot."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    s = project.style
    if req.auto_reframe_enabled is not None:
        s.auto_reframe_enabled = bool(req.auto_reframe_enabled)
        # Safety: auto-reframe is incompatible with split-screen (both want the
        # FG region). Turning one on turns the other off.
        if s.auto_reframe_enabled and s.split_screen_enabled:
            s.split_screen_enabled = False
    if req.auto_reframe_mode in ("all", "biggest", "follow"):
        s.auto_reframe_mode = req.auto_reframe_mode
    if req.auto_reframe_follow_id is not None:
        s.auto_reframe_follow_id = int(req.auto_reframe_follow_id)
    if req.auto_reframe_padding is not None:
        s.auto_reframe_padding = max(0.0, min(1.0, float(req.auto_reframe_padding)))
    if req.auto_reframe_smoothing is not None:
        s.auto_reframe_smoothing = max(0.0, min(0.99, float(req.auto_reframe_smoothing)))
    return {
        "status": "ok",
        "auto_reframe_enabled": s.auto_reframe_enabled,
        "auto_reframe_mode": s.auto_reframe_mode,
        "auto_reframe_follow_id": s.auto_reframe_follow_id,
        "auto_reframe_padding": s.auto_reframe_padding,
        "auto_reframe_smoothing": s.auto_reframe_smoothing,
    }


@router.get("/{project_id}/preview-reframe")
async def editor_preview_reframe(project_id: str, seconds: float = 10.0):
    """Render a short MP4 sample with auto-reframe applied so the user can
    verify the framing before committing to the full export.

    Picks the busiest stretch of the clip — the timestamp with the most
    detected faces, so the preview is meaningful (not 10s of empty frames).
    Renders ~`seconds` of output (default 10s) starting there.
    """
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    if not project.clips:
        raise HTTPException(status_code=400, detail="No clip — call /upload first")
    clip = project.clips[0]

    ft = getattr(clip, "face_track", None) or {}
    if not ft.get("samples"):
        raise HTTPException(status_code=400, detail="Run /analyze-faces first")

    # Pick the busiest sample (most faces visible) as preview anchor — if the
    # whole clip has 1 person, picks the moment with highest confidence.
    samples = ft["samples"]
    def _score(s):
        return (len(s.get("faces", [])), sum(f.get("confidence", 0) for f in s.get("faces", [])))
    anchor = max(samples, key=_score) if samples else None
    if not anchor:
        raise HTTPException(status_code=400, detail="Empty face track — analyze again")
    anchor_t = float(anchor.get("t", clip.start_time))
    half = max(2.0, min(30.0, seconds / 2))
    sample_start = max(float(clip.start_time), anchor_t - half)
    sample_end = min(float(clip.end_time), sample_start + seconds)
    if sample_end - sample_start < 1.0:
        sample_start = float(clip.start_time)
        sample_end = min(float(clip.end_time), sample_start + seconds)

    # Build an ephemeral clip with the sample range, copy style with auto-reframe
    # forced ON regardless of project.style.auto_reframe_enabled — this endpoint
    # ALWAYS renders the auto-reframe so the user can compare.
    from .. import services as _svcs    # local to avoid module-level import recursion
    from ..services import export_service as _ex
    sample_clip = clip.model_copy(deep=True)
    sample_clip.start_time = sample_start
    sample_clip.end_time = sample_end
    sample_clip.duration = sample_end - sample_start
    sample_clip.segments = []           # preview always single-range
    sample_style = project.style.model_copy(deep=True)
    sample_style.auto_reframe_enabled = True
    sample_style.split_screen_enabled = False

    os.makedirs(project.output_dir, exist_ok=True)
    output_path = os.path.join(project.output_dir, f"preview_reframe_{uuid.uuid4().hex[:8]}.mp4")

    try:
        await asyncio.to_thread(
            _ex.export_clip_with_style,
            project.video_path, sample_clip, sample_style, output_path,
            getattr(project, "transcript", None), "en",
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Reframe preview failed: {str(e)}")

    if not os.path.exists(output_path):
        raise HTTPException(status_code=500, detail="Preview not generated")
    return FileResponse(output_path, media_type="video/mp4")


@router.post("/{project_id}/thumbnails")
async def editor_thumbnails(project_id: str, count: int = 30):
    """Generate (or regenerate) the timeline thumbnail strip for the video.

    Returns a list of {time, url} the frontend paints across the timeline.
    Thumbnails are cached on disk in the project's output_dir/thumbs.
    """
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]

    thumbs_dir = os.path.join(project.output_dir, "thumbs")
    try:
        thumbs = await asyncio.to_thread(
            video_service.generate_thumbnails,
            project.video_path, thumbs_dir, count, project.video_duration,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Thumbnail generation failed: {str(e)}")

    return {
        "count": len(thumbs),
        "duration": project.video_duration,
        "thumbnails": [
            {"time": t["time"], "url": f"/api/editor/{project_id}/thumb/{t['file']}"}
            for t in thumbs
        ],
    }


@router.post("/{project_id}/overlay-image")
async def editor_upload_overlay_image(project_id: str, image: UploadFile = File(...)):
    """Upload an image to use as a video overlay. Returns its server path + URL."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]

    overlays_dir = os.path.join(project.output_dir, "overlays")
    os.makedirs(overlays_dir, exist_ok=True)
    # Keep extension; unique name so multiple overlays don't collide
    ext = os.path.splitext(image.filename or "")[1].lower() or ".png"
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        ext = ".png"
    fname = f"overlay_{uuid.uuid4().hex[:8]}{ext}"
    fpath = os.path.join(overlays_dir, fname)
    with open(fpath, "wb") as f:
        shutil.copyfileobj(image.file, f)

    return {
        "path": fpath,
        "url": f"/api/editor/{project_id}/overlay/{fname}",
        "filename": fname,
    }


@router.get("/{project_id}/overlay/{filename}")
async def editor_overlay_file(project_id: str, filename: str):
    """Serve an uploaded overlay image."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = os.path.join(projects[project_id].output_dir, "overlays", filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Overlay not found")
    return FileResponse(path)


@router.post("/{project_id}/music")
async def editor_upload_music(project_id: str, audio: UploadFile = File(...)):
    """Upload a background-music track for the editor. Returns server path + URL.
    The path is stored in StyleConfig.music_path and mixed in on export."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]

    music_dir = os.path.join(project.output_dir, "music")
    os.makedirs(music_dir, exist_ok=True)
    ext = os.path.splitext(audio.filename or "")[1].lower()
    if ext not in (".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus", ".flac"):
        ext = ".mp3"
    fname = f"music_{uuid.uuid4().hex[:8]}{ext}"
    fpath = os.path.join(music_dir, fname)
    with open(fpath, "wb") as f:
        shutil.copyfileobj(audio.file, f)

    # Waveform peaks for the editor's audio track (the little bars).
    peaks = video_service.get_audio_peaks(fpath, buckets=320)

    return {
        "path": fpath,
        "url": f"/api/editor/{project_id}/music/{fname}",
        "filename": audio.filename or fname,
        "peaks": peaks,
    }


@router.get("/{project_id}/music/{filename}")
async def editor_music_file(project_id: str, filename: str):
    """Serve an uploaded music track (for preview playback in the editor)."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = os.path.join(projects[project_id].output_dir, "music", filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Music not found")
    return FileResponse(path)


@router.get("/{project_id}/thumb/{filename}")
async def editor_thumb_file(project_id: str, filename: str):
    """Serve a single timeline thumbnail JPEG."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    # Basic traversal guard
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = os.path.join(projects[project_id].output_dir, "thumbs", filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(path, media_type="image/jpeg")


@router.put("/{project_id}/segments")
async def editor_save_segments(project_id: str, req: SegmentsRequest):
    """Save the timeline editor's cut segments for the clip.

    Empty list = revert to single-range (start_time/end_time) mode. Non-empty
    = multi-segment mode (export concatenates the kept pieces). Also updates
    start_time/end_time to span the kept range and recomputes duration.
    """
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    if not project.clips:
        raise HTTPException(status_code=400, detail="No clip in session")

    clip = project.clips[0]
    # Clamp + drop zero-length pieces. DO NOT sort — the array order is the
    # playback/export order so the user can reorder pieces (CapCut style).
    clean = []
    for s in req.segments:
        t_in = (s.transition_in or "cut").lower()
        t_dur = max(0.0, min(3.0, float(s.transition_duration or 0)))
        if s.type == "image":
            clean.append(Segment(start=0.0, end=0.0, type="image",
                                 image_path=s.image_path, duration=max(0.5, float(s.duration or 3.0)),
                                 transition_in=t_in, transition_duration=t_dur))
            continue
        a = max(0.0, min(project.video_duration, float(s.start)))
        b = max(0.0, min(project.video_duration, float(s.end)))
        if b - a > 0.05:
            clean.append(Segment(start=round(a, 3), end=round(b, 3),
                                 speed=max(0.25, min(4.0, float(s.speed or 1.0))),
                                 transition_in=t_in, transition_duration=t_dur))
    clip.segments = clean

    # Source range covered by VIDEO segments (for transcription windowing)
    vid = [s for s in clean if s.type == "video"]
    if vid:
        clip.start_time = min(seg.start for seg in vid)
        clip.end_time = max(seg.end for seg in vid)
    # Output duration accounts for speed, image durations, AND xfade overlap.
    from ..services import video_service
    clip.duration = (video_service.total_output_duration([s.model_dump() for s in clean])
                     if clean else (clip.end_time - clip.start_time))

    return {
        "status": "ok",
        "segments": [s.model_dump() for s in clean],
        "total_duration": clip.duration,
    }


@router.get("/{project_id}")
async def editor_session_info(project_id: str):
    """Get current state of an editor session (trim range, transcript status)."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    p = projects[project_id]
    if not p.clips:
        raise HTTPException(status_code=400, detail="Session has no clip")
    clip = p.clips[0]
    return {
        "project_id": p.id,
        "filename": p.video_filename,
        "duration": p.video_duration,
        "clip_id": clip.id,
        "trim_start": clip.start_time,
        "trim_end": clip.end_time,
        "segments": [s.model_dump() for s in getattr(clip, "segments", [])],
        "has_transcript": p.transcript is not None,
        "transcript_word_count": len(p.transcript.get("words", [])) if p.transcript else 0,
        "transcript_trim_start": getattr(p, "analyze_start", 0.0),
        "transcript_trim_duration": getattr(p, "analyze_duration", 0.0),
    }
