import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from ..models.clip import StreamStartRequest
from ..services import stream_service, twitch_service, twitch_chat_service, kick_service, live_clips_service

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
    Payload: { clips: [{slug, title}, ...], broadcaster_name, gemini_model,
               analyze_with_gemini (bool, default true) }
    When analyze_with_gemini=false the clips land ready with empty captions
    (no Gemini, no Whisper) so the user re-analyzes them manually in ClipsStep.
    """
    items = payload.get("clips") or []
    if not items or not isinstance(items, list):
        raise HTTPException(status_code=400, detail="`clips` array required")
    broadcaster = (payload.get("broadcaster_name") or "").strip()
    model = (payload.get("gemini_model") or "").strip()
    analyze = bool(payload.get("analyze_with_gemini", True))
    try:
        project_id = twitch_service.process_clips_batch_to_project(
            clips=items, broadcaster_name=broadcaster, gemini_model=model,
            analyze_with_gemini=analyze,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"project_id": project_id, "status": "analyzing" if analyze else "ready", "count": len(items)}


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


@router.get("/kick-clips")
def get_kick_clips(url: str = "", video_id: str = "", limit: int = 500):
    """List the top viewer-made clips of a Kick VOD, sorted by views.

    Mirror of /twitch-clips. Accepts a full Kick VOD URL (kick.com/video/<uuid>
    or kick.com/<channel>/videos/<uuid>) or a raw video_id. Returns the
    clips list with `vod_offset_seconds` so the UI can show "where in the
    VOD" each clip came from.
    """
    vid = video_id.strip() or kick_service.extract_video_id(url)
    if not vid:
        raise HTTPException(status_code=400, detail="Provide a Kick VOD URL or video_id")
    try:
        clips = kick_service.get_clips_for_video(
            vid,
            max_clips=max(10, min(2000, int(limit))),
            channel_slug=kick_service.extract_channel(url) or "",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"video_id": vid, "count": len(clips), "clips": clips}


@router.post("/kick-clip-to-project")
def kick_clip_to_project(payload: dict):
    """One-click: download a Kick clip (via yt-dlp) + spawn Gemini caption
    job + return project_id. Frontend polls /api/status/{id} until ready,
    then jumps to Step 2 of the Video Clipper mode."""
    slug = (payload.get("clip_slug") or payload.get("slug") or "").strip()
    if not slug:
        # Tolerate a raw URL too — extract the clip id ourselves.
        u = (payload.get("url") or "").strip()
        if u:
            slug = kick_service.extract_clip_id(u) or u
    title = (payload.get("clip_title") or payload.get("title") or "").strip() or "Kick clip"
    broadcaster = (payload.get("broadcaster_name") or "").strip()
    model = (payload.get("gemini_model") or "").strip()
    if not slug:
        raise HTTPException(status_code=400, detail="clip_slug or url required")
    try:
        project_id = kick_service.process_clip_to_project(
            clip_slug=slug, clip_title=title,
            broadcaster_name=broadcaster, gemini_model=model,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"project_id": project_id, "status": "analyzing"}


@router.post("/kick-clips-batch-to-project")
def kick_clips_batch_to_project(payload: dict):
    """Batch: many Kick clips → ONE project with N ClipData entries.
    Payload: { clips: [{slug, title}, ...], broadcaster_name, gemini_model,
               analyze_with_gemini (bool, default true) }
    When analyze_with_gemini=false the clips land ready with empty captions
    (no Gemini, no Whisper) so the user re-analyzes them manually in ClipsStep.
    """
    items = payload.get("clips") or []
    if not items or not isinstance(items, list):
        raise HTTPException(status_code=400, detail="`clips` array required")
    broadcaster = (payload.get("broadcaster_name") or "").strip()
    model = (payload.get("gemini_model") or "").strip()
    analyze = bool(payload.get("analyze_with_gemini", True))
    try:
        project_id = kick_service.process_clips_batch_to_project(
            clips=items, broadcaster_name=broadcaster, gemini_model=model,
            analyze_with_gemini=analyze,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"project_id": project_id, "status": "analyzing" if analyze else "ready", "count": len(items)}


@router.post("/live-clips/start")
def live_clips_start(payload: dict):
    """Start a "pescador" session: poll the channel's clips API every ~60s
    and accumulate every NEW clip (deduped by id). Returns the session
    snapshot. Payload: {platform: 'twitch'|'kick', channel: 'name'}."""
    platform = (payload.get("platform") or "").lower().strip()
    channel = (payload.get("channel") or "").strip()
    if platform not in ("twitch", "kick"):
        raise HTTPException(status_code=400, detail="platform must be 'twitch' or 'kick'")
    if not channel:
        raise HTTPException(status_code=400, detail="channel required")
    try:
        return live_clips_service.start_session(platform, channel)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/live-clips/status/{session_id}")
def live_clips_status(session_id: str):
    """Poll the session — frontend hits this every 5s to update the list."""
    snap = live_clips_service.get_session_public(session_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Session not found")
    return snap


@router.post("/live-clips/stop/{session_id}")
def live_clips_stop(session_id: str):
    """Stop pescando. Found clips stay in the session for the user to
    process — call /clear if you want a clean slate without stopping."""
    snap = live_clips_service.stop_session(session_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Session not found")
    return snap


@router.post("/live-clips/clear/{session_id}")
def live_clips_clear(session_id: str):
    """Empty the found_clips list while leaving the session running.
    seen_ids stays so we don't re-pick clips that came in before the clear."""
    snap = live_clips_service.clear_clips(session_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Session not found")
    return snap


@router.get("/live-clips")
def live_clips_list():
    """Lightweight overview of every live session (debug + multi-session UI)."""
    return {"sessions": live_clips_service.list_sessions()}


@router.post("/clip-download")
def clip_download(payload: dict):
    """Download ONE pescador clip (Twitch or Kick) and return the raw MP4 as an
    attachment — no Gemini, no render. Reuses the same per-platform download
    that the batch-to-project flow uses, just skips everything after the file.
    Payload: {platform, slug, url, title}."""
    import os as _os
    import re as _re
    import uuid as _uuid
    from ..config import settings as _settings

    platform = (payload.get("platform") or "").lower().strip()
    slug = (payload.get("slug") or "").strip()
    url = (payload.get("url") or "").strip()
    title = (payload.get("title") or "clip").strip()
    safe_title = _re.sub(r"[^\w\-]+", "_", title)[:50] or "clip"

    dl_dir = _os.path.join(_settings.PROJECTS_DIR, "_pesc_downloads")
    _os.makedirs(dl_dir, exist_ok=True)
    dest = _os.path.join(dl_dir, f"{_uuid.uuid4().hex[:8]}_{safe_title}.mp4")

    try:
        if platform == "twitch":
            if not slug:
                raise HTTPException(status_code=400, detail="slug required for twitch")
            twitch_service.download_clip_to_disk(slug, dest)
        elif platform == "kick":
            ident = url or slug   # Kick prefers the channel-prefixed URL for yt-dlp
            if not ident:
                raise HTTPException(status_code=400, detail="url or slug required for kick")
            kick_service.download_clip_to_disk(ident, dest)
        else:
            raise HTTPException(status_code=400, detail="platform must be 'twitch' or 'kick'")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Clip download failed: {e}")

    if not _os.path.exists(dest):
        raise HTTPException(status_code=502, detail="Clip downloaded but file is missing")
    return FileResponse(dest, media_type="video/mp4", filename=f"{safe_title}.mp4")


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
