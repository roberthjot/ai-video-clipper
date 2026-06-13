"""HTTP routes for the universal video downloader (Fase 1)."""
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..services import downloader_service

router = APIRouter(prefix="/api/downloader", tags=["downloader"])


@router.post("/start")
def start_download(payload: dict):
    """Begin a background download. Returns the job id + initial metadata
    immediately; poll /status/{job_id} for progress."""
    url = (payload.get("url") or "").strip()
    quality = (payload.get("quality") or "max").strip()
    audio_only = bool(payload.get("audio_only"))
    if not url:
        raise HTTPException(status_code=400, detail="URL required")
    try:
        job = downloader_service.start_download(url, quality, audio_only)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _serialize(job)


@router.get("/status/{job_id}")
def get_status(job_id: str):
    job = downloader_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _serialize(job)


@router.get("/list")
def list_jobs():
    return [_serialize(j) for j in downloader_service.list_jobs()]


@router.delete("/{job_id}")
def delete_job(job_id: str):
    ok = downloader_service.delete_job(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "deleted"}


@router.get("/file/{job_id}")
def download_file(job_id: str):
    """Stream the finished file to the browser."""
    job = downloader_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "ready":
        raise HTTPException(status_code=400, detail="Download not ready")
    path = job.get("filepath")
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(
        path,
        media_type="video/mp4" if path.endswith(".mp4") else "application/octet-stream",
        filename=job.get("filename") or os.path.basename(path),
    )


def _serialize(job: dict) -> dict:
    """Strip internal fields and return what the UI consumes."""
    return {
        "id": job.get("id"),
        "url": job.get("url"),
        "platform": job.get("platform"),
        "quality": job.get("quality"),
        "audio_only": job.get("audio_only"),
        "status": job.get("status"),
        "progress": job.get("progress"),
        "downloaded_bytes": job.get("downloaded_bytes"),
        "total_bytes": job.get("total_bytes"),
        "speed_bps": job.get("speed_bps"),
        "eta_seconds": job.get("eta_seconds"),
        "title": job.get("title"),
        "uploader": job.get("uploader"),
        "duration_seconds": job.get("duration_seconds"),
        "thumbnail": job.get("thumbnail"),
        "filename": job.get("filename"),
        "filesize_mb": job.get("filesize_mb"),
        "error": job.get("error"),
        "created_at": job.get("created_at"),
    }
