import os
import subprocess
import imageio_ffmpeg
from PIL import Image, ImageDraw

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()


def create_rounded_box(width: int, height: int, corner_radius: int = 20) -> str:
    """Create a white rounded rectangle PNG."""
    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    output_path = os.path.join(temp_dir, f"box_{width}x{height}.png")

    img = Image.new('RGBA', (width, height), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        [(0, 0), (width, height)],
        radius=corner_radius,
        fill=(255, 255, 255, 242)
    )
    img.save(output_path)
    return output_path


def split_text_into_lines(text: str, max_chars: int = 40) -> list:
    """Split text into max 3 lines. Truncate to 15 words max."""
    # Hard cap at 15 words to prevent overflow
    words = text.split()[:15]
    lines = []
    current = []

    for word in words:
        test = " ".join(current + [word])
        if len(test) <= max_chars:
            current.append(word)
        else:
            if current:
                lines.append(" ".join(current))
            current = [word]

    if current:
        lines.append(" ".join(current))

    return lines[:3]


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
    **kwargs,
) -> str:
    """Generate preview frame (JPEG)."""
    W, H = 1080, 1920

    filter_parts = []
    filter_parts.append(f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=12:2[bg]")
    filter_parts.append(f"[0:v]scale={W}:-2[fg]")
    filter_parts.append(f"[bg][fg]overlay=(W-w)/2:(H-h)/2[v]")

    last = "v"
    input_index = 1
    rounded_box_path = None

    # Add rounded box + text if caption exists
    if caption_text:
        import re as _re
        safe = caption_text.replace("'", "`").replace('"', "").replace("\\", "")
        safe = _re.sub(r'[^\x00-\x7F]+', '', safe).strip()
        lines = split_text_into_lines(safe)

        font_size_actual = 42
        pad_x, pad_y = 24, 16
        line_gap = 8
        line_h = int(font_size_actual * 1.15)
        base_y = int(text_y * H)

        try:
            from PIL import ImageFont as _IF
            _fnt = _IF.truetype('C:/Windows/Fonts/arialbd.ttf', font_size_actual)
            max_line_px = max(_fnt.getlength(line) for line in lines)
        except Exception:
            max_line_px = max(len(line) for line in lines) * font_size_actual * 0.55
        box_w = min(W - 80, int(max_line_px + pad_x * 2))
        box_h = line_h * len(lines) + line_gap * (len(lines) - 1) + pad_y * 2
        box_x = (W - box_w) // 2
        box_y = base_y - pad_y

        rounded_box_path = create_rounded_box(box_w, box_h, corner_radius=14)
        filter_parts.append(f"[{last}][{input_index}:v]overlay={box_x}:{box_y}[boxed]")
        last = "boxed"
        input_index += 1

        for i, line in enumerate(lines):
            y = box_y + pad_y + i * (line_h + line_gap)
            filter_parts.append(f"[{last}]drawtext=text='{line}':fontfile='C\\:/Windows/Fonts/arialbd.ttf':fontsize=42:fontcolor=black:x=(w-text_w)/2:y={y}[t{i}]")
            last = f"t{i}"

    # Watermark
    if watermark_path and os.path.exists(watermark_path):
        wm_w = max(50, int(W * watermark_scale))
        wx = int(watermark_x * W)
        wy = int(watermark_y * H)
        filter_parts.append(f"[{input_index}:v]scale={wm_w}:-1,format=rgba,colorchannelmixer=aa={watermark_opacity}[wm]")
        filter_parts.append(f"[{last}][wm]overlay={wx}-(overlay_w/2):{wy}-(overlay_h/2)[final]")
        last = "final"

    cmd = [FFMPEG_EXE, "-ss", str(timestamp), "-i", video_path]

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

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=30)
    except:
        pass
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
) -> str:
    """Generate preview clip with blur + rounded white box + text."""
    clip_duration = duration
    W, H = 1080, 1920

    # Build filter
    filter_complex = f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=12:2[bg];[0:v]scale={W}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]"
    last_label = "v"
    input_index = 1
    rounded_box_path = None

    # Add rounded box + text
    if caption_text:
        import re as _re
        safe = caption_text.replace("'", "`").replace('"', "").replace("\\", "")
        safe = _re.sub(r'[^\x00-\x7F]+', '', safe).strip()
        lines = split_text_into_lines(safe)

        font_size_actual = 42
        pad_x, pad_y = 24, 16
        line_gap = 8
        line_h = int(font_size_actual * 1.15)
        base_y = int(text_y * H)

        try:
            from PIL import ImageFont as _IF
            _fnt = _IF.truetype('C:/Windows/Fonts/arialbd.ttf', font_size_actual)
            max_line_px = max(_fnt.getlength(line) for line in lines)
        except Exception:
            max_line_px = max(len(line) for line in lines) * font_size_actual * 0.55
        box_w = min(W - 80, int(max_line_px + pad_x * 2))
        box_h = line_h * len(lines) + line_gap * (len(lines) - 1) + pad_y * 2
        box_x = (W - box_w) // 2
        box_y = base_y - pad_y

        rounded_box_path = create_rounded_box(box_w, box_h, corner_radius=14)
        filter_complex += f";[{last_label}][{input_index}:v]overlay={box_x}:{box_y}[boxed]"
        last_label = "boxed"
        input_index += 1

        for i, line in enumerate(lines):
            y = box_y + pad_y + i * (line_h + line_gap)
            filter_complex += f";[{last_label}]drawtext=text='{line}':fontfile='C\\:/Windows/Fonts/arialbd.ttf':fontsize={font_size_actual}:fontcolor=black:x=(w-text_w)/2:y={y}[t{i}]"
            last_label = f"t{i}"

    end_time = start_time + clip_duration
    cmd = [FFMPEG_EXE, "-ss", str(start_time), "-to", str(end_time), "-i", video_path]

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

    print(f"[Preview] Generating {clip_duration}s clip with {len(lines) if caption_text else 0} text lines")
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
