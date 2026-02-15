import os
import subprocess
import imageio_ffmpeg

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()


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
    font_size: int = 42,
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
    """Generate a 9:16 preview frame (static JPEG) with blur background + text."""
    W, H = 1080, 1920

    filter_parts = []
    filter_parts.append(
        f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,"
        f"crop={W}:{H},boxblur=12:2[bg]"
    )
    filter_parts.append(f"[0:v]scale={W}:-2[fg]")
    filter_parts.append(f"[bg][fg]overlay=(W-w)/2:(H-h)/2[composed]")

    last = "composed"

    if caption_text:
        safe = caption_text
        for ch in ["'", '"', "\\", ":", ";", "%", "{", "}", "[", "]"]:
            safe = safe.replace(ch, " ")
        safe = safe.strip()[:80]

        tx = int(text_x * W)
        ty = int(text_y * H)

        filter_parts.append(
            f"[{last}]drawtext="
            f"text='{safe}':"
            f"fontsize={font_size}:"
            f"fontcolor={text_color}:"
            f"borderw={text_stroke_width}:"
            f"bordercolor={text_stroke_color}:"
            f"x={tx}-(text_w/2):y={ty}[texted]"
        )
        last = "texted"

    cmd = [
        FFMPEG_EXE,
        "-ss", str(timestamp),
        "-i", video_path,
    ]

    if watermark_path and os.path.exists(watermark_path):
        cmd.extend(["-i", watermark_path])
        wm_w = max(50, int(W * watermark_scale))
        filter_parts.append(
            f"[1:v]scale={wm_w}:-1,format=rgba,"
            f"colorchannelmixer=aa={watermark_opacity}[wm]"
        )
        wx = int(watermark_x * W)
        wy = int(watermark_y * H)
        filter_parts.append(
            f"[{last}][wm]overlay={wx}-(overlay_w/2):{wy}-(overlay_h/2)[final]"
        )
        last = "final"

    filter_str = ";".join(filter_parts)

    cmd.extend([
        "-vframes", "1",
        "-filter_complex", filter_str,
        "-map", f"[{last}]",
        "-q:v", "2",
        "-y", "-loglevel", "error",
        output_path,
    ])

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=30)
    except subprocess.CalledProcessError as e:
        print(f"Preview error: {e.stderr}")
        # Fallback: plain frame
        fallback = [
            FFMPEG_EXE,
            "-ss", str(timestamp),
            "-i", video_path,
            "-vframes", "1",
            "-q:v", "2",
            "-y", "-loglevel", "error",
            output_path,
        ]
        subprocess.run(fallback, check=True)

    return output_path


def generate_preview_clip(
    video_path: str,
    start_time: float,
    duration: float,
    output_path: str,
    max_seconds: float = 10.0,
) -> str:
    """Generate a short preview clip (max 10 seconds) for playback."""
    clip_duration = min(duration, max_seconds)

    cmd = [
        FFMPEG_EXE,
        "-ss", str(start_time),
        "-i", video_path,
        "-t", str(clip_duration),
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "28",
        "-c:a", "aac",
        "-movflags", "+faststart",
        "-y", "-loglevel", "error",
        output_path,
    ]

    subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=60)
    return output_path
