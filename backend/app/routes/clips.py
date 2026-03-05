import os
import asyncio
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from ..services import gemini_service, video_service
from .upload import get_project_store

router = APIRouter(prefix="/api/clips", tags=["clips"])


class AnalyzeRequest(BaseModel):
    project_id: str
    duration_override: float | None = None


class EditCaptionRequest(BaseModel):
    viral_caption: str


@router.post("/analyze")
async def analyze_video(req: AnalyzeRequest):
    """Start AI analysis on a project's video."""
    projects = get_project_store()
    if req.project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[req.project_id]

    active_file = None
    try:
        project.status = "uploading"
        file_obj = await asyncio.to_thread(gemini_service.upload_video, project.video_path)

        project.status = "processing"
        active_file = await asyncio.to_thread(gemini_service.wait_for_processing, file_obj)

        # Check token count before analyzing — fail fast with clear message
        project.status = "analyzing"
        token_count = await asyncio.to_thread(gemini_service.count_tokens, active_file)
        project.token_count = token_count
        MAX_TOKENS = 1_048_576
        if token_count > MAX_TOKENS:
            project.status = "error"
            mins = int((project.video_duration or 0) / 60)
            await asyncio.to_thread(gemini_service.delete_file, active_file)
            raise HTTPException(
                status_code=400,
                detail=f"Video too large for AI: {token_count:,} tokens (max {MAX_TOKENS:,}). "
                       f"Your video is {mins} min. Please use a video under 45 minutes."
            )
        duration = req.duration_override or project.video_duration

        clips = await asyncio.to_thread(
            gemini_service.analyze_video,
            active_file,
            duration,
            project.clip_count,
            project.min_duration,
            project.custom_prompt,
        )

        project.clips = clips
        project.status = "ready"

        return {
            "project_id": project.id,
            "status": "ready",
            "clips": [c.model_dump() for c in clips],
            "total": len(clips),
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        project.status = "error"
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Always clean up the Gemini file to free storage quota
        if active_file is not None:
            await asyncio.to_thread(gemini_service.delete_file, active_file)


@router.get("/{project_id}/download-info")
async def download_clips_info(project_id: str):
    """Download the clips_info.txt file for a project."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    info_path = os.path.join(project.output_dir, "clips_info.txt")

    if not os.path.exists(info_path):
        raise HTTPException(status_code=404, detail="clips_info.txt not found. Export clips first.")

    return FileResponse(info_path, media_type="text/plain", filename="clips_info.txt")


@router.get("/{project_id}")
async def get_clips(project_id: str):
    """Get all clips for a project."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    return {
        "clips": [c.model_dump() for c in project.clips],
        "total": len(project.clips),
    }


@router.put("/{project_id}/{clip_id}")
async def edit_clip_caption(project_id: str, clip_id: int, req: EditCaptionRequest):
    """Edit the caption text for a specific clip."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    for clip in project.clips:
        if clip.id == clip_id:
            clip.viral_caption = req.viral_caption
            return {"status": "updated", "clip": clip.model_dump()}

    raise HTTPException(status_code=404, detail="Clip not found")


@router.get("/{project_id}/{clip_id}/preview")
async def preview_clip_frame(project_id: str, clip_id: int):
    """Generate and return a 9:16 preview frame for a clip."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = None
    for c in project.clips:
        if c.id == clip_id:
            clip = c
            break

    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    os.makedirs(project.output_dir, exist_ok=True)
    preview_path = os.path.join(project.output_dir, f"preview_clip_{clip_id}.jpg")
    timestamp = clip.start_time + (clip.duration / 2)

    style = project.style

    try:
        await asyncio.to_thread(
            video_service.generate_preview_frame,
            video_path=project.video_path,
            timestamp=timestamp,
            output_path=preview_path,
            caption_text=clip.viral_caption,
            text_x=style.text_x,
            text_y=style.text_y,
            font_size=style.font_size,
            text_color=style.text_color,
            text_stroke_color=style.text_stroke_color,
            text_stroke_width=style.text_stroke_width,
            watermark_path=style.watermark_path,
            watermark_x=style.watermark_x,
            watermark_y=style.watermark_y,
            watermark_scale=style.watermark_scale,
            watermark_opacity=style.watermark_opacity,
            fill_mode=style.fill_mode,
            split_screen_enabled=style.split_screen_enabled,
            split_image_path=style.split_image_path,
            split_ratio=style.split_ratio,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Preview generation failed: {str(e)}")

    if not os.path.exists(preview_path):
        raise HTTPException(status_code=500, detail="Preview file not generated")

    return FileResponse(preview_path, media_type="image/jpeg")


@router.get("/{project_id}/{clip_id}/video-preview")
async def preview_clip_video(project_id: str, clip_id: int):
    """Generate and return a short video preview of a clip for playback."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = None
    for c in project.clips:
        if c.id == clip_id:
            clip = c
            break

    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    os.makedirs(project.output_dir, exist_ok=True)
    video_preview_path = os.path.join(project.output_dir, f"preview_clip_{clip_id}.mp4")

    style = project.style

    try:
        await asyncio.to_thread(
            video_service.generate_preview_clip,
            video_path=project.video_path,
            start_time=clip.start_time,
            duration=clip.duration,
            output_path=video_preview_path,
            caption_text=clip.viral_caption,
            text_x=style.text_x,
            text_y=style.text_y,
            font_size=style.font_size,
            text_color=style.text_color,
            text_stroke_color=style.text_stroke_color,
            text_stroke_width=style.text_stroke_width,
            watermark_path=style.watermark_path,
            watermark_x=style.watermark_x,
            watermark_y=style.watermark_y,
            watermark_scale=style.watermark_scale,
            watermark_opacity=style.watermark_opacity,
            fill_mode=style.fill_mode,
            split_screen_enabled=style.split_screen_enabled,
            split_image_path=style.split_image_path,
            split_ratio=style.split_ratio,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Video preview failed: {str(e)}")

    if not os.path.exists(video_preview_path):
        raise HTTPException(status_code=500, detail="Video preview not generated")

    return FileResponse(video_preview_path, media_type="video/mp4")
