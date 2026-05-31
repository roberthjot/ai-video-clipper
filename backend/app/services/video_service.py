import os
import re
import subprocess
import imageio_ffmpeg
from PIL import Image, ImageDraw

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()

# Cache QSV availability check across the process lifetime
_QSV_AVAILABLE = None


def get_visual_filter_chain(filter_name: str) -> str:
    """Return an FFmpeg filter string for a cinematic look. Empty string = no filter."""
    f = (filter_name or "none").lower()
    if f == "cinematic":
        # Aggressive teal shadows + orange highlights, strong contrast
        return ("eq=saturation=0.80:contrast=1.25:gamma=0.95,"
                "colorbalance=rs=-0.12:gs=-0.05:bs=0.25:rh=0.20:gh=0.05:bh=-0.15,"
                "curves=master='0/0 0.3/0.22 0.7/0.78 1/1'")
    if f == "warm":
        # Strong golden/yellow with visible warm shift
        return ("eq=saturation=1.18:contrast=1.08:gamma_r=0.92:gamma_b=1.08,"
                "colorbalance=rm=0.18:gm=0.08:bm=-0.22:rh=0.10:bh=-0.10")
    if f == "vivid":
        # Very punchy saturation + strong contrast — stop-scroll effect
        return "eq=saturation=1.65:contrast=1.30:brightness=0.03:gamma=0.95"
    if f == "moody":
        # Heavily desaturated, dark, distinct cool tint
        return ("eq=saturation=0.55:contrast=1.20:brightness=-0.08:gamma=0.92,"
                "colorbalance=rs=-0.08:bs=0.15:rh=-0.05:bh=0.08")
    if f == "bw":
        # Full black & white with extra contrast for impact
        return "hue=s=0,eq=contrast=1.15:brightness=0.02"
    return ""


