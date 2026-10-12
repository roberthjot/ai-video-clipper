import os
import uuid
import re
import json
import subprocess
import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
STOCK_DIR = os.path.join(BASE_DIR, "stock_aesthetic")
OUTPUT_DIR = os.path.join(BASE_DIR, "temp_lyrics")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(STOCK_DIR, exist_ok=True)

STOCK_PRESETS = [
    {"id": "clip1", "filename": "clip1_foggy_trees.mp4", "name": "Niebla y Ramas Oscuras"},
    {"id": "clip2", "filename": "clip2_dark_walk.mp4", "name": "Sendero y Silueta"},
    {"id": "clip3", "filename": "clip3_neon_rain.mp4", "name": "Lluvia de Neón Cyberpunk"},
    {"id": "clip4", "filename": "clip4_retro_dark.mp4", "name": "Estética Retro 80s"},
]


def list_stock_clips():
    """Return available stock background clips."""
    res = []
    for p in STOCK_PRESETS:
        full_path = os.path.join(STOCK_DIR, p["filename"])
        if os.path.exists(full_path):
            res.append({**p, "exists": True, "path": full_path})
        else:
            res.append({**p, "exists": False})
    return res


def get_media_duration(file_path: str) -> float:
    """Get duration of audio/video using ffmpeg."""
    cmd = [FFMPEG, "-i", file_path]
    p = subprocess.run(cmd, capture_output=True, text=True)
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", p.stderr)
    if match:
        h, m, s = match.groups()
        return int(h) * 3600 + int(m) * 60 + float(s)
    return 30.0


def extract_wav(source_path: str, wav_path: str):
    """Extract mono 16kHz WAV for Whisper."""
    cmd = [
        FFMPEG, "-y",
        "-i", source_path,
        "-vn",
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        wav_path
    ]
    subprocess.run(cmd, capture_output=True, check=True)


from . import subtitle_service

def cards_to_words(cards: list) -> list:
    """Convert lyric cards to word-level entries for subtitle_service."""
    words = []
    for c in cards:
        text = str(c.get("text", "")).strip()
        tokens = text.split()
        if not tokens:
            continue
        c_start = float(c["start"])
        c_end = float(c["end"])
        if c_end <= c_start:
            c_end = c_start + 0.5
        c_dur = c_end - c_start

        if len(tokens) == 1:
            words.append({
                "word": tokens[0],
                "start": round(c_start, 3),
                "end": round(c_end, 3)
            })
        else:
            total_chars = sum(len(t) for t in tokens)
            cur_t = c_start
            for idx, t in enumerate(tokens):
                if idx == len(tokens) - 1:
                    w_end = c_end
                else:
                    share = (len(t) / max(1, total_chars)) * c_dur
                    w_end = cur_t + share
                words.append({
                    "word": t,
                    "start": round(cur_t, 3),
                    "end": round(w_end, 3)
                })
                cur_t = w_end
    return words


def transcribe_audio(wav_path: str, style: str = "karaoke", custom_lyrics: str = None):
    """
    Transcribe audio with Whisper and group into lyric cards.
    Groups 1 word for 1-word styles, 2 for twoword/impact, 3-4 for karaoke/clean/etc.
    """
    from faster_whisper import WhisperModel

    model = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=8)
    segments, info = model.transcribe(wav_path, word_timestamps=True, language="es", beam_size=1, vad_filter=True)

    raw_words = []
    for s in segments:
        for w in (s.words or []):
            cleaned = re.sub(r"[^\wáéíóúüñ']", "", w.word.strip(), flags=re.IGNORECASE)
            if cleaned:
                raw_words.append({
                    "word": cleaned.upper(),
                    "start": round(w.start, 2),
                    "end": round(w.end, 2)
                })

    cards = []
    if style in ("popup", "bounce", "big_center", "typewriter") or style.startswith("word_"):
        max_words_per_card = 1
    elif style in ("twoword", "impact"):
        max_words_per_card = 2
    else:
        max_words_per_card = 4

    i = 0
    while i < len(raw_words):
        chunk = raw_words[i:i + max_words_per_card]
        if not chunk:
            break
        text = " ".join(c["word"] for c in chunk)
        start_time = chunk[0]["start"]
        end_time = chunk[-1]["end"]
        # Ensure minimum duration so it doesn't flash too fast
        if end_time - start_time < 0.5:
            end_time = start_time + 0.5
        cards.append({
            "text": text,
            "start": round(start_time, 2),
            "end": round(end_time, 2)
        })
        i += len(chunk)

    return {
        "language": info.language,
        "cards": cards,
        "raw_words": raw_words
    }


def format_ass_time(seconds: float) -> str:
    """Format seconds into ASS H:MM:SS.cs"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds - int(seconds)) * 100))
    if cs >= 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def create_ass_subtitles(
    cards: list,
    output_ass_path: str,
    font_style: str = "karaoke",
    font_size: int = 80,
    subtitle_y: float = 0.0,
    size_scale: float = 1.0,
    duration: float = 30.0
):
    """Generate ASS subtitle file using either custom styles or any style in subtitle_service."""
    if font_style in ("impact", "slant"):
        if font_style == "slant":
            font_name = "Arial Black"
            italic = -1
            outline = 4
            shadow = 4
        else:
            font_name = "Impact"
            italic = 0
            outline = 4
            shadow = 3

        # Alignment=5 (center). Offset Y if specified
        margin_v = int(1920 * (subtitle_y or 0.0))

        header = f"""[Script Info]
