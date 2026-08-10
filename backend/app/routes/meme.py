import os
import uuid
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from ..services.meme_service import (
    start_meme_batch, get_batch, retry_meme_item, MEME_UPLOAD_DIR, MEME_OUTPUT_DIR, TEMP_DIR,
    extract_video_frame, detect_crop_boundaries, crop_video_pct,
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


@router.post("/crop-preview")
async def crop_preview_video(
    video: UploadFile = File(...),
    top: float = Form(0.0),
    bottom: float = Form(0.0),
    left: float = Form(0.0),
    right: float = Form(0.0),
    seconds: float = Form(8.0),
):
    """Render a short preview MP4 with the crop applied (NO Gemini call, local
    FFmpeg only) so the user can watch the cut before generating memes. The
    rendered file is SAVED to the meme exports folder (same place as the final
    meme renders) and is NOT cleaned up."""
    import imageio_ffmpeg as _iio
    import subprocess as _sp
    _ffmpeg = _iio.get_ffmpeg_exe()
    os.makedirs(MEME_OUTPUT_DIR, exist_ok=True)

    base_name = os.path.splitext(os.path.basename(video.filename or "video"))[0]
    safe_base = "".join(ch for ch in base_name if ch.isalnum() or ch in " _-").strip() or "video"
    out_name = f"recortado_{safe_base}_{uuid.uuid4().hex[:6]}.mp4"
    out_path = os.path.join(MEME_OUTPUT_DIR, out_name)
    tmp_video = os.path.join(TEMP_DIR, f"cprev_src_{uuid.uuid4().hex[:8]}{os.path.splitext(video.filename)[1] or '.mp4'}")
    try:
        content = await video.read()
        with open(tmp_video, "wb") as f:
            f.write(content)

        ct = max(0.0, min(100.0, top)) / 100.0
        cb = max(0.0, min(100.0, bottom)) / 100.0
        cl = max(0.0, min(100.0, left)) / 100.0
        cr = max(0.0, min(100.0, right)) / 100.0
        left_expr = f"trunc(iw*{cl:.6f}/2)*2"
        w_expr    = f"trunc(iw*(1-{cl:.6f}-{cr:.6f})/2)*2"
        top_expr  = f"trunc(ih*{ct:.6f}/2)*2"
        h_expr    = f"trunc(ih*(1-{ct:.6f}-{cb:.6f})/2)*2"
        vf = f"crop={w_expr}:{h_expr}:{left_expr}:{top_expr}"

        cmd = [_ffmpeg, "-y", "-ss", "0", "-t", f"{max(2.0, seconds):.1f}",
               "-i", tmp_video,
               "-vf", vf, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
               "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_path]
        r = _sp.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0 or not os.path.exists(out_path):
            raise RuntimeError(f"Preview render failed: {r.stderr[-300:]}")
        print(f"[Meme] crop preview saved -> {out_path}")
        return FileResponse(out_path, media_type="video/mp4",
                            filename=f"recortado_{safe_base}.mp4")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            os.remove(tmp_video)
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
    crops: str = Form(""),   # JSON: [{top,bottom,left,right}, ...] % per video (edges/white removal)
    videos: list[UploadFile] = File(...),
):
    """Upload multiple videos and start meme batch processing.

    `crops` (optional) is a JSON array with one entry per uploaded video, each
    `{"top": %, "bottom": %, "left": %, "right": %}` (0-100) to remove white
    margins / borders ON THAT video. Each video is pre-cropped with FFmpeg
    BEFORE the batch runs, so Gemini only analyzes (and the meme exports) the
    already-cropped source.
    """
    import json as _json
    os.makedirs(MEME_UPLOAD_DIR, exist_ok=True)

    crops_list = []
    if crops and crops.strip():
        try:
            parsed = _json.loads(crops)
            crops_list = parsed if isinstance(parsed, list) else []
        except Exception:
            crops_list = []

    video_paths = []
    filenames = []

    for i, video in enumerate(videos):
        ext = os.path.splitext(video.filename)[1] or ".mp4"
        saved_name = f"{uuid.uuid4().hex[:8]}{ext}"
        saved_path = os.path.join(MEME_UPLOAD_DIR, saved_name)
        content = await video.read()
        with open(saved_path, "wb") as f:
            f.write(content)

        # Per-video pre-crop (remove white/borders) BEFORE Gemini sees it.
        c = crops_list[i] if i < len(crops_list) and isinstance(crops_list[i], dict) else {}
        ct = max(0.0, min(100.0, float(c.get("top", 0) or 0))) / 100.0
        cb = max(0.0, min(100.0, float(c.get("bottom", 0) or 0))) / 100.0
        cl = max(0.0, min(100.0, float(c.get("left", 0) or 0))) / 100.0
        cr = max(0.0, min(100.0, float(c.get("right", 0) or 0))) / 100.0
        if ct > 0.001 or cb > 0.001 or cl > 0.001 or cr > 0.001:
            cropped_name = f"{uuid.uuid4().hex[:8]}_crop.mp4"
            cropped_path = os.path.join(MEME_UPLOAD_DIR, cropped_name)
            try:
                saved_path = crop_video_pct(saved_path, cropped_path, ct, cb, cl, cr)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Crop failed for {video.filename}: {e}")

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
        # to not collide with anything the meme service writes. Also keep a
        # full snapshot (`last_export`) so the text-free background renderer
        # (GET /preview-bg) can reproduce the EXACT composite minus the text.
        item["style_meta"] = {
            "bg_mode": bg_mode, "font_family": font_family,
            "text_color": text_color, "stroke_color": stroke_color, "stroke_width": stroke_width,
            "visual_filter": visual_filter,
            "trim_start": trim_start, "trim_end": trim_end,
            "mirror_cyclic_enabled": mirror_cyclic_enabled,
            "mirror_cyclic_interval": mirror_cyclic_interval,
            "boost_contrast": boost_contrast,
        }
        item["last_export"] = {
            "bg_color": batch["bg_color"],
            "text_y": text_y, "text_x": text_x,
            "video_scale": video_scale, "video_y": video_y,
            "font_size": font_size, "corner_radius": corner_radius,
            "bg_mode": bg_mode, "font_family": font_family,
            "text_color": text_color, "stroke_color": stroke_color, "stroke_width": stroke_width,
            "visual_filter": visual_filter,
            "trim_start": trim_start, "trim_end": trim_end,
            "mirror_cyclic_enabled": mirror_cyclic_enabled,
            "mirror_cyclic_interval": mirror_cyclic_interval,
            "boost_contrast": boost_contrast,
            "crop_top_pct": crop_top_pct, "crop_bottom_pct": crop_bottom_pct,
            "crop_left_pct": crop_left_pct, "crop_right_pct": crop_right_pct,
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


@router.get("/preview-bg/{batch_id}/{index}")
async def preview_background(batch_id: str, index: int, bust: int = 0):
    """Render (or return cached) a text-FREE version of the meme composite.

    The frontend uses this as the live-preview background so its draggable
    WYSIWYG text overlay is the ONLY text visible (no baked text behind). It
    reproduces the exact last_export settings minus the caption.
    """
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

    cfg = item.get("last_export") or {}
    if not cfg:
        raise HTTPException(status_code=400, detail="No export settings yet — re-export once first")

    # Reuse the final export path pattern with a distinct suffix so the
    # background is cached per item. We only re-render when the underlying
    # composite settings changed (signature of last_export), so opening the
    # preview repeatedly is instant and moving/editing text never re-renders.
    import hashlib as _hl
    sig = _hl.sha1(repr(sorted((k, str(v)) for k, v in cfg.items())).encode()).hexdigest()[:16]
    p, e = os.path.splitext(item["output_path"])
    bg_path = f"{p}_bg_{sig}.mp4"
    if os.path.exists(bg_path):
        return FileResponse(bg_path, media_type="video/mp4")

    # Crop if any crop % is set (mirrors the reexport flow)
    cropped_path = None
    video_path_eff = video_path
    ct, cb, cl, cr = (float(cfg.get("crop_top_pct", 0)), float(cfg.get("crop_bottom_pct", 0)),
                      float(cfg.get("crop_left_pct", 0)), float(cfg.get("crop_right_pct", 0)))
    if ct > 0.001 or cb > 0.001 or cl > 0.001 or cr > 0.001:
        cropped_path = video_path + "_bg_crop.mp4"
        try:
            video_path_eff = crop_video_pct(video_path, cropped_path, ct, cb, cl, cr)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Crop failed: {e}")

    try:
        export_meme_video(
            video_path_eff, "", bg_path,
            cfg.get("bg_color", "black"),
            text_y=float(cfg.get("text_y", 0.08)), text_x=float(cfg.get("text_x", 0.05)),
            video_scale=float(cfg.get("video_scale", 0.9)), video_y=float(cfg.get("video_y", 0.6)),
            font_size=int(cfg.get("font_size", 60)), corner_radius=int(cfg.get("corner_radius", 0)),
            bg_mode=cfg.get("bg_mode", "color"), font_family=cfg.get("font_family", "calibri"),
            text_color=cfg.get("text_color", ""), stroke_color=cfg.get("stroke_color", ""),
            stroke_width=int(cfg.get("stroke_width", 0)),
            visual_filter=cfg.get("visual_filter", "none"),
            trim_start=float(cfg.get("trim_start", 0.0)), trim_end=float(cfg.get("trim_end", 0.0)),
            mirror_cyclic_enabled=bool(cfg.get("mirror_cyclic_enabled", False)),
            mirror_cyclic_interval=float(cfg.get("mirror_cyclic_interval", 5.0)),
            boost_contrast=bool(cfg.get("boost_contrast", False)),
            text_align=cfg.get("text_align", "left"),
            with_text=False,
        )
        return FileResponse(bg_path, media_type="video/mp4")
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cropped_path:
            try:
                os.remove(cropped_path)
            except Exception:
                pass


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
