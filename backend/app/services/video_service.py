import os
import re
import math
import subprocess
import imageio_ffmpeg
from PIL import Image, ImageDraw

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()

# ─── Caption fonts ──────────────────────────────────────────────────────────
# Map of font keys (used by StyleConfig.caption_font) to file paths.
# Windows fonts are always available. Google fonts must be downloaded into
# backend/app/fonts/ (see fonts/README.md for direct links).
_FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "fonts")

FONT_MAP = {
    # Windows-installed (no download needed)
    "calibri":     "C:/Windows/Fonts/calibrib.ttf",
    "arial_black": "C:/Windows/Fonts/ariblk.ttf",
    "impact":      "C:/Windows/Fonts/impact.ttf",
    "verdana":     "C:/Windows/Fonts/verdanab.ttf",
    "segoe_ui":    "C:/Windows/Fonts/seguibl.ttf",
    "trebuchet":   "C:/Windows/Fonts/trebucbd.ttf",
    # Google Fonts — download into backend/app/fonts/ (see README)
    "montserrat":  os.path.join(_FONTS_DIR, "Montserrat-Black.ttf"),
    "poppins":     os.path.join(_FONTS_DIR, "Poppins-Bold.ttf"),
    "bebas":       os.path.join(_FONTS_DIR, "BebasNeue-Regular.ttf"),
    "anton":       os.path.join(_FONTS_DIR, "Anton-Regular.ttf"),
    "oswald":      os.path.join(_FONTS_DIR, "Oswald-Bold.ttf"),
}


def get_font_path(font_key: str) -> str:
    """Resolve a font key to an actual TTF path. Falls back to Calibri Bold
    if the requested file doesn't exist on disk (e.g. user didn't download
    the Google Font yet)."""
    path = FONT_MAP.get(font_key or "calibri", FONT_MAP["calibri"])
    if not os.path.exists(path):
        # Fallback to Calibri so render never crashes
        fallback = FONT_MAP["calibri"]
        if os.path.exists(fallback):
            print(f"[Font] '{font_key}' not found at {path} — falling back to Calibri")
            return fallback
    return path


# Cache QSV availability check across the process lifetime
_QSV_AVAILABLE = None


def get_canvas_dimensions(aspect_ratio: str = "9:16") -> tuple:
    """Return (W, H) for the requested output aspect ratio. Even numbers
    (required by H.264). Defaults to 9:16 vertical."""
    ar = (aspect_ratio or "9:16").strip()
    return {
        "9:16": (1080, 1920),
        "1:1":  (1080, 1080),
        "16:9": (1920, 1080),
        "4:5":  (1080, 1350),
    }.get(ar, (1080, 1920))


# ─── Multi-segment concat (timeline editor) ───────────────────────────────────
#
# The timeline editor lets the user cut a clip into kept pieces (removing
# boring middles). We implement this "concat-first": before the heavy export
# pipeline runs, we concatenate the kept segments into one temp mp4. The rest
# of the pipeline (blur, caption, watermark, subtitles, keyframes) then runs
# on that temp file as if it were a normal single-range video. This keeps the
# complex export filter graph untouched and makes subtitle/keyframe timing
# trivially correct (they operate on the already-cut video).

def _atempo_chain(speed: float) -> str:
    """Build an atempo filter chain for arbitrary speed. atempo only accepts
    0.5–2.0, so out-of-range speeds are decomposed into a product of factors."""
    s = max(0.25, min(4.0, float(speed)))
    factors = []
    while s > 2.0 + 1e-6:
        factors.append(2.0); s /= 2.0
    while s < 0.5 - 1e-6:
        factors.append(0.5); s /= 0.5
    factors.append(s)
    return ",".join(f"atempo={f:.6f}" for f in factors)


def _norm_segments(segments: list) -> list:
    """Normalise mixed input (tuples or dicts) into a list of dicts with
    start/end/speed/type/image_path/duration/transition_in/transition_duration."""
    out = []
    for seg in segments:
        if isinstance(seg, (tuple, list)):
            s, e = float(seg[0]), float(seg[1])
            sp = float(seg[2]) if len(seg) > 2 else 1.0
            out.append({"start": s, "end": e, "speed": sp, "type": "video",
                        "transition_in": "cut", "transition_duration": 0.0})
        elif isinstance(seg, dict):
            out.append({
                "start": float(seg.get("start", 0)), "end": float(seg.get("end", 0)),
                "speed": max(0.25, min(4.0, float(seg.get("speed", 1.0) or 1.0))),
                "type": seg.get("type", "video"),
                "image_path": seg.get("image_path"),
                "duration": float(seg.get("duration", 0) or 0),
                "transition_in": str(seg.get("transition_in") or "cut"),
                "transition_duration": float(seg.get("transition_duration") or 0),
            })
        else:  # pydantic Segment
            out.append({
                "start": float(getattr(seg, "start", 0)), "end": float(getattr(seg, "end", 0)),
                "speed": max(0.25, min(4.0, float(getattr(seg, "speed", 1.0) or 1.0))),
                "type": getattr(seg, "type", "video"),
                "image_path": getattr(seg, "image_path", None),
                "duration": float(getattr(seg, "duration", 0) or 0),
                "transition_in": str(getattr(seg, "transition_in", None) or "cut"),
                "transition_duration": float(getattr(seg, "transition_duration", 0) or 0),
            })
    return out


def _segment_output_duration(seg: dict) -> float:
    """How long this segment lasts in the FINAL output (ignoring xfade overlap)."""
    if seg["type"] == "image":
        return max(0.1, seg.get("duration", 0) or 0)
    return max(0.0, (seg["end"] - seg["start"]) / max(0.25, seg.get("speed", 1.0)))


# Transitions we accept (FFmpeg xfade names). "cut" means no transition.
XFADE_TRANSITIONS = {
    "fade", "fadeblack", "fadewhite", "dissolve", "pixelize", "radial",
    "slideleft", "slideright", "slideup", "slidedown",
    "wipeleft", "wiperight", "wipeup", "wipedown",
    "circleopen", "circleclose", "smoothleft", "smoothright",
    "zoomin",
}


def _seg_transition(seg: dict) -> tuple:
    """Return (name, duration) for a segment's incoming transition.
    Returns ("cut", 0.0) when there's none (the default, hard cut)."""
    name = (seg.get("transition_in") or "cut").lower()
    dur = float(seg.get("transition_duration") or 0)
    if name in ("", "cut", "none") or dur <= 0:
        return ("cut", 0.0)
    if name not in XFADE_TRANSITIONS:
        # Unknown name — fall back to a plain fade so we don't crash FFmpeg.
        name = "fade"
    return (name, dur)


def _segment_offsets(segs: list) -> list:
    """Return [(out_start, out_end), ...] in OUTPUT seconds for each segment,
    accounting for xfade overlap. Transition duration is clamped to half of
    each neighbour so it never exceeds clip length."""
    offs = []
    cursor = 0.0
    prev_dur = 0.0
    for i, seg in enumerate(segs):
        dur = _segment_output_duration(seg)
        if i == 0:
            offs.append((0.0, dur))
            cursor = dur
            prev_dur = dur
            continue
        _, T = _seg_transition(seg)
        T_eff = min(T, prev_dur * 0.5, dur * 0.5) if T > 0 else 0.0
        start = max(0.0, cursor - T_eff)
        offs.append((start, start + dur))
        cursor = start + dur
        prev_dur = dur
    return offs


def total_output_duration(segments: list) -> float:
    """Total output length of a segment list, accounting for xfade overlap."""
    segs = _norm_segments(segments)
    if not segs:
        return 0.0
    return _segment_offsets(segs)[-1][1]


def _has_xfade(segs: list) -> bool:
    """True if any segment (after the first) has a non-cut transition."""
    for i, s in enumerate(segs):
        if i == 0:
            continue
        name, T = _seg_transition(s)
        if name != "cut" and T > 0:
            return True
    return False


