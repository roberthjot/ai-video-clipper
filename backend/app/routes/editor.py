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
        if s.type == "image":
            clean.append(Segment(start=0.0, end=0.0, type="image",
                                 image_path=s.image_path, duration=max(0.5, float(s.duration or 3.0))))
            continue
        a = max(0.0, min(project.video_duration, float(s.start)))
        b = max(0.0, min(project.video_duration, float(s.end)))
        if b - a > 0.05:
            clean.append(Segment(start=round(a, 3), end=round(b, 3),
                                 speed=max(0.25, min(4.0, float(s.speed or 1.0)))))
    clip.segments = clean

    # Source range covered by VIDEO segments (for transcription windowing)
    vid = [s for s in clean if s.type == "video"]
    if vid:
        clip.start_time = min(seg.start for seg in vid)
        clip.end_time = max(seg.end for seg in vid)
    # Output duration accounts for speed (video) + image durations
    def _odur(seg):
        if seg.type == "image":
            return seg.duration
        return (seg.end - seg.start) / max(0.25, seg.speed)
    clip.duration = sum(_odur(s) for s in clean) if clean else (clip.end_time - clip.start_time)

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
