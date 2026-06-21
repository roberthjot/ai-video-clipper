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
    max_duration: int = Form(90),
    custom_prompt: str = Form(""),
    gemini_model: str = Form("gemini-2.5-flash"),
    creator_name: str = Form(""),
    analyze_start: float = Form(0.0),
    analyze_duration: float = Form(0.0),
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

    # Validate model — only allow known good ones
    if gemini_model not in gemini_service.VIDEO_ANALYSIS_MODELS:
        gemini_model = "gemini-2.5-flash"

    # Validate analyze range against the actual video duration
    analyze_start = max(0.0, float(analyze_start or 0.0))
    analyze_duration = max(0.0, float(analyze_duration or 0.0))
    if analyze_start >= duration:
        analyze_start = 0.0  # invalid → fall back to analyzing from beginning
    # Clamp duration so start + duration never exceeds video length
    if analyze_duration > 0 and analyze_start + analyze_duration > duration:
        analyze_duration = duration - analyze_start

    # Create project
    project = Project(
        id=project_id,
        video_filename=video.filename,
        video_path=upload_path,
        clip_count=clip_count,
        min_duration=min_duration,
        max_duration=max(min_duration + 5, int(max_duration or 90)),
        custom_prompt=custom_prompt,
        status="uploaded",
        video_duration=duration,
        output_dir=os.path.join(settings.PROJECTS_DIR, project_id),
        gemini_model=gemini_model,
        creator_name=creator_name.strip(),
        analyze_start=analyze_start,
        analyze_duration=analyze_duration,
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


@router.patch("/projects/{project_id}/creator")
async def update_project_creator(project_id: str, creator_name: str = Form("")):
    """Update the project's creator_name (used by Gemini on reanalyze)."""
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    projects[project_id].creator_name = (creator_name or "").strip()
    return {"status": "ok", "creator_name": projects[project_id].creator_name}


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
    progress = getattr(p, "analyze_progress", "") or ""
    return {"status": p.status, "analyze_progress": progress, **info}


def get_project_store():
    """Access the in-memory project store (used by other routes)."""
    return projects