Title: Lyric Edit
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{font_size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,{italic},0,0,100,100,1,0,1,{outline},{shadow},5,40,40,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        lines = [header]
        for card in cards:
            st = format_ass_time(card["start"])
            et = format_ass_time(card["end"])
            txt = card["text"].replace("\n", "\\N")
            lines.append(f"Dialogue: 0,{st},{et},Default,,0,0,0,,{txt}\n")

        with open(output_ass_path, "w", encoding="utf-8") as f:
            f.writelines(lines)
    else:
        # Full support for all styles in subtitle_service
        words = cards_to_words(cards)
        effective_scale = size_scale if size_scale != 1.0 else (font_size / 80.0)
        ass_path = subtitle_service.generate_ass_for_clip(
            transcript={"words": words},
            clip_start=0.0,
            clip_end=duration + 5.0,
            style=font_style,
            output_dir=OUTPUT_DIR,
            time_offset=0.0,
            size_scale=effective_scale,
            y_offset=subtitle_y or 0.0
        )
        if ass_path and os.path.exists(ass_path):
            import shutil
            shutil.copy2(ass_path, output_ass_path)
        else:
            # Fallback to impact
            create_ass_subtitles(cards, output_ass_path, font_style="impact", font_size=font_size, subtitle_y=subtitle_y)


def render_lyric_video(
    audio_path: str,
    clip_paths: list,
    cards: list,
    font_style: str = "karaoke",
    font_size: int = 80,
    subtitle_y: float = 0.0,
    size_scale: float = 1.0,
    start_trim: float = 0.0,
    end_trim: float = 0.0
) -> str:
    """
    Renders 1080x1920 video with centered multi-clip montage and burned ASS subtitles.
    Supports all subtitle styles (karaoke, popup, neon, 3d, glitch, retro, etc.).
    """
    total_audio_dur = get_media_duration(audio_path)
    if end_trim > start_trim and end_trim <= total_audio_dur:
        duration = end_trim - start_trim
    else:
        duration = total_audio_dur

    run_id = uuid.uuid4().hex[:8]
    ass_path = os.path.join(OUTPUT_DIR, f"lyrics_{run_id}.ass")
    out_mp4 = os.path.join(OUTPUT_DIR, f"lyric_edit_{run_id}.mp4")

    # Shift card timestamps if start_trim > 0
    shifted_cards = []
    for c in cards:
        ns = c["start"] - start_trim
        ne = c["end"] - start_trim
        if ne > 0 and ns < duration:
            shifted_cards.append({
                "text": c["text"],
                "start": max(0.0, ns),
                "end": min(duration, ne)
            })

    create_ass_subtitles(
        cards=shifted_cards,
        output_ass_path=ass_path,
        font_style=font_style,
        font_size=font_size,
        subtitle_y=subtitle_y,
        size_scale=size_scale,
        duration=duration
    )

    # Multi-clip logic
    if not clip_paths:
        # Default to stock clips
        clip_paths = [p["path"] for p in list_stock_clips() if p.get("exists")]

    n_clips = max(1, len(clip_paths))
    slice_dur = duration / n_clips

    inputs = [
        "-f", "lavfi", "-i", f"color=c=black:s=1080x1920:d={duration}:r=30"
    ]
    for cp in clip_paths:
        inputs.extend(["-stream_loop", "-1", "-i", cp])

    # Audio input
    if start_trim > 0 or end_trim > 0:
        inputs.extend(["-ss", str(start_trim), "-i", audio_path])
    else:
        inputs.extend(["-i", audio_path])

    audio_idx = len(clip_paths) + 1

    filter_parts = []
    concat_inputs = ""
    for i in range(1, len(clip_paths) + 1):
        filter_parts.append(
            f"[{i}:v]trim=start=0:end={slice_dur:.2f},setpts=PTS-STARTPTS,"
            f"scale=1080:608:force_original_aspect_ratio=increase,crop=1080:608,fps=30,setsar=1[v{i}];"
        )
        concat_inputs += f"[v{i}]"

    filter_parts.append(f"{concat_inputs}concat=n={len(clip_paths)}:v=1:a=0[center_v];")
    filter_parts.append("[0:v][center_v]overlay=x=0:y=656[vcomp];")

    escaped_ass = ass_path.replace("\\", "/").replace(":", "\\:")
    filter_parts.append(f"[vcomp]subtitles='{escaped_ass}'[vout]")

    filter_complex = "".join(filter_parts)

    cmd = [
        FFMPEG, "-y",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-map", f"{audio_idx}:a",
        "-t", str(duration),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        out_mp4
    ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg error: {res.stderr}")

    return out_mp4
