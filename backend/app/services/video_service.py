import os
import subprocess
import imageio_ffmpeg
from PIL import Image, ImageDraw

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()


def create_caption_overlay(lines: list, font_size: int = 72,
                            pad_x: int = 12, pad_y: int = 8,
                            line_gap: int = 5) -> tuple:
    """Render white rounded box + text with PIL. Returns (png_path, box_w, box_h).
    Using PIL avoids all FFmpeg drawtext escaping issues (apostrophes, quotes, etc).
    """
    import time
    from PIL import ImageFont as _IF

    W_vid = 1080
    font_path = 'C:/Windows/Fonts/calibrib.ttf'
    try:
        font = _IF.truetype(font_path, font_size)
    except Exception:
        font = _IF.load_default()

    line_h = int(font_size * 1.15)

    try:
        max_line_px = max(font.getlength(line) for line in lines) if lines else 0
    except Exception:
        max_line_px = max(len(line) for line in lines) * font_size * 0.55 if lines else 0

    box_w = min(W_vid - 80, int(max_line_px + pad_x * 2))
    box_h = line_h * len(lines) + line_gap * max(len(lines) - 1, 0) + pad_y * 2

    img = Image.new('RGBA', (box_w, box_h), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([(0, 0), (box_w, box_h)], radius=14, fill=(255, 255, 255, 242))

    for i, line in enumerate(lines):
        y = pad_y + i * (line_h + line_gap)
        try:
            tw = int(font.getlength(line))
        except Exception:
            tw = int(len(line) * font_size * 0.55)
        x = (box_w - tw) // 2
        draw.text((x, y), line, font=font, fill=(0, 0, 0, 255))

    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    png_path = os.path.join(temp_dir, f"caption_{int(time.time() * 1000)}.png")
    img.save(png_path)
    return png_path, box_w, box_h


def split_text_into_lines(text: str, max_chars: int = 40) -> list:
    """Split text into up to 3 lines, each capped at max_chars. Extra words are dropped."""
    words = text.split()
    lines = []
    current = []

    for word in words:
        if len(lines) == 3:
            break
        test = " ".join(current + [word])
        if len(test) <= max_chars:
            current.append(word)
        else:
            if current:
                lines.append(" ".join(current))
            if len(lines) == 3:
                break
            current = [word]

    if current and len(lines) < 3:
        lines.append(" ".join(current))

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
    png_path = os.path.join(temp_dir, f"ig_frame_{int(time.time() * 1000)}.png")
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
    raw_frame_path = os.path.join(temp_dir, f"ig_raw_{int(time.time() * 1000)}.jpg")

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
    else:
        fg_filter = f"scale={W}:-2"

    filter_parts = []
    input_index = 1  # [0] = video

    if use_split:
        # Video portion with blur bg sized to video_h
        filter_parts.append(f"[0:v]scale={W}:{video_h}:force_original_aspect_ratio=increase,crop={W}:{video_h},boxblur=12:2[bg]")
        filter_parts.append(f"[0:v]{fg_filter}[fg]")
        filter_parts.append(f"[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[video_part]")
        # Image portion: scale to fill, crop to exact size, match pixel format
        filter_parts.append(f"[1:v]scale={W}:{image_h}:force_original_aspect_ratio=increase,crop={W}:{image_h},setsar=1,format=yuv420p[img_part]")
        # Stack vertically
        filter_parts.append("[video_part][img_part]vstack=inputs=2[v]")
        input_index = 2  # [0]=video, [1]=split image
    else:
        filter_parts.append(f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=12:2[bg]")
        filter_parts.append(f"[0:v]{fg_filter}[fg]")
        filter_parts.append(f"[bg][fg]overlay=(W-w)/2:(H-h)/2[v]")

    last = "v"
    rounded_box_path = None

    # Caption overlay — Y position relative to video portion in split mode
    if caption_text:
        lines = split_text_into_lines(caption_text, max_chars=25)
        pad_x, pad_y = 12, 8
        line_gap = 5
        base_y = int(text_y * target_h)

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
    else:
        fg_filter = f"scale={W}:-2"

    # Build filter
    input_index = 1

    if use_split:
        filter_complex = (
            f"[0:v]scale={W}:{video_h}:force_original_aspect_ratio=increase,crop={W}:{video_h},boxblur=12:2[bg];"
            f"[0:v]{fg_filter}[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[video_part];"
            f"[1:v]scale={W}:{image_h}:force_original_aspect_ratio=increase,crop={W}:{image_h},setsar=1,format=yuv420p[img_part];"
            f"[video_part][img_part]vstack=inputs=2[v]"
        )
        input_index = 2
    else:
        filter_complex = f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=12:2[bg];[0:v]{fg_filter}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]"

    last_label = "v"
    rounded_box_path = None

    # Caption overlay — Y relative to video portion in split mode
    if caption_text:
        lines = split_text_into_lines(caption_text, max_chars=25)
        pad_x, pad_y = 12, 8
        line_gap = 5
        base_y = int(text_y * target_h)

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
    if preview_vf:
        filter_complex += f";[{last_label}]{','.join(preview_vf)}[detected]"
        last_label = "detected"

    end_time = start_time + clip_duration
    cmd = [FFMPEG_EXE, "-ss", str(start_time), "-to", str(end_time), "-i", video_path]

    if use_split:
        cmd.extend(["-loop", "1", "-t", str(clip_duration), "-i", split_image_path])

    if rounded_box_path:
        cmd.extend(["-loop", "1", "-t", str(clip_duration), "-i", rounded_box_path])

    cmd.extend([
        "-filter_complex", filter_complex,
        "-map", f"[{last_label}]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        "-sar", "1:1",
        "-movflags", "+faststart",
        "-y",
        output_path,
    ])

    print(f"[Preview] Generating {clip_duration}s clip with {len(lines) if caption_text else 0} text lines, split={use_split}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

    if rounded_box_path and os.path.exists(rounded_box_path):
        try:
            os.remove(rounded_box_path)
        except:
            pass

    if result.returncode != 0:
        print(f"[Preview] Error: {result.stderr[-500:]}")
        raise RuntimeError(f"Preview failed: {result.stderr}")

    return output_path
