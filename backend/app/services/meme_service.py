import os
import uuid
import time
import threading
import subprocess
from PIL import Image, ImageDraw, ImageFont

from ..config import settings
from .gemini_service import upload_video, wait_for_processing, delete_file
from . import gemini_service, prompts
from google.genai import types

FFMPEG_EXE = "ffmpeg"
try:
    import imageio_ffmpeg
    FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    pass

MEME_OUTPUT_DIR = os.path.join(settings.PROJECTS_DIR, "_meme_exports")
MEME_UPLOAD_DIR = os.path.join(settings.PROJECTS_DIR, "_meme_uploads")

# In-memory batch store
meme_batches: dict = {}

# Current Gemini model for this thread's batch — set by _process_batch from the
# request payload, read by every detect_* / generate_* call below. None falls
# back to the .env default so calls outside a batch still work.
_current_model: dict = {}     # {thread_id: model_name}


def _resolve_model() -> str:
    return _current_model.get(threading.get_ident()) or settings.GEMINI_MODEL


TEMP_DIR = os.path.join(os.path.dirname(__file__), "temp")


def extract_video_frame(video_path: str, output_path: str) -> None:
    """Extract a single frame from a video (tries at 1s, fallback 0s)."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    for seek in ("1", "0"):
        cmd = [FFMPEG_EXE, "-ss", seek, "-i", video_path,
               "-frames:v", "1", "-q:v", "3", "-y", output_path]
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode == 0 and os.path.exists(output_path):
            return
    raise RuntimeError("No se pudo extraer frame del video")


def detect_crop_boundaries(frame_path: str) -> dict:
    """Ask Gemini to detect tweet-card vs video boundaries in an Instagram meme frame.
    Returns { crop_top_pct: float, crop_bottom_pct: float } (0.0-1.0)."""
    with open(frame_path, "rb") as f:
        img_bytes = f.read()

    response = gemini_service.client.models.generate_content(
        model=_resolve_model(),
        contents=[types.Content(role="user", parts=[
            types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
            types.Part.from_text(text=prompts.render("meme_crop")),
        ])],
        config=types.GenerateContentConfig(temperature=0.0),
    )
    raw = response.text.strip().upper()
    crop_top = 0.0
    crop_bottom = 0.0
    crop_left = 0.0
    crop_right = 0.0
    for token in raw.split():
        if token.startswith("TOP:"):
            try:
                crop_top = min(50, max(0, int(token[4:]))) / 100.0
            except Exception:
                pass
        elif token.startswith("BOTTOM:"):
            try:
                crop_bottom = min(50, max(0, int(token[7:]))) / 100.0
            except Exception:
                pass
        elif token.startswith("LEFT:"):
            try:
                crop_left = min(50, max(0, int(token[5:]))) / 100.0
            except Exception:
                pass
        elif token.startswith("RIGHT:"):
            try:
                crop_right = min(50, max(0, int(token[6:]))) / 100.0
            except Exception:
                pass
    return {
        "crop_top_pct": round(crop_top, 4),
        "crop_bottom_pct": round(crop_bottom, 4),
        "crop_left_pct": round(crop_left, 4),
        "crop_right_pct": round(crop_right, 4),
    }


def crop_video_pct(video_path: str, output_path: str,
                   crop_top_pct: float, crop_bottom_pct: float,
                   crop_left_pct: float = 0.0, crop_right_pct: float = 0.0) -> str:
    """Crop video by removing top/bottom/left/right percentages. Returns output_path."""
    # Ensure even pixel counts required by libx264
    left_expr = f"trunc(iw*{crop_left_pct:.6f}/2)*2"
    w_expr    = f"trunc(iw*(1-{crop_left_pct:.6f}-{crop_right_pct:.6f})/2)*2"
    top_expr  = f"trunc(ih*{crop_top_pct:.6f}/2)*2"
    h_expr    = f"trunc(ih*(1-{crop_top_pct:.6f}-{crop_bottom_pct:.6f})/2)*2"
    cmd = [
        FFMPEG_EXE, "-i", video_path,
        "-vf", f"crop={w_expr}:{h_expr}:{left_expr}:{top_expr}",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-c:a", "copy", "-y", output_path,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"Crop failed: {r.stderr[-500:]}")
    return output_path


def generate_meme_text(file_obj) -> str:
    """Ask Gemini to generate meme text for this video."""
    response = gemini_service.client.models.generate_content(
        model=_resolve_model(),
        contents=[types.Content(role="user", parts=[
            types.Part.from_uri(file_uri=file_obj.uri, mime_type=file_obj.mime_type),
            types.Part.from_text(text=prompts.render("meme_text")),
        ])],
        config=types.GenerateContentConfig(temperature=1.0),
    )
    raw = response.text.strip().rstrip(".")
    raw = raw.lower().rstrip(".")
    raw = raw[:1].upper() + raw[1:] if raw else raw
    return raw


def detect_music_artist(file_obj) -> dict:
    """Ask Gemini to identify the artist in the music video. Returns dict with artist/instagram or empty strings."""
    response = gemini_service.client.models.generate_content(
        model=_resolve_model(),
        contents=[types.Content(role="user", parts=[
            types.Part.from_uri(file_uri=file_obj.uri, mime_type=file_obj.mime_type),
            types.Part.from_text(text=prompts.render("music_artist")),
        ])],
        config=types.GenerateContentConfig(temperature=0.1),
    )
    raw = response.text.strip()
    artist = ""
    instagram = ""
    for line in raw.splitlines():
        line = line.strip()
        if line.upper().startswith("ARTIST:"):
            val = line[7:].strip()
            if val.upper() != "NONE":
                artist = val
        elif line.upper().startswith("INSTAGRAM:"):
            val = line[10:].strip()
            if val and val.upper() != "NONE":
                instagram = val if val.startswith("@") else f"@{val}"
    return {"artist": artist, "instagram": instagram}


def generate_music_vibe(file_obj) -> str:
    """Ask Gemini to generate an emotion-driven vibe phrase for a music video."""
    response = gemini_service.client.models.generate_content(
        model=_resolve_model(),
        contents=[types.Content(role="user", parts=[
            types.Part.from_uri(file_uri=file_obj.uri, mime_type=file_obj.mime_type),
            types.Part.from_text(text=prompts.render("music_vibe")),
        ])],
        config=types.GenerateContentConfig(temperature=1.0),
    )
    raw = response.text.strip().rstrip(".")
    raw = raw.lower().rstrip(".")
    raw = raw[:1].upper() + raw[1:] if raw else raw
    return raw


def generate_ig_description(file_obj, meme_text: str, content_type: str = "meme") -> str:
    """Ask Gemini to generate a long Instagram caption for the video."""
    if content_type == "music":
        prompt = prompts.render("ig_description_music", MEME_TEXT=meme_text)
    else:
        prompt = prompts.render("ig_description_meme", MEME_TEXT=meme_text)
    response = gemini_service.client.models.generate_content(
        model=_resolve_model(),
        contents=[types.Content(role="user", parts=[
            types.Part.from_uri(file_uri=file_obj.uri, mime_type=file_obj.mime_type),
            types.Part.from_text(text=prompt),
        ])],
        config=types.GenerateContentConfig(temperature=0.9),
    )
    return response.text.strip()


def _wrap_text_px(text: str, font, max_width: int) -> list:
    """Wrap text to fit within max_width pixels using real font measurement."""
    lines_raw = text.replace('\\n', '\n').split('\n')
    result = []
    for line in lines_raw:
        words = line.split()
        cur = ""
        for w in words:
            test = (cur + " " + w).strip() if cur else w
            try:
                tw = int(font.getlength(test))
            except Exception:
                tw = len(test) * int(font.size * 0.6)
            if tw <= max_width:
                cur = test
            else:
                if cur:
                    result.append(cur)
                cur = w
        if cur:
            result.append(cur)
    return result[:4]  # max 4 lines


# Font key → TTF path (Windows). Defaults to Calibri Bold; falls back to
# load_default() if the file is missing so non-Windows hosts keep working.
_FONT_MAP_MEME = {
    "calibri":     "C:/Windows/Fonts/calibrib.ttf",
    "arial":       "C:/Windows/Fonts/arial.ttf",     # clean Helvetica-like (classic meme font)
    "segoe":       "C:/Windows/Fonts/segoeui.ttf",   # clean Windows system sans
    "arial_black": "C:/Windows/Fonts/ariblk.ttf",
    "trebuchet":   "C:/Windows/Fonts/trebucbd.ttf",
    "comic":       "C:/Windows/Fonts/comicbd.ttf",
    "impact":      "C:/Windows/Fonts/impact.ttf",
}


def _hex_to_rgb(h: str, fallback=(255, 255, 255)) -> tuple:
    """Parse '#RRGGBB' (or '#RGB') to (r, g, b). Returns fallback if invalid."""
    if not h:
        return fallback
    s = str(h).strip().lstrip("#")
    try:
        if len(s) == 3:
            s = "".join(c * 2 for c in s)
        if len(s) != 6:
            return fallback
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    except Exception:
        return fallback


def create_meme_bg_png(text: str, bg_color: str = "black", W: int = 1080, H: int = 1920,
                        text_y_ratio: float = 0.08, font_size: int = 60, text_x_ratio: float = 0.05,
                        font_family: str = "calibri", text_color: str = "",
                        stroke_color: str = "", stroke_width: int = 0,
                        transparent: bool = False,
                        text_align: str = "left") -> tuple:
    """Create meme background PNG: solid color + meme text at given Y ratio.

    When `transparent=True`, returns an RGBA image with ONLY the text painted
    (alpha 0 everywhere else). Used by the "blur" background mode, where the
    bg is the source video blurred and the text is layered on top as its own
    transparent PNG.

    Other new params:
    - font_family: key in _FONT_MAP_MEME ("calibri" default, "arial_black",
      "trebuchet", "comic", "impact")
    - text_color / stroke_color: "#RRGGBB"; empty string → derive from bg_color
      (white text on black bg, black on white) — preserves prior behaviour.
    - stroke_width: 0 = no outline (default). Larger values (4–8) make the
      text readable on the "blur" background.

    Returns (png_path, text_bottom_y).
    """
    bg_rgb = (0, 0, 0) if bg_color == "black" else (255, 255, 255)
    default_text_rgb = (255, 255, 255) if bg_color == "black" else (20, 20, 20)
    text_rgb = _hex_to_rgb(text_color, default_text_rgb)
    stroke_rgb = _hex_to_rgb(stroke_color, (0, 0, 0))

    font_path = _FONT_MAP_MEME.get(font_family, _FONT_MAP_MEME["calibri"])
    try:
        font = ImageFont.truetype(font_path, font_size)
    except Exception:
        # Try the calibri default if the requested font is missing
        try:
            font = ImageFont.truetype(_FONT_MAP_MEME["calibri"], font_size)
        except Exception:
            font = ImageFont.load_default()

    line_h = int(font_size * 1.35)

    if transparent:
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    else:
        img = Image.new("RGB", (W, H), bg_rgb)
    draw = ImageDraw.Draw(img)

    x_start = int(W * text_x_ratio)
    right_margin = int(W * 0.05)  # 5% padding from right edge
    available_width = W - x_start - right_margin
    lines = _wrap_text_px(text, font, max(available_width, 200))

    y = int(H * text_y_ratio)
    stroke_kwargs = {}
    if stroke_width and stroke_width > 0:
        stroke_kwargs = {"stroke_width": int(stroke_width), "stroke_fill": stroke_rgb}
    # text_align: "left" keeps the original behaviour (anchored at x_start).
    # "center" centers each wrapped line on the canvas width — most memes
    # want this. "right" anchors each line to the right margin.
    align = (text_align or "left").lower()
    for line in lines:
        if align in ("center", "right"):
            try:
                lw = font.getlength(line) if hasattr(font, "getlength") else (font.getbbox(line)[2] - font.getbbox(line)[0])
            except Exception:
                lw = len(line) * font_size * 0.55
            if align == "center":
                tx = int((W - lw) / 2)
            else:  # right
                tx = int(W - right_margin - lw)
        else:
            tx = x_start
        draw.text((tx, y), line, font=font, fill=text_rgb, **stroke_kwargs)
        y += line_h

    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    import uuid as _uuid
    png_path = os.path.join(temp_dir, f"meme_bg_{_uuid.uuid4().hex}.png")
    img.save(png_path)
    return png_path, y  # y = bottom of last text line


def create_rounded_corner_blocker(W: int, H: int, radius: int, bg_color: str, output_path: str) -> str:
    """Create a PNG: background color only at the 4 corners (to round the canvas edges).
    Transparent everywhere else, so it can be overlaid as the final layer."""
    bg_rgb = (0, 0, 0) if bg_color == "black" else (255, 255, 255)
    # Full-size rounded rectangle mask: 255 inside, 0 in corners
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([(0, 0), (W - 1, H - 1)], radius=radius, fill=255)
    # Invert: corners = 255, inside = 0
    corners_alpha = mask.point(lambda x: 255 - x)
    # Create background-colored image and apply alpha so only corners are opaque
    blocker = Image.new("RGBA", (W, H), (*bg_rgb, 255))
    blocker.putalpha(corners_alpha)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    blocker.save(output_path)
    return output_path


# Visual filters — copied verbatim from video_service.get_visual_filter_chain
# so memes get the same cinematic looks as the main editor. Keeping the table
# local avoids a cross-module import here.
_MEME_VISUAL_FILTERS = {
    "none": "",
    "cinematic": "eq=contrast=1.06:saturation=0.92,curves=master='0/0 0.5/0.45 1/1'",
    "warm":      "colorbalance=rs=.06:gs=.02:bs=-.05:rm=.04:gm=.01:bm=-.03",
    "vivid":     "eq=contrast=1.10:saturation=1.20",
    "moody":     "eq=contrast=1.08:saturation=0.80,colorbalance=bs=.08",
    "bw":        "hue=s=0,eq=contrast=1.05",
}


def export_meme_video(video_path: str, meme_text: str, output_path: str,
                      bg_color: str = "black", text_y: float = 0.08,
                      video_scale: float = 0.9, video_y: float = 0.6,
                      font_size: int = 60, text_x: float = 0.05,
                      corner_radius: int = 0,
                      # New v2 controls — all default to "preserve old behaviour"
                      bg_mode: str = "color",            # "color" | "blur"
                      font_family: str = "calibri",
                      text_color: str = "",
                      stroke_color: str = "",
                      stroke_width: int = 0,
                      visual_filter: str = "none",
                      trim_start: float = 0.0,
                      trim_end: float = 0.0,             # 0 = whole video
                      mirror_cyclic_enabled: bool = False,
                      mirror_cyclic_interval: float = 5.0,
                      boost_contrast: bool = False,
                      text_align: str = "left",
                      with_text: bool = True,
                      ) -> None:
    """Export full video (no cuts) overlaid on meme background.

    New params (v2 — meme editor parity with the Visual Editor):
    - bg_mode="color" keeps the existing PIL-rendered solid background.
      bg_mode="blur" generates a transparent text PNG and uses the SOURCE
      video itself (scaled + blurred to canvas size) as the background — so
      the meme "lives inside" the video instead of floating on a solid card.
    - font_family / text_color / stroke_color / stroke_width — pass through to
      create_meme_bg_png (PIL rendering).
    - visual_filter — one of cinematic/warm/vivid/moody/bw/none, applied to the
      foreground video right after the scale.
    - trim_start / trim_end — input-side `-ss` / `-to` to cut the source.
    - mirror_cyclic_enabled / interval — hflip toggling on/off every interval
      seconds, same expression as the Visual Editor.
    - boost_contrast — anti-detect contrast boost (same eq= values as elsewhere).
    """
    W, H = 1080, 1920
    bg_mode = (bg_mode or "color").lower()

    # PNG with text. transparent only for blur mode (so the blurred source
    # video shows through behind the text). With with_text=False we render a
    # text-free background (solid colour for "color" mode, a fully transparent
    # PNG for "blur") so the frontend can overlay a LIVE draggable text layer
    # on top — full WYSIWYG without re-exporting.
    bg_png, _text_bottom = create_meme_bg_png(
        meme_text if with_text else "", bg_color, W, H,
        text_y_ratio=text_y, font_size=font_size, text_x_ratio=text_x,
        font_family=font_family, text_color=text_color,
        stroke_color=stroke_color, stroke_width=stroke_width,
        transparent=(bg_mode == "blur"),
        text_align=text_align,
    )

    # Scale + visual filter + anti-detect chain on the source FG video.
    scale_w = int(W * video_scale)
    fg_chain_parts = [f"scale={scale_w}:-2"]
    vf_chain = _MEME_VISUAL_FILTERS.get(visual_filter, "")
    if vf_chain:
        fg_chain_parts.append(vf_chain)
    if boost_contrast:
        fg_chain_parts.append("eq=contrast=1.05:brightness=0.02:saturation=1.05")
    if mirror_cyclic_enabled:
        m_int = max(0.5, min(20.0, float(mirror_cyclic_interval or 5.0)))
        # Same expression as export_service. Backslash-escape the commas
        # because they'd otherwise be interpreted as filter separators.
        fg_chain_parts.append(
            f"hflip=enable='lt(mod(t\\,{m_int * 2:.3f})\\,{m_int:.3f})'"
        )
    fg_filter = ",".join(fg_chain_parts)

    # Center video horizontally; video_y controls where the video center sits
    overlay_x = "(W-w)/2"
    overlay_y = f"{int(H * video_y)}-h/2"

    extra_inputs = []
    corner_png = None

    # Filter chain branches by bg_mode. "color" uses the static PNG bg; "blur"
    # uses the source video itself (blurred + scaled) and overlays the text as
    # a transparent PNG on top of the FG video.
    if bg_mode == "blur":
        # [0:v] is split: one branch becomes the blurred background, the other
        # the foreground (scaled + filtered). Text PNG overlayed last.
        if corner_radius > 0:
            corner_png = os.path.join(TEMP_DIR, f"corners_{_uuid.uuid4().hex}.png")
            create_rounded_corner_blocker(W, H, corner_radius, bg_color, corner_png)
            extra_inputs = ["-loop", "1", "-i", corner_png]
            filter_complex = (
                f"[0:v]setpts=PTS-STARTPTS,split=2[fg_in][bg_in];"
                f"[bg_in]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=14:2[bg];"
                f"[fg_in]{fg_filter}[fg];"
                f"[bg][fg]overlay={overlay_x}:{overlay_y}[comp];"
                f"[comp][1:v]overlay=0:0[withtext];"
                f"[withtext][2:v]overlay=0:0[out]"
            )
        else:
            filter_complex = (
                f"[0:v]setpts=PTS-STARTPTS,split=2[fg_in][bg_in];"
                f"[bg_in]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=14:2[bg];"
                f"[fg_in]{fg_filter}[fg];"
                f"[bg][fg]overlay={overlay_x}:{overlay_y}[comp];"
                f"[comp][1:v]overlay=0:0[out]"
            )
        cmd_inputs = [
            "-i", video_path,
            "-loop", "1", "-i", bg_png,         # [1] transparent text PNG
            *extra_inputs,                        # [2] optional corner blocker
        ]
    else:
        # Original solid-bg behaviour — only the new params (font/color/stroke)
        # propagate through create_meme_bg_png; everything else identical.
        if corner_radius > 0:
            corner_png = os.path.join(TEMP_DIR, f"corners_{_uuid.uuid4().hex}.png")
            create_rounded_corner_blocker(W, H, corner_radius, bg_color, corner_png)
            extra_inputs = ["-loop", "1", "-i", corner_png]
            filter_complex = (
                f"[1:v]scale={W}:{H},setsar=1[bg];"
                f"[0:v]setpts=PTS-STARTPTS,{fg_filter}[fg];"
                f"[bg][fg]overlay={overlay_x}:{overlay_y}[comp];"
                f"[comp][2:v]overlay=0:0[out]"
            )
        else:
            filter_complex = (
                f"[1:v]scale={W}:{H},setsar=1[bg];"
                f"[0:v]setpts=PTS-STARTPTS,{fg_filter}[fg];"
                f"[bg][fg]overlay={overlay_x}:{overlay_y}[out]"
            )
        cmd_inputs = [
            "-i", video_path,
            "-loop", "1", "-i", bg_png,
            *extra_inputs,
        ]

    # Input-side trim — `-ss` BEFORE `-i` is the fast keyframe seek; `-to`
    # AFTER `-i` bounds the duration. trim_end=0 means "play to natural end".
    trim_in_args = []
    trim_out_args = []
    if trim_start and trim_start > 0:
        trim_in_args = ["-ss", str(round(float(trim_start), 3))]
    if trim_end and trim_end > trim_start:
        trim_out_args = ["-to", str(round(float(trim_end - trim_start), 3))]

    # When we trim the source we need to NOT pass -shortest, because the bg PNG
    # is looped indefinitely and -shortest would clip to the longest stream
    # (still OK with trim too — kept for safety).
    cmd = [
        FFMPEG_EXE,
        *trim_in_args,
        *cmd_inputs,
        *trim_out_args,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-shortest",
        "-y", output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    for p in (bg_png, corner_png):
        try:
            if p:
                os.remove(p)
        except Exception:
            pass
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {result.stderr[-600:]}")


def _process_batch(batch_id: str, video_paths: list, bg_color: str, text_y: float, video_scale: float, video_y: float, font_size: int = 60, text_x: float = 0.05, content_type: str = "meme", crop_top_pct: float = 0.0, crop_bottom_pct: float = 0.0, crop_left_pct: float = 0.0, crop_right_pct: float = 0.0, gemini_model: str = None) -> None:
    """Background thread: process each video in the batch sequentially."""
    batch = meme_batches[batch_id]
    os.makedirs(MEME_OUTPUT_DIR, exist_ok=True)
    # Pin the chosen Gemini model to this worker thread so every detect_/
    # generate_ call inside picks it up via _resolve_model().
    tid = threading.get_ident()
    if gemini_model:
        _current_model[tid] = gemini_model
        print(f"[Meme] Batch {batch_id}: using model {gemini_model}")

    for i, video_path in enumerate(video_paths):
        _process_one_item(
            batch_id, i, video_path, bg_color, text_y, video_scale, video_y,
            font_size, text_x, content_type, crop_top_pct, crop_bottom_pct,
            crop_left_pct, crop_right_pct,
        )

    batch["status"] = "completed"
    _current_model.pop(tid, None)        # release the per-thread model override
    print(f"[Meme] Batch {batch_id} all done")


def _process_one_item(batch_id, i, video_path, bg_color, text_y, video_scale, video_y,
                      font_size, text_x, content_type, crop_top_pct, crop_bottom_pct,
                      crop_left_pct, crop_right_pct):
    """Process a SINGLE meme item end-to-end (upload→analyze→generate→export).
    Used by the batch loop AND by the per-item retry. Catches its own errors and
    writes status/error onto the item."""
    batch = meme_batches[batch_id]
    item = batch["items"][i]
    do_crop = crop_top_pct > 0.001 or crop_bottom_pct > 0.001 or crop_left_pct > 0.001 or crop_right_pct > 0.001
    cropped_path = None
    try:
        item["error"] = ""
        # 0. Crop if needed
        if do_crop:
            item["status"] = "cropping"
            cropped_path = video_path.replace(".mp4", "_cropped.mp4").replace(".mov", "_cropped.mp4")
            video_path = crop_video_pct(video_path, cropped_path, crop_top_pct, crop_bottom_pct, crop_left_pct, crop_right_pct)
            print(f"[Meme] Batch {batch_id} item {i}: cropped (top={crop_top_pct:.1%} bot={crop_bottom_pct:.1%} left={crop_left_pct:.1%} right={crop_right_pct:.1%})")

        # 1. Upload to Gemini
        item["status"] = "uploading"
        print(f"[Meme] Batch {batch_id} item {i}: uploading to Gemini")
        file_obj = upload_video(video_path)

        # 2. Wait for Gemini processing
        item["status"] = "analyzing"
        file_obj = wait_for_processing(file_obj)

        # 3. Generate text based on content type
        if content_type == "music":
            meme_text = generate_music_vibe(file_obj)
        else:
            meme_text = generate_meme_text(file_obj)
        item["meme_text"] = meme_text

        # 3b. Detect artist (music mode only, while file is still uploaded)
        if content_type == "music":
            try:
                artist_info = detect_music_artist(file_obj)
            except Exception:
                artist_info = {"artist": "", "instagram": ""}
            item["artist_info"] = artist_info
            print(f"[Meme] Batch {batch_id} item {i}: artist = {artist_info}")

        # 3c. Generate IG description (while file is still uploaded)
        try:
            ig_description = generate_ig_description(file_obj, meme_text, content_type)
        except Exception:
            ig_description = ""
        item["ig_description"] = ig_description

        delete_file(file_obj)
        print(f"[Meme] Batch {batch_id} item {i}: [{content_type}] text = {meme_text[:60]!r}")

        # 4. Export video
        item["status"] = "exporting"
        output_filename = f"meme_{batch_id}_{i}.mp4"
        output_path = os.path.join(MEME_OUTPUT_DIR, output_filename)
        export_meme_video(video_path, meme_text, output_path, bg_color, text_y=text_y, video_scale=video_scale, video_y=video_y, font_size=font_size, text_x=text_x)

        # Save IG description as .txt
        txt_filename = f"meme_{batch_id}_{i}.txt"
        txt_path = os.path.join(MEME_OUTPUT_DIR, txt_filename)
        label = "Vibe text" if content_type == "music" else "Meme text"
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(f"{label}:\n{meme_text}\n\n")
            if content_type == "music":
                # Separate hashtag lines from body text so artist goes before hashtags
                desc_lines = ig_description.splitlines()
                hashtag_lines = [l for l in desc_lines if l.strip().startswith("#")]
                body_lines = [l for l in desc_lines if not l.strip().startswith("#")]
                body_text = "\n".join(body_lines).strip()
                hashtags_text = "\n".join(hashtag_lines).strip()

                f.write(f"Instagram Description:\n{body_text}\n")
                ai = item.get("artist_info", {})
                if ai.get("artist") or ai.get("instagram"):
                    f.write("\n")
                if ai.get("artist"):
                    f.write(f"Artist: {ai['artist']}\n")
                if ai.get("instagram"):
                    f.write(f"Instagram: {ai['instagram']}\n")
                if hashtags_text:
                    f.write(f"\n{hashtags_text}\n")
            else:
                # Separate hashtags to end for memes too
                desc_lines = ig_description.splitlines()
                hashtag_lines = [l for l in desc_lines if l.strip().startswith("#")]
                body_lines = [l for l in desc_lines if not l.strip().startswith("#")]
                body_text = "\n".join(body_lines).strip()
                hashtags_text = "\n".join(hashtag_lines).strip()
                f.write(f"Instagram Description:\n{body_text}\n")
                if hashtags_text:
                    f.write(f"\n{hashtags_text}\n")
        item["txt_path"] = txt_path

        item["video_path"] = video_path
        item["output_path"] = output_path
        # Snapshot of the settings used for this first export so the text-free
        # preview background reproduces the same composite (see /preview-bg).
        item["last_export"] = {
            "bg_color": bg_color,
            "text_y": text_y, "text_x": text_x,
            "video_scale": video_scale, "video_y": video_y,
            "font_size": font_size,
            "corner_radius": 0,
            "bg_mode": "color", "font_family": "calibri",
            "text_color": "", "stroke_color": "", "stroke_width": 0,
            "visual_filter": "none",
            "trim_start": 0.0, "trim_end": 0.0,
            "mirror_cyclic_enabled": False, "mirror_cyclic_interval": 5.0,
            "boost_contrast": False,
            "crop_top_pct": crop_top_pct, "crop_bottom_pct": crop_bottom_pct,
            "crop_left_pct": crop_left_pct, "crop_right_pct": crop_right_pct,
        }
        item["status"] = "ready"
        print(f"[Meme] Batch {batch_id} item {i}: done")

    except Exception as e:
        item["status"] = "error"
        item["error"] = str(e)
        print(f"[Meme] Batch {batch_id} item {i}: ERROR — {e}")


def start_meme_batch(video_paths: list, filenames: list, bg_color: str = "black",
                     text_y: float = 0.08, video_scale: float = 0.9, video_y: float = 0.6,
                     font_size: int = 60, text_x: float = 0.05, content_type: str = "meme",
                     crop_top_pct: float = 0.0, crop_bottom_pct: float = 0.0,
                     crop_left_pct: float = 0.0, crop_right_pct: float = 0.0,
                     gemini_model: str = None) -> str:
    """Start a meme batch. Returns batch_id."""
    batch_id = uuid.uuid4().hex[:12]
    # Persist everything a single-item RETRY needs to reproduce the job.
    job_params = {
        "bg_color": bg_color, "text_y": text_y, "video_scale": video_scale,
        "video_y": video_y, "font_size": font_size, "text_x": text_x,
        "content_type": content_type, "crop_top_pct": crop_top_pct,
        "crop_bottom_pct": crop_bottom_pct, "crop_left_pct": crop_left_pct,
        "crop_right_pct": crop_right_pct, "gemini_model": gemini_model,
    }
    meme_batches[batch_id] = {
        "batch_id": batch_id,
        "status": "processing",
        "bg_color": bg_color,
        "content_type": content_type,
        "params": job_params,
        "video_paths": list(video_paths),
        "filenames": list(filenames),
        "items": [
            {
                "index": i,
                "filename": filenames[i],
                "status": "pending",
                "meme_text": "",
                "output_path": "",
                "error": "",
                "ig_description": "",
                "txt_path": "",
                "artist_info": None,
            }
            for i in range(len(video_paths))
        ],
    }
    threading.Thread(
        target=_process_batch,
        args=(batch_id, video_paths, bg_color, text_y, video_scale, video_y, font_size, text_x, content_type, crop_top_pct, crop_bottom_pct, crop_left_pct, crop_right_pct, gemini_model),
        daemon=True,
    ).start()
    return batch_id


def retry_meme_item(batch_id: str, index: int) -> bool:
    """Re-run a single item (after a failure, or to regenerate). Reuses the
    original video + job params stored on the batch. Runs in a background
    thread so the request returns immediately. Returns False if not found."""
    batch = meme_batches.get(batch_id)
    if not batch or index < 0 or index >= len(batch.get("items", [])):
        return False
    paths = batch.get("video_paths") or []
    params = batch.get("params") or {}
    if index >= len(paths):
        return False

    item = batch["items"][index]
    item["status"] = "pending"
    item["error"] = ""
    batch["status"] = "processing"

    def _run():
        tid = threading.get_ident()
        gm = params.get("gemini_model")
        if gm:
            _current_model[tid] = gm
        try:
            _process_one_item(
                batch_id, index, paths[index],
                params.get("bg_color", "black"), params.get("text_y", 0.08),
                params.get("video_scale", 0.9), params.get("video_y", 0.6),
                params.get("font_size", 60), params.get("text_x", 0.05),
                params.get("content_type", "meme"),
                params.get("crop_top_pct", 0.0), params.get("crop_bottom_pct", 0.0),
                params.get("crop_left_pct", 0.0), params.get("crop_right_pct", 0.0),
            )
        finally:
            _current_model.pop(tid, None)
            # If every item is settled, mark the batch completed again.
            if all(it["status"] in ("ready", "error") for it in batch["items"]):
                batch["status"] = "completed"
        print(f"[Meme] Batch {batch_id} item {index}: retry done ({item['status']})")

    threading.Thread(target=_run, daemon=True).start()
    return True


def get_batch(batch_id: str) -> dict | None:
    return meme_batches.get(batch_id)