def _qsv_supported() -> bool:
    """Check once whether the bundled FFmpeg supports h264_qsv encoder."""
    global _QSV_AVAILABLE
    if _QSV_AVAILABLE is not None:
        return _QSV_AVAILABLE
    try:
        result = subprocess.run(
            [FFMPEG_EXE, "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=10
        )
        _QSV_AVAILABLE = "h264_qsv" in (result.stdout or "")
        print(f"[FFmpeg] Intel QSV available: {_QSV_AVAILABLE}")
    except Exception as e:
        print(f"[FFmpeg] QSV detection failed: {e}")
        _QSV_AVAILABLE = False
    return _QSV_AVAILABLE


def get_video_codec_args(preset: str = "fast", crf: int = 23, prefer_qsv: bool = True) -> list:
    """Return the FFmpeg codec arguments for the encoder we want to use.
    Uses Intel QSV if available; otherwise falls back to libx264."""
    if prefer_qsv and _qsv_supported():
        # h264_qsv preset names: veryfast, faster, fast, medium, slow, slower, veryslow
        # global_quality is the equivalent of crf (same scale, lower = better)
        qsv_preset = preset if preset in ("veryfast", "faster", "fast", "medium", "slow") else "fast"
        return ["-c:v", "h264_qsv", "-preset", qsv_preset, "-global_quality", str(crf)]
    return ["-c:v", "libx264", "-preset", preset, "-crf", str(crf)]


def run_ffmpeg_with_fallback(cmd_builder, label: str = "FFmpeg") -> subprocess.CompletedProcess:
    """Run an FFmpeg command built by cmd_builder(use_qsv: bool) -> list[str].
    Tries QSV first; on failure, falls back to libx264 and reruns."""
    if _qsv_supported():
        cmd = cmd_builder(True)
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode == 0:
            return result
        print(f"[{label}] QSV encode failed, falling back to libx264. stderr tail: {result.stderr[-300:]}")
    cmd = cmd_builder(False)
    return subprocess.run(cmd, capture_output=True, text=True, timeout=600)

# Emoji unicode ranges (covers most common emojis)
_EMOJI_RE = re.compile(
    r"[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F9FF]"
)


def _count_emojis(text: str) -> int:
    return len(_EMOJI_RE.findall(text))


def _measure_text_with_emoji(text: str, font, font_size: int) -> int:
    """PIL fonts can't measure emojis, so we measure text-only width and add
    a fixed allowance per emoji."""
    text_only = _EMOJI_RE.sub("", text)
    try:
        text_w = int(font.getlength(text_only))
    except Exception:
        text_w = int(len(text_only) * font_size * 0.55)
    # Each emoji renders at roughly font_size square. Add small spacing.
    emoji_w = _count_emojis(text) * int(font_size * 1.05)
    return text_w + emoji_w


def create_caption_overlay(lines: list, font_size: int = 72,
                            pad_x: int = 18, pad_y: int = 10,
                            line_gap: int = 0) -> tuple:
    """TikTok-style caption: each line is a fully-rounded box (all 4 corners).
    Boxes drawn bottom-to-top, each overlapping the one below by `radius` px
    so junctions are seamless. Where widths differ, the wider box's rounded
    corners stick out creating the TikTok staircase step effect.
    """
    from PIL import ImageFont as _IF
    import uuid as _uuid

    W_vid = 1080
    fill = (255, 255, 255, 242)
    font_path = 'C:/Windows/Fonts/calibrib.ttf'
    try:
        font = _IF.truetype(font_path, font_size)
    except Exception:
        font = _IF.load_default()

    line_h = int(font_size * 1.40)  # taller line so emojis fit + more breathing room
    radius = int(line_h * 0.19)
    overlap = radius  # each box overlaps the next by radius px to close the gap

    # Measure each line's box width (accounting for emojis)
    line_widths = []
    for line in lines:
        tw = _measure_text_with_emoji(line, font, font_size)
        line_widths.append(min(W_vid - 60, tw + pad_x * 2))

    n = len(lines)
    canvas_w = max(line_widths) if line_widths else 100
    canvas_h = n * line_h - (n - 1) * overlap + pad_y * 2

    img = Image.new('RGBA', (canvas_w, canvas_h), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)

    # Draw boxes bottom-to-top so upper boxes paint over the top rounded corners
    for i in range(n - 1, -1, -1):
        bw = line_widths[i]
        x0 = (canvas_w - bw) // 2
        x1 = x0 + bw
        y0 = pad_y + i * (line_h - overlap)
        y1 = y0 + line_h
        draw.rounded_rectangle([(x0, y0), (x1, y1)], radius=radius, fill=fill)

    # Draw text — use Pilmoji if the line has emojis, plain PIL otherwise
    has_any_emoji = any(_count_emojis(line) > 0 for line in lines)
    pilmoji_ctx = None
    if has_any_emoji:
        try:
            from pilmoji import Pilmoji
            from pilmoji.source import AppleEmojiSource
            # Apple emojis = the iOS / TikTok / CapCut look
            pilmoji_ctx = Pilmoji(img, source=AppleEmojiSource)
        except Exception as e:
            print(f"[Caption] Pilmoji unavailable, emojis will not render: {e}")

    for i, line in enumerate(lines):
        bw = line_widths[i]
        x0 = (canvas_w - bw) // 2
        y0 = pad_y + i * (line_h - overlap)
        tw = _measure_text_with_emoji(line, font, font_size)
        text_x = x0 + (bw - tw) // 2
        text_y = y0 + (line_h - font_size) // 2

        if pilmoji_ctx and _count_emojis(line) > 0:
            # Use Pilmoji's native offset to align emoji with text baseline
            pilmoji_ctx.text(
                (text_x, text_y), line, font=font, fill=(0, 0, 0, 255),
                emoji_position_offset=(0, -int(font_size * 0.10)),
            )
        else:
            draw.text((text_x, text_y), line, font=font, fill=(0, 0, 0, 255))

    if pilmoji_ctx:
        try:
            pilmoji_ctx.close()
        except Exception:
            pass

    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    png_path = os.path.join(temp_dir, f"caption_{_uuid.uuid4().hex}.png")
    img.save(png_path)
    return png_path, canvas_w, canvas_h


def create_tiktok_caption_overlay(lines: list, font_size: int = 72,
                                   pad_x: int = 20, pad_y: int = 10,
                                   line_gap: int = 8,
                                   stroke_width: int = 4) -> tuple:
    """Render TikTok-style text: white text with thick black outline, transparent background.
    Emojis (if present) are rendered AFTER the outline pass using Pilmoji so they
    keep their natural color instead of being smeared by the black stroke.
    Returns (png_path, box_w, box_h)."""
    from PIL import ImageFont as _IF
    import uuid as _uuid

    W_vid = 1080
    font_path = 'C:/Windows/Fonts/calibrib.ttf'
    try:
        font = _IF.truetype(font_path, font_size)
    except Exception:
        font = _IF.load_default()

    line_h = int(font_size * 1.40)  # taller line so emojis fit

    # Split each line into (text_part, emoji_part). Emojis are stripped for the
    # outlined text pass; they are painted in color afterwards.
    parsed = []
    for line in lines:
        emojis_in_line = "".join(_EMOJI_RE.findall(line))
        text_only = _EMOJI_RE.sub("", line).rstrip()
        parsed.append({"text": text_only, "emoji": emojis_in_line})

    # Measure widths per line (text + emoji separately so emoji never gets stroked)
    def _txt_w(s):
        try:
            return int(font.getlength(s))
        except Exception:
            return int(len(s) * font_size * 0.55)

    line_widths = []
    for p in parsed:
        tw = _txt_w(p["text"])
        ew = len(p["emoji"]) * int(font_size * 1.05)  # space allowance per emoji
        spacer = int(font_size * 0.20) if p["emoji"] and p["text"] else 0
        line_widths.append(tw + spacer + ew)

    max_line_px = max(line_widths) if line_widths else 0
    box_w = min(W_vid - 40, int(max_line_px + pad_x * 2 + stroke_width * 2))
    box_h = line_h * len(lines) + line_gap * max(len(lines) - 1, 0) + pad_y * 2 + stroke_width * 2

    img = Image.new('RGBA', (box_w, box_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    has_any_emoji = any(p["emoji"] for p in parsed)
    pilmoji_ctx = None
    if has_any_emoji:
        try:
            from pilmoji import Pilmoji
            from pilmoji.source import AppleEmojiSource
            pilmoji_ctx = Pilmoji(img, source=AppleEmojiSource)
        except Exception as e:
            print(f"[TikTok Caption] Pilmoji unavailable, emojis will not render: {e}")

    for i, p in enumerate(parsed):
        text_part, emoji_part = p["text"], p["emoji"]
        y = pad_y + stroke_width + i * (line_h + line_gap)

        tw = _txt_w(text_part)
        ew = len(emoji_part) * int(font_size * 1.05)
        spacer = int(font_size * 0.20) if emoji_part and text_part else 0
        total_w = tw + spacer + ew
        x = (box_w - total_w) // 2

        # Outline + white text — ONLY for the text portion (no emojis here)
        if text_part:
            for dx in range(-stroke_width, stroke_width + 1):
                for dy in range(-stroke_width, stroke_width + 1):
                    if dx == 0 and dy == 0:
                        continue
                    if abs(dx) ** 2 + abs(dy) ** 2 <= stroke_width ** 2 + stroke_width:
                        draw.text((x + dx, y + dy), text_part, font=font, fill=(0, 0, 0, 255))
            draw.text((x, y), text_part, font=font, fill=(255, 255, 255, 255))

        # Emoji on top, rendered in color by Pilmoji, no stroke.
        # Pilmoji anchors emoji to the font baseline, which sits ~ascent below
        # the visible top of the text. To align the emoji's vertical center
        # with the text's visual center we need to shift up by roughly
        # ~font_size (matches the empirical offset observed in the rendered
        # output).
        if emoji_part and pilmoji_ctx:
            emoji_x = x + tw + spacer
            offset_y = -int(font_size * 0.80)
            pilmoji_ctx.text(
                (emoji_x, y), emoji_part, font=font, fill=(255, 255, 255, 255),
                emoji_position_offset=(0, offset_y),
            )

    if pilmoji_ctx:
        try:
            pilmoji_ctx.close()
        except Exception:
            pass

    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    png_path = os.path.join(temp_dir, f"caption_tiktok_{_uuid.uuid4().hex}.png")
    img.save(png_path)
    return png_path, box_w, box_h


def split_text_into_lines(text: str, max_chars: int = 40) -> list:
    """Split text into up to 4 lines, each capped at max_chars. Extra words are dropped.
    If the last line ends up containing only emojis (no text), the last word from the
    previous line is pulled down so the emoji never appears alone in its own mini-box.
    """
    words = text.split()
    lines = []
    current = []

    for word in words:
        if len(lines) == 4:
            break
        test = " ".join(current + [word])
        if len(test) <= max_chars:
            current.append(word)
        else:
            if current:
                lines.append(" ".join(current))
            if len(lines) == 4:
                break
            current = [word]

    if current and len(lines) < 4:
        lines.append(" ".join(current))

    # If the final line is just emoji(s) with no text, pull the previous line's
    # last word down so the emoji is anchored to a real word (cleaner look).
    if len(lines) >= 2:
        last_no_emoji = _EMOJI_RE.sub("", lines[-1]).strip()
        if not last_no_emoji:
            prev_words = lines[-2].split()
            if len(prev_words) > 1:
                pulled = prev_words[-1]
                lines[-2] = " ".join(prev_words[:-1])
                lines[-1] = pulled + " " + lines[-1]

    return lines


# Fixed video zone constants — video size NEVER changes with text position
IG_VIDEO_H = 1100       # fixed video zone height (px), independent of text position
IG_BOTTOM_PAD = 80      # fixed bottom padding (px)
# video_top is always: 1920 - 80 - 1100 = 740
IG_VIDEO_TOP = 1920 - IG_BOTTOM_PAD - IG_VIDEO_H  # = 740


def create_instagram_frame_bg(
    caption: str,
    W: int = 1080,
    H: int = 1920,
    font_size: int = 72,
    top_padding: int = 130,
    gap: int = 60,
) -> tuple:
    """Create Instagram post frame: white background with caption text centered at top.
    Returns (png_path, video_top_y) where video_top_y is the FIXED start of the video zone.
    NOTE: video_top is FIXED (IG_VIDEO_TOP) regardless of text position so video size never changes."""
    import time
    from PIL import ImageFont as _IF

    font_path = 'C:/Windows/Fonts/calibrib.ttf'
    try:
        font = _IF.truetype(font_path, font_size)
    except Exception:
        font = _IF.load_default()

    lines = split_text_into_lines(caption, max_chars=28)
    line_h = int(font_size * 1.3)

    # video_top is FIXED — for size calculation only (video_h = H - video_top - pad = 1100)
    video_top = IG_VIDEO_TOP  # always 740
    # text_bottom = where text actually ends + gap (used for video placement centering)
    text_bottom = top_padding + line_h * len(lines) + gap

    img = Image.new('RGB', (W, H), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    # Draw text at top_padding (independent of video zone position)
    y = top_padding
    for line in lines:
        try:
            tw = int(font.getlength(line))
        except Exception:
            tw = int(len(line) * font_size * 0.6)
        x = (W - tw) // 2
        draw.text((x, y), line, font=font, fill=(20, 20, 20))
        y += line_h

    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    import uuid as _uuid
    png_path = os.path.join(temp_dir, f"ig_frame_{_uuid.uuid4().hex}.png")
    img.save(png_path)
    # Return (png_path, video_top_fixed, text_bottom_actual)
    return png_path, video_top, text_bottom


def get_video_duration(file_path: str) -> float:
    """Get video duration in seconds using ffmpeg."""
    try:
        cmd = [FFMPEG_EXE, "-i", file_path]
        result = subprocess.run(cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        for line in result.stderr.split("\n"):
            if "Duration" in line:
                parts = line.strip().split("Duration:")[1].split(",")[0].strip()
                h, m, s = parts.split(":")
                return float(h) * 3600 + float(m) * 60 + float(s)
    except Exception:
        pass
    return 600.0


def generate_instagram_preview_clip(
    video_path: str,
    start_time: float,
    duration: float,
    output_path: str,
    caption_text: str = "",
    fill_mode: str = "fit",
    watermark_path: str = None,
    watermark_x: float = 0.5,
    watermark_y: float = 0.85,
    watermark_scale: float = 0.3,
    watermark_opacity: float = 0.9,
    flip_horizontal: bool = False,
    boost_contrast: bool = False,
    max_seconds: float = 10.0,
) -> str:
    """Generate a short Instagram-format preview: white frame + caption above + video below."""
    clip_duration = min(duration, max_seconds)
    W, H = 1080, 1920
    bottom_padding = 55

    frame_png, video_top = create_instagram_frame_bg(caption_text)
    video_h = H - video_top - bottom_padding

    if fill_mode == "fill":
        fg_filter = f"scale={W}:{video_h}:force_original_aspect_ratio=increase,crop={W}:{video_h}"
    elif fill_mode == "zoom":
        fg_filter = f"scale=-2:{int(video_h * 0.9)}"
    elif fill_mode == "small":
        fg_filter = f"scale=-2:{int(video_h * 0.78)}"
    elif fill_mode == "medium":
        fg_filter = f"scale=-2:{int(video_h * 0.65)}"
    elif fill_mode == "mini":
        fg_filter = f"scale=-2:{int(video_h * 0.50)}"
    else:  # fit
        fg_filter = f"scale={W}:{video_h}:force_original_aspect_ratio=decrease"

    filter_complex = (
        f"[0:v]scale={W}:{video_h}:force_original_aspect_ratio=increase,crop={W}:{video_h},boxblur=12:2[bg];"
        f"[0:v]{fg_filter}[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2[video_processed];"
        f"[1:v][video_processed]overlay=0:{video_top}[with_video]"
    )

    current_label = "with_video"
    input_index = 2

    has_watermark = watermark_path and os.path.exists(watermark_path)
    if has_watermark:
        wm_w = max(50, int(W * watermark_scale))
        wx = int(watermark_x * W)
        wy = video_top + int(watermark_y * video_h)
        filter_complex += f";[{input_index}:v]scale={wm_w}:-1,format=rgba,colorchannelmixer=aa={watermark_opacity}[wm]"
        filter_complex += f";[{current_label}][wm]overlay={wx}-(overlay_w/2):{wy}-(overlay_h/2)[watermarked]"
        current_label = "watermarked"
        input_index += 1

    preview_vf = []
    if flip_horizontal:
        preview_vf.append("hflip")
    if boost_contrast:
        preview_vf.append("eq=contrast=1.05:brightness=0.02:saturation=1.05")
    if preview_vf:
        filter_complex += f";[{current_label}]{','.join(preview_vf)}[detected]"
        current_label = "detected"

    end_time = start_time + clip_duration
    cmd = [FFMPEG_EXE, "-ss", str(start_time), "-to", str(end_time), "-i", video_path]
    cmd.extend(["-loop", "1", "-t", str(clip_duration), "-i", frame_png])

    if has_watermark:
        cmd.extend(["-loop", "1", "-t", str(clip_duration), "-i", watermark_path])

    cmd.extend([
        "-filter_complex", filter_complex,
        "-map", f"[{current_label}]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        "-sar", "1:1",
        "-movflags", "+faststart",
        "-y", output_path,
    ])

    print(f"[Instagram Preview] Generating {clip_duration}s clip")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

    if frame_png and os.path.exists(frame_png):
        try:
            os.remove(frame_png)
        except:
            pass

    if result.returncode != 0:
        print(f"[Instagram Preview] Error: {result.stderr[-500:]}")
        raise RuntimeError(f"Instagram preview failed: {result.stderr}")

    return output_path


def generate_instagram_preview_frame(
    video_path: str,
    timestamp: float,
    output_path: str,
    caption_text: str = "",
    fill_mode: str = "fit",
    ig_top_padding: int = 130,
    watermark_path: str = None,
    watermark_x: float = 0.5,
    watermark_y: float = 0.85,
    ig_watermark_y: float = None,
    watermark_scale: float = 0.3,
    watermark_opacity: float = 0.9,
    flip_horizontal: bool = False,
    boost_contrast: bool = False,
) -> str:
    """Generate a JPEG in Instagram post format: white bg + caption text above + video frame below.
    Step 1: FFmpeg extracts a single raw video frame.
    Step 2: PIL creates the white IG background and pastes the video frame into the video zone.
    """
    import time
    from PIL import ImageEnhance, ImageFilter

    W, H = 1080, 1920

    # Build white IG background with caption text at top
    # video_h is FIXED — text position does NOT affect video size
    frame_png, video_top, text_bottom = create_instagram_frame_bg(caption_text, top_padding=ig_top_padding)
    video_h = IG_VIDEO_H        # always 1100, independent of text position
    bottom_padding = IG_BOTTOM_PAD  # always 80

    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    import uuid as _uuid
    raw_frame_path = os.path.join(temp_dir, f"ig_raw_{_uuid.uuid4().hex}.jpg")

    # Step 1: Extract video frame scaled according to fill_mode
    if fill_mode == "fill":
        # Cover the full video zone (crop sides)
        vf = f"scale={W}:{video_h}:force_original_aspect_ratio=increase,crop={W}:{video_h}"
    elif fill_mode == "zoom":
        # 90% of zone height, centered
        vf = f"scale=-2:{int(video_h * 0.9)}"
    elif fill_mode == "small":
        # 78% of zone height, centered
        vf = f"scale=-2:{int(video_h * 0.78)}"
    elif fill_mode == "medium":
        # 65% of zone height — noticeably bigger than fit, slight side crop for landscape
        vf = f"scale=-2:{int(video_h * 0.65)}"
    elif fill_mode == "mini":
        # 50% of zone height — smallest option, more blur visible
        vf = f"scale=-2:{int(video_h * 0.50)}"
    else:  # fit — scale to fit width, may have top/bottom white space
        vf = f"scale={W}:-2"

    extract_cmd = [
        FFMPEG_EXE,
        "-ss", str(timestamp),
        "-i", video_path,
        "-vframes", "1",
        "-vf", vf,
        "-q:v", "2",
        "-y", "-loglevel", "error",
        raw_frame_path,
    ]

    result = subprocess.run(extract_cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0 or not os.path.exists(raw_frame_path):
        if os.path.exists(frame_png):
            try: os.remove(frame_png)
            except: pass
        raise RuntimeError(f"Frame extraction failed: {result.stderr[-300:]}")

    # Step 2: PIL composite — paste video CENTERED within the video zone on white bg
    bg = Image.open(frame_png).convert("RGB")       # 1080x1920 white with caption
    raw = Image.open(raw_frame_path).convert("RGB") # video frame at fill_mode dimensions

    raw_w, raw_h = raw.size
    # Center horizontally within the canvas
    paste_x = (W - raw_w) // 2
    # Center vertically in the FULL canvas (so video appears in the middle of the image)
    # Clamp upward so video never overlaps the text, clamp downward to stay on canvas
    paste_y = (H - raw_h) // 2                          # ideal: canvas center
    paste_y = max(paste_y, text_bottom)                 # don't overlap text
    paste_y = min(paste_y, H - bottom_padding - raw_h) # don't overflow bottom
    bg.paste(raw, (paste_x, paste_y))

    # Watermark (positioned relative to video zone)
    # ig_watermark_y overrides watermark_y for IG preview if provided
    effective_wm_y = ig_watermark_y if ig_watermark_y is not None else watermark_y
    if watermark_path and os.path.exists(watermark_path):
        wm = Image.open(watermark_path).convert("RGBA")
        wm_w = max(50, int(W * watermark_scale))
        wm_h = int(wm.size[1] * wm_w / wm.size[0])
        wm = wm.resize((wm_w, wm_h), Image.LANCZOS)
        if watermark_opacity < 1.0:
            r, g, b, a = wm.split()
            a = a.point(lambda x: int(x * watermark_opacity))
            wm = Image.merge("RGBA", (r, g, b, a))
        wx = int(watermark_x * W) - wm_w // 2
        wy = video_top + int(effective_wm_y * video_h) - wm_h // 2
        bg.paste(wm, (wx, wy), wm)

    if flip_horizontal:
        bg = bg.transpose(Image.FLIP_LEFT_RIGHT)
    if boost_contrast:
        bg = ImageEnhance.Contrast(bg).enhance(1.05)
        bg = ImageEnhance.Brightness(bg).enhance(1.02)
        bg = ImageEnhance.Color(bg).enhance(1.05)

    bg.save(output_path, quality=90)

    for p in [frame_png, raw_frame_path]:
        if p and os.path.exists(p):
            try: os.remove(p)
            except: pass

    print(f"[IG Preview Frame] Done — video_top={video_top}, video_h={video_h}, size={bg.size}")
    return output_path


def generate_preview_frame(
    video_path: str,
    timestamp: float,
    output_path: str,
    caption_text: str = "",
    text_x: float = 0.5,
    text_y: float = 0.15,
    font_size: int = 50,
    text_color: str = "white",
    text_stroke_color: str = "black",
    text_stroke_width: int = 3,
    watermark_path: str = None,
    watermark_x: float = 0.5,
    watermark_y: float = 0.85,
    watermark_scale: float = 0.3,
    watermark_opacity: float = 0.9,
    fill_mode: str = "fit",
    split_screen_enabled: bool = False,
    split_image_path: str = None,
    split_ratio: float = 0.5,
    flip_horizontal: bool = False,
    boost_contrast: bool = False,
    caption_style: str = "box",
    background_style: str = "blur",
    **kwargs,
) -> str:
    """Generate preview frame (JPEG)."""
    W, H = 1080, 1920

    # Determine if split-screen is active
    use_split = split_screen_enabled and split_image_path and os.path.exists(split_image_path)

    if use_split:
        ratio = max(0.3, min(0.7, split_ratio))
        video_h = int(H * ratio)
        image_h = H - video_h
        target_h = video_h
    else:
        target_h = H

    # Build fg_filter based on fill_mode and target height
    if fill_mode == "fill":
        fg_filter = f"scale={W}:{target_h}:force_original_aspect_ratio=increase,crop={W}:{target_h}"
    elif fill_mode == "zoom":
        fg_filter = f"scale=-2:{int(target_h * 0.9)}"
    elif fill_mode == "small":
        fg_filter = f"scale=-2:{int(target_h * 0.78)}"
    elif fill_mode == "medium":
        fg_filter = f"scale=-2:{int(target_h * 0.65)}"
    elif fill_mode == "mini":
        fg_filter = f"scale=-2:{int(target_h * 0.50)}"
    else:
        fg_filter = f"scale={W}:-2"

    filter_parts = []
    input_index = 1  # [0] = video

    # Black bg via `pad` (single chain, no source-timing issues).
    # Blur bg via the original [bg]+[fg]+overlay pattern.
    if use_split:
        if background_style == "black":
            filter_parts.append(
                f"[0:v]{fg_filter},pad={W}:{video_h}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p[video_part]"
            )
        else:
            filter_parts.append(f"[0:v]scale={W}:{video_h}:force_original_aspect_ratio=increase,crop={W}:{video_h},boxblur=12:2[bg]")
            filter_parts.append(f"[0:v]{fg_filter}[fg]")
            filter_parts.append(f"[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[video_part]")
        # Image portion: scale to fill, crop to exact size, match pixel format
        filter_parts.append(f"[1:v]scale={W}:{image_h}:force_original_aspect_ratio=increase,crop={W}:{image_h},setsar=1,format=yuv420p[img_part]")
        # Stack vertically
        filter_parts.append("[video_part][img_part]vstack=inputs=2[v]")
        input_index = 2  # [0]=video, [1]=split image
    else:
        if background_style == "black":
            filter_parts.append(
                f"[0:v]{fg_filter},pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p[v]"
            )
        else:
            filter_parts.append(f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=12:2[bg]")
            filter_parts.append(f"[0:v]{fg_filter}[fg]")
            filter_parts.append(f"[bg][fg]overlay=(W-w)/2:(H-h)/2[v]")

    last = "v"
    rounded_box_path = None

    # Caption overlay — Y position relative to video portion in split mode
    if caption_text:
        lines = split_text_into_lines(caption_text, max_chars=30)
        pad_x, pad_y = 12, 14
        line_gap = 5
        base_y = int(text_y * target_h)

        if caption_style == 'tiktok':
            rounded_box_path, box_w, box_h = create_tiktok_caption_overlay(
                lines, font_size=font_size
            )
        else:
            rounded_box_path, box_w, box_h = create_caption_overlay(
                lines, font_size=font_size, pad_x=pad_x, pad_y=pad_y, line_gap=line_gap
            )
        box_x = max(0, min(W - box_w, int(text_x * W) - box_w // 2))
        box_y = base_y - pad_y

        filter_parts.append(f"[{last}][{input_index}:v]overlay={box_x}:{box_y}[boxed]")
        last = "boxed"
        input_index += 1

    # Watermark — Y position relative to video portion in split mode
    if watermark_path and os.path.exists(watermark_path):
        wm_w = max(50, int(W * watermark_scale))
        wx = int(watermark_x * W)
        wy = int(watermark_y * target_h)
        filter_parts.append(f"[{input_index}:v]scale={wm_w}:-1,format=rgba,colorchannelmixer=aa={watermark_opacity}[wm]")
        filter_parts.append(f"[{last}][wm]overlay={wx}-(overlay_w/2):{wy}-(overlay_h/2)[final]")
        last = "final"

    # Visual anti-detect filters (also shown in preview)
    preview_vf = []
    if flip_horizontal:
        preview_vf.append("hflip")
    if boost_contrast:
        preview_vf.append("eq=contrast=1.05:brightness=0.02:saturation=1.05")
    if preview_vf:
        filter_parts.append(f"[{last}]{','.join(preview_vf)}[detected]")
        last = "detected"

    cmd = [FFMPEG_EXE, "-ss", str(timestamp), "-i", video_path]

    if use_split:
        cmd.extend(["-i", split_image_path])

    if rounded_box_path:
        cmd.extend(["-loop", "1", "-i", rounded_box_path])

    if watermark_path and os.path.exists(watermark_path):
        cmd.extend(["-i", watermark_path])

    cmd.extend([
        "-vframes", "1",
        "-filter_complex", ";".join(filter_parts),
        "-map", f"[{last}]",
        "-q:v", "2",
        "-y", "-loglevel", "error",
        output_path,
    ])

    print(f"[FFmpeg CMD] {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=30)
    except subprocess.CalledProcessError as e:
        print(f"[FFmpeg ERROR] returncode={e.returncode}")
        print(f"[FFmpeg STDERR] {e.stderr}")
        raise RuntimeError(f"FFmpeg failed: {e.stderr[-500:] if e.stderr else 'no stderr'}")
    finally:
        if rounded_box_path and os.path.exists(rounded_box_path):
            try:
                os.remove(rounded_box_path)
            except:
                pass

    return output_path


def generate_preview_clip(
    video_path: str,
    start_time: float,
    duration: float,
    output_path: str,
    max_seconds: float = 10.0,
    caption_text: str = "",
    text_x: float = 0.5,
    text_y: float = 0.08,
    font_size: int = 50,
    text_color: str = "white",
    text_stroke_color: str = "black",
    text_stroke_width: int = 5,
    watermark_path: str = None,
    watermark_x: float = 0.5,
    watermark_y: float = 0.85,
    watermark_scale: float = 0.3,
    watermark_opacity: float = 0.9,
    fill_mode: str = "fit",
    split_screen_enabled: bool = False,
    split_image_path: str = None,
    split_ratio: float = 0.5,
    flip_horizontal: bool = False,
    boost_contrast: bool = False,
    caption_style: str = "box",
    subtitle_style: str = "none",
    transcript: dict = None,
    visual_filter: str = "none",
    subtitle_size_scale: float = 1.0,
    background_style: str = "blur",
) -> str:
    """Generate preview clip with blur + rounded white box + text."""
    clip_duration = min(duration, max_seconds)
    W, H = 1080, 1920

    # Determine if split-screen is active
    use_split = split_screen_enabled and split_image_path and os.path.exists(split_image_path)

    if use_split:
        ratio = max(0.3, min(0.7, split_ratio))
        video_h = int(H * ratio)
        image_h = H - video_h
        target_h = video_h
    else:
        target_h = H

    # Build fg_filter based on fill_mode and target height
    if fill_mode == "fill":
        fg_filter = f"scale={W}:{target_h}:force_original_aspect_ratio=increase,crop={W}:{target_h}"
    elif fill_mode == "zoom":
        fg_filter = f"scale=-2:{int(target_h * 0.9)}"
    elif fill_mode == "small":
        fg_filter = f"scale=-2:{int(target_h * 0.78)}"
    elif fill_mode == "medium":
        fg_filter = f"scale=-2:{int(target_h * 0.65)}"
    elif fill_mode == "mini":
        fg_filter = f"scale=-2:{int(target_h * 0.50)}"
    else:
        fg_filter = f"scale={W}:-2"

    # Build filter
    input_index = 1

    if use_split:
        if background_style == "black":
            filter_complex = (
                f"[0:v]{fg_filter},pad={W}:{video_h}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p[video_part];"
                f"[1:v]scale={W}:{image_h}:force_original_aspect_ratio=increase,crop={W}:{image_h},setsar=1,format=yuv420p[img_part];"
                f"[video_part][img_part]vstack=inputs=2[v]"
            )
        else:
            filter_complex = (
                f"[0:v]scale={W}:{video_h}:force_original_aspect_ratio=increase,crop={W}:{video_h},boxblur=12:2[bg];"
                f"[0:v]{fg_filter}[fg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[video_part];"
                f"[1:v]scale={W}:{image_h}:force_original_aspect_ratio=increase,crop={W}:{image_h},setsar=1,format=yuv420p[img_part];"
                f"[video_part][img_part]vstack=inputs=2[v]"
            )
        input_index = 2
    else:
        if background_style == "black":
            filter_complex = f"[0:v]{fg_filter},pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p[v]"
        else:
            filter_complex = f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=12:2[bg];[0:v]{fg_filter}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]"

    last_label = "v"
    rounded_box_path = None

    # Caption overlay — Y relative to video portion in split mode
    if caption_text:
        lines = split_text_into_lines(caption_text, max_chars=30)
        pad_x, pad_y = 12, 14
        line_gap = 5
        base_y = int(text_y * target_h)

        if caption_style == 'tiktok':
            rounded_box_path, box_w, box_h = create_tiktok_caption_overlay(
                lines, font_size=font_size
            )
        else:
            rounded_box_path, box_w, box_h = create_caption_overlay(
                lines, font_size=font_size, pad_x=pad_x, pad_y=pad_y, line_gap=line_gap
            )
        box_x = max(0, min(W - box_w, int(text_x * W) - box_w // 2))
        box_y = base_y - pad_y

        filter_complex += f";[{last_label}][{input_index}:v]overlay={box_x}:{box_y}[boxed]"
        last_label = "boxed"
        input_index += 1

    # Visual anti-detect filters (also shown in preview)
    preview_vf = []
    if flip_horizontal:
        preview_vf.append("hflip")
    if boost_contrast:
        preview_vf.append("eq=contrast=1.05:brightness=0.02:saturation=1.05")
    # Cinematic visual filter applied last
    cinematic = get_visual_filter_chain(visual_filter)
    if cinematic:
        preview_vf.append(cinematic)
    if preview_vf:
        filter_complex += f";[{last_label}]{','.join(preview_vf)}[detected]"
        last_label = "detected"

    # Burn-in subtitles in preview (so user can see exactly what will be exported)
    ass_subtitle_path = None
    ass_subtitle_path_extra = None  # cwd copy for FFmpeg-friendly relative path
    if subtitle_style and subtitle_style != 'none' and transcript:
        try:
            from . import subtitle_service
            temp_dir = os.path.join(os.path.dirname(__file__), "temp")
            ass_subtitle_path = subtitle_service.generate_ass_for_clip(
                transcript=transcript,
                clip_start=start_time,
                clip_end=start_time + clip_duration,
                style=subtitle_style,
                output_dir=temp_dir,
                size_scale=subtitle_size_scale,
            )
            if ass_subtitle_path:
                # FFmpeg subtitles filter is fragile with Windows paths.
                # Workaround: copy the ASS to the current working directory and use
                # a relative filename — no colons to escape.
                import shutil as _shutil
                ass_basename = os.path.basename(ass_subtitle_path)
                ass_in_cwd = os.path.join(os.getcwd(), ass_basename)
                _shutil.copy2(ass_subtitle_path, ass_in_cwd)
                # Track for cleanup
                ass_subtitle_path_extra = ass_in_cwd
                filter_complex += f";[{last_label}]subtitles={ass_basename}[subbed]"
                last_label = "subbed"
                print(f"[Preview] Subtitle style='{subtitle_style}' applied (ass={ass_basename})")
        except Exception as e:
            print(f"[Preview] Subtitle generation failed (continuing without): {e}")

    # PREVIEW SPEED OPTIMIZATION: downscale final output to 720x1280 (3x fewer pixels)
    # The full 1080x1920 layout is preserved so captions/watermark/subs look correct,
    # we just shrink at the very end before encoding for faster output. Export still
    # uses the full 1080x1920 — this only affects the temporary preview file.
    filter_complex += f";[{last_label}]scale=720:1280[scaled]"
    last_label = "scaled"

    end_time = start_time + clip_duration
    cmd = [FFMPEG_EXE, "-ss", str(start_time), "-to", str(end_time), "-i", video_path]

    if use_split:
        cmd.extend(["-loop", "1", "-t", str(clip_duration), "-i", split_image_path])

    if rounded_box_path:
        cmd.extend(["-loop", "1", "-t", str(clip_duration), "-i", rounded_box_path])

    base_args = [
        "-filter_complex", filter_complex,
        "-map", f"[{last_label}]",
        "-map", "0:a?",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        "-sar", "1:1",
        "-movflags", "+faststart",
        "-y",
        output_path,
    ]
    # Try QSV (Intel hardware encoder) first; fall back to libx264 on failure
    qsv_codec = get_video_codec_args(preset="veryfast", crf=28, prefer_qsv=True)
    cpu_codec = get_video_codec_args(preset="ultrafast", crf=28, prefer_qsv=False)
    cmd_qsv = cmd + qsv_codec + base_args
    cmd_cpu = cmd + cpu_codec + base_args

    print(f"[Preview] Generating {clip_duration}s clip with {len(lines) if caption_text else 0} text lines, split={use_split}, qsv={_qsv_supported()}")
    result = subprocess.run(cmd_qsv, capture_output=True, text=True, timeout=120)
    if result.returncode != 0 and _qsv_supported():
        print(f"[Preview] QSV failed, retrying with libx264. stderr: {result.stderr[-200:]}")
        result = subprocess.run(cmd_cpu, capture_output=True, text=True, timeout=120)

    if rounded_box_path and os.path.exists(rounded_box_path):
        try:
            os.remove(rounded_box_path)
        except:
            pass

    if ass_subtitle_path and os.path.exists(ass_subtitle_path):
        try:
            os.remove(ass_subtitle_path)
        except:
            pass
    # Clean the cwd copy used by FFmpeg
    if ass_subtitle_path_extra and os.path.exists(ass_subtitle_path_extra):
        try:
            os.remove(ass_subtitle_path_extra)
        except:
            pass

    if result.returncode != 0:
        print(f"[Preview] Error: {result.stderr[-500:]}")
        raise RuntimeError(f"Preview failed: {result.stderr}")

    return output_path
