import os
import subprocess
import threading
from ..config import settings
from ..models.clip import ClipData, StyleConfig
from . import video_service

FFMPEG_EXE = video_service.FFMPEG_EXE

# Global progress tracker
export_progress = {}  # project_id -> {current, total, status, current_file, files, errors}


def get_progress(project_id: str) -> dict:
    """Get the current export progress for a project."""
    return export_progress.get(project_id, {
        "current": 0, "total": 0, "status": "idle",
        "current_file": "", "files": [], "errors": []
    })


def export_clip_with_style(
    video_path: str,
    clip: ClipData,
    style: StyleConfig,
    output_path: str,
) -> str:
    """Export a single clip as 9:16 video with blur background + text + watermark."""
    W, H = 1080, 1920
    duration = clip.end_time - clip.start_time

    filter_parts = []
    has_watermark = style.watermark_path and os.path.exists(style.watermark_path)

    # Step 1: Create blurred background (scaled to fill 9:16, then blur)
    filter_parts.append(
        f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,"
        f"crop={W}:{H},boxblur=12:2[bg]"
    )

    # Step 2: Scale original to fit width (keeping aspect ratio)
    filter_parts.append(
        f"[0:v]scale={W}:-2[fg]"
    )

    # Step 3: Overlay original centered on blurred bg
    filter_parts.append(
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2[composed]"
    )

    current_label = "composed"

    # Step 4: Text overlay (optional)
    if clip.viral_caption:
        safe_text = clip.viral_caption
        # Remove chars that break FFmpeg drawtext
        for ch in ["'", '"', "\\", ":", ";", "%", "{", "}", "[", "]"]:
            safe_text = safe_text.replace(ch, " ")
        safe_text = safe_text.strip()
        if len(safe_text) > 80:
            safe_text = safe_text[:80]

        tx = int(style.text_x * W)
        ty = int(style.text_y * H)

        filter_parts.append(
            f"[{current_label}]drawtext="
            f"text='{safe_text}':"
            f"fontsize={style.font_size}:"
            f"fontcolor={style.text_color}:"
            f"borderw={style.text_stroke_width}:"
            f"bordercolor={style.text_stroke_color}:"
            f"x={tx}-(text_w/2):y={ty}[texted]"
        )
        current_label = "texted"

    # Step 5: Watermark overlay (optional, needs second input)
    if has_watermark:
        wm_w = max(50, int(W * style.watermark_scale))
        wx = int(style.watermark_x * W)
        wy = int(style.watermark_y * H)
        wm_input = "1:v"
        filter_parts.append(
            f"[{wm_input}]scale={wm_w}:-1,format=rgba,"
            f"colorchannelmixer=aa={style.watermark_opacity}[wm]"
        )
        filter_parts.append(
            f"[{current_label}][wm]overlay={wx}-(overlay_w/2):{wy}-(overlay_h/2)[watermarked]"
        )
        current_label = "watermarked"

    # Step 6: Final pixel format
    filter_parts.append(f"[{current_label}]format=yuv420p[out]")

    filter_str = ";".join(filter_parts)

    # Build command
    cmd = [
        FFMPEG_EXE,
        "-ss", str(clip.start_time),
        "-i", video_path,
        "-t", str(duration),
    ]

    if has_watermark:
        cmd.extend(["-i", style.watermark_path])

    cmd.extend([
        "-filter_complex", filter_str,
        "-map", "[out]",
        "-map", "0:a?",
        "-c:a", "aac",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-y", "-loglevel", "warning",
        output_path,
    ])

    try:
        print(f"[Export] Clip {clip.id}: Running FFmpeg with filter chain...")
        result = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=600)
        if result.stderr:
            print(f"[Export] Clip {clip.id} warnings: {result.stderr[:200]}")
        print(f"[Export] Clip {clip.id}: Success!")
    except subprocess.CalledProcessError as e:
        print(f"[Export] Clip {clip.id} FAILED: {e.stderr[:500] if e.stderr else 'no stderr'}")
        print(f"[Export] Clip {clip.id}: Using fallback (simple cut)...")
        # Fallback: simple cut without filters
        fallback_cmd = [
            FFMPEG_EXE,
            "-ss", str(clip.start_time),
            "-i", video_path,
            "-t", str(duration),
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac",
            "-y", "-loglevel", "error",
            output_path,
        ]
        subprocess.run(fallback_cmd, check=True, capture_output=True, text=True, timeout=300)

    return output_path


def export_all_clips_background(
    project_id: str,
    video_path: str,
    clips: list[ClipData],
    style: StyleConfig,
    output_dir: str,
):
    """Run export in background thread with progress tracking."""

    def _run():
        os.makedirs(output_dir, exist_ok=True)
        export_progress[project_id] = {
            "current": 0,
            "total": len(clips),
            "status": "exporting",
            "current_file": "",
            "files": [],
            "errors": [],
        }

        for i, clip in enumerate(clips):
            desc = clip.description.replace(" ", "_").lower()
            desc = "".join([c for c in desc if c.isalnum() or c in ("_", "-")])[:40]
            filename = f"clip_{clip.id:02d}_{desc}.mp4"
            output_path = os.path.join(output_dir, filename)

            export_progress[project_id]["current"] = i + 1
            export_progress[project_id]["current_file"] = filename

            try:
                export_clip_with_style(
                    video_path=video_path,
                    clip=clip,
                    style=style,
                    output_path=output_path,
                )
                export_progress[project_id]["files"].append(filename)
            except Exception as e:
                print(f"Error exporting clip {clip.id}: {e}")
                export_progress[project_id]["errors"].append(f"Clip {clip.id}: {str(e)}")

        export_progress[project_id]["status"] = "done"

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