def concat_segments(source_video: str, segments: list, output_path: str,
                    canvas: tuple = (1080, 1920)) -> float:
    """Concatenate kept segments (video and/or image clips) into one mp4.

    Each segment is a dict/tuple with start/end/speed (video) or
    type="image"/image_path/duration (image clip). Video segments support
    per-segment speed (setpts + atempo). Image clips become a still shown
    full-screen for `duration` seconds with silent audio.

    Mixed video+image is normalised to a common WxH (the canvas) so the
    concat filter accepts all streams. Returns total output duration.
    """
    W, H = canvas
    segs = [s for s in _norm_segments(segments)
            if (s["type"] == "image" and s.get("image_path")) or (s["end"] - s["start"] > 0.05)]
    if not segs:
        raise RuntimeError("concat_segments: no valid segments")

    has_image = any(s["type"] == "image" for s in segs)
    has_speed = any(abs(s["speed"] - 1.0) > 1e-3 for s in segs if s["type"] == "video")

    use_xfade = _has_xfade(segs)

    # Fast path: pure single video segment, normal speed → simple trim copy-ish
    if len(segs) == 1 and segs[0]["type"] == "video" and not has_speed and not use_xfade:
        s, e = segs[0]["start"], segs[0]["end"]
        dur = e - s
        cmd = [FFMPEG_EXE, "-ss", str(max(0.0, s - 4.0)), "-i", source_video,
               "-ss", str(min(4.0, s)), "-t", str(dur),
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
               "-c:a", "aac", "-y", "-loglevel", "error", output_path]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        if r.returncode != 0:
            raise RuntimeError(f"concat_segments (single) failed: {r.stderr[-400:]}")
        return dur

    # General path: build a filter graph. Image clips need extra inputs.
    # Input [0] = source video. Image clips add inputs [1], [2], ...
    inputs = [FFMPEG_EXE, "-i", source_video]
    img_input_idx = {}
    next_input = 1
    for i, seg in enumerate(segs):
        if seg["type"] == "image":
            inputs += ["-loop", "1", "-t", str(_segment_output_duration(seg)), "-i", seg["image_path"]]
            img_input_idx[i] = next_input
            next_input += 1

    # ── xfade path ────────────────────────────────────────────────────────
    # When any segment has a non-cut transition, build a pairwise xfade chain.
    # All segments are normalised to canvas WxH/yuv420p/30fps so xfade accepts
    # them. Audio uses acrossfade. "cut" segments in this path still get a
    # tiny 0.04s fade (visually a hard cut) to keep the graph uniform.
    if use_xfade:
        parts = []
        for i, seg in enumerate(segs):
            if seg["type"] == "image":
                inp = img_input_idx[i]
                dur = _segment_output_duration(seg)
                parts.append(
                    f"[{inp}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,"
                    f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,"
                    f"trim=duration={dur},setpts=PTS-STARTPTS[v{i}]"
                )
                parts.append(
                    f"anullsrc=channel_layout=stereo:sample_rate=44100,"
                    f"atrim=duration={dur},asetpts=PTS-STARTPTS[a{i}]"
                )
            else:
                s, e, sp = seg["start"], seg["end"], seg["speed"]
                parts.append(
                    f"[0:v]trim=start={s}:end={e},setpts=(PTS-STARTPTS)/{sp},"
                    f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
                    f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v{i}]"
                )
                parts.append(
                    f"[0:a]atrim=start={s}:end={e},asetpts=PTS-STARTPTS,"
                    f"{_atempo_chain(sp)},aresample=44100[a{i}]"
                )

        # Pairwise xfade + acrossfade. Track cumulative output duration.
        offs = _segment_offsets(segs)
        prev_v = "v0"
        prev_a = "a0"
        for i in range(1, len(segs)):
            name, T = _seg_transition(segs[i])
            # In xfade path, even "cut" segments need a tiny crossfade so the
            # filter has something to do. Imperceptible at 0.04s.
            if name == "cut" or T <= 0:
                name = "fade"
                # Clamp to half of both neighbours (xfade requires T < min(dur))
                T_eff = min(0.04, _segment_output_duration(segs[i-1]) * 0.5,
                            _segment_output_duration(segs[i]) * 0.5)
            else:
                T_eff = offs[i-1][1] - offs[i][0]  # already clamped in _segment_offsets
                T_eff = max(0.04, T_eff)
            # xfade offset = where in stream A its last T_eff seconds begin
            # relative to A's start. Stream A is the chained result; its
            # cumulative duration up to here is offs[i-1][1].
            xfade_offset = max(0.0, offs[i-1][1] - T_eff)
            out_v = f"vx{i}"
            out_a = f"ax{i}"
            parts.append(
                f"[{prev_v}][v{i}]xfade=transition={name}:duration={T_eff:.3f}:"
                f"offset={xfade_offset:.3f}[{out_v}]"
            )
            parts.append(
                f"[{prev_a}][a{i}]acrossfade=d={T_eff:.3f}:c1=tri:c2=tri[{out_a}]"
            )
            prev_v = out_v
            prev_a = out_a

        filtergraph = ";".join(parts)
        cmd = inputs + [
            "-filter_complex", filtergraph,
            "-map", f"[{prev_v}]", "-map", f"[{prev_a}]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-c:a", "aac", "-y", "-loglevel", "error", output_path,
        ]
        total = offs[-1][1]
        print(f"[Concat] xfade chain n={len(segs)} -> {total:.1f}s")
        r = subprocess.run(cmd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=900)
        if r.returncode != 0:
            # Retry video-only (source may have no audio stream)
            print(f"[Concat] xfade with-audio failed, retrying video-only. stderr: {r.stderr[-250:]}")
            parts_v = [p for p in parts if not p.startswith("[0:a]")
                       and "anullsrc" not in p and "acrossfade" not in p
                       and not p.startswith("[a")]
            cmd_v = inputs + [
                "-filter_complex", ";".join(parts_v),
                "-map", f"[{prev_v}]",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                "-y", "-loglevel", "error", output_path,
            ]
            r = subprocess.run(cmd_v, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=900)
            if r.returncode != 0:
                raise RuntimeError(f"concat_segments (xfade) failed: {r.stderr[-400:]}")
        return total

    # ── Concat path (cuts only) ───────────────────────────────────────────
    parts = []
    concat_inputs = ""
    for i, seg in enumerate(segs):
        if seg["type"] == "image":
            inp = img_input_idx[i]
            # Scale image to canvas (contain) on black, set fps/sar, + silent audio
            parts.append(
                f"[{inp}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,"
                f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v{i}]"
            )
            parts.append(f"anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration={_segment_output_duration(seg)}[a{i}]")
        else:
            s, e, sp = seg["start"], seg["end"], seg["speed"]
            # When mixing with images, normalise video size to canvas too
            vchain = f"[0:v]trim=start={s}:end={e},setpts=(PTS-STARTPTS)/{sp}"
            if has_image:
                vchain += f",scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p"
            parts.append(vchain + f"[v{i}]")
            parts.append(f"[0:a]atrim=start={s}:end={e},asetpts=PTS-STARTPTS,{_atempo_chain(sp)}[a{i}]")
        concat_inputs += f"[v{i}][a{i}]"

    n = len(segs)
    filtergraph = ";".join(parts) + f";{concat_inputs}concat=n={n}:v=1:a=1[outv][outa]"
    cmd = inputs + ["-filter_complex", filtergraph, "-map", "[outv]", "-map", "[outa]",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                    "-c:a", "aac", "-y", "-loglevel", "error", output_path]
    total = sum(_segment_output_duration(s) for s in segs)
    print(f"[Concat] {n} segments (image={has_image}, speed={has_speed}) -> {total:.1f}s")
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
    if r.returncode != 0:
        # Retry video-only (source may have no audio stream)
        print(f"[Concat] with-audio failed, retrying video-only. stderr: {r.stderr[-250:]}")
        parts_v = []
        concat_v = ""
        for i, seg in enumerate(segs):
            if seg["type"] == "image":
                inp = img_input_idx[i]
                parts_v.append(f"[{inp}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v{i}]")
            else:
                s, e, sp = seg["start"], seg["end"], seg["speed"]
                vchain = f"[0:v]trim=start={s}:end={e},setpts=(PTS-STARTPTS)/{sp}"
                if has_image:
                    vchain += f",scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p"
                parts_v.append(vchain + f"[v{i}]")
            concat_v += f"[v{i}]"
        fg_v = ";".join(parts_v) + f";{concat_v}concat=n={n}:v=1:a=0[outv]"
        cmd_v = inputs + ["-filter_complex", fg_v, "-map", "[outv]",
                          "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                          "-y", "-loglevel", "error", output_path]
        r = subprocess.run(cmd_v, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        if r.returncode != 0:
            raise RuntimeError(f"concat_segments failed: {r.stderr[-400:]}")
    return total


def remap_transcript_to_segments(transcript: dict, segments: list) -> dict:
    """Remap a transcript from SOURCE-video time to CONCATENATED time.

    When segments [(5,10),(15,20)] are concatenated, a word at source t=17
    (inside the second kept piece) lands at output t = (10-5) + (17-15) = 7.
    Words inside removed gaps are dropped. Returns a new transcript dict whose
    word timestamps are in the concatenated output timeline — which is what the
    export's subtitle generator expects after concat-first.
    """
    if not transcript or not transcript.get("words"):
        return transcript
    segs = _norm_segments(segments)
    if not segs:
        return transcript

    offs = _segment_offsets(segs)
    out_words = []
    for i, seg in enumerate(segs):
        out_start, _ = offs[i]
        if seg["type"] == "image":
            continue
        s, e, sp = seg["start"], seg["end"], max(0.25, seg.get("speed", 1.0))
        for w in transcript["words"]:
            ws, we = w.get("start", 0), w.get("end", 0)
            if we <= s or ws >= e:
                continue
            # Clip to the segment, compress by speed, then shift into output time
            new_start = (max(ws, s) - s) / sp + out_start
            new_end = (min(we, e) - s) / sp + out_start
            if new_end > new_start:
                out_words.append({**w, "start": round(new_start, 3), "end": round(new_end, 3)})

    out = dict(transcript)
    out["words"] = out_words
    return out


def generate_thumbnails(source_video: str, output_dir: str, count: int = 30,
                        duration: float = None, width: int = 160) -> list:
    """Extract `count` evenly-spaced thumbnail JPEGs across the video.

    Returns a list of dicts: [{"time": sec, "file": "thumb_03.jpg"}, ...].
    Used by the timeline editor to paint the clip track. width keeps them
    small (fast + light). Existing thumbs in output_dir are overwritten.
    """
    if duration is None:
        duration = get_video_duration(source_video)
    count = max(4, min(60, int(count)))
    os.makedirs(output_dir, exist_ok=True)

    # Evenly spaced timestamps, biased slightly inward so the first/last frames
    # aren't pure black intros/outros.
    thumbs = []
    for i in range(count):
        frac = (i + 0.5) / count
        t = max(0.0, min(duration - 0.1, frac * duration))
        fname = f"thumb_{i:03d}.jpg"
        fpath = os.path.join(output_dir, fname)
        cmd = [
            FFMPEG_EXE, "-ss", str(t), "-i", source_video,
            "-frames:v", "1", "-vf", f"scale={width}:-2",
            "-q:v", "5", "-y", "-loglevel", "error", fpath,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        if result.returncode == 0 and os.path.exists(fpath):
            thumbs.append({"time": round(t, 2), "file": fname})
    return thumbs


# ─── Keyframe animation (zoompan expression generator) ────────────────────────
#
# Per-clip animated zoom/pan. The editor modal sends a list of keyframes,
# each with {time (s relative to clip start), zoom, pan_x, pan_y}. We build
# the FFmpeg `zoompan` filter expressions with linear interpolation between
# consecutive keyframes and held values outside the range.
#
# Why zoompan (and not scale + eval=frame): scale's output dimensions can't
# vary mid-stream in a way downstream filters accept. zoompan is designed
# specifically for animated zoom into source content, evaluated per frame.
#
# Trade-off vs the static `_zoom` path: in keyframes mode the foreground is
# always canvas-sized (zoompan output = `s=WxH`), so the bg-blur layer never
# shows through. That's acceptable because keyframes are used for punch-in
# / zoom-out effects where the source is meant to fill the frame anyway.

def has_keyframes(clip) -> bool:
    """True if the clip has keyframes that should drive an animated zoom."""
    kfs = getattr(clip, "keyframes", None) or []
    return len(kfs) > 0


def interpolate_keyframes(keyframes: list, t: float) -> dict:
    """Linearly interpolate keyframe values at time `t` (seconds from clip start).

    Mirrors the JS interpolation used by the editor's live preview so the
    static preview-frame thumbnail matches what the animated clip will show.
    Hold first/last value outside the keyframe range. Returns
    `{zoom, pan_x, pan_y}` or sensible defaults if `keyframes` is empty.
    """
    if not keyframes:
        return {"zoom": 1.0, "pan_x": 0.0, "pan_y": 0.0}

    def _get(kf, name, default=0.0):
        return float(getattr(kf, name, None) if hasattr(kf, name) else kf.get(name, default))

    pts = sorted(
        [(_get(k, "time", 0.0), _get(k, "zoom", 1.0), _get(k, "pan_x", 0.0), _get(k, "pan_y", 0.0))
         for k in keyframes],
        key=lambda p: p[0],
    )
    if t <= pts[0][0]:
        return {"zoom": pts[0][1], "pan_x": pts[0][2], "pan_y": pts[0][3]}
    if t >= pts[-1][0]:
        return {"zoom": pts[-1][1], "pan_x": pts[-1][2], "pan_y": pts[-1][3]}
    for i in range(len(pts) - 1):
        t0, z0, px0, py0 = pts[i]
        t1, z1, px1, py1 = pts[i + 1]
        if t0 <= t < t1:
            u = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
            return {
                "zoom":  z0 + (z1 - z0) * u,
                "pan_x": px0 + (px1 - px0) * u,
                "pan_y": py0 + (py1 - py0) * u,
            }
    return {"zoom": pts[-1][1], "pan_x": pts[-1][2], "pan_y": pts[-1][3]}


def build_zoompan_filter(
    keyframes: list,
    clip_duration: float,
    target_w: int,
    target_h: int,
    fps: int = 30,
) -> str:
    """Return a complete `zoompan=...` filter string for the foreground.

    `keyframes` is a list of objects/dicts with `.time/.zoom/.pan_x/.pan_y`.
    `clip_duration` is the trimmed clip length (seconds). zoompan emits
    `fps`*duration frames at size `target_w`×`target_h`.

    The returned string is the *body* of the zoompan filter — wrap it with
    `[fg_input]<this>[fg_label]` in the parent filter chain.
    """
    if not keyframes:
        # Caller should have checked has_keyframes() first.
        return f"zoompan=z=1:x=0:y=0:d=1:s={target_w}x{target_h}:fps={fps}"

    # Normalise to a list of (time, zoom, pan_x, pan_y) tuples sorted by time.
    def _get(kf, name, default=0.0):
        return float(getattr(kf, name, None) if hasattr(kf, name) else kf.get(name, default))

    pts = []
    for kf in keyframes:
        pts.append((
            _get(kf, "time", 0.0),
            max(1.0, _get(kf, "zoom", 1.0)),
            _get(kf, "pan_x", 0.0),
            _get(kf, "pan_y", 0.0),
        ))
    pts.sort(key=lambda p: p[0])

    # Pad: if first kf isn't at t=0, hold first values from start.
    # If last kf isn't at end, hold last values to end.
    if pts[0][0] > 0:
        pts = [(0.0, pts[0][1], pts[0][2], pts[0][3])] + pts
    if pts[-1][0] < clip_duration:
        pts = pts + [(clip_duration, pts[-1][1], pts[-1][2], pts[-1][3])]

    def _chain(idx: int) -> str:
        """Build piecewise-linear expression for tuple field `idx` over `pts`."""
        # Fallback for time beyond last segment = last value
        last_val = pts[-1][idx]
        expr = f"{last_val:.6f}"
        # Walk backwards, wrap each segment in an `if(lt(it, t_end), interp, expr)`
        for i in range(len(pts) - 1, 0, -1):
            t0, _, _, _ = pts[i - 1]
            t1, _, _, _ = pts[i]
            v0 = pts[i - 1][idx]
            v1 = pts[i][idx]
            if t1 - t0 < 1e-6:
                # Zero-length segment → step to v1
                interp = f"{v1:.6f}"
            else:
                # v0 + (v1 - v0) * ((it - t0) / (t1 - t0))
                slope = (v1 - v0) / (t1 - t0)
                interp = f"({v0:.6f}+({slope:.6f})*(it-{t0:.6f}))"
            expr = f"if(lt(it,{t1:.6f}),{interp},{expr})"
        return expr

    z_expr = _chain(1)
    px_expr = _chain(2)
    py_expr = _chain(3)

    # x/y in zoompan are top-left of the source crop window, in SOURCE coords.
    # Centred crop: (iw - iw/zoom)/2. Pan adds a fraction of the available
    # pan range (iw - iw/zoom)/2 in each direction.
    #   pan_x = +100 → fully right, -100 → fully left, 0 → centred.
    x_expr = f"((iw-iw/zoom)/2)+(({px_expr})/100)*((iw-iw/zoom)/2)"
    y_expr = f"((ih-ih/zoom)/2)+(({py_expr})/100)*((ih-ih/zoom)/2)"

    # FFmpeg's filter graph parser uses ',' and ':' as delimiters at the top
    # level — single-quote each expression so commas inside if(...) survive.
    return (
        f"zoompan=z='{z_expr}'"
        f":x='{x_expr}'"
        f":y='{y_expr}'"
        f":d=1:s={target_w}x{target_h}:fps={fps}"
    )


def get_visual_filter_chain(filter_name: str) -> str:
    """Return an FFmpeg filter string for a cinematic look. Empty string = no filter."""
    f = (filter_name or "none").lower()
    if f == "cinematic":
        # Aggressive teal shadows + orange highlights, strong contrast
        return ("eq=saturation=0.80:contrast=1.25:gamma=0.95,"
                "colorbalance=rs=-0.12:gs=-0.05:bs=0.25:rh=0.20:gh=0.05:bh=-0.15,"
                "curves=master='0/0 0.3/0.22 0.7/0.78 1/1'")
    if f == "warm":
        # Strong golden/yellow with visible warm shift
        return ("eq=saturation=1.18:contrast=1.08:gamma_r=0.92:gamma_b=1.08,"
                "colorbalance=rm=0.18:gm=0.08:bm=-0.22:rh=0.10:bh=-0.10")
    if f == "vivid":
        # Very punchy saturation + strong contrast — stop-scroll effect
        return "eq=saturation=1.65:contrast=1.30:brightness=0.03:gamma=0.95"
    if f == "moody":
        # Heavily desaturated, dark, distinct cool tint
        return ("eq=saturation=0.55:contrast=1.20:brightness=-0.08:gamma=0.92,"
                "colorbalance=rs=-0.08:bs=0.15:rh=-0.05:bh=0.08")
    if f == "bw":
        # Full black & white with extra contrast for impact
        return "hue=s=0,eq=contrast=1.15:brightness=0.02"
    return ""


def _has_audio_stream(path: str) -> bool:
    """True if the file has at least one audio stream (probed via ffmpeg -i)."""
    try:
        r = subprocess.run([FFMPEG_EXE, "-i", path, "-hide_banner"],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        return "Audio:" in (r.stderr or "")
    except Exception:
        return True   # assume audio so we still try to mix


def get_audio_peaks(audio_path: str, buckets: int = 300) -> list:
    """Return ~`buckets` normalized (0..1) amplitude peaks for a waveform display.

    Decodes the audio to low-rate mono 16-bit PCM and takes the max abs sample
    per bucket. Cheap enough to run at upload time; used by the editor to draw
    the little waveform bars (so the user can see where the sound/silence is).
    """
    import array
    try:
        r = subprocess.run(
            [FFMPEG_EXE, "-i", audio_path, "-ac", "1", "-ar", "8000",
             "-f", "s16le", "-hide_banner", "-loglevel", "error", "-"],
            capture_output=True, timeout=120)
        raw = r.stdout or b""
    except Exception as e:
        print(f"[Peaks] failed for {audio_path}: {e}")
        return []
    usable = len(raw) - (len(raw) % 2)
    if usable <= 0:
        return []
    samples = array.array("h")
    samples.frombytes(raw[:usable])
    n = len(samples)
    if n == 0:
        return []
    buckets = max(20, min(buckets, n))
    step = n / buckets
    peaks = []
    for i in range(buckets):
        a = int(i * step)
        b = int((i + 1) * step)
        if b <= a:
            b = a + 1
        m = max((abs(s) for s in samples[a:b]), default=0)
        peaks.append(round(m / 32768.0, 3))
    return peaks


def mix_music_track(video_path: str, music_path: str,
                    music_volume: float = 0.8, original_volume: float = 1.0,
                    music_start: float = 0.0, music_end: float = 0.0) -> str:
    """Mix a background-music track into an already-rendered clip, IN PLACE.

    Runs as a fast post-step after the main export: the video stream is copied
    (no re-encode) and only the audio is re-mixed, so it's cheap.

    `music_start` / `music_end` pick a SLICE of the music source (in music
    seconds). end=0 means "play to the natural end" — `-shortest` still cuts
    to the video length so a long music slice is fine. The slice plays from
    the clip's t=0 onward.

    If the clip has no audio of its own, the music becomes the only track.
    """
    tmp = video_path + ".mixtmp.mp4"

    # Build the music branch. If trim is requested, prepend atrim+asetpts so
    # the slice starts at the clip's t=0 (asetpts=PTS-STARTPTS resets PTS).
    has_trim = (music_start and music_start > 0) or (music_end and music_end > music_start)
    if has_trim:
        if music_end and music_end > music_start:
            atrim = f"atrim=start={music_start}:end={music_end},"
        else:
            atrim = f"atrim=start={music_start},"
        music_branch = f"[1:a]{atrim}asetpts=PTS-STARTPTS,volume={music_volume}"
    else:
        music_branch = f"[1:a]volume={music_volume}"

    if _has_audio_stream(video_path):
        fc = (f"[0:a]volume={original_volume}[a0];"
              f"{music_branch}[a1];"
              f"[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]")
    else:
        fc = f"{music_branch}[aout]"
    cmd = [FFMPEG_EXE, "-i", video_path, "-i", music_path,
           "-filter_complex", fc, "-map", "0:v", "-map", "[aout]",
           "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
           "-shortest", "-movflags", "+faststart",
           "-y", "-loglevel", "error", tmp]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
    if r.returncode != 0 or not os.path.exists(tmp):
        if os.path.exists(tmp):
            try: os.remove(tmp)
            except Exception: pass
        raise RuntimeError(f"music mix failed: {(r.stderr or '')[-300:]}")
    os.replace(tmp, video_path)
    return video_path


def _qsv_supported() -> bool:
    """Check once whether the bundled FFmpeg supports h264_qsv encoder."""
    global _QSV_AVAILABLE
    if _QSV_AVAILABLE is not None:
        return _QSV_AVAILABLE
    try:
        result = subprocess.run(
            [FFMPEG_EXE, "-hide_banner", "-encoders"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10
        )
        _QSV_AVAILABLE = "h264_qsv" in (result.stdout or "")
        print(f"[FFmpeg] Intel QSV available: {_QSV_AVAILABLE}")
    except Exception as e:
        print(f"[FFmpeg] QSV detection failed: {e}")
        _QSV_AVAILABLE = False
    return _QSV_AVAILABLE


def get_video_codec_args(preset: str = "fast", crf: int = 23, prefer_qsv: bool = True) -> list:
    """Return the FFmpeg codec arguments for the encoder we want to use.
    Uses Intel QSV if available; otherwise falls back to libx264."""
    if prefer_qsv and _qsv_supported():
        # h264_qsv preset names: veryfast, faster, fast, medium, slow, slower, veryslow
        # global_quality is the equivalent of crf (same scale, lower = better)
        qsv_preset = preset if preset in ("veryfast", "faster", "fast", "medium", "slow") else "fast"
        return ["-c:v", "h264_qsv", "-preset", qsv_preset, "-global_quality", str(crf)]
    return ["-c:v", "libx264", "-preset", preset, "-crf", str(crf)]


def run_ffmpeg_with_fallback(cmd_builder, label: str = "FFmpeg") -> subprocess.CompletedProcess:
    """Run an FFmpeg command built by cmd_builder(use_qsv: bool) -> list[str].
    Tries QSV first; on failure, falls back to libx264 and reruns."""
    if _qsv_supported():
        cmd = cmd_builder(True)
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        if result.returncode == 0:
            return result
        print(f"[{label}] QSV encode failed, falling back to libx264. stderr tail: {result.stderr[-300:]}")
    cmd = cmd_builder(False)
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)

# Emoji unicode ranges (covers most common emojis)
_EMOJI_RE = re.compile(
    r"[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F9FF]"
)


def _count_emojis(text: str) -> int:
    return len(_EMOJI_RE.findall(text))


def _measure_text_with_emoji(text: str, font, font_size: int) -> int:
    """PIL fonts can't measure emojis, so we measure text-only width and add
    a fixed allowance per emoji."""
    text_only = _EMOJI_RE.sub("", text)
    try:
        text_w = int(font.getlength(text_only))
    except Exception:
        text_w = int(len(text_only) * font_size * 0.55)
    # Each emoji renders at roughly font_size square. Add small spacing.
    emoji_w = _count_emojis(text) * int(font_size * 1.05)
    return text_w + emoji_w


def _round_polygon(pts: list, radius: float, samples: int = 12) -> list:
    """Round every corner of a closed polygon with an exact circular arc.

    Works for convex AND concave corners (CapCut-style wrapped-text contour).
    The radius at each corner is clamped to half of each adjacent edge so arcs
    never overlap — small steps simply get a smaller radius and meet cleanly.
    Returns a new, denser point list ready for ImageDraw.polygon().
    """
    # Drop consecutive duplicate points (zero-length edges break the math).
    clean = []
    for p in pts:
        if not clean or abs(p[0] - clean[-1][0]) > 1e-6 or abs(p[1] - clean[-1][1]) > 1e-6:
            clean.append((float(p[0]), float(p[1])))
    if len(clean) > 1 and abs(clean[0][0] - clean[-1][0]) < 1e-6 and abs(clean[0][1] - clean[-1][1]) < 1e-6:
        clean.pop()
    m = len(clean)
    if m < 3:
        return clean

    out = []
    for i in range(m):
        prev = clean[(i - 1) % m]
        cur = clean[i]
        nxt = clean[(i + 1) % m]
        v1x, v1y = prev[0] - cur[0], prev[1] - cur[1]
        v2x, v2y = nxt[0] - cur[0], nxt[1] - cur[1]
        len1 = math.hypot(v1x, v1y)
        len2 = math.hypot(v2x, v2y)
        if len1 < 1e-6 or len2 < 1e-6:
            out.append(cur); continue
        u1 = (v1x / len1, v1y / len1)
        u2 = (v2x / len2, v2y / len2)
        # Skip straight (collinear) points — they aren't real corners.
        if abs(u1[0] * u2[1] - u1[1] * u2[0]) < 1e-6:
            out.append(cur); continue

        rr = min(radius, len1 / 2.0, len2 / 2.0)
        t1 = (cur[0] + u1[0] * rr, cur[1] + u1[1] * rr)   # tangent point on edge 1
        t2 = (cur[0] + u2[0] * rr, cur[1] + u2[1] * rr)   # tangent point on edge 2

        # Arc centre lies along the corner bisector; this formula is correct for
        # convex and concave corners of any angle (all ours are 90°).
        bx, by = u1[0] + u2[0], u1[1] + u2[1]
        blen = math.hypot(bx, by)
        if blen < 1e-6:
            out.append(cur); continue
        bx, by = bx / blen, by / blen
        half = math.acos(max(-1.0, min(1.0, u1[0] * bx + u1[1] * by)))   # half interior angle
        sin_half = math.sin(half)
        if sin_half < 1e-6:
            out.append(cur); continue
        ox = cur[0] + bx * (rr / sin_half)
        oy = cur[1] + by * (rr / sin_half)
        arc_r = rr * math.cos(half) / sin_half

        a1 = math.atan2(t1[1] - oy, t1[0] - ox)
        a2 = math.atan2(t2[1] - oy, t2[0] - ox)
        da = a2 - a1
        while da > math.pi:
            da -= 2 * math.pi
        while da < -math.pi:
            da += 2 * math.pi
        for s in range(samples + 1):
            a = a1 + da * (s / samples)
            out.append((ox + math.cos(a) * arc_r, oy + math.sin(a) * arc_r))

    return out


def create_caption_overlay(lines: list, font_size: int = 72,
                            pad_x: int = 28, pad_y: int = 16,
                            line_gap: int = 0,
                            font_key: str = "calibri",
                            box_radius: float = 0.28, box_opacity: float = 0.95,
                            box_color: str = "#FFFFFF") -> tuple:
    """CapCut-style caption: ONE single rounded rectangle around the text.

    Like CapCut's Basic text panel: the box is a single rounded rectangle, and
    the pad_x (Width) / pad_y (Height) controls GROW the box around the text
    without moving or resizing the text itself. Text is wrapped by measured
    pixel width so it never overflows, and the font auto-shrinks only if a
    single word is too wide. Box width grows with pad_x (clamped to the frame),
    box height grows with pad_y.
    """
    from PIL import ImageFont as _IF
    import uuid as _uuid

    W_vid = 1080
    side_margin = 40                       # keep the box clear of the screen edges
    pad_x = max(int(pad_x), 0)
    pad_y = max(int(pad_y), 0)
    # Text wraps to a STABLE width that does NOT depend on pad_x, so growing the
    # box with the Width control never re-flows the text — only the box grows.
    max_content_w = W_vid - side_margin * 2 - 32

    try:
        _c = (box_color or "#FFFFFF").lstrip("#")
        _rgb = (int(_c[0:2], 16), int(_c[2:4], 16), int(_c[4:6], 16))
    except Exception:
        _rgb = (255, 255, 255)
    fill = _rgb + (max(0, min(255, int(box_opacity * 255))),)
    # Auto-pick readable text color: white on a dark box, black on a light box.
    _lum = 0.299 * _rgb[0] + 0.587 * _rgb[1] + 0.114 * _rgb[2]
    text_fill = (255, 255, 255, 255) if _lum < 140 else (0, 0, 0, 255)
    font_path = get_font_path(font_key)

    # Re-flow whatever lines we were handed back into a single string, then wrap
    # by *real pixel width*. Character counts lie — the same 30 chars can be
    # narrow or wide depending on the letters — so a char-based split lets long
    # lines overflow the box. Pixel wrapping guarantees every line fits.
    # "\n" separators are PRESERVED as hard breaks so users can manually push
    # words to the next line by typing Enter in the edit modal.
    raw_text = "\n".join(s.rstrip() for s in (lines or []) if s and s.strip())

    def _wrap_px(text, fnt, fs):
        """Pixel-wrap each \\n-delimited block independently. Auto-wrap never
        crosses a manual line break — the user's Enter is respected."""
        out = []
        for block in (text or "").split("\n"):
            cur = ""
            for word in block.split():
                cand = (cur + " " + word).strip()
                if not cur or _measure_text_with_emoji(cand, fnt, fs) <= max_content_w:
                    cur = cand
                else:
                    out.append(cur)
                    cur = word
            if cur:
                out.append(cur)
        return out

    fs = max(28, int(font_size))
    font = _IF.load_default()
    wrapped = [raw_text] if raw_text else [""]
    while fs >= 28:
        try:
            font = _IF.truetype(font_path, fs)
        except Exception:
            font = _IF.load_default()
        wrapped = _wrap_px(raw_text, font, fs) or [""]
        widest = max((_measure_text_with_emoji(l, font, fs) for l in wrapped), default=0)
        if widest <= max_content_w or fs <= 28:
            break
        fs -= 2                            # a single word is too wide → shrink & retry
    font_size = fs

    # Never leave a final line that is only emoji(s): pull the previous word down
    # so the emoji stays anchored to a real word (cleaner look).
    if len(wrapped) >= 2 and not _EMOJI_RE.sub("", wrapped[-1]).strip():
        prev = wrapped[-2].split()
        if len(prev) > 1:
            wrapped[-2] = " ".join(prev[:-1])
            wrapped[-1] = prev[-1] + " " + wrapped[-1]

    lines = wrapped
    n = len(lines)
    line_h = int(font_size * 1.30)

    # PER-LINE CONTOUR (the CapCut look): each line's background hugs its OWN
    # text width, so a short line is narrower than a long one — the edges step
    # in/out to follow the text instead of being one plain rectangle. All lines
    # merge into ONE connected shape with rounded corners (convex + concave).
    # It still GROWS: pad_x (Width) widens every line's hug, pad_y (Height)
    # grows the whole block vertically.
    frame_w = W_vid - side_margin * 2
    text_widths = [_measure_text_with_emoji(l, font, font_size) for l in lines]
    widest_text = max(text_widths) if text_widths else 0
    # Apply the SAME padding to EVERY line, capped so the widest line still fits
    # the frame. The gap between a wide and a narrow line is (wide_text - narrow_
    # text), which does not depend on the padding — so the step between lines
    # stays CONSTANT as the box grows (only the box grows, the step holds), just
    # like CapCut. Previously each line was clamped on its own, so the wide line
    # hit the frame first and the step shrank as you increased Width.
    eff_pad_x = pad_x
    if widest_text + eff_pad_x * 2 > frame_w:
        eff_pad_x = max(0, (frame_w - widest_text) // 2)
    line_box_w = [min(max(int(tw + eff_pad_x * 2), int(line_h)), frame_w) for tw in text_widths]
    canvas_w = max(line_box_w) if line_box_w else 100
    # Text sits at FIXED line spacing (line_h); each line's BACKGROUND box adds
    # pad_y above & below its text. Raising Height (pad_y) grows the boxes (they
    # overlap) WITHOUT moving the text — the caller offsets the whole overlay by
    # -pad_y so the text never changes position. Box height = n*line_h + 2*pad_y.
    canvas_h = n * line_h + pad_y * 2
    cx = canvas_w / 2.0

    # Corner radius (line-height based so corners look the same on any box).
    radius = box_radius * line_h * 0.7
    radius = max(2.0, min(radius, line_h * 0.5, canvas_w * 0.5))

    # Snap NEAR-IDENTICAL adjacent widths so a sub-radius step can't leave an
    # awkward sliver; genuinely different widths keep their visible hugging step.
    snap_tol = max(0.5 * radius, 10.0)
    for _ in range(n):
        changed = False
        for i in range(n):
            for j in (i - 1, i + 1):
                if 0 <= j < n and 0.0 < line_box_w[j] - line_box_w[i] <= snap_tol:
                    line_box_w[i] = line_box_w[j]
                    changed = True
        if not changed:
            break

    # Per-line boxes (centered): line i spans [i*line_h, (i+1)*line_h + 2*pad_y]
    # so it adds pad_y above & below its text. They OVERLAP when pad_y is large;
    # we take their UNION. For each vertical slice the outline uses the WIDEST
    # box covering it → a clean staircase. Then round every corner (convex outer
    # + concave step) with exact arcs.
    boxes = [(i * line_h, (i + 1) * line_h + 2 * pad_y, line_box_w[i] / 2.0) for i in range(n)]
    ys = sorted(set([b[0] for b in boxes] + [b[1] for b in boxes]))
    intervals = []
    for k in range(len(ys) - 1):
        y0, y1 = ys[k], ys[k + 1]
        ymid = (y0 + y1) / 2.0
        active = [hw for (t, b, hw) in boxes if t <= ymid <= b]
        if not active:
            continue
        hw = max(active)
        if intervals and abs(intervals[-1][2] - hw) < 1e-6:
            intervals[-1] = (intervals[-1][0], y1, hw)     # merge same-width runs
        else:
            intervals.append((y0, y1, hw))
    right_b, left_b = [], []
    for (y0, y1, hw) in intervals:
        right_b.append((cx + hw, y0)); right_b.append((cx + hw, y1))
        left_b.append((cx - hw, y0)); left_b.append((cx - hw, y1))
    polygon = right_b + left_b[::-1]
    rounded = _round_polygon(polygon, radius, samples=12)

    # Fill the rounded contour on a supersampled mask → LANCZOS downscale for AA.
    S = 4
    canvas_w, canvas_h = int(canvas_w), int(canvas_h)
    mask = Image.new('L', (canvas_w * S, canvas_h * S), 0)
    ImageDraw.Draw(mask).polygon([(x * S, y * S) for x, y in rounded], fill=255)
    mask = mask.resize((canvas_w, canvas_h), Image.LANCZOS)

    img = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
    color_layer = Image.new('RGBA', (canvas_w, canvas_h), _rgb + (255,))
    box_alpha = mask.point(lambda v: int(v * box_opacity))
    img.paste(color_layer, (0, 0), box_alpha)
    draw = ImageDraw.Draw(img)

    # Draw text — use Pilmoji if the line has emojis, plain PIL otherwise
    has_any_emoji = any(_count_emojis(line) > 0 for line in lines)
    pilmoji_ctx = None
    if has_any_emoji:
        try:
            from pilmoji import Pilmoji
            from pilmoji.source import AppleEmojiSource
            # Apple emojis = the iOS / TikTok / CapCut look
            pilmoji_ctx = Pilmoji(img, source=AppleEmojiSource)
        except Exception as e:
            print(f"[Caption] Pilmoji unavailable, emojis will not render: {e}")

    for i, line in enumerate(lines):
        tw = _measure_text_with_emoji(line, font, font_size)
        text_x = (canvas_w - tw) // 2
        text_y = pad_y + i * line_h + (line_h - font_size) // 2

        if pilmoji_ctx and _count_emojis(line) > 0:
            # Use Pilmoji's native offset to align emoji with text baseline
            pilmoji_ctx.text(
                (text_x, text_y), line, font=font, fill=text_fill,
                emoji_position_offset=(0, -int(font_size * 0.10)),
            )
        else:
            draw.text((text_x, text_y), line, font=font, fill=text_fill)

    if pilmoji_ctx:
        try:
            pilmoji_ctx.close()
        except Exception:
            pass

    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    png_path = os.path.join(temp_dir, f"caption_{_uuid.uuid4().hex}.png")
    img.save(png_path)
    return png_path, canvas_w, canvas_h


def create_tiktok_caption_overlay(lines: list, font_size: int = 72,
                                   pad_x: int = 20, pad_y: int = 10,
                                   line_gap: int = 8,
                                   stroke_width: int = 4,
                                   font_key: str = "calibri") -> tuple:
    """Render TikTok-style text: white text with thick black outline, transparent background.
    Emojis (if present) are rendered AFTER the outline pass using Pilmoji so they
    keep their natural color instead of being smeared by the black stroke.
    Returns (png_path, box_w, box_h)."""
    from PIL import ImageFont as _IF
    import uuid as _uuid

    W_vid = 1080
    font_path = get_font_path(font_key)
    try:
        font = _IF.truetype(font_path, font_size)
    except Exception:
        font = _IF.load_default()

    line_h = int(font_size * 1.40)  # taller line so emojis fit

    # Split each line into (text_part, emoji_part). Emojis are stripped for the
    # outlined text pass; they are painted in color afterwards.
    parsed = []
    for line in lines:
        emojis_in_line = "".join(_EMOJI_RE.findall(line))
        text_only = _EMOJI_RE.sub("", line).rstrip()
        parsed.append({"text": text_only, "emoji": emojis_in_line})

    # Measure widths per line (text + emoji separately so emoji never gets stroked)
    def _txt_w(s):
        try:
            return int(font.getlength(s))
        except Exception:
            return int(len(s) * font_size * 0.55)

    line_widths = []
    for p in parsed:
        tw = _txt_w(p["text"])
        ew = len(p["emoji"]) * int(font_size * 1.05)  # space allowance per emoji
        spacer = int(font_size * 0.20) if p["emoji"] and p["text"] else 0
        line_widths.append(tw + spacer + ew)

    max_line_px = max(line_widths) if line_widths else 0
    box_w = min(W_vid - 40, int(max_line_px + pad_x * 2 + stroke_width * 2))
    box_h = line_h * len(lines) + line_gap * max(len(lines) - 1, 0) + pad_y * 2 + stroke_width * 2

    img = Image.new('RGBA', (box_w, box_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    has_any_emoji = any(p["emoji"] for p in parsed)
    pilmoji_ctx = None
    if has_any_emoji:
        try:
            from pilmoji import Pilmoji
            from pilmoji.source import AppleEmojiSource
            pilmoji_ctx = Pilmoji(img, source=AppleEmojiSource)
        except Exception as e:
            print(f"[TikTok Caption] Pilmoji unavailable, emojis will not render: {e}")

    for i, p in enumerate(parsed):
        text_part, emoji_part = p["text"], p["emoji"]
        y = pad_y + stroke_width + i * (line_h + line_gap)

        tw = _txt_w(text_part)
        ew = len(emoji_part) * int(font_size * 1.05)
        spacer = int(font_size * 0.20) if emoji_part and text_part else 0
        total_w = tw + spacer + ew
        x = (box_w - total_w) // 2

        # Outline + white text — ONLY for the text portion (no emojis here)
        if text_part:
            for dx in range(-stroke_width, stroke_width + 1):
                for dy in range(-stroke_width, stroke_width + 1):
                    if dx == 0 and dy == 0:
                        continue
                    if abs(dx) ** 2 + abs(dy) ** 2 <= stroke_width ** 2 + stroke_width:
                        draw.text((x + dx, y + dy), text_part, font=font, fill=(0, 0, 0, 255))
            draw.text((x, y), text_part, font=font, fill=(255, 255, 255, 255))

        # Emoji on top, rendered in color by Pilmoji, no stroke.
        # Pilmoji anchors emoji to the font baseline, which sits ~ascent below
        # the visible top of the text. To align the emoji's vertical center
        # with the text's visual center we need to shift up by roughly
        # ~font_size (matches the empirical offset observed in the rendered
        # output).
        if emoji_part and pilmoji_ctx:
            emoji_x = x + tw + spacer
            offset_y = -int(font_size * 0.80)
            pilmoji_ctx.text(
                (emoji_x, y), emoji_part, font=font, fill=(255, 255, 255, 255),
                emoji_position_offset=(0, offset_y),
            )

    if pilmoji_ctx:
        try:
            pilmoji_ctx.close()
        except Exception:
            pass

    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    png_path = os.path.join(temp_dir, f"caption_tiktok_{_uuid.uuid4().hex}.png")
    img.save(png_path)
    return png_path, box_w, box_h


def split_text_into_lines(text: str, max_chars: int = 40, max_lines: int = 4) -> list:
    """Split text into up to max_lines lines, each capped at max_chars. Extra words
    beyond max_lines are dropped (raise max_lines so nothing is dropped).
    If the last line ends up containing only emojis (no text), the last word from the
    previous line is pulled down so the emoji never appears alone in its own mini-box.

    Respects "\\n" in `text` as a HARD line break (user-typed break in the edit
    modal). Each block separated by "\\n" gets its own auto-wrap; auto-wrap never
    crosses a manual break.
    """
    blocks = (text or "").split("\n")
    lines = []

    for block in blocks:
        if len(lines) >= max_lines:
            break
        words = block.split()
        current = []
        for word in words:
            if len(lines) >= max_lines:
                break
            test = " ".join(current + [word])
            if len(test) <= max_chars:
                current.append(word)
            else:
                if current:
                    lines.append(" ".join(current))
                if len(lines) >= max_lines:
                    break
                current = [word]
        if current and len(lines) < max_lines:
            lines.append(" ".join(current))

    # If the final line is just emoji(s) with no text, pull the previous line's
    # last word down so the emoji is anchored to a real word (cleaner look).
    if len(lines) >= 2:
        last_no_emoji = _EMOJI_RE.sub("", lines[-1]).strip()
        if not last_no_emoji:
            prev_words = lines[-2].split()
            if len(prev_words) > 1:
                pulled = prev_words[-1]
                lines[-2] = " ".join(prev_words[:-1])
                lines[-1] = pulled + " " + lines[-1]

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
    import uuid as _uuid
    png_path = os.path.join(temp_dir, f"ig_frame_{_uuid.uuid4().hex}.png")
    img.save(png_path)
    # Return (png_path, video_top_fixed, text_bottom_actual)
    return png_path, video_top, text_bottom


def get_video_duration(file_path: str) -> float:
    """Get video duration in seconds using ffmpeg."""
    try:
        cmd = [FFMPEG_EXE, "-i", file_path]
        result = subprocess.run(cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
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
    elif fill_mode == "mini":
        fg_filter = f"scale=-2:{int(video_h * 0.50)}"
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
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)

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
    import uuid as _uuid
    raw_frame_path = os.path.join(temp_dir, f"ig_raw_{_uuid.uuid4().hex}.jpg")

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
    elif fill_mode == "mini":
        # 50% of zone height — smallest option, more blur visible
        vf = f"scale=-2:{int(video_h * 0.50)}"
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

    result = subprocess.run(extract_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
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
    caption_style: str = "box",
    background_style: str = "blur",
    no_text: bool = False,
    caption_font: str = "calibri",
    caption_box_radius: float = 0.288,
    caption_box_opacity: float = 0.95,
    caption_box_color: str = "#FFFFFF",
    caption_box_pad_x: int = 14,
    caption_box_pad_y: int = 14,
    no_emojis: bool = False,
    edit_zoom: float = 1.0,
    edit_pan_x: float = 0.0,
    edit_pan_y: float = 0.0,
    fill_mode_scale: float = 1.0,
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

    # Per-clip editor transform — scales the BOX size (not the content).
    # fill_mode_scale is the global StyleConfig knob; multiply both so the
    # rest of the formulas don't need to know about it.
    _fm_scale = max(0.5, min(1.5, float(fill_mode_scale or 1.0)))
    _zoom = max(0.3, float(edit_zoom or 1.0)) * _fm_scale
    _pan_x_pct = float(edit_pan_x or 0.0) / 100.0
    _pan_y_pct = float(edit_pan_y or 0.0) / 100.0

    # Build fg_filter based on fill_mode × zoom (matches generate_preview_clip + export)
    if fill_mode == "fill":
        scaled_h = int(target_h * _zoom)
        scaled_w = int(W * _zoom)
        fg_filter = f"scale={scaled_w}:{scaled_h}:force_original_aspect_ratio=increase,crop={scaled_w}:{scaled_h}"
    elif fill_mode == "fit":
        fg_filter = f"scale={int(W * _zoom)}:-2"
    elif fill_mode == "zoom":
        fg_filter = f"scale=-2:{int(target_h * 0.9 * _zoom)}"
    elif fill_mode == "small":
        fg_filter = f"scale=-2:{int(target_h * 0.78 * _zoom)}"
    elif fill_mode == "medium":
        fg_filter = f"scale=-2:{int(target_h * 0.65 * _zoom)}"
    elif fill_mode == "mini":
        fg_filter = f"scale=-2:{int(target_h * 0.50 * _zoom)}"
    else:
        fg_filter = f"scale={W}:-2"

    filter_parts = []
    input_index = 1  # [0] = video

    def _bg(target_height: int) -> str:
        base = f"[0:v]scale={W}:{target_height}:force_original_aspect_ratio=increase,crop={W}:{target_height}"
        if background_style == "black":
            return base + ",colorchannelmixer=rr=0:rg=0:rb=0:gr=0:gg=0:gb=0:br=0:bg=0:bb=0"
        if background_style == "white":
            return base + ",drawbox=x=0:y=0:w=iw:h=ih:color=white@1.0:t=fill"
        return base + ",boxblur=12:2"

    if use_split:
        filter_parts.append(f"{_bg(video_h)}[bg]")
        filter_parts.append(f"[0:v]{fg_filter}[fg]")
        filter_parts.append(f"[bg][fg]overlay=(W-w)/2+({_pan_x_pct})*W:(H-h)/2+({_pan_y_pct})*{video_h},format=yuv420p[video_part]")
        # Image portion: scale to fill, crop to exact size, match pixel format
        filter_parts.append(f"[1:v]scale={W}:{image_h}:force_original_aspect_ratio=increase,crop={W}:{image_h},setsar=1,format=yuv420p[img_part]")
        # Stack vertically
        filter_parts.append("[video_part][img_part]vstack=inputs=2[v]")
        input_index = 2  # [0]=video, [1]=split image
    else:
        filter_parts.append(f"{_bg(H)}[bg]")
        filter_parts.append(f"[0:v]{fg_filter}[fg]")
        filter_parts.append(f"[bg][fg]overlay=(W-w)/2+({_pan_x_pct})*W:(H-h)/2+({_pan_y_pct})*H[v]")

    last = "v"
    rounded_box_path = None

    # Caption overlay — Y position relative to video portion in split mode
    if caption_text and not no_text:
        _caption = caption_text
        if no_emojis:
            _caption = _EMOJI_RE.sub("", _caption)
            _caption = re.sub(r"\s+", " ", _caption).strip()
        # Pass the RAW caption (with user-typed \n intact) — create_caption_overlay
        # does its own pixel-wrap. Avoids the char-based pre-split turning into
        # spurious hard breaks inside _wrap_px (which respects \n as forced).
        lines = [_caption] if _caption else []
        pad_x, pad_y = caption_box_pad_x, caption_box_pad_y
        line_gap = 5
        base_y = int(text_y * target_h)

        if caption_style == 'tiktok':
            rounded_box_path, box_w, box_h = create_tiktok_caption_overlay(
                lines, font_size=font_size, font_key=caption_font
            )
        else:
            rounded_box_path, box_w, box_h = create_caption_overlay(
                lines, font_size=font_size, pad_x=pad_x, pad_y=pad_y,
                line_gap=line_gap, font_key=caption_font,
                box_radius=caption_box_radius, box_opacity=caption_box_opacity, box_color=caption_box_color,
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
        result = subprocess.run(cmd, check=True, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
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
    caption_style: str = "box",
    subtitle_style: str = "none",
    transcript: dict = None,
    visual_filter: str = "none",
    subtitle_size_scale: float = 1.0,
    subtitle_y: float = 0.0,
    background_style: str = "blur",
    no_text: bool = False,
    caption_font: str = "calibri",
    caption_box_radius: float = 0.288,
    caption_box_opacity: float = 0.95,
    caption_box_color: str = "#FFFFFF",
    caption_box_pad_x: int = 14,
    caption_box_pad_y: int = 14,
    no_emojis: bool = False,
    edit_zoom: float = 1.0,
    edit_pan_x: float = 0.0,
    edit_pan_y: float = 0.0,
    fill_mode_scale: float = 1.0,
    keyframes: list = None,         # list of Keyframe (or dicts) — animated zoom/pan
    mirror_cyclic_enabled: bool = False,
    mirror_cyclic_interval: float = 5.0,
    sway_enabled: bool = False,
    sway_period: float = 3.0,
    sway_amplitude: int = 40,
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

    # Per-clip editor transform — scales the BOX size (not the content).
    # fill_mode_scale is the global StyleConfig knob; multiply both so the
    # rest of the formulas don't need to know about it.
    _fm_scale = max(0.5, min(1.5, float(fill_mode_scale or 1.0)))
    _zoom = max(0.3, float(edit_zoom or 1.0)) * _fm_scale
    _pan_x_pct = float(edit_pan_x or 0.0) / 100.0
    _pan_y_pct = float(edit_pan_y or 0.0) / 100.0

    # If keyframes are present, switch the foreground stage to a zoompan filter
    # that animates zoom/pan over the clip duration. The fg becomes canvas-
    # sized so the bg-blur is hidden (acceptable: keyframes are for punch-ins
    # where the source should fill the frame anyway). Otherwise keep the
    # existing static scale+overlay chain so single-mode behaviour is untouched.
    use_keyframes = bool(keyframes) and len(keyframes) > 0
    if use_keyframes:
        fg_filter = build_zoompan_filter(keyframes, clip_duration, W, target_h, fps=30)
    elif fill_mode == "fill":
        scaled_h = int(target_h * _zoom)
        scaled_w = int(W * _zoom)
        fg_filter = f"scale={scaled_w}:{scaled_h}:force_original_aspect_ratio=increase,crop={scaled_w}:{scaled_h}"
    elif fill_mode == "fit":
        fg_filter = f"scale={int(W * _zoom)}:-2"
    elif fill_mode == "zoom":
        fg_filter = f"scale=-2:{int(target_h * 0.9 * _zoom)}"
    elif fill_mode == "small":
        fg_filter = f"scale=-2:{int(target_h * 0.78 * _zoom)}"
    elif fill_mode == "medium":
        fg_filter = f"scale=-2:{int(target_h * 0.65 * _zoom)}"
    elif fill_mode == "mini":
        fg_filter = f"scale=-2:{int(target_h * 0.50 * _zoom)}"
    else:
        fg_filter = f"scale={W}:-2"

    # Build filter
    input_index = 1

    def _bg(target_height: int) -> str:
        base = f"[0:v]scale={W}:{target_height}:force_original_aspect_ratio=increase,crop={W}:{target_height}"
        if background_style == "black":
            return base + ",colorchannelmixer=rr=0:rg=0:rb=0:gr=0:gg=0:gb=0:br=0:bg=0:bb=0"
        if background_style == "white":
            return base + ",drawbox=x=0:y=0:w=iw:h=ih:color=white@1.0:t=fill"
        return base + ",boxblur=12:2"

    # Cyclic mirror — same logic as in export_service: applied to FG only,
    # before overlay, so captions/watermark/subs stay un-flipped.
    fg_chain = fg_filter
    if mirror_cyclic_enabled:
        m_int = max(0.5, min(20.0, float(mirror_cyclic_interval or 5.0)))
        fg_chain = (
            f"{fg_chain},"
            f"hflip=enable='lt(mod(t\\,{m_int * 2:.3f})\\,{m_int:.3f})'"
        )

    # Sway — sine-wave offset added to the overlay X coord. Captions use
    # their own absolute positions, so they don't sway.
    sway_x_add = ""
    if sway_enabled:
        s_period = max(0.5, min(30.0, float(sway_period or 3.0)))
        s_amp = max(0, min(200, int(sway_amplitude or 40)))
        if s_amp > 0:
            sway_x_add = f"+sin(2*PI*t/{s_period:.3f})*{s_amp}"

    # In keyframes mode the fg is already canvas-sized — overlay at (0,0).
    # In static mode the overlay carries the pan offset (as before).
    if use_split:
        if use_keyframes:
            _overlay_xy_split = f"0{sway_x_add}:0"
        else:
            _overlay_xy_split = (
                f"(W-w)/2+({_pan_x_pct})*W{sway_x_add}:"
                f"(H-h)/2+({_pan_y_pct})*{video_h}"
            )
        filter_complex = (
            f"{_bg(video_h)}[bg];"
            f"[0:v]{fg_chain}[fg];"
            f"[bg][fg]overlay={_overlay_xy_split},format=yuv420p[video_part];"
            f"[1:v]scale={W}:{image_h}:force_original_aspect_ratio=increase,crop={W}:{image_h},setsar=1,format=yuv420p[img_part];"
            f"[video_part][img_part]vstack=inputs=2[v]"
        )
        input_index = 2
    else:
        if use_keyframes:
            _overlay_xy_full = f"0{sway_x_add}:0"
        else:
            _overlay_xy_full = (
                f"(W-w)/2+({_pan_x_pct})*W{sway_x_add}:"
                f"(H-h)/2+({_pan_y_pct})*H"
            )
        filter_complex = f"{_bg(H)}[bg];[0:v]{fg_chain}[fg];[bg][fg]overlay={_overlay_xy_full}[v]"

    last_label = "v"
    rounded_box_path = None

    # Caption overlay — Y relative to video portion in split mode
    if caption_text and not no_text:
        _caption = caption_text
        if no_emojis:
            _caption = _EMOJI_RE.sub("", _caption)
            _caption = re.sub(r"\s+", " ", _caption).strip()
        # Pass the RAW caption (with user-typed \n intact) — create_caption_overlay
        # does its own pixel-wrap. Avoids the char-based pre-split turning into
        # spurious hard breaks inside _wrap_px (which respects \n as forced).
        lines = [_caption] if _caption else []
        pad_x, pad_y = caption_box_pad_x, caption_box_pad_y
        line_gap = 5
        base_y = int(text_y * target_h)

        if caption_style == 'tiktok':
            rounded_box_path, box_w, box_h = create_tiktok_caption_overlay(
                lines, font_size=font_size, font_key=caption_font
            )
        else:
            rounded_box_path, box_w, box_h = create_caption_overlay(
                lines, font_size=font_size, pad_x=pad_x, pad_y=pad_y,
                line_gap=line_gap, font_key=caption_font,
                box_radius=caption_box_radius, box_opacity=caption_box_opacity, box_color=caption_box_color,
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
    # Cinematic visual filter applied last
    cinematic = get_visual_filter_chain(visual_filter)
    if cinematic:
        preview_vf.append(cinematic)
    if preview_vf:
        filter_complex += f";[{last_label}]{','.join(preview_vf)}[detected]"
        last_label = "detected"

    # Burn-in subtitles in preview (so user can see exactly what will be exported)
    ass_subtitle_path = None
    ass_subtitle_path_extra = None  # cwd copy for FFmpeg-friendly relative path
    if subtitle_style and subtitle_style != 'none' and transcript and not no_text:
        try:
            from . import subtitle_service
            temp_dir = os.path.join(os.path.dirname(__file__), "temp")
            ass_subtitle_path = subtitle_service.generate_ass_for_clip(
                transcript=transcript,
                clip_start=start_time,
                clip_end=start_time + clip_duration,
                style=subtitle_style,
                output_dir=temp_dir,
                size_scale=subtitle_size_scale,
                y_offset=subtitle_y,
            )
            if ass_subtitle_path:
                # FFmpeg subtitles filter is fragile with Windows paths.
                # Workaround: copy the ASS to the current working directory and use
                # a relative filename — no colons to escape.
                import shutil as _shutil
                ass_basename = os.path.basename(ass_subtitle_path)
                ass_in_cwd = os.path.join(os.getcwd(), ass_basename)
                _shutil.copy2(ass_subtitle_path, ass_in_cwd)
                # Track for cleanup
                ass_subtitle_path_extra = ass_in_cwd
                filter_complex += f";[{last_label}]subtitles={ass_basename}[subbed]"
                last_label = "subbed"
                print(f"[Preview] Subtitle style='{subtitle_style}' applied (ass={ass_basename})")
        except Exception as e:
            print(f"[Preview] Subtitle generation failed (continuing without): {e}")

    # PREVIEW SPEED OPTIMIZATION: downscale final output to 720x1280 (3x fewer pixels)
    # The full 1080x1920 layout is preserved so captions/watermark/subs look correct,
    # we just shrink at the very end before encoding for faster output. Export still
    # uses the full 1080x1920 — this only affects the temporary preview file.
    filter_complex += f";[{last_label}]scale=720:1280[scaled]"
    last_label = "scaled"

    end_time = start_time + clip_duration
    cmd = [FFMPEG_EXE, "-ss", str(start_time), "-to", str(end_time), "-i", video_path]

    if use_split:
        cmd.extend(["-loop", "1", "-t", str(clip_duration), "-i", split_image_path])

    if rounded_box_path:
        cmd.extend(["-loop", "1", "-t", str(clip_duration), "-i", rounded_box_path])

    base_args = [
        "-filter_complex", filter_complex,
        "-map", f"[{last_label}]",
        "-map", "0:a?",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        "-sar", "1:1",
        "-movflags", "+faststart",
        "-y",
        output_path,
    ]
    # Try QSV (Intel hardware encoder) first; fall back to libx264 on failure
    qsv_codec = get_video_codec_args(preset="veryfast", crf=28, prefer_qsv=True)
    cpu_codec = get_video_codec_args(preset="ultrafast", crf=28, prefer_qsv=False)
    cmd_qsv = cmd + qsv_codec + base_args
    cmd_cpu = cmd + cpu_codec + base_args

    print(f"[Preview] Generating {clip_duration}s clip — keyframes={'YES('+str(len(keyframes))+')' if use_keyframes else 'no'}, caption_lines={len(lines) if caption_text else 0}, subtitle={subtitle_style}, visual_filter={visual_filter}, split={use_split}, qsv={_qsv_supported()}")
    print(f"[Preview] filter_complex (last 400 chars): ...{filter_complex[-400:]}")
    result = subprocess.run(cmd_qsv, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    if result.returncode != 0 and _qsv_supported():
        print(f"[Preview] QSV failed (rc={result.returncode}), retrying with libx264. stderr tail: {result.stderr[-400:]}")
        result = subprocess.run(cmd_cpu, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    if result.returncode != 0:
        # Print the full FFmpeg cmd + last 1KB of stderr so we can see the
        # exact filter graph parse error or codec failure.
        print(f"[Preview] FAILED rc={result.returncode}")
        print(f"[Preview] cmd: {' '.join(cmd_cpu)}")
        print(f"[Preview] stderr tail: {result.stderr[-1000:]}")

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
    # Clean the cwd copy used by FFmpeg
    if ass_subtitle_path_extra and os.path.exists(ass_subtitle_path_extra):
        try:
            os.remove(ass_subtitle_path_extra)
        except:
            pass

    if result.returncode != 0:
        print(f"[Preview] Error: {result.stderr[-500:]}")
        raise RuntimeError(f"Preview failed: {result.stderr}")

    return output_path
