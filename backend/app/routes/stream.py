import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from ..models.clip import StreamStartRequest
from ..services import stream_service, twitch_service, twitch_chat_service

router = APIRouter()


@router.post("/twitch-chat-velocity/start")
def start_chat_velocity(url: str = "", video_id: str = ""):
    """Kick off (or reuse) the chat-velocity download for a VOD.
    Returns immediately — frontend polls /status/{video_id} for progress."""
    vid = video_id.strip() or twitch_service.extract_video_id(url)
    if not vid:
        raise HTTPException(status_code=400, detail="Provide a Twitch VOD URL or video_id")
    try:
        job = twitch_chat_service.start_velocity_job(vid)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"video_id": vid, "status": job["status"], "progress": job.get("progress", 0)}


@router.get("/twitch-chat-velocity/status/{video_id}")
def get_chat_velocity_status(video_id: str):
    """Poll a chat-velocity job. While running, returns {status, progress}.
    When ready, also returns the full buckets array + top peaks."""
    job = twitch_chat_service.get_velocity_job(video_id)
    if not job:
        raise HTTPException(status_code=404, detail="No job for this VOD — start one first")
    out = {
        "video_id": video_id,
        "status": job["status"],
        "progress": job.get("progress", 0),
        "total_messages": job.get("total_messages", 0),
    }
    if job["status"] == "error":
        out["error"] = job.get("error", "")
    if job["status"] == "ready":
        result = job["result"]
        out["bucket_seconds"] = result["bucket_seconds"]
        out["duration_seconds"] = result["duration_seconds"]
        out["total_messages"] = result["total_messages"]
        out["buckets"] = result["buckets"]
        out["peaks"] = twitch_chat_service.get_top_peaks(result, top_n=10)
    return out


@router.post("/twitch-clips-batch-to-project")
def twitch_clips_batch_to_project(payload: dict):
    """Batch: many Twitch clips → ONE project with N ClipData entries.
    Payload: { clips: [{slug, title}, ...], broadcaster_name, gemini_model }
    """
    items = payload.get("clips") or []
    if not items or not isinstance(items, list):
        raise HTTPException(status_code=400, detail="`clips` array required")
    broadcaster = (payload.get("broadcaster_name") or "").strip()
    model = (payload.get("gemini_model") or "").strip()
    try:
        project_id = twitch_service.process_clips_batch_to_project(
            clips=items, broadcaster_name=broadcaster, gemini_model=model,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"project_id": project_id, "status": "analyzing", "count": len(items)}


@router.post("/twitch-clip-to-project")
def twitch_clip_to_project(payload: dict):
    """One-click: download a Twitch clip + spawn Gemini caption job + return
    project_id. Frontend polls /api/status/{id} until status == 'ready', then
    jumps the user to Step 2 (Clips) of the Video Clipper mode.
    """
    slug = (payload.get("clip_slug") or "").strip()
    title = (payload.get("clip_title") or "").strip() or "Twitch clip"
    broadcaster = (payload.get("broadcaster_name") or "").strip()
    model = (payload.get("gemini_model") or "").strip()
    if not slug:
        raise HTTPException(status_code=400, detail="clip_slug required")
    try:
        project_id = twitch_service.process_clip_to_project(
            clip_slug=slug, clip_title=title,
            broadcaster_name=broadcaster, gemini_model=model,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"project_id": project_id, "status": "analyzing"}


@router.get("/twitch-clips")
def get_twitch_clips(url: str = "", video_id: str = "", limit: int = 500):
    """Fetch the top viewer-made clips of a Twitch VOD, sorted by views.

    Accepts either a full VOD URL or a raw video_id. Returns the clips with
    `vod_offset_seconds` so the UI can autopopulate the HH:MM:SS download
    inputs and let the user grab the exact moment.
    """
    vid = video_id.strip() or twitch_service.extract_video_id(url)
    if not vid:
        raise HTTPException(status_code=400, detail="Provide a Twitch VOD URL or video_id")
    try:
        clips = twitch_service.get_clips_for_video(vid, max_clips=max(10, min(2000, int(limit))))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"video_id": vid, "count": len(clips), "clips": clips}


@router.post("/start")
def start_stream(req: StreamStartRequest):
    if not req.url.strip():
        raise HTTPException(status_code=400, detail="URL is required")

    is_vod = stream_service.is_vod_url(req.url)
    # VOD or single-shot mode: validate the second-level inputs instead of minutes.
    if is_vod or req.single_shot:
        if req.duration_seconds <= 0:
            raise HTTPException(status_code=400, detail="duration_seconds required for VOD / single-shot")
        if req.duration_seconds > 6 * 3600:
            raise HTTPException(status_code=400, detail="duration_seconds capped at 6 hours")
        if req.start_offset_seconds < 0 or req.start_offset_seconds > 24 * 3600:
            raise HTTPException(status_code=400, detail="start_offset_seconds out of range")
    else:
        if req.segment_minutes < 1 or req.segment_minutes > 30:
            raise HTTPException(status_code=400, detail="segment_minutes must be 1-30")

    if req.resolution not in ("480p", "720p", "1080p"):
        raise HTTPException(status_code=400, detail="resolution must be 480p, 720p, or 1080p")

    session = stream_service.start_session(
        url=req.url.strip(),
        segment_minutes=req.segment_minutes,
        clips_per_segment=req.clips_per_segment,
        resolution=req.resolution,
        start_offset_minutes=req.start_offset_minutes,
        single_shot=req.single_shot,
        start_offset_seconds=req.start_offset_seconds,
        duration_seconds=req.duration_seconds,
    )
    return {"session_id": session.session_id, "status": session.status, "is_vod": session.is_vod}


@router.post("/stop/{session_id}")
def stop_stream(session_id: str):
    session = stream_service.stop_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session_id, "status": session.status}


@router.get("/status/{session_id}")
def get_status(session_id: str):
    session = stream_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    segments_out = []
    for seg in session.segments:
        segments_out.append({
            "index": seg.index,
            "status": seg.status,
            "duration_recorded": seg.duration_recorded,
            "started_at": seg.started_at,
            "error": seg.error,
            "file_size_mb": round(os.path.getsize(seg.file_path) / 1024 / 1024, 1)
                            if seg.file_path and os.path.exists(seg.file_path) else 0,
        })

    return {
        "session_id": session.session_id,
        "url": session.url,
        "platform": session.platform,
        "status": session.status,
        "error": session.error,
        "segment_minutes": session.segment_minutes,
        "segments": segments_out,
        "ready_count": sum(1 for s in session.segments if s.status == "ready"),
    }


@router.get("/download/{session_id}/{segment_index}")
def download_segment(session_id: str, segment_index: int):
    """Download a recorded segment as MP4."""
    path = stream_service.get_segment_path(session_id, segment_index)
    if not path:
        raise HTTPException(status_code=404, detail="Segment not found or not ready")
    filename = f"stream_{session_id}_seg{segment_index + 1:02d}.mp4"
    return FileResponse(path, media_type="video/mp4", filename=filename)


@router.get("/sessions")
def list_sessions():
    sessions = stream_service.list_sessions()
    return [
        {
            "session_id": s.session_id,
            "url": s.url,
            "platform": s.platform,
            "status": s.status,
            "segment_count": len(s.segments),
            "ready_count": sum(1 for seg in s.segments if seg.status == "ready"),
            "created_at": s.created_at,
        }
        for s in sessions
    ]
