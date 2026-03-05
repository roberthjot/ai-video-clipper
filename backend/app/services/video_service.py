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
        font_size_actual = 72
        pad_x, pad_y = 12, 8
        line_gap = 5
        base_y = int(text_y * target_h)

        rounded_box_path, box_w, box_h = create_caption_overlay(
            lines, font_size=font_size_actual, pad_x=pad_x, pad_y=pad_y, line_gap=line_gap
        )
        box_x = (W - box_w) // 2
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
        font_size_actual = 72
        pad_x, pad_y = 12, 8
        line_gap = 5
        base_y = int(text_y * target_h)

        rounded_box_path, box_w, box_h = create_caption_overlay(
            lines, font_size=font_size_actual, pad_x=pad_x, pad_y=pad_y, line_gap=line_gap
        )
        box_x = (W - box_w) // 2
        box_y = base_y - pad_y

        filter_complex += f";[{last_label}][{input_index}:v]overlay={box_x}:{box_y}[boxed]"
        last_label = "boxed"
        input_index += 1

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
