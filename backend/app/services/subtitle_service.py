"""
Subtitle service: generates ASS (Advanced SubStation Alpha) subtitle files
from Whisper word-level transcripts. Three styles are supported:

- "clean":   white text with thick black outline, 3-4 words per line
- "karaoke": TikTok-style word highlighting (current word in yellow)
- "popup":   one word at a time with bounce effect (MrBeast style)

The generated ASS file is burned into the exported video by FFmpeg via the
`subtitles=` filter.
"""
import os
import re
import uuid


# ASS color format: &HBBGGRR (alpha-blue-green-red, hex)
WHITE = "&H00FFFFFF"
YELLOW = "&H0000FFFF"
BLACK_BG = "&H00000000"
BLACK_OUTLINE = "&H00000000"


def _format_time(seconds: float) -> str:
    """ASS time format: H:MM:SS.cs (centiseconds)"""
    if seconds < 0:
        seconds = 0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds - int(seconds)) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _clean_word(word: str) -> str:
    """Strip punctuation and weird symbols. Keep letters, digits, apostrophes."""
    # Remove anything that isn't a letter, digit, apostrophe, or space
    cleaned = re.sub(r"[^\w\s']", '', word, flags=re.UNICODE)
    # Collapse multiple spaces
    cleaned = re.sub(r"\s+", ' ', cleaned).strip()
    return cleaned


