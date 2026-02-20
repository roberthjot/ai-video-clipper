import os
import uuid
import shutil
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from ..config import settings
from ..models.clip import ProjectConfig
from ..models.project import Project
from ..services import video_service, gemini_service

router = APIRouter(prefix="/api", tags=["upload"])

# In-memory project store (simple for desktop app)
projects: dict[str, Project] = {}


@router.post("/upload")
async def upload_video(
    video: UploadFile = File(...),
    clip_count: int = Form(25),
    min_duration: int = Form(15),
    custom_prompt: str = Form(""),
):
    """Upload a video and create a new project."""
    # Generate project ID
    project_id = str(uuid.uuid4())[:8]

    # Save uploaded file
    upload_path = os.path.join(settings.UPLOAD_DIR, f"{project_id}_{video.filename}")
    with open(upload_path, "wb") as f:
        shutil.copyfileobj(video.file, f)

    # Get video duration
    duration = video_service.get_video_duration(upload_path)

    # Create project
    project = Project(
        id=project_id,
        video_filename=video.filename,
        video_path=upload_path,
        clip_count=clip_count,
        min_duration=min_duration,
        custom_prompt=custom_prompt,
        status="uploaded",
        video_duration=duration,
        output_dir=os.path.join(settings.PROJECTS_DIR, project_id),
    )

    projects[project_id] = project
    print(f"[Upload] project={project_id} min_duration={min_duration} clip_count={clip_count}")

    return {
        "project_id": project_id,
        "filename": video.filename,
        "duration": duration,
        "status": "uploaded",
    }


@router.get("/projects")
async def list_projects():
    """List all projects."""
    return [
        {
            "id": p.id,
            "filename": p.video_filename,
            "status": p.status,
            "clip_count": len(p.clips),
            "created_at": p.created_at,
        }
        for p in projects.values()
    ]


@router.get("/projects/{project_id}")
async def get_project(project_id: str):
    """Get project details."""
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    return projects[project_id]


@router.get("/status/{project_id}")
async def get_project_status(project_id: str):
    """Get just the project status (for polling during analysis)."""
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    p = projects[project_id]
    token_info = ""
    if p.token_count > 0:
        pct_used = round(p.token_count / 1_048_576 * 100)
        token_info = f" ({p.token_count:,} tokens — {pct_used}% of limit)"
    status_map = {
        "uploaded": {"phase": "uploaded", "message": "Video uploaded", "percent": 0},
        "uploading": {"phase": "uploading", "message": "Uploading to AI...", "percent": 15},
        "processing": {"phase": "processing", "message": "AI is processing video...", "percent": 35},
        "analyzing": {"phase": "analyzing", "message": f"AI is finding viral moments...{token_info}", "percent": 65},
        "ready": {"phase": "ready", "message": f"Analysis complete!{token_info}", "percent": 100},
        "error": {"phase": "error", "message": "An error occurred", "percent": 0},
    }
    info = status_map.get(p.status, {"phase": p.status, "message": p.status, "percent": 0})
    return {"status": p.status, **info}


def get_project_store():
    """Access the in-memory project store (used by other routes)."""
    return projects
