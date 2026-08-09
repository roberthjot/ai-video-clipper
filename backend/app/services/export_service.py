import os
import subprocess
import threading
import uuid
from ..config import settings
from ..models.clip import ClipData, StyleConfig
from . import video_service, subtitle_service, face_track_service

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
    language: str = "en",
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
            # IMPORTANT: the cached Spanish words (clip.words_es) are also in
            # SOURCE time — they must be remapped the same way as the English
            # transcript, otherwise the ES subs land at the wrong moments in
            # the concatenated video (off by however much was cut out). Apply
            # the SAME segment remap before recursing.
            if getattr(clip_copy, "words_es", None):
                remapped_es = video_service.remap_transcript_to_segments(
                    {"words": clip_copy.words_es}, seg_dicts,
                )
                clip_copy.words_es = remapped_es.get("words", []) if remapped_es else []
            # Same idea for the face_track used by auto-reframe: its sample
            # timestamps are in source time, so when we recurse on the
            # concatenated video they must be remapped to land at the right
            # moments. Otherwise the dynamic crop follows faces by the wrong
            # offset (off by however many seconds were cut out before it).
            if getattr(clip_copy, "face_track", None) and clip_copy.face_track.get("samples"):
                clip_copy.face_track = face_track_service.remap_face_track_to_segments(
                    clip_copy.face_track, seg_dicts,
                )
            print(f"[Export] Clip {clip.id}: {len(seg_dicts)} segments concatenated -> {total:.1f}s, running pipeline on temp")
            return export_clip_with_style(concat_path, clip_copy, style, output_path, remapped_transcript, language=language)
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

    # Auto-reframe (face tracking): when enabled, replace the static fg crop
    # with a dynamic crop that follows the face trajectory. Incompatible with
    # split-screen (both manipulate the FG region) and with keyframes (both
    # want to control the FG transform) — those win if both are set, but we
    # warn rather than fail.
    auto_reframe_active = (
        getattr(style, 'auto_reframe_enabled', False)
        and getattr(clip, 'face_track', None)
        and clip.face_track.get('samples')
        and not use_split
        and not use_keyframes
    )
    # sendcmd file path (kept in scope so we can clean up in `finally` later).
    # We need TWO paths because FFmpeg's filter_complex parser on Windows breaks
    # when sendcmd's `f=` contains a drive-letter colon (e.g. `C:`). The fix is
    # the same as the `subtitles=` filter: write the real file in temp/, then
    # COPY it to the current working dir and pass only the basename to FFmpeg.
    rfm_traj_path = None       # full path (kept for our own cleanup)
    rfm_traj_cwd_path = None   # cwd copy (the one FFmpeg actually reads)

    if getattr(style, 'auto_reframe_enabled', False):
        if use_split:
            print(f"[Export] Clip {clip.id}: auto_reframe IGNORED — split-screen is active")
        elif use_keyframes:
            print(f"[Export] Clip {clip.id}: auto_reframe IGNORED — keyframes are active")
        elif not auto_reframe_active:
            print(f"[Export] Clip {clip.id}: auto_reframe enabled but face_track empty — analyze first")

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
    if auto_reframe_active:
        # Build the dynamic crop trajectory from the cached face track. The
        # trajectory's `t` values are in source seconds; FFmpeg's filter time
        # starts at 0 after the input -ss fast_seek, so we offset every `t`
        # by -fast_seek when writing the sendcmd file.
        _aspect_str = getattr(style, 'aspect_ratio', '9:16')
        traj = face_track_service.compute_crop_trajectory(
            face_track=clip.face_track,
            mode=getattr(style, 'auto_reframe_mode', 'all'),
            follow_id=getattr(style, 'auto_reframe_follow_id', None),
            target_aspect=_aspect_str,
            padding=float(getattr(style, 'auto_reframe_padding', 0.30)),
            smoothing=float(getattr(style, 'auto_reframe_smoothing', 0.85)),
        )
        if not traj:
            print(f"[Export] Clip {clip.id}: auto_reframe trajectory empty — falling back to fit")
            fg_filter = f"scale={W}:-2"
        else:
            # Shift trajectory timestamps from SOURCE time to filter time. The
            # fast-seek is computed below this block (we need it here too).
            _fast_seek_rfm = max(0.0, clip.start_time - 4.0)
            shifted = [{**p, "t": max(0.0, p["t"] - _fast_seek_rfm)} for p in traj]
            # FIXED crop dimensions: use the LARGEST cw/ch across the whole
            # trajectory. Only x/y vary. This is crucial — when crop changes
            # output size mid-stream, FFmpeg has to renegotiate downstream
            # buffers every frame which on Windows ends in "Cannot allocate
            # memory" from libavfilter. With a fixed window, the source-side
            # crop only "pans" around the frame, no buffer reallocation.
            # Loses the close-up zoom effect (we always show the widest
            # window the trajectory ever needed) but the system stays solid.
            fixed_cw = max(p["cw"] for p in shifted)
            fixed_ch = max(p["ch"] for p in shifted)
            # Re-clamp x/y so the fixed window fits the source frame at every
            # sample (cx/cy may have been chosen for a smaller window).
            src_w = int(clip.face_track.get("width") or W)
            src_h = int(clip.face_track.get("height") or H)
            for p in shifted:
                p["cw"] = fixed_cw
                p["ch"] = fixed_ch
                p["cx"] = max(fixed_cw / 2, min(src_w - fixed_cw / 2, p["cx"]))
                p["cy"] = max(fixed_ch / 2, min(src_h - fixed_ch / 2, p["cy"]))

            tmp_dir = os.path.join(os.path.dirname(__file__), "temp")
            os.makedirs(tmp_dir, exist_ok=True)
            rfm_traj_path = os.path.join(tmp_dir, f"rfm_traj_{clip.id}_{uuid.uuid4().hex[:8]}.cmd")
            face_track_service.build_sendcmd_file(shifted, rfm_traj_path, label="rfm")
            # Copy to cwd and pass only the basename — same Windows workaround
            # as the subtitles= filter. The drive-letter colon in absolute paths
            # is interpreted as a filter option separator otherwise.
            import shutil as _shutil
            rfm_basename = os.path.basename(rfm_traj_path)
            rfm_traj_cwd_path = os.path.join(os.getcwd(), rfm_basename)
            _shutil.copy2(rfm_traj_path, rfm_traj_cwd_path)

            # Initial crop values (sendcmd will overwrite as soon as the first
            # timestamped instruction fires, but we need valid params on the
            # crop filter spec so FFmpeg can parse it).
            p0 = shifted[0]
            x0 = max(0, int(p0["cx"] - p0["cw"] / 2))
            y0 = max(0, int(p0["cy"] - p0["ch"] / 2))
            # The crop already targets the canvas aspect ratio; scaling to W
            # gives us exactly W×target_h with no letterboxing or extra fit.
            fg_filter = (
                f"sendcmd=f={rfm_basename},"
                f"crop@rfm={p0['cw']}:{p0['ch']}:{x0}:{y0},"
                f"scale={W}:{target_h}"
            )
            print(f"[Export] Clip {clip.id}: auto_reframe ACTIVE — {len(shifted)} crop pts, "
                  f"mode={getattr(style, 'auto_reframe_mode', 'all')}, "
                  f"smooth={getattr(style, 'auto_reframe_smoothing', 0.85)}")
    elif use_keyframes:
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
        if bg_style == "white":
            return base + ",drawbox=x=0:y=0:w=iw:h=ih:color=white@1.0:t=fill"
        return base + ",boxblur=12:2"

    # Cyclic mirror: hflip ON for N seconds, OFF for N seconds, repeating.
    # Applied to the FG ONLY (before overlay) so captions/watermark/subs that
    # are added LATER stay mirrored-free. Toggle pattern via FFmpeg's `enable`
    # expression: lt(mod(t, N*2), N) → true for the first half of each cycle.
    fg_chain = fg_filter
    if getattr(style, 'mirror_cyclic_enabled', False):
        m_interval = max(0.5, min(20.0, float(getattr(style, 'mirror_cyclic_interval', 5.0) or 5.0)))
        fg_chain = (
            f"{fg_chain},"
            f"hflip=enable='lt(mod(t\\,{m_interval * 2:.3f})\\,{m_interval:.3f})'"
        )

    # Sway: foreground drifts side-to-side via a sine wave added to the
    # overlay X coordinate. Captions / watermark / subtitles use their own
    # absolute coordinates so they don't sway.
    sway_x_add = ""
    if getattr(style, 'sway_enabled', False):
        s_period = max(0.5, min(30.0, float(getattr(style, 'sway_period', 3.0) or 3.0)))
        s_amp = max(0, min(200, int(getattr(style, 'sway_amplitude', 40) or 40)))
        if s_amp > 0:
            sway_x_add = f"+sin(2*PI*t/{s_period:.3f})*{s_amp}"

    # Overlay position: keyframes mode → (0,0) since fg is already canvas-
    # sized; static mode → carry the pan offset.
    if use_split:
        if use_keyframes:
            _ov_split = f"0{sway_x_add}:0"
        else:
            _ov_split = (
                f"(W-w)/2+({_pan_x_pct})*W{sway_x_add}:"
                f"(H-h)/2+({_pan_y_pct})*{video_h}"
            )
        filter_complex = (
            f"{_bg(video_h)}[bg];"
            f"[0:v]{fg_chain}[fg];"
            f"[bg][fg]overlay={_ov_split},format=yuv420p[video_part];"
            f"[1:v]scale={W}:{image_h}:force_original_aspect_ratio=increase,crop={W}:{image_h},setsar=1,format=yuv420p[img_part];"
            f"[video_part][img_part]vstack=inputs=2[v]"
        )
        input_index = 2
    else:
        if use_keyframes:
            _ov_full = f"0{sway_x_add}:0"
        else:
            _ov_full = (
                f"(W-w)/2+({_pan_x_pct})*W{sway_x_add}:"
                f"(H-h)/2+({_pan_y_pct})*H"
            )
        # Auto-reframe bypass: the dynamic crop already fills the 9:16 canvas
        # exactly (compute_crop_trajectory expands to target_aspect every
        # sample). Running it through the bg/fg/overlay machinery causes
        # FFmpeg to renegotiate buffers every time the crop dimensions tick —
        # which on Windows ends in "Cannot allocate memory" from libavfilter.
        # When auto-reframe is on, emit a single linear chain:
        #     [0:v] sendcmd, crop@rfm, scale, (mirror_cyclic) -> [v]
        # The downstream caption/watermark/subtitle/anti-detect stages
        # operate on [v] as before. Cheaper AND more stable.
        if auto_reframe_active:
            ar_chain = fg_chain
            if sway_x_add:
                # Sway shifts the overlaid foreground when not using auto-reframe;
                # with reframe there's no separate fg layer to shift, so we
                # approximate by adding the sway as an overlay-on-self via pad.
                # Skipped for v1 — sway+reframe is a niche combo.
                pass
            filter_complex = f"[0:v]{ar_chain}[v]"
        else:
            filter_complex = f"{_bg(H)}[bg];[0:v]{fg_chain}[fg];[bg][fg]overlay={_ov_full}[v]"

    current_label = "v"
    rounded_box_path = None

    # Master toggle: skip ALL on-screen text when no_text is set
    no_text = getattr(style, 'no_text', False)
    no_emojis = getattr(style, 'no_emojis', False)

    # Language swap: when exporting the Spanish version, use the cached
    # translated caption (falls back to English if not translated yet).
    _lang_es = (language or "en").lower().startswith("es")
    _caption_text = clip.viral_caption
    if _lang_es and getattr(clip, "caption_es", ""):
        _caption_text = clip.caption_es

    # Caption overlay — Y relative to video portion in split mode
    if _caption_text and not no_text:
        import re as _re
        _caption = _caption_text
        if no_emojis:
            _caption = video_service._EMOJI_RE.sub("", _caption)
            _caption = _re.sub(r"\s+", " ", _caption).strip()
        # Pass the RAW caption (with user-typed \n intact) — create_caption_overlay
        # does its own pixel-wrap. The char-based pre-split would turn into spurious
        # hard breaks inside _wrap_px (which respects \n as forced).
        _cap_style = getattr(style, 'caption_style', 'box')
        # Strip color markers for every style EXCEPT highlight (which parses
        # them into colored spans). Keeps box/tiktok from showing literal *.
        _cap_for_style = _caption if _cap_style == 'highlight' else video_service.strip_caption_markers(_caption)
        lines = [_cap_for_style] if _cap_for_style else []
        pad_x = getattr(style, "caption_box_pad_x", 14)
        pad_y = getattr(style, "caption_box_pad_y", 14)
        line_gap = 5
        base_y = int(style.text_y * target_h)

        _font = getattr(style, 'caption_font', 'calibri')
        if _cap_style == 'tiktok':
            rounded_box_path, box_w, box_h = video_service.create_tiktok_caption_overlay(
                lines, font_size=style.font_size, font_key=_font
            )
        elif _cap_style == 'meme':
            rounded_box_path, box_w, box_h = video_service.create_text_caption_overlay(
                lines, variant='meme', font_size=style.font_size, font_key='arial'
            )
        elif _cap_style in ('clean', 'highlight', 'yellow'):
            rounded_box_path, box_w, box_h = video_service.create_text_caption_overlay(
                lines, variant=_cap_style, font_size=style.font_size, font_key=_font
            )
        else:
            rounded_box_path, box_w, box_h = video_service.create_caption_overlay(
                lines, font_size=style.font_size, pad_x=pad_x, pad_y=pad_y,
                line_gap=line_gap, font_key=_font,
                box_radius=getattr(style, "caption_box_radius", 0.28),
                box_opacity=getattr(style, "caption_box_opacity", 0.95),
                box_color=getattr(style, "caption_box_color", "#FFFFFF"),
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

    # Video overlays (B-roll picture-in-picture) — same position/timing model
    # as image_overlays but each input is a real video that's trimmed to its
    # broll_in..broll_out sub-range and time-shifted so its playback starts
    # exactly at output_t = `start`. PIP audio is added via the audio chain
    # below (collected here so the chain build can see all overlays at once).
    video_overlay_inputs = []   # list of paths to append as plain -i inputs
    audio_mix_chains = []       # list of completed [N:a]...[brollN_a] filter expressions
    audio_mix_labels = []       # the labels we'll feed amix
    video_overlays = getattr(style, 'video_overlays', None) or []
    for ov in video_overlays:
        ov_path = getattr(ov, 'path', None)
        if not ov_path or not os.path.exists(ov_path):
            continue
        ov_w = max(40, int(W * float(getattr(ov, 'scale', 0.30))))
        ov_x = int(float(getattr(ov, 'x', 0.80)) * W)
        ov_y = int(float(getattr(ov, 'y', 0.18)) * H)
        ov_op = max(0.0, min(1.0, float(getattr(ov, 'opacity', 1.0))))
        ov_start = float(getattr(ov, 'start', 0.0))
        ov_end = float(getattr(ov, 'end', 99999.0))
        if ov_end <= ov_start:
            continue
        broll_in = max(0.0, float(getattr(ov, 'broll_in', 0.0)))
        broll_out = float(getattr(ov, 'broll_out', 0.0))
        if broll_out <= broll_in:
            # 0 or invalid → derive from how long the user wants it visible
            broll_out = broll_in + (ov_end - ov_start)
        audio_mode = str(getattr(ov, 'audio_mode', 'mute') or 'mute')

        idx = input_index   # this is the -i index FFmpeg will assign

        # VIDEO chain:
        # trim source range → reset PTS to 0 → shift so playback starts at output t=ov_start
        # → scale + alpha → overlay onto current with enable in [ov_start..ov_end]
        # setpts shift uses TB-relative arithmetic so it survives any input fps.
        filter_complex += (
            f";[{idx}:v]"
            f"trim=start={broll_in}:end={broll_out},"
            f"setpts=PTS-STARTPTS+{ov_start}/TB,"
            f"scale={ov_w}:-2,"
            f"format=rgba,colorchannelmixer=aa={ov_op}[broll{idx}]"
        )
        filter_complex += (
            f";[{current_label}][broll{idx}]overlay="
            f"{ov_x}-(overlay_w/2):{ov_y}-(overlay_h/2)"
            f":enable='between(t,{ov_start},{ov_end})'[brollov{idx}]"
        )
        current_label = f"brollov{idx}"
        video_overlay_inputs.append(ov_path)

        # AUDIO chain (only for non-mute modes). "replace" falls back to mix
        # in v1 — same chain, just maps differently for the user's intent.
        if audio_mode in ("mix", "replace"):
            # 0.5 default volume; gated by `enable` so silence outside the
            # overlay window (amix has no enable so we mute via volume).
            vol = 0.5 if audio_mode == "mix" else 0.9
            audio_mix_chains.append(
                f";[{idx}:a]"
                f"atrim=start={broll_in}:end={broll_out},"
                f"asetpts=PTS-STARTPTS+{ov_start}/TB,"
                f"volume={vol}:enable='between(t,{ov_start},{ov_end})'"
                f"[broll{idx}_a]"
            )
            audio_mix_labels.append(f"broll{idx}_a")

        input_index += 1

    # Build the final audio chain. If at least one B-roll wants mix/replace,
    # amix it into the main audio. Otherwise leave the original `-map 0:a?`
    # as-is (handled in tail_args below).
    final_audio_label = None
    if audio_mix_chains:
        for ch in audio_mix_chains:
            filter_complex += ch
        # `[0:a]` + every broll audio label → amix duration=first so the
        # output stops with the main video, not when amix runs out of inputs.
        mix_inputs = "[0:a]" + "".join(f"[{lab}]" for lab in audio_mix_labels)
        filter_complex += (
            f";{mix_inputs}amix=inputs={1 + len(audio_mix_labels)}:"
            f"duration=first:dropout_transition=0[outaudio]"
        )
        final_audio_label = "outaudio"

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

    # Burn-in subtitles from Whisper transcript (if requested).
    # For Spanish exports we swap in the cached translated word list — the ASS
    # generator only reads {"words": [...]} so every subtitle style works
    # automatically without any per-style change.
    _effective_transcript = transcript
    if _lang_es and getattr(clip, "words_es", None):
        _effective_transcript = {"words": list(clip.words_es)}
    ass_subtitle_path = None
    ass_subtitle_path_extra = None  # cwd copy for relative-path workaround
    sub_style = getattr(style, 'subtitle_style', 'none')
    if sub_style and sub_style != 'none' and _effective_transcript and not no_text:
        try:
            # The export uses fast-seek (clip.start - 4s) + output trim.
            # Subtitles must be shifted by `buffer` so they appear at the
            # correct moment AFTER the trim discards the seek overshoot.
            _fast_seek = max(0.0, clip.start_time - 4.0)
            _buffer = clip.start_time - _fast_seek
            temp_dir = os.path.join(os.path.dirname(__file__), "temp")
            ass_subtitle_path = subtitle_service.generate_ass_for_clip(
                transcript=_effective_transcript,
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

    # Video overlays (B-rolls) — plain -i (no loop). Indices match the
    # `[N:v]` / `[N:a]` labels emitted above when input_index was the next
    # free slot.
    for vov_path in video_overlay_inputs:
        cmd.extend(["-i", vov_path])

    # Codec args picked at runtime — try Intel QSV first, fall back to libx264 on failure
    qsv_codec = video_service.get_video_codec_args(preset="fast", crf=23, prefer_qsv=True)
    cpu_codec = video_service.get_video_codec_args(preset="fast", crf=23, prefer_qsv=False)
    # Audio map: when any B-roll wants mix/replace, use the mixed [outaudio]
    # label. Otherwise stream-copy the main input's audio (current behaviour).
    audio_map_args = (
        ["-map", f"[{final_audio_label}]"] if final_audio_label else ["-map", "0:a?"]
    )
    tail_args = [
        "-filter_complex", filter_complex,
        "-map", "[out]",
        *audio_map_args,
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

    # Timeout scales with output duration. The fixed 600s timeout was fine for
    # 30–60s TikTok clips, but Editor-mode exports can run an entire hour of
    # source video with blur+subs+caption that take ~30–50 min to encode even
    # with QSV. Use a generous 5× realtime safety margin (so a 60-min export
    # gets ~5 h) — failure-by-timeout for legitimate long jobs is worse than
    # waiting longer for a hung process.
    _export_timeout = max(600, int(duration * 5))
    try:
        print(f"[Export] Clip {clip.id}: Exporting... split={use_split}, qsv={video_service._qsv_supported()}, duration={duration:.1f}s, timeout={_export_timeout}s")
        result = subprocess.run(cmd_qsv, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=_export_timeout)
        if result.returncode != 0 and video_service._qsv_supported():
            print(f"[Export] Clip {clip.id}: QSV failed, retrying with libx264. stderr: {result.stderr[-200:]}")
            result = subprocess.run(cmd_cpu, check=True, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=_export_timeout)
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
        if rfm_traj_path and os.path.exists(rfm_traj_path):
            try:
                os.remove(rfm_traj_path)
            except:
                pass
        if rfm_traj_cwd_path and os.path.exists(rfm_traj_cwd_path):
            try:
                os.remove(rfm_traj_cwd_path)
            except:
                pass

    # Background music — mixed in as a fast post-step (video copied, audio
    # re-mixed) so it stays aligned with the already-trimmed clip.
    music_path = getattr(style, "music_path", None)
    if music_path and os.path.exists(music_path):
        try:
            video_service.mix_music_track(
                output_path, music_path,
                music_volume=getattr(style, "music_volume", 0.8),
                original_volume=getattr(style, "original_volume", 1.0),
                music_start=float(getattr(style, "music_start", 0.0) or 0.0),
                music_end=float(getattr(style, "music_end", 0.0) or 0.0),
            )
            print(f"[Export] Clip {clip.id}: mixed music {os.path.basename(music_path)}")
        except Exception as e:
            print(f"[Export] Clip {clip.id}: music mix failed (kept original audio): {e}")

    return output_path


def export_all_clips_background(
    project_id: str,
    video_path: str,
    clips: list[ClipData],
    style: StyleConfig,
    output_dir: str,
    transcript: dict = None,
    language: str = "en",
    file_suffix: str = "",
):
    """Run export in background thread with progress tracking.

    `language` controls the burned-in caption + subtitle language. "en"
    (default) keeps current behaviour. "es" uses each clip's cached
    caption_es + words_es (populated by translate_clip_to_spanish) and
    appends an "_es" suffix to filenames so the two versions can co-exist
    in the same exported/ folder.

    `file_suffix` (e.g. "_16x9") is appended to output filenames so quick
    variant renders of the same clip don't overwrite the standard export.
    """

    _lang_es = (language or "en").lower().startswith("es")
    _suffix = "_es" if _lang_es else ""

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
                filename = f"clip_{clip.id:02d}_{title_safe}{file_suffix}{_suffix}.mp4"
                filepath = os.path.join(output_dir, filename)

                export_progress[project_id]["current"] = i + 1
                export_progress[project_id]["current_file"] = filename

                eff_style = getattr(clip, "style_override", None) or style
                export_clip_with_style(video_path, clip, eff_style, filepath, transcript=transcript, language=language)
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

    # Same duration-aware timeout as the TikTok export — IG uses libx264 so
    # long clips need plenty of room.
    _ig_timeout = max(600, int(duration * 5))
    try:
        print(f"[Instagram Export] Clip {clip.id}: Exporting (ig_fill_mode={ig_fill_mode}, ig_top_padding={ig_top_padding}, duration={duration:.1f}s, timeout={_ig_timeout}s)...")
        subprocess.run(cmd, check=True, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=_ig_timeout)
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
