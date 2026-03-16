import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from ..models.clip import StreamStartRequest
from ..services import stream_service

router = APIRouter()


@router.post("/start")
def start_stream(req: StreamStartRequest):
    if not req.url.strip():
        raise HTTPException(status_code=400, detail="URL is required")
    if req.segment_minutes < 1 or req.segment_minutes > 30:
        raise HTTPException(status_code=400, detail="segment_minutes must be 1-30")

    session = stream_service.start_session(
        url=req.url.strip(),
        segment_minutes=req.segment_minutes,
        clips_per_segment=req.clips_per_segment,
    )
    return {"session_id": session.session_id, "status": session.status}


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
