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
import uuid


# ASS color format: &HBBGGRR (alpha-blue-green-red, hex)
WHITE = "&H00FFFFFF"
YELLOW = "&H0000FFFF"
BLACK_BG = "&H00000000"
BLACK_OUTLINE = "&H00000000"


def _format_time(seconds: float) -> str:
    """ASS time format: H:MM:SS.cs (centiseconds)"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds - int(seconds)) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_header(style: str, video_w: int = 1080, video_h: int = 1920) -> str:
    """Generate ASS header with the chosen visual style."""
    if style == "popup":
        # Big bold single-word style
        font_size = 110
        outline = 8
        marginV = int(video_h * 0.45)  # near vertical center
    elif style == "karaoke":
        # 3-5 words per line, current word highlighted
        font_size = 80
        outline = 6
        marginV = int(video_h * 0.30)  # lower third area
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
Style: Highlight,Arial Black,{font_size},{YELLOW},{YELLOW},{BLACK_OUTLINE},{BLACK_BG},-1,0,0,0,100,100,0,0,1,{outline},2,2,40,40,{marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _filter_words_for_clip(words: list, clip_start: float, clip_end: float) -> list:
    """Get words within the clip's time range, with timestamps relative to clip start."""
    result = []
    for w in words:
        if w["end"] < clip_start:
            continue
        if w["start"] > clip_end:
            break
        # Clip the word to the clip range and shift to relative time
        rel_start = max(0.0, w["start"] - clip_start)
        rel_end = min(clip_end - clip_start, w["end"] - clip_start)
        if rel_end <= rel_start:
            continue
        result.append({
            "word": w["word"].strip(),
            "start": rel_start,
            "end": rel_end,
        })
    return result


def _escape_ass_text(text: str) -> str:
    """Escape special ASS characters."""
    return text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\n", "\\N")


def _generate_clean(words: list) -> str:
    """Group words into lines of 3-4 words and show each line for its duration."""
    lines = []
    chunk = []
    chunk_start = None
    MAX_WORDS = 4

    for w in words:
        if chunk_start is None:
            chunk_start = w["start"]
        chunk.append(w)
        # Flush chunk on punctuation or word count limit
        is_long_pause = (len(chunk) >= 2 and
                         w == chunk[-1] and
                         len(words) > words.index(w) + 1 and
                         words[words.index(w) + 1]["start"] - w["end"] > 0.3)
        if len(chunk) >= MAX_WORDS or is_long_pause:
            text = " ".join(c["word"] for c in chunk).upper()
            lines.append({
                "start": chunk_start,
                "end": chunk[-1]["end"],
                "text": _escape_ass_text(text),
            })
            chunk = []
            chunk_start = None

    if chunk:
        text = " ".join(c["word"] for c in chunk).upper()
        lines.append({
            "start": chunk_start,
            "end": chunk[-1]["end"],
            "text": _escape_ass_text(text),
        })

    events = []
    for line in lines:
        events.append(
            f"Dialogue: 0,{_format_time(line['start'])},{_format_time(line['end'])},"
            f"Default,,0,0,0,,{line['text']}"
        )
    return "\n".join(events)


def _generate_karaoke(words: list) -> str:
    """Show 3-5 words at a time with the current word highlighted in yellow."""
    WORDS_PER_GROUP = 4
    events = []

    # Group words into chunks
    groups = []
    for i in range(0, len(words), WORDS_PER_GROUP):
        groups.append(words[i:i + WORDS_PER_GROUP])

    for group in groups:
        if not group:
            continue
        group_start = group[0]["start"]
        group_end = group[-1]["end"]

        # For each word in group, render the whole group with current word highlighted
        for idx, word in enumerate(group):
            parts = []
            for j, w in enumerate(group):
                text = _escape_ass_text(w["word"].upper())
                if j == idx:
                    # Highlighted word — yellow + slightly bigger via \fscx/\fscy
                    parts.append(f"{{\\c{YELLOW}\\fscx110\\fscy110}}{text}{{\\r}}")
                else:
                    parts.append(text)
            line = " ".join(parts)
            events.append(
                f"Dialogue: 0,{_format_time(word['start'])},{_format_time(word['end'])},"
                f"Default,,0,0,0,,{line}"
            )

    return "\n".join(events)


def _generate_popup(words: list) -> str:
    """One word at a time, big and bold with a bounce-in effect."""
    events = []
    for w in words:
        text = _escape_ass_text(w["word"].upper())
        # \fad(80,40) = fade-in 80ms, fade-out 40ms
        # \t(0,150,\fscx100\fscy100) = scale up from initial size for bounce
        animated = f"{{\\fad(60,30)\\fscx80\\fscy80\\t(0,120,\\fscx105\\fscy105)\\t(120,180,\\fscx100\\fscy100)}}{text}"
        events.append(
            f"Dialogue: 0,{_format_time(w['start'])},{_format_time(w['end'])},"
            f"Default,,0,0,0,,{animated}"
        )
    return "\n".join(events)


def generate_ass_for_clip(
    transcript: dict,
    clip_start: float,
    clip_end: float,
    style: str,
    output_dir: str,
) -> str:
    """
    Generate an ASS subtitle file for a single clip.

    Args:
        transcript: Whisper transcript dict with 'words' key (word-level timestamps)
        clip_start: Clip start time (in original video seconds)
        clip_end: Clip end time
        style: "clean" | "karaoke" | "popup"
        output_dir: Directory to write the .ass file

    Returns:
        Absolute path to the generated .ass file. Returns None if no words in range.
    """
    if not transcript or not transcript.get("words"):
        return None

    clip_words = _filter_words_for_clip(transcript["words"], clip_start, clip_end)
    if not clip_words:
        return None

    header = _ass_header(style)

    if style == "karaoke":
        body = _generate_karaoke(clip_words)
    elif style == "popup":
        body = _generate_popup(clip_words)
    else:  # clean (default)
        body = _generate_clean(clip_words)

    content = header + body + "\n"

    os.makedirs(output_dir, exist_ok=True)
    ass_path = os.path.join(output_dir, f"subs_{uuid.uuid4().hex}.ass")
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(content)
    return ass_path