def _ass_header(style: str, video_w: int = 1080, video_h: int = 1920) -> str:
    """Generate ASS header with the chosen visual style."""
    if style == "popup":
        font_size = 110
        outline = 8
        marginV = int(video_h * 0.45)
    elif style == "karaoke":
        font_size = 80
        outline = 6
        marginV = int(video_h * 0.30)
    elif style == "highlight":
        font_size = 78
        outline = 6
        marginV = int(video_h * 0.30)
    elif style == "big_center":
        font_size = 150
        outline = 10
        marginV = int(video_h * 0.45)
    elif style == "twoword":
        font_size = 100
        outline = 8
        marginV = int(video_h * 0.40)
    elif style == "bounce":
        font_size = 120
        outline = 9
        marginV = int(video_h * 0.40)
    elif style == "typewriter":
        font_size = 80
        outline = 6
        marginV = int(video_h * 0.30)
    else:  # clean
        font_size = 75
        outline = 5
        marginV = int(video_h * 0.30)

    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,{font_size},{WHITE},{YELLOW},{BLACK_OUTLINE},{BLACK_BG},-1,0,0,0,100,100,0,0,1,{outline},2,2,40,40,{marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _filter_words_for_clip(words: list, clip_start: float, clip_end: float) -> list:
    """Get words within the clip's time range, with timestamps relative to clip start.
    Words are returned in the same order as the original transcript and cleaned."""
    result = []
    for w in words:
        # Skip words completely outside the clip range
        if w["end"] < clip_start:
            continue
        if w["start"] > clip_end:
            break

        cleaned = _clean_word(w["word"])
        if not cleaned:
            continue  # Skip words that are pure punctuation

        # Shift timestamps to be relative to clip start
        rel_start = max(0.0, w["start"] - clip_start)
        rel_end = min(clip_end - clip_start, w["end"] - clip_start)
        if rel_end <= rel_start:
            continue

        result.append({
            "word": cleaned,
            "start": rel_start,
            "end": rel_end,
        })
    return result


def _escape_ass_text(text: str) -> str:
    """Escape special ASS characters."""
    return text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\n", "\\N")


def _generate_clean(words: list) -> str:
    """Group words into chunks of 3-4 and show each chunk for its full duration."""
    MAX_WORDS = 4
    events = []

    # Build chunks of MAX_WORDS each, in order
    for i in range(0, len(words), MAX_WORDS):
        chunk = words[i:i + MAX_WORDS]
        if not chunk:
            continue
        chunk_start = chunk[0]["start"]
        chunk_end = chunk[-1]["end"]
        text = " ".join(_escape_ass_text(c["word"].upper()) for c in chunk)
        events.append(
            f"Dialogue: 0,{_format_time(chunk_start)},{_format_time(chunk_end)},"
            f"Default,,0,0,0,,{text}"
        )

    return "\n".join(events)


def _generate_karaoke(words: list) -> str:
    """Show 3-4 words at a time, highlighting the current word in yellow.
    The whole group is visible from first word's start to last word's end —
    only the highlight color moves between words."""
    WORDS_PER_GROUP = 4
    events = []

    for gi in range(0, len(words), WORDS_PER_GROUP):
        group = words[gi:gi + WORDS_PER_GROUP]
        if not group:
            continue

        for idx, current in enumerate(group):
            # The dialogue for this word lasts from this word's start to the
            # next word's start (or to the last word's end if it's the last one)
            seg_start = current["start"]
            if idx < len(group) - 1:
                seg_end = group[idx + 1]["start"]
            else:
                seg_end = current["end"]

            if seg_end <= seg_start:
                continue

            # Render the whole group, with the current word in yellow + slightly bigger
            parts = []
            for j, w in enumerate(group):
                txt = _escape_ass_text(w["word"].upper())
                if j == idx:
                    parts.append(f"{{\\c{YELLOW}\\fscx112\\fscy112}}{txt}{{\\r}}")
                else:
                    parts.append(txt)
            line = " ".join(parts)
            events.append(
                f"Dialogue: 0,{_format_time(seg_start)},{_format_time(seg_end)},"
                f"Default,,0,0,0,,{line}"
            )

    return "\n".join(events)


def _generate_popup(words: list) -> str:
    """One word at a time, big and bold. Each word lasts from its start to the
    next word's start, so there are no visual gaps between words."""
    events = []
    n = len(words)
    for i, w in enumerate(words):
        text = _escape_ass_text(w["word"].upper())
        seg_start = w["start"]
        # Each word visible until the next word starts (no gaps)
        seg_end = words[i + 1]["start"] if i + 1 < n else w["end"]
        if seg_end <= seg_start:
            continue
        # Quick fade-in + slight bounce scale
        animated = f"{{\\fad(60,30)\\fscx80\\fscy80\\t(0,120,\\fscx108\\fscy108)\\t(120,180,\\fscx100\\fscy100)}}{text}"
        events.append(
            f"Dialogue: 0,{_format_time(seg_start)},{_format_time(seg_end)},"
            f"Default,,0,0,0,,{animated}"
        )
    return "\n".join(events)


def _generate_highlight_box(words: list) -> str:
    """Submagic-style: show 4 words per group, active word has a yellow 'box'
    effect simulated with a very thick yellow outline + black fill."""
    WORDS_PER_GROUP = 4
    events = []
    for gi in range(0, len(words), WORDS_PER_GROUP):
        group = words[gi:gi + WORDS_PER_GROUP]
        if not group:
            continue
        for idx, current in enumerate(group):
            seg_start = current["start"]
            seg_end = group[idx + 1]["start"] if idx < len(group) - 1 else current["end"]
            if seg_end <= seg_start:
                continue
            parts = []
            for j, w in enumerate(group):
                txt = _escape_ass_text(w["word"].upper())
                if j == idx:
                    # Active: black text inside a thick yellow "box" (simulated by large outline)
                    parts.append(f"{{\\1c&H000000&\\3c&H00FFFF&\\bord12}}{txt}{{\\r}}")
                else:
                    parts.append(txt)
            line = " ".join(parts)
            events.append(
                f"Dialogue: 0,{_format_time(seg_start)},{_format_time(seg_end)},"
                f"Default,,0,0,0,,{line}"
            )
    return "\n".join(events)


def _generate_big_center(words: list) -> str:
    """One giant word at the center of the screen. High impact for key moments."""
    events = []
    n = len(words)
    for i, w in enumerate(words):
        text = _escape_ass_text(w["word"].upper())
        seg_start = w["start"]
        seg_end = words[i + 1]["start"] if i + 1 < n else w["end"]
        if seg_end <= seg_start:
            continue
        # Fade-in/out with subtle pop scale
        animated = (
            f"{{\\fad(50,50)\\fscx85\\fscy85"
            f"\\t(0,100,\\fscx105\\fscy105)\\t(100,180,\\fscx100\\fscy100)}}{text}"
        )
        events.append(
            f"Dialogue: 0,{_format_time(seg_start)},{_format_time(seg_end)},"
            f"Default,,0,0,0,,{animated}"
        )
    return "\n".join(events)


def _generate_two_word(words: list) -> str:
    """Two words at a time — fast-paced rhythm popular in beat-driven clips."""
    events = []
    for gi in range(0, len(words), 2):
        pair = words[gi:gi + 2]
        if not pair:
            continue
        seg_start = pair[0]["start"]
        seg_end = pair[-1]["end"]
        text = " ".join(_escape_ass_text(w["word"].upper()) for w in pair)
        # Small fade for smoother transitions between pairs
        animated = f"{{\\fad(40,20)}}{text}"
        events.append(
            f"Dialogue: 0,{_format_time(seg_start)},{_format_time(seg_end)},"
            f"Default,,0,0,0,,{animated}"
        )
    return "\n".join(events)


def _generate_bounce(words: list) -> str:
    """One word at a time with a strong bounce-in animation."""
    events = []
    n = len(words)
    for i, w in enumerate(words):
        text = _escape_ass_text(w["word"].upper())
        seg_start = w["start"]
        seg_end = words[i + 1]["start"] if i + 1 < n else w["end"]
        if seg_end <= seg_start:
            continue
        # Strong bounce: start small, overshoot big, settle back
        animated = (
            f"{{\\fad(40,30)\\fscx40\\fscy40"
            f"\\t(0,150,\\fscx125\\fscy125)"
            f"\\t(150,250,\\fscx95\\fscy95)"
            f"\\t(250,330,\\fscx100\\fscy100)}}{text}"
        )
        events.append(
            f"Dialogue: 0,{_format_time(seg_start)},{_format_time(seg_end)},"
            f"Default,,0,0,0,,{animated}"
        )
    return "\n".join(events)


def _generate_typewriter(words: list) -> str:
    """Letters appear one at a time within each word, then the full word stays."""
    events = []
    n = len(words)
    for i, w in enumerate(words):
        text = _escape_ass_text(w["word"].upper())
        seg_start = w["start"]
        seg_end = words[i + 1]["start"] if i + 1 < n else w["end"]
        if seg_end <= seg_start or not text:
            continue
        word_duration = seg_end - seg_start
        # Spend ~40% of the word's duration revealing letters, then hold the full word
        reveal_total = max(0.08, min(0.4, word_duration * 0.4))
        per_letter = reveal_total / max(1, len(text))
        # Build partial-text events as each letter is added
        for letter_idx in range(1, len(text) + 1):
            sub_start = seg_start + (letter_idx - 1) * per_letter
            sub_end = seg_start + letter_idx * per_letter if letter_idx < len(text) else seg_end
            if sub_end <= sub_start:
                continue
            partial = text[:letter_idx]
            events.append(
                f"Dialogue: 0,{_format_time(sub_start)},{_format_time(sub_end)},"
                f"Default,,0,0,0,,{partial}"
            )
    return "\n".join(events)


def generate_ass_for_clip(
    transcript: dict,
    clip_start: float,
    clip_end: float,
    style: str,
    output_dir: str,
    time_offset: float = 0.0,
) -> str:
    """
    Generate an ASS subtitle file for a single clip.

    Args:
        transcript: Whisper transcript dict with 'words' key (word-level timestamps)
        clip_start: Clip start time (in original video seconds)
        clip_end: Clip end time
        style: "clean" | "karaoke" | "popup"
        output_dir: Directory to write the .ass file
        time_offset: Seconds to add to all subtitle timestamps. Used by the
            export pipeline which fast-seeks 4s before the clip then trims —
            without this offset subtitles appear during the trimmed buffer.

    Returns:
        Absolute path to the generated .ass file. Returns None if no words in range.
    """
    if not transcript or not transcript.get("words"):
        return None

    clip_words = _filter_words_for_clip(transcript["words"], clip_start, clip_end)
    if not clip_words:
        return None

    # Shift all word timestamps by the offset (compensates for fast-seek buffer)
    if time_offset > 0:
        for w in clip_words:
            w["start"] += time_offset
            w["end"] += time_offset

    header = _ass_header(style)

    if style == "karaoke":
        body = _generate_karaoke(clip_words)
    elif style == "popup":
        body = _generate_popup(clip_words)
    elif style == "highlight":
        body = _generate_highlight_box(clip_words)
    elif style == "big_center":
        body = _generate_big_center(clip_words)
    elif style == "twoword":
        body = _generate_two_word(clip_words)
    elif style == "bounce":
        body = _generate_bounce(clip_words)
    elif style == "typewriter":
        body = _generate_typewriter(clip_words)
    else:  # clean (default)
        body = _generate_clean(clip_words)

    content = header + body + "\n"

    os.makedirs(output_dir, exist_ok=True)
    ass_path = os.path.join(output_dir, f"subs_{uuid.uuid4().hex}.ass")
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(content)
    return ass_path
