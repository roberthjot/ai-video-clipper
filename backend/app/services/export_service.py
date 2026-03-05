import os
import subprocess
import threading
from ..config import settings
from ..models.clip import ClipData, StyleConfig
from . import video_service

FFMPEG_EXE = video_service.FFMPEG_EXE

# Global progress tracker
export_progress = {}


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
    """Export clip with blur + rounded box + text + watermark + optional split-screen."""
    W, H = 1080, 1920
    duration = clip.end_time - clip.start_time

    # Determine if split-screen is active
    use_split = style.split_screen_enabled and style.split_image_path and os.path.exists(style.split_image_path)

    if use_split:
        ratio = max(0.3, min(0.7, style.split_ratio))
        video_h = int(H * ratio)
        image_h = H - video_h
        target_h = video_h
    else:
        target_h = H

    # Build fg_filter based on fill_mode and target height
    if style.fill_mode == "fill":
        fg_filter = f"scale={W}:{target_h}:force_original_aspect_ratio=increase,crop={W}:{target_h}"
    elif style.fill_mode == "zoom":
        fg_filter = f"scale=-2:{int(target_h * 0.9)}"
    elif style.fill_mode == "small":
        fg_filter = f"scale=-2:{int(target_h * 0.78)}"
    else:
        fg_filter = f"scale={W}:-2"

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

    current_label = "v"
    rounded_box_path = None

    # Caption overlay — Y relative to video portion in split mode
    if clip.viral_caption:
        lines = video_service.split_text_into_lines(clip.viral_caption, max_chars=25)
        font_size_actual = 72
        pad_x, pad_y = 12, 8
        line_gap = 5
        base_y = int(style.text_y * target_h)

        rounded_box_path, box_w, box_h = video_service.create_caption_overlay(
            lines, font_size=font_size_actual, pad_x=pad_x, pad_y=pad_y, line_gap=line_gap
        )
        box_x = (W - box_w) // 2
        box_y = base_y - pad_y

        filter_complex += f";[{current_label}][{input_index}:v]overlay={box_x}:{box_y}[boxed]"
        current_label = "boxed"
        input_index += 1

    # Watermark — Y relative to video portion in split mode
    has_watermark = style.watermark_path and os.path.exists(style.watermark_path)
    if has_watermark:
        wm_w = max(50, int(W * style.watermark_scale))
        wx = int(style.watermark_x * W)
        wy = int(style.watermark_y * target_h)
        filter_complex += f";[{input_index}:v]scale={wm_w}:-1,format=rgba,colorchannelmixer=aa={style.watermark_opacity}[wm]"
        filter_complex += f";[{current_label}][wm]overlay={wx}-(overlay_w/2):{wy}-(overlay_h/2)[watermarked]"
        current_label = "watermarked"

    filter_complex += f";[{current_label}]format=yuv420p[out]"

    cmd = [
        FFMPEG_EXE,
        "-ss", str(clip.start_time), "-to", str(clip.end_time), "-i", video_path,
    ]

    if use_split:
        cmd.extend(["-loop", "1", "-t", str(duration), "-i", style.split_image_path])

    if rounded_box_path:
        cmd.extend(["-loop", "1", "-t", str(duration), "-i", rounded_box_path])

    if has_watermark:
        cmd.extend(["-loop", "1", "-t", str(duration), "-i", style.watermark_path])

    cmd.extend([
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-map", "0:a?",
        "-c:a", "aac",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-sar", "1:1",
        "-movflags", "+faststart",
        "-y", "-loglevel", "warning",
        output_path,
    ])

    try:
        print(f"[Export] Clip {clip.id}: Exporting... split={use_split}")
        result = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=600)
        print(f"[Export] Clip {clip.id}: Success!")
    except subprocess.CalledProcessError as e:
        print(f"[Export] Clip {clip.id} FAILED: {e.stderr[:500] if e.stderr else 'no stderr'}")
        raise
    finally:
        if rounded_box_path and os.path.exists(rounded_box_path):
            try:
                os.remove(rounded_box_path)
            except:
                pass

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
            "status": "running",
            "current_file": "",
            "files": [],
            "errors": []
        }

        for i, clip in enumerate(clips):
            try:
                title_safe = getattr(clip, 'title', f'clip_{clip.id}').replace(' ', '_').lower()[:30]
                filename = f"clip_{clip.id:02d}_{title_safe}.mp4"
                filepath = os.path.join(output_dir, filename)

                export_progress[project_id]["current"] = i + 1
                export_progress[project_id]["current_file"] = filename

                export_clip_with_style(video_path, clip, style, filepath)
                export_progress[project_id]["files"].append(filename)

            except Exception as e:
                error_msg = f"Clip {clip.id}: {str(e)}"
                export_progress[project_id]["errors"].append(error_msg)
                print(f"[Export] Error: {error_msg}")

        # Generate clips_info.txt
        try:
            info_path = os.path.join(output_dir, "clips_info.txt")
            with open(info_path, "w", encoding="utf-8") as f:
                f.write("=" * 60 + "\n")
                f.write("AI VIDEO CLIPPER - CLIPS INFO\n")
                f.write("=" * 60 + "\n\n")
                for clip in clips:
                    duration = clip.end_time - clip.start_time
                    start_fmt = f"{int(clip.start_time // 60)}:{int(clip.start_time % 60):02d}"
                    end_fmt = f"{int(clip.end_time // 60)}:{int(clip.end_time % 60):02d}"
                    f.write(f"CLIP {clip.id} - {getattr(clip, 'description', f'Clip {clip.id}')}\n")
                    f.write(f"Timestamps : {start_fmt} - {end_fmt} ({int(duration)}s)\n")
                    f.write(f"Caption    : {clip.viral_caption}\n")
                    f.write(f"Why viral  : {getattr(clip, 'viral_reason', 'N/A')}\n")
                    f.write("\n" + "-" * 60 + "\n\n")
            print(f"[Export] clips_info.txt saved to {info_path}")
        except Exception as e:
            print(f"[Export] Failed to write clips_info.txt: {e}")

        export_progress[project_id]["status"] = "completed"
        print(f"[Export] All clips exported to {output_dir}")

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
