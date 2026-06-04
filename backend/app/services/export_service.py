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
    """Export clip with blur + rounded box + text + watermark + optional split-screen + subtitles.

    Concat-first: if the clip has timeline segments (the user cut out middles),
    we first concatenate the kept pieces into a temp mp4, then run the normal
    single-range pipeline on that temp. This keeps the heavy filter graph below
    untouched and makes subtitle/keyframe timing correct (they operate on the
    already-cut video).
    """
    segments = getattr(clip, "segments", None) or []
    if segments:
        canvas = video_service.get_canvas_dimensions(getattr(style, 'aspect_ratio', '9:16'))
        # Pass the full Segment objects so concat sees speed/type/image_path.
        seg_dicts = [s.model_dump() if hasattr(s, "model_dump") else dict(s) for s in segments]
        tmp_dir = os.path.join(os.path.dirname(__file__), "temp")
        os.makedirs(tmp_dir, exist_ok=True)
        concat_path = os.path.join(tmp_dir, f"export_concat_{clip.id}_{os.getpid()}_{abs(hash(str(seg_dicts))) % 10**8}.mp4")
        try:
            total = video_service.concat_segments(video_path, seg_dicts, concat_path, canvas=canvas)
            # Build a single-range copy pointing at the concatenated temp.
            clip_copy = clip.model_copy(deep=True)
            clip_copy.segments = []
            clip_copy.start_time = 0.0
            clip_copy.end_time = total
            clip_copy.duration = total
            # Remap the transcript from source time to concatenated time so the
            # burned-in subtitles line up with the cut video (and words inside
            # removed gaps disappear).
            remapped_transcript = video_service.remap_transcript_to_segments(transcript, seg_dicts) if transcript else None
            print(f"[Export] Clip {clip.id}: {len(seg_dicts)} segments concatenated -> {total:.1f}s, running pipeline on temp")
            return export_clip_with_style(concat_path, clip_copy, style, output_path, remapped_transcript)
        finally:
            if os.path.exists(concat_path):
                try:
                    os.remove(concat_path)
                except Exception:
                    pass

    W, H = video_service.get_canvas_dimensions(getattr(style, 'aspect_ratio', '9:16'))
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

    # Per-clip editor transform: zoom scales the BOX size (makes the inner
    # video take up more of the canvas). Pan offsets the overlay position.
    # Same semantics as CapCut: scale changes how big the clip appears on
    # the canvas; it does NOT crop INTO the video content.
    _zoom = max(0.3, float(getattr(clip, 'edit_zoom', 1.0) or 1.0))
    _pan_x_pct = float(getattr(clip, 'edit_pan_x', 0.0) or 0.0) / 100.0  # -0.5 to +0.5
    _pan_y_pct = float(getattr(clip, 'edit_pan_y', 0.0) or 0.0) / 100.0

    # Global fill-mode multiplier from StyleConfig — fine-tune knob on top of
    # the named presets (e.g. "Medium" but 1.2× bigger). Multiplies into _zoom
    # so the rest of the math stays identical.
    _fm_scale = max(0.5, min(1.5, float(getattr(style, 'fill_mode_scale', 1.0) or 1.0)))
    _zoom = _zoom * _fm_scale

    # Animated zoom/pan via keyframes — overrides the static edit_* values
    # above when the clip has any keyframes set. We swap the fg stage to a
    # zoompan filter and set the overlay to (0,0) since zoompan already
    # outputs at canvas size.
    clip_keyframes = getattr(clip, 'keyframes', None) or []
    use_keyframes = len(clip_keyframes) > 0

    # Build fg_filter based on fill_mode and target height, multiplied by zoom
    fm = style.fill_mode
    base_height_pct = (
        1.0  if fm == "fill"   else
        0.9  if fm == "zoom"   else
        0.78 if fm == "small"  else
        0.65 if fm == "medium" else
        0.5  if fm == "mini"   else
        1.0  # fit (handled by width scale below)
    )
    if use_keyframes:
        fg_filter = video_service.build_zoompan_filter(
            clip_keyframes, duration, W, target_h, fps=30,
        )
    elif fm == "fill":
        # fill always covers the full canvas; zoom > 1 still uses cover
        scaled_h = int(target_h * _zoom)
        scaled_w = int(W * _zoom)
        fg_filter = f"scale={scaled_w}:{scaled_h}:force_original_aspect_ratio=increase,crop={scaled_w}:{scaled_h}"
    elif fm == "fit":
        # fit: width = W * zoom, height auto preserving aspect
        fg_filter = f"scale={int(W * _zoom)}:-2"
    else:
        # medium / mini / small / zoom: height-based scaling
        fg_filter = f"scale=-2:{int(target_h * base_height_pct * _zoom)}"

    if use_keyframes:
        print(f"[Export] Clip {clip.id}: animated keyframes ({len(clip_keyframes)} pts) — using zoompan, fg covers full canvas")
    elif _zoom != 1.0 or _pan_x_pct != 0.0 or _pan_y_pct != 0.0:
        print(f"[Export] Clip {clip.id}: editor transform zoom={_zoom:.2f} pan=({_pan_x_pct*100:.0f}%,{_pan_y_pct*100:.0f}%) — scales the box, not the content")

    input_index = 1

    # Background reuses the same scale+crop chain as blur but swaps the final
    # step: black = colorchannelmixer that zeros all RGB. Same timing/source
    # as fg, so overlay always emits frames correctly regardless of fill_mode.
    bg_style = getattr(style, 'background_style', 'blur')

    def _bg(target_height: int) -> str:
        base = f"[0:v]scale={W}:{target_height}:force_original_aspect_ratio=increase,crop={W}:{target_height}"
        if bg_style == "black":
            return base + ",colorchannelmixer=rr=0:rg=0:rb=0:gr=0:gg=0:gb=0:br=0:bg=0:bb=0"
        return base + ",boxblur=12:2"

    # Overlay position: keyframes mode → (0,0) since fg is already canvas-
    # sized; static mode → carry the pan offset.
    # IMPORTANT: build each overlay string INSIDE its branch — `video_h`
    # only exists when `use_split` is True (defined in the if-split block above).
    if use_split:
        _ov_split = "0:0" if use_keyframes else (
            f"(W-w)/2+({_pan_x_pct})*W:(H-h)/2+({_pan_y_pct})*{video_h}"
        )
        filter_complex = (
            f"{_bg(video_h)}[bg];"
            f"[0:v]{fg_filter}[fg];"
            f"[bg][fg]overlay={_ov_split},format=yuv420p[video_part];"
            f"[1:v]scale={W}:{image_h}:force_original_aspect_ratio=increase,crop={W}:{image_h},setsar=1,format=yuv420p[img_part];"
            f"[video_part][img_part]vstack=inputs=2[v]"
        )
        input_index = 2
    else:
        _ov_full = "0:0" if use_keyframes else (
            f"(W-w)/2+({_pan_x_pct})*W:(H-h)/2+({_pan_y_pct})*H"
        )
        filter_complex = f"{_bg(H)}[bg];[0:v]{fg_filter}[fg];[bg][fg]overlay={_ov_full}[v]"

    current_label = "v"
    rounded_box_path = None

    # Master toggle: skip ALL on-screen text when no_text is set
    no_text = getattr(style, 'no_text', False)
    no_emojis = getattr(style, 'no_emojis', False)

    # Caption overlay — Y relative to video portion in split mode
    if clip.viral_caption and not no_text:
        import re as _re
        _caption = clip.viral_caption
        if no_emojis:
            _caption = video_service._EMOJI_RE.sub("", _caption)
            _caption = _re.sub(r"\s+", " ", _caption).strip()
        lines = video_service.split_text_into_lines(_caption, max_chars=30)
        pad_x, pad_y = 12, 14
        line_gap = 5
        base_y = int(style.text_y * target_h)

        _font = getattr(style, 'caption_font', 'calibri')
        if getattr(style, 'caption_style', 'box') == 'tiktok':
            rounded_box_path, box_w, box_h = video_service.create_tiktok_caption_overlay(
                lines, font_size=style.font_size, font_key=_font
            )
        else:
            rounded_box_path, box_w, box_h = video_service.create_caption_overlay(
                lines, font_size=style.font_size, pad_x=pad_x, pad_y=pad_y,
                line_gap=line_gap, font_key=_font,
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
        input_index += 1

    # Image overlays (editor mode) — each painted on top for its time range.
    # These inputs are added to the cmd later (see overlay_inputs). Positions
    # are relative to the full canvas; time range is in output seconds.
    overlay_inputs = []  # list of (path, loop_dur) to append as -loop inputs
    image_overlays = getattr(style, 'image_overlays', None) or []
    for ov in image_overlays:
        ov_path = getattr(ov, 'path', None)
        if not ov_path or not os.path.exists(ov_path):
            continue
        ov_w = max(20, int(W * float(getattr(ov, 'scale', 0.4))))
        ov_x = int(float(getattr(ov, 'x', 0.5)) * W)
        ov_y = int(float(getattr(ov, 'y', 0.4)) * H)
        ov_op = max(0.0, min(1.0, float(getattr(ov, 'opacity', 1.0))))
        ov_start = float(getattr(ov, 'start', 0.0))
        ov_end = float(getattr(ov, 'end', 99999.0))
        idx = input_index
        # Scale + apply opacity
        filter_complex += f";[{idx}:v]scale={ov_w}:-1,format=rgba,colorchannelmixer=aa={ov_op}[ov{idx}]"
        # Overlay centered at (ov_x, ov_y), only between start/end output secs
        filter_complex += (
            f";[{current_label}][ov{idx}]overlay="
            f"{ov_x}-(overlay_w/2):{ov_y}-(overlay_h/2)"
            f":enable='between(t,{ov_start},{ov_end})'[imgov{idx}]"
        )
        current_label = f"imgov{idx}"
        overlay_inputs.append(ov_path)
        input_index += 1

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
    # Cinematic visual filter (last so it shapes the final look)
    cinematic = video_service.get_visual_filter_chain(getattr(style, 'visual_filter', 'none'))
    if cinematic:
        extra_vf.append(cinematic)
    if extra_vf:
        filter_complex += f";[{current_label}]{','.join(extra_vf)}[uniquified]"
        current_label = "uniquified"

    # Burn-in subtitles from Whisper transcript (if requested)
    ass_subtitle_path = None
    ass_subtitle_path_extra = None  # cwd copy for relative-path workaround
    sub_style = getattr(style, 'subtitle_style', 'none')
    if sub_style and sub_style != 'none' and transcript and not no_text:
        try:
            # The export uses fast-seek (clip.start - 4s) + output trim.
            # Subtitles must be shifted by `buffer` so they appear at the
            # correct moment AFTER the trim discards the seek overshoot.
            _fast_seek = max(0.0, clip.start_time - 4.0)
            _buffer = clip.start_time - _fast_seek
            temp_dir = os.path.join(os.path.dirname(__file__), "temp")
            ass_subtitle_path = subtitle_service.generate_ass_for_clip(
                transcript=transcript,
                clip_start=clip.start_time,
                clip_end=clip.end_time,
                style=sub_style,
                output_dir=temp_dir,
                time_offset=_buffer,
                size_scale=getattr(style, 'subtitle_size_scale', 1.0),
                y_offset=getattr(style, 'subtitle_y', 0.0),
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

    # Image overlays — same loop-input pattern, in the same order they were
    # assigned indices in the filter graph above.
    for ov_path in overlay_inputs:
        cmd.extend(["-loop", "1", "-t", str(loop_dur), "-i", ov_path])

    # Codec args picked at runtime — try Intel QSV first, fall back to libx264 on failure
    qsv_codec = video_service.get_video_codec_args(preset="fast", crf=23, prefer_qsv=True)
    cpu_codec = video_service.get_video_codec_args(preset="fast", crf=23, prefer_qsv=False)
    tail_args = [
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-map", "0:a?",
        "-c:a", "aac",
        "-sar", "1:1",
        "-movflags", "+faststart",
    ]
    if style.strip_metadata:
        tail_args.extend(["-map_metadata", "-1"])
    # Output-side accurate seek: discard the first `buffer` seconds (the fast-seek overshoot),
    # then cut at exactly `duration` seconds. This gives frame-accurate clipping.
    tail_args.extend(["-ss", str(buffer), "-t", str(duration), "-y", "-loglevel", "warning", output_path])

    # Codec args must come BEFORE the output filename (which is the last item in tail_args)
    cmd_qsv = cmd + qsv_codec + tail_args
    cmd_cpu = cmd + cpu_codec + tail_args

    try:
        print(f"[Export] Clip {clip.id}: Exporting... split={use_split}, qsv={video_service._qsv_supported()}")
        result = subprocess.run(cmd_qsv, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        if result.returncode != 0 and video_service._qsv_supported():
            print(f"[Export] Clip {clip.id}: QSV failed, retrying with libx264. stderr: {result.stderr[-200:]}")
            result = subprocess.run(cmd_cpu, check=True, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        elif result.returncode != 0:
            raise subprocess.CalledProcessError(result.returncode, cmd_cpu, output=result.stdout, stderr=result.stderr)
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

                eff_style = getattr(clip, "style_override", None) or style
                export_clip_with_style(video_path, clip, eff_style, filepath, transcript=transcript)
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
    elif ig_fill_mode == "mini":
        fg_filter = f"scale=-2:{int(video_h * 0.50)}"
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
        subprocess.run(cmd, check=True, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
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

                eff_style = getattr(clip, "style_override", None) or style
                export_instagram_clip(video_path, clip, eff_style, filepath)
                instagram_export_progress[project_id]["files"].append(filename)

            except Exception as e:
                error_msg = f"Clip {clip.id}: {str(e)}"
                instagram_export_progress[project_id]["errors"].append(error_msg)
                print(f"[Instagram Export] Error: {error_msg}")

        instagram_export_progress[project_id]["status"] = "completed"
        print(f"[Instagram Export] All clips exported to {output_dir}")

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
