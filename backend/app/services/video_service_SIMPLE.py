import os
import subprocess
import imageio_ffmpeg

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()


def generate_preview_clip_SIMPLE(
    video_path: str,
    start_time: float,
    duration: float,
    output_path: str,
    caption_text: str = "",
    font_size: int = 70,
) -> str:
    """Generate a SIMPLE preview clip that ACTUALLY WORKS."""
    W, H = 1080, 1920

    # Simple filter: just crop to 9:16 with blur background
    filter_complex = (
        f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=12:2[bg];"
        f"[0:v]scale={W}:-2[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2[v]"
    )

    # Add text if provided
    if caption_text:
        # Clean text
        safe_text = caption_text.replace("'", "").replace('"', "").replace("\\", "")
        safe_text = safe_text[:80]

        # Add simple white text with black outline - NO BOX
        y_pos = int(0.15 * H)

        filter_complex += (
            f";[v]drawtext="
            f"text='{safe_text}':"
            f"fontsize={font_size}:"
            f"fontcolor=white:"
            f"x=(w-text_w)/2:"
            f"y={y_pos}:"
            f"borderw=8:"
            f"bordercolor=black[final]"
        )
        output_label = "final"
    else:
        output_label = "v"

    cmd = [
        FFMPEG_EXE,
        "-ss", str(start_time),
        "-i", video_path,
        "-t", str(duration),  # Full duration, not just 10 seconds
        "-filter_complex", filter_complex,
        "-map", f"[{output_label}]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-y",
        output_path,
    ]

    print(f"[SIMPLE] Running FFmpeg command...")
    print(f"[SIMPLE] Duration: {duration}s, Start: {start_time}s")

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

    if result.returncode != 0:
        print(f"[SIMPLE] FFmpeg error: {result.stderr}")
        raise RuntimeError(f"FFmpeg failed: {result.stderr}")

    print(f"[SIMPLE] Success! Output: {output_path}")
    return output_path
