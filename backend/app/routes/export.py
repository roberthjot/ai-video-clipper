import os
from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
from ..models.clip import StyleConfig
from ..services import export_service
from .upload import get_project_store
from ..config import settings

router = APIRouter(prefix="/api/export", tags=["export"])


@router.post("/watermark/{project_id}")
async def upload_watermark(project_id: str, watermark: UploadFile = File(...)):
    """Upload a watermark PNG for a project."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    os.makedirs(project.output_dir, exist_ok=True)

    wm_path = os.path.join(project.output_dir, "watermark.png")
    with open(wm_path, "wb") as f:
        content = await watermark.read()
        f.write(content)

    project.style.watermark_path = wm_path
    return {"status": "uploaded", "path": wm_path}


@router.put("/style/{project_id}")
async def update_style(project_id: str, style: StyleConfig):
    """Update visual style configuration."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    if style.watermark_path is None and project.style.watermark_path:
        style.watermark_path = project.style.watermark_path

    project.style = style
    return {"status": "updated", "style": style.model_dump()}


@router.post("/render/{project_id}")
async def render_clips(project_id: str, clip_ids: list[int] = Query(default=None)):
    """Start exporting clips in background. Optionally pass clip_ids to export only selected."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    if not project.clips:
        raise HTTPException(status_code=400, detail="No clips to export.")

    # Filter clips if clip_ids provided
    if clip_ids:
        clips_to_export = [c for c in project.clips if c.id in clip_ids]
    else:
        clips_to_export = project.clips

    if not clips_to_export:
        raise HTTPException(status_code=400, detail="No matching clips found.")

    project.status = "exporting"
    export_dir = os.path.join(project.output_dir, "exported")

    # Start background export
    export_service.export_all_clips_background(
        project_id=project_id,
        video_path=project.video_path,
        clips=clips_to_export,
        style=project.style,
        output_dir=export_dir,
    )

    return {
        "status": "started",
        "total": len(clips_to_export),
        "message": "Export started in background. Poll /api/export/progress/{project_id} for updates.",
    }


@router.get("/progress/{project_id}")
async def get_export_progress(project_id: str):
    """Poll export progress."""
    progress = export_service.get_progress(project_id)
    return progress


@router.get("/download/{project_id}/{filename}")
async def download_clip(project_id: str, filename: str):
    """Download an exported clip."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    file_path = os.path.join(project.output_dir, "exported", filename)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path, media_type="video/mp4", filename=filename)
