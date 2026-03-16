from fastapi import APIRouter, HTTPException
from ..models.clip import StreamStartRequest
from ..services import stream_service

router = APIRouter()


@router.post("/start")
def start_stream(req: StreamStartRequest):
    """Start recording a live stream in segments and analyzing each one."""
    if not req.url.strip():
        raise HTTPException(status_code=400, detail="URL is required")
    if req.segment_minutes < 1 or req.segment_minutes > 30:
        raise HTTPException(status_code=400, detail="segment_minutes must be 1-30")
    if req.clips_per_segment < 1 or req.clips_per_segment > 10:
        raise HTTPException(status_code=400, detail="clips_per_segment must be 1-10")

    session = stream_service.start_session(
        url=req.url.strip(),
        segment_minutes=req.segment_minutes,
        clips_per_segment=req.clips_per_segment,
    )
    return {"session_id": session.session_id, "status": session.status}


@router.post("/stop/{session_id}")
def stop_stream(session_id: str):
    """Stop an active recording session."""
    session = stream_service.stop_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session_id, "status": session.status}


@router.get("/status/{session_id}")
def get_status(session_id: str):
    """Poll session status + all segments and their clips."""
    session = stream_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    segments_out = []
    for seg in session.segments:
        segments_out.append({
            "index": seg.index,
            "status": seg.status,
            "duration_recorded": seg.duration_recorded,
            "clip_count": len(seg.clips),
            "clips": seg.clips,
            "project_id": seg.project_id,
            "error": seg.error,
        })

    return {
        "session_id": session.session_id,
        "url": session.url,
        "platform": session.platform,
        "status": session.status,
        "segment_minutes": session.segment_minutes,
        "clips_per_segment": session.clips_per_segment,
        "segments": segments_out,
        "total_clips": sum(len(s.clips) for s in session.segments),
    }


@router.get("/sessions")
def list_sessions():
    """List all sessions (active and past)."""
    sessions = stream_service.list_sessions()
    return [
        {
            "session_id": s.session_id,
            "url": s.url,
            "platform": s.platform,
            "status": s.status,
            "segment_count": len(s.segments),
            "total_clips": sum(len(seg.clips) for seg in s.segments),
            "created_at": s.created_at,
        }
        for s in sessions
    ]
