import os
import uuid
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse

from ..services.meme_service import start_meme_batch, get_batch, MEME_UPLOAD_DIR, MEME_OUTPUT_DIR

router = APIRouter()


@router.post("/process")
async def process_memes(
    bg_color: str = Form("black"),
    text_y: float = Form(0.08),
    text_x: float = Form(0.05),
    video_scale: float = Form(0.9),
    video_y: float = Form(0.6),
    font_size: int = Form(80),
    videos: list[UploadFile] = File(...),
):
    """Upload multiple videos and start meme batch processing."""
    os.makedirs(MEME_UPLOAD_DIR, exist_ok=True)

    video_paths = []
    filenames = []

    for video in videos:
        ext = os.path.splitext(video.filename)[1] or ".mp4"
        saved_name = f"{uuid.uuid4().hex[:8]}{ext}"
        saved_path = os.path.join(MEME_UPLOAD_DIR, saved_name)
        content = await video.read()
        with open(saved_path, "wb") as f:
            f.write(content)
        video_paths.append(saved_path)
        filenames.append(video.filename)

    batch_id = start_meme_batch(video_paths, filenames, bg_color,
                                 text_y=text_y, text_x=text_x, video_scale=video_scale,
                                 video_y=video_y, font_size=font_size)
    return {"batch_id": batch_id, "count": len(video_paths)}


@router.get("/status/{batch_id}")
async def meme_status(batch_id: str):
    """Poll batch processing status."""
    batch = get_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return batch


@router.post("/reexport/{batch_id}/{index}")
async def reexport_meme(
    batch_id: str,
    index: int,
    text_y: float = Form(0.08),
    text_x: float = Form(0.05),
    video_scale: float = Form(0.9),
    video_y: float = Form(0.6),
    font_size: int = Form(80),
):
    """Re-export a meme with updated text_y / video_scale (no Gemini call)."""
    from ..services.meme_service import export_meme_video
    batch = get_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    items = batch.get("items", [])
    if index < 0 or index >= len(items):
        raise HTTPException(status_code=404, detail="Item not found")

    item = items[index]
    video_path = item.get("video_path", "")
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Original video not found")

    item["status"] = "exporting"
    try:
        export_meme_video(
            video_path, item["meme_text"], item["output_path"],
            batch["bg_color"], text_y=text_y, text_x=text_x, video_scale=video_scale,
            video_y=video_y, font_size=font_size,
        )
        item["status"] = "ready"
    except Exception as e:
        item["status"] = "error"
        item["error"] = str(e)
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "ok"}


@router.get("/download/{batch_id}/{index}")
async def download_meme(batch_id: str, index: int):
    """Download a finished meme video."""
    batch = get_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    items = batch.get("items", [])
    if index < 0 or index >= len(items):
        raise HTTPException(status_code=404, detail="Item not found")

    item = items[index]
    if item["status"] != "ready":
        raise HTTPException(status_code=400, detail=f"Item not ready (status: {item['status']})")

    output_path = item["output_path"]
    if not os.path.exists(output_path):
        raise HTTPException(status_code=404, detail="Output file not found")

    original_name = os.path.splitext(item["filename"])[0]
    download_name = f"meme_{original_name}.mp4"
    return FileResponse(output_path, media_type="video/mp4", filename=download_name)
