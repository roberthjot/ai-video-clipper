import os
import subprocess
import threading
from ..config import settings
from ..models.clip import ClipData, StyleConfig
from . import video_service, subtitle_service

FFMPEG_EXE = video_service.FFMPEG_EXE

# Global progress trackers
export_progress = {}
instagram_export_progress = {}


def get_instagram_progress(project_id: str) -> dict:
    """Get the current instagram export progress for a project."""
    return instagram_export_progress.get(project_id, {
        "current": 0, "total": 0, "status": "idle",
        "current_file": "", "files": [], "errors": []
    })


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
    transcript: dict = None,
) -> str:
    """Export clip with blur + rounded box + text + watermark + optional split-screen + subtitles."""
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
    elif style.fill_mode == "medium":
        fg_filter = f"scale=-2:{int(target_h * 0.65)}"
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
        lines = video_service.split_text_into_lines(clip.viral_caption, max_chars=30)
        pad_x, pad_y = 12, 8
        line_gap = 5
        base_y = int(style.text_y * target_h)

        if getattr(style, 'caption_style', 'box') == 'tiktok':
            rounded_box_path, box_w, box_h = video_service.create_tiktok_caption_overlay(
                lines, font_size=style.font_size
            )
        else:
            rounded_box_path, box_w, box_h = video_service.create_caption_overlay(
                lines, font_size=style.font_size, pad_x=pad_x, pad_y=pad_y, line_gap=line_gap
            )
        box_x = max(0, min(W - box_w, int(style.text_x * W) - box_w // 2))
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

    # Anti-detect filters (optional, export only)
    extra_vf = []
    if style.flip_horizontal:
        extra_vf.append("hflip")
    if style.zoom_uniquify:
        zoom_w = int(W * 1.02)
        zoom_h = int(H * 1.02)
        extra_vf.append(f"scale={zoom_w}:{zoom_h},crop={W}:{H}")
    if style.boost_contrast:
        extra_vf.append("eq=contrast=1.05:brightness=0.02:saturation=1.05")
    if extra_vf:
        filter_complex += f";[{current_label}]{','.join(extra_vf)}[uniquified]"
        current_label = "uniquified"

    # Burn-in subtitles from Whisper transcript (if requested)
    ass_subtitle_path = None
    ass_subtitle_path_extra = None  # cwd copy for relative-path workaround
    sub_style = getattr(style, 'subtitle_style', 'none')
    if sub_style and sub_style != 'none' and transcript:
        try:
            temp_dir = os.path.join(os.path.dirname(__file__), "temp")
            ass_subtitle_path = subtitle_service.generate_ass_for_clip(
                transcript=transcript,
                clip_start=clip.start_time,
                clip_end=clip.end_time,
                style=sub_style,
                output_dir=temp_dir,
            )
            if ass_subtitle_path:
                # Workaround Windows path issues with FFmpeg subtitles filter:
                # copy ASS to current working dir and use the basename only.
                import shutil as _shutil
                ass_basename = os.path.basename(ass_subtitle_path)
                ass_subtitle_path_extra = os.path.join(os.getcwd(), ass_basename)
                _shutil.copy2(ass_subtitle_path, ass_subtitle_path_extra)
                filter_complex += f";[{current_label}]subtitles={ass_basename}[subbed]"
                current_label = "subbed"
                print(f"[Export] Clip {clip.id}: subtitle style='{sub_style}' applied (ass={ass_basename})")
        except Exception as e:
            print(f"[Export] Clip {clip.id}: subtitle generation failed (continuing without): {e}")

    filter_complex += f";[{current_label}]format=yuv420p[out]"

    # Two-pass seek: fast input seek (keyframe) + accurate output trim
    fast_seek = max(0.0, clip.start_time - 4.0)
    buffer = clip.start_time - fast_seek
    loop_dur = duration + buffer + 1.0  # looped inputs need to cover fast_seek window too
    print(f"[Export] Clip {clip.id}: start={clip.start_time}s end={clip.end_time}s duration={duration:.1f}s fast_seek={fast_seek}s buffer={buffer:.1f}s")
    cmd = [
        FFMPEG_EXE,
        "-ss", str(fast_seek), "-i", video_path,
    ]

    if use_split:
        cmd.extend(["-loop", "1", "-t", str(loop_dur), "-i", style.split_image_path])

    if rounded_box_path:
        cmd.extend(["-loop", "1", "-t", str(loop_dur), "-i", rounded_box_path])

    if has_watermark:
        cmd.extend(["-loop", "1", "-t", str(loop_dur), "-i", style.watermark_path])

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
    ])
    if style.strip_metadata:
        cmd.extend(["-map_metadata", "-1"])
    # Output-side accurate seek: discard the first `buffer` seconds (the fast-seek overshoot),
    # then cut at exactly `duration` seconds. This gives frame-accurate clipping.
    cmd.extend(["-ss", str(buffer), "-t", str(duration), "-y", "-loglevel", "warning", output_path])

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
        if ass_subtitle_path and os.path.exists(ass_subtitle_path):
            try:
                os.remove(ass_subtitle_path)
            except:
                pass
        if ass_subtitle_path_extra and os.path.exists(ass_subtitle_path_extra):
            try:
                os.remove(ass_subtitle_path_extra)
            except:
                pass

    return output_path


