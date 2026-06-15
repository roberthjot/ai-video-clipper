import os
import uuid
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from ..services.meme_service import (
    start_meme_batch, get_batch, retry_meme_item, MEME_UPLOAD_DIR, MEME_OUTPUT_DIR, TEMP_DIR,
    extract_video_frame, detect_crop_boundaries,
)

router = APIRouter()


@router.post("/frame")
async def get_frame(video: UploadFile = File(...)):
    """Extract and return a JPEG frame from a video (for crop preview)."""
    os.makedirs(TEMP_DIR, exist_ok=True)
    tmp_video = os.path.join(TEMP_DIR, f"tmp_frame_{uuid.uuid4().hex[:8]}{os.path.splitext(video.filename)[1] or '.mp4'}")
    tmp_frame = os.path.join(TEMP_DIR, f"frame_{uuid.uuid4().hex[:8]}.jpg")
    try:
        content = await video.read()
        with open(tmp_video, "wb") as f:
            f.write(content)
        extract_video_frame(tmp_video, tmp_frame)
        return FileResponse(tmp_frame, media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            os.remove(tmp_video)
        except Exception:
            pass


@router.post("/detect-crop")
async def detect_crop(video: UploadFile = File(...)):
    """Upload a video, extract a frame, ask Gemini to detect crop boundaries.
    Returns { crop_top_pct, crop_bottom_pct }."""
    os.makedirs(TEMP_DIR, exist_ok=True)
    tmp_video = os.path.join(TEMP_DIR, f"tmp_crop_{uuid.uuid4().hex[:8]}{os.path.splitext(video.filename)[1] or '.mp4'}")
    tmp_frame = os.path.join(TEMP_DIR, f"frame_crop_{uuid.uuid4().hex[:8]}.jpg")
    try:
        content = await video.read()
        with open(tmp_video, "wb") as f:
            f.write(content)
        extract_video_frame(tmp_video, tmp_frame)
        result = detect_crop_boundaries(tmp_frame)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        for p in (tmp_video, tmp_frame):
            try:
                os.remove(p)
            except Exception:
                pass


@router.post("/process")
async def process_memes(
    bg_color: str = Form("black"),
    text_y: float = Form(0.08),
    text_x: float = Form(0.05),
    video_scale: float = Form(0.9),
    video_y: float = Form(0.6),
    font_size: int = Form(60),
    content_type: str = Form("meme"),
    crop_top_pct: float = Form(0.0),
    crop_bottom_pct: float = Form(0.0),
    crop_left_pct: float = Form(0.0),
    crop_right_pct: float = Form(0.0),
    gemini_model: str = Form(""),
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
                                 video_y=video_y, font_size=font_size, content_type=content_type,
                                 crop_top_pct=crop_top_pct, crop_bottom_pct=crop_bottom_pct,
                                 crop_left_pct=crop_left_pct, crop_right_pct=crop_right_pct,
                                 gemini_model=(gemini_model or None))
    return {"batch_id": batch_id, "count": len(video_paths)}


@router.get("/status/{batch_id}")
async def meme_status(batch_id: str):
    """Poll batch processing status."""
    batch = get_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return batch


@router.post("/retry/{batch_id}/{index}")
async def retry_item(batch_id: str, index: int):
    """Re-run a single meme item (after a failure or to regenerate it)."""
    ok = retry_meme_item(batch_id, index)
    if not ok:
        raise HTTPException(status_code=404, detail="Batch or item not found")
    return {"status": "retrying", "batch_id": batch_id, "index": index}


@router.get("/crop-preview/{batch_id}/{index}")
async def crop_preview(
    batch_id: str,
    index: int,
    crop_top_pct: float = 0.0,
    crop_bottom_pct: float = 0.0,
    crop_left_pct: float = 0.0,
    crop_right_pct: float = 0.0,
):
    """Extract a frame from original video, apply crop, return JPEG preview."""
    from ..services.meme_service import crop_video_pct
    import imageio_ffmpeg as _iio
    _ffmpeg = _iio.get_ffmpeg_exe()

    batch = get_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    items = batch.get("items", [])
    if index < 0 or index >= len(items):
        raise HTTPException(status_code=404, detail="Item not found")

    video_path = items[index].get("video_path", "")
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Original video not found")

    os.makedirs(TEMP_DIR, exist_ok=True)
    uid = uuid.uuid4().hex[:8]
    frame_path = os.path.join(TEMP_DIR, f"cprev_{uid}.jpg")

    do_crop = crop_top_pct > 0.001 or crop_bottom_pct > 0.001 or crop_left_pct > 0.001 or crop_right_pct > 0.001
    if do_crop:
        # Apply crop filter directly to a single frame (fast)
        left_expr = f"trunc(iw*{crop_left_pct:.6f}/2)*2"
        w_expr    = f"trunc(iw*(1-{crop_left_pct:.6f}-{crop_right_pct:.6f})/2)*2"
        top_expr  = f"trunc(ih*{crop_top_pct:.6f}/2)*2"
        h_expr    = f"trunc(ih*(1-{crop_top_pct:.6f}-{crop_bottom_pct:.6f})/2)*2"
        vf = f"crop={w_expr}:{h_expr}:{left_expr}:{top_expr}"
    else:
        vf = "scale=iw:ih"  # no-op

    cmd = [_ffmpeg, "-ss", "1", "-i", video_path,
           "-vf", vf, "-frames:v", "1", "-q:v", "3", "-y", frame_path]
    import subprocess as _sp
    r = _sp.run(cmd, capture_output=True)
    if r.returncode != 0 or not os.path.exists(frame_path):
        # fallback at 0s
        cmd[2] = "0"
        r = _sp.run(cmd, capture_output=True)
    if not os.path.exists(frame_path):
        raise HTTPException(status_code=500, detail="Frame extraction failed")

    return FileResponse(frame_path, media_type="image/jpeg")


@router.post("/reexport/{batch_id}/{index}")
async def reexport_meme(
    batch_id: str,
    index: int,
    text_y: float = Form(0.08),
    text_x: float = Form(0.05),
    video_scale: float = Form(0.9),
    video_y: float = Form(0.6),
    font_size: int = Form(60),
    custom_text: str = Form(""),
    crop_top_pct: float = Form(0.0),
    crop_bottom_pct: float = Form(0.0),
    crop_left_pct: float = Form(0.0),
    crop_right_pct: float = Form(0.0),
    corner_radius: int = Form(0),
    # ── Extended controls (meme editor parity) — all optional ─────────────
    bg_mode: str = Form("color"),              # "color" | "blur"
    font_family: str = Form("calibri"),
    text_color: str = Form(""),
    stroke_color: str = Form(""),
    stroke_width: int = Form(0),
    visual_filter: str = Form("none"),
    trim_start: float = Form(0.0),
    trim_end: float = Form(0.0),                # 0 = whole video
    mirror_cyclic_enabled: bool = Form(False),
    mirror_cyclic_interval: float = Form(5.0),
    boost_contrast: bool = Form(False),
    text_align: str = Form("left"),
):
    """Re-export a meme with updated settings (no Gemini call). Supports crop +
    rounded corners + the extended editor controls (font/color/stroke, blur
    background, visual filter, trim, anti-detect)."""
    from ..services.meme_service import export_meme_video, crop_video_pct
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

    # Use custom text if provided, otherwise keep original
    meme_text = custom_text.strip() if custom_text.strip() else item["meme_text"]
    if custom_text.strip():
        item["meme_text"] = custom_text.strip()

    # Crop original video if requested
    do_crop = crop_top_pct > 0.001 or crop_bottom_pct > 0.001 or crop_left_pct > 0.001 or crop_right_pct > 0.001
    cropped_path = None
    if do_crop:
        cropped_path = video_path + "_reexport_crop.mp4"
        try:
            video_path = crop_video_pct(video_path, cropped_path, crop_top_pct, crop_bottom_pct, crop_left_pct, crop_right_pct)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Crop failed: {e}")

    item["status"] = "exporting"
    try:
        export_meme_video(
            video_path, meme_text, item["output_path"],
            batch["bg_color"], text_y=text_y, text_x=text_x, video_scale=video_scale,
            video_y=video_y, font_size=font_size, corner_radius=corner_radius,
            bg_mode=bg_mode, font_family=font_family,
            text_color=text_color, stroke_color=stroke_color, stroke_width=stroke_width,
            visual_filter=visual_filter,
            trim_start=trim_start, trim_end=trim_end,
            mirror_cyclic_enabled=mirror_cyclic_enabled,
            mirror_cyclic_interval=mirror_cyclic_interval,
            boost_contrast=boost_contrast,
            text_align=text_align,
        )
        # Cache the chosen settings on the item so re-rendering preserves them
        # and so the UI can show what was applied. Stored under `style_meta`
        # to not collide with anything the meme service writes.
        item["style_meta"] = {
            "bg_mode": bg_mode, "font_family": font_family,
            "text_color": text_color, "stroke_color": stroke_color, "stroke_width": stroke_width,
            "visual_filter": visual_filter,
            "trim_start": trim_start, "trim_end": trim_end,
            "mirror_cyclic_enabled": mirror_cyclic_enabled,
            "mirror_cyclic_interval": mirror_cyclic_interval,
            "boost_contrast": boost_contrast,
        }
        item["status"] = "ready"
    except Exception as e:
        item["status"] = "error"
        item["error"] = str(e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cropped_path:
            try:
                os.remove(cropped_path)
            except Exception:
                pass

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


@router.get("/description/{batch_id}/{index}")
async def download_description(batch_id: str, index: int):
    """Download the IG description .txt for a finished meme."""
    batch = get_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    items = batch.get("items", [])
    if index < 0 or index >= len(items):
        raise HTTPException(status_code=404, detail="Item not found")

    item = items[index]
    txt_path = item.get("txt_path", "")
    if not txt_path or not os.path.exists(txt_path):
        raise HTTPException(status_code=404, detail="Description file not found")

    original_name = os.path.splitext(item["filename"])[0]
    download_name = f"descripcion_{original_name}.txt"
    return FileResponse(txt_path, media_type="text/plain", filename=download_name)