def export_all_clips_background(
    project_id: str,
    video_path: str,
    clips: list[ClipData],
    style: StyleConfig,
    output_dir: str,
    transcript: dict = None,
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

                export_clip_with_style(video_path, clip, style, filepath, transcript=transcript)
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
                    ig_desc = getattr(clip, 'ig_description', '')
                    if ig_desc:
                        f.write(f"\nIG Description:\n{ig_desc}\n")
                    f.write("\n" + "-" * 60 + "\n\n")
            print(f"[Export] clips_info.txt saved to {info_path}")
        except Exception as e:
            print(f"[Export] Failed to write clips_info.txt: {e}")

        export_progress[project_id]["status"] = "completed"
        print(f"[Export] All clips exported to {output_dir}")

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()


def export_instagram_clip(
    video_path: str,
    clip,
    style,
    output_path: str,
) -> str:
    """Export clip in Instagram post format matching the preview exactly:
    white bg + caption text on top + video centered in canvas."""
    W, H = 1080, 1920
    duration = clip.end_time - clip.start_time

    # Use IG-specific settings (same as preview)
    ig_top_padding = getattr(style, 'ig_top_padding', 130)
    ig_fill_mode = getattr(style, 'ig_fill_mode', 'fit')

    frame_png, video_top, text_bottom = video_service.create_instagram_frame_bg(
        clip.viral_caption, top_padding=ig_top_padding
    )
    # Use FIXED video_h — same as preview, never changes with text position
    video_h = video_service.IG_VIDEO_H        # always 1100
    bottom_padding = video_service.IG_BOTTOM_PAD  # always 80

    # Scale video according to ig_fill_mode (same as preview)
    if ig_fill_mode == "fill":
        fg_filter = f"scale={W}:{video_h}:force_original_aspect_ratio=increase,crop={W}:{video_h}"
    elif ig_fill_mode == "zoom":
        fg_filter = f"scale=-2:{int(video_h * 0.9)}"
    elif ig_fill_mode == "small":
        fg_filter = f"scale=-2:{int(video_h * 0.78)}"
    elif ig_fill_mode == "medium":
        fg_filter = f"scale=-2:{int(video_h * 0.65)}"
    else:  # fit
        fg_filter = f"scale={W}:-2"

    # [0]=video, [1]=white frame PNG (looped)
    # Center video in the FULL canvas (same logic as PIL preview):
    #   paste_y = max(text_bottom, (H-h)/2), then min(that, H-bottom_padding-h)
    # Use no-comma arithmetic (commas break FFmpeg filter_complex parsing):
    #   max(a,b) = (a + b + abs(a-b)) / 2
    #   min(a,b) = (a + b - abs(a-b)) / 2
    tb = text_bottom     # actual bottom of text + gap
    cb = H - bottom_padding  # 1840
    # inner = max(tb, (H-h)/2)
    inner = f"({tb}+(H-h)/2+abs({tb}-(H-h)/2))/2"
    # overlay_y = min(inner, cb - h)
    overlay_y = f"(({inner})+({cb}-h)-abs(({inner})-({cb}-h)))/2"
    # setpts=PTS-STARTPTS forces video timestamps to start at exactly 0,
    # preventing a blank white first frame caused by input-seek keyframe delay
    filter_complex = (
        f"[0:v]setpts=PTS-STARTPTS,{fg_filter}[fg];"
        f"[1:v][fg]overlay=(W-w)/2:{overlay_y}[with_video]"
    )

    current_label = "with_video"
    input_index = 2

    has_watermark = style.watermark_path and os.path.exists(style.watermark_path)
    ig_wm_y = getattr(style, 'ig_watermark_y', style.watermark_y)
    if has_watermark:
        wm_w = max(50, int(W * style.watermark_scale))
        wx = int(style.watermark_x * W)
        wy = video_top + int(ig_wm_y * video_h)
        filter_complex += f";[{input_index}:v]scale={wm_w}:-1,format=rgba,colorchannelmixer=aa={style.watermark_opacity}[wm]"
        filter_complex += f";[{current_label}][wm]overlay={wx}-(overlay_w/2):{wy}-(overlay_h/2)[watermarked]"
        current_label = "watermarked"
        input_index += 1

    extra_vf = []
    if style.flip_horizontal:
        extra_vf.append("hflip")
    if style.zoom_uniquify:
        zoom_w = int(W * 1.02)
        zoom_h = int(H * 1.02)
        extra_vf.append(f"scale={zoom_w}:{zoom_h},crop={W}:{H}")
    if style.boost_contrast:
        extra_vf.append("eq=contrast=1.05:brightness=0.02:saturation=1.05")
    if extra_vf:
        filter_complex += f";[{current_label}]{','.join(extra_vf)}[uniquified]"
        current_label = "uniquified"

    filter_complex += f";[{current_label}]format=yuv420p[out]"

    fast_seek = max(0.0, clip.start_time - 4.0)
    buffer = clip.start_time - fast_seek
    loop_dur = duration + buffer + 1.0
    cmd = [FFMPEG_EXE, "-ss", str(fast_seek), "-i", video_path]
    cmd.extend(["-loop", "1", "-t", str(loop_dur), "-i", frame_png])

    if has_watermark:
        cmd.extend(["-loop", "1", "-t", str(loop_dur), "-i", style.watermark_path])

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
    ])
    if style.strip_metadata:
        cmd.extend(["-map_metadata", "-1"])
    cmd.extend(["-ss", str(buffer), "-t", str(duration), "-y", "-loglevel", "warning", output_path])

    try:
        print(f"[Instagram Export] Clip {clip.id}: Exporting (ig_fill_mode={ig_fill_mode}, ig_top_padding={ig_top_padding})...")
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=600)
        print(f"[Instagram Export] Clip {clip.id}: Done!")
    except subprocess.CalledProcessError as e:
        print(f"[Instagram Export] Clip {clip.id} FAILED: {e.stderr[:500] if e.stderr else 'no stderr'}")
        raise
    finally:
        if frame_png and os.path.exists(frame_png):
            try:
                os.remove(frame_png)
            except:
                pass

    return output_path


def export_all_instagram_clips_background(
    project_id: str,
    video_path: str,
    clips: list,
    style,
    output_dir: str,
):
    """Run instagram export in background thread with progress tracking."""

    def _run():
        os.makedirs(output_dir, exist_ok=True)
        instagram_export_progress[project_id] = {
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
                filename = f"ig_clip_{clip.id:02d}_{title_safe}.mp4"
                filepath = os.path.join(output_dir, filename)

                instagram_export_progress[project_id]["current"] = i + 1
                instagram_export_progress[project_id]["current_file"] = filename

                export_instagram_clip(video_path, clip, style, filepath)
                instagram_export_progress[project_id]["files"].append(filename)

            except Exception as e:
                error_msg = f"Clip {clip.id}: {str(e)}"
                instagram_export_progress[project_id]["errors"].append(error_msg)
                print(f"[Instagram Export] Error: {error_msg}")

        instagram_export_progress[project_id]["status"] = "completed"
        print(f"[Instagram Export] All clips exported to {output_dir}")

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
