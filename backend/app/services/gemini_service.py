import os
import math
import time
import json
import re
import subprocess
import uuid
from google import genai
from google.genai import types
from ..config import settings
from ..models.clip import ClipData
from . import prompts


# Video chunking thresholds (videos longer than this get split for analysis).
# Gemini 2.5 Flash handles ~1M tokens of video context (≈45 min of video) in a
# single call, so chunking is only needed for genuinely long content. Below
# 30 min we ship single-shot — that avoids: dedup loss across chunk boundaries,
# multiple API failure surfaces, FFmpeg re-encode time per chunk, and the
# "asked for 9, got 5" symptom from a single failed chunk.
CHUNK_THRESHOLD_SECONDS = 30 * 60   # 30 min — chunk only for genuinely long videos
CHUNK_DURATION_SECONDS = 15 * 60    # ~15 min per chunk (bigger chunks = fewer boundaries)

VIDEO_ANALYSIS_MODELS = {
    "gemini-3.5-flash",                  # paid only
    "gemini-3-flash-preview",            # free 20/day
    "gemini-3.1-pro-preview",            # paid only
    "gemini-3.1-flash-lite-preview",     # free
    "gemini-2.5-flash",                  # free 1500/day (recommended)
    "gemini-2.5-flash-lite",             # free 1000/day
    "gemini-2.5-pro",                    # free 50/day
}


# ── Gemini API key (editable at runtime from Ajustes) ──────────────────────
# The key comes from .env by default, but can be overridden from the UI; the
# override is persisted to runtime_config.json (gitignored) and survives restart.
_RUNTIME_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "runtime_config.json")


def _load_api_key() -> str:
    try:
        if os.path.exists(_RUNTIME_FILE):
            with open(_RUNTIME_FILE, encoding="utf-8") as f:
                k = (json.load(f) or {}).get("api_key")
                if k and k.strip():
                    return k.strip()
    except Exception as e:
        print(f"[gemini] failed to read runtime key: {e}")
    return settings.GOOGLE_API_KEY


current_api_key = _load_api_key()

# Initialize Gemini client
client = genai.Client(api_key=current_api_key)


def set_api_key(key: str) -> None:
    """Swap the Gemini API key at runtime (recreates the client) and persist it."""
    global client, current_api_key
    key = (key or "").strip()
    if not key:
        raise ValueError("Empty API key")
    current_api_key = key
    client = genai.Client(api_key=key)
    try:
        with open(_RUNTIME_FILE, "w", encoding="utf-8") as f:
            json.dump({"api_key": key}, f)
    except Exception as e:
        print(f"[gemini] failed to persist runtime key: {e}")


def masked_api_key() -> str:
    """A safe, masked preview of the active key (never expose the full key)."""
    k = current_api_key or ""
    if len(k) <= 8:
        return "·" * len(k)
    return f"{k[:4]}{'·' * 10}{k[-3:]}"


def upload_video(file_path: str):
    """Upload a video file to the Gemini File API."""
    file_upload = client.files.upload(file=file_path)
    return file_upload


def wait_for_processing(file_obj) -> object:
    """Wait for Gemini to finish processing the uploaded video."""
    while True:
        retrieved_file = client.files.get(name=file_obj.name)
        if retrieved_file.state == "ACTIVE":
            return retrieved_file
        elif retrieved_file.state == "FAILED":
            raise RuntimeError("Gemini video processing failed.")
        time.sleep(5)


def delete_file(file_obj) -> None:
    """Delete an uploaded file from Gemini storage to free quota."""
    try:
        client.files.delete(name=file_obj.name)
        print(f"[Gemini] Deleted file: {file_obj.name}")
    except Exception as e:
        print(f"[Gemini] Failed to delete file {file_obj.name} (ignoring): {e}")


def check_model_health(model: str) -> dict:
    """Run a tiny text request to see whether a Gemini model is reachable.
    This is only a light signal: video requests can still fail later due to
    higher token/capacity pressure.
    """
    if model not in VIDEO_ANALYSIS_MODELS:
        return {
            "model": model,
            "status": "invalid",
            "message": "Model is not in the app's allowed video model list.",
        }

    try:
        response = client.models.generate_content(
            model=model,
            contents="Respond with exactly: ok",
        )
        text = (getattr(response, "text", "") or "").strip()
        return {
            "model": model,
            "status": "ok",
            "message": text[:80] or "ok",
        }
    except Exception as e:
        status_code = getattr(e, "status_code", None)
        raw = str(e)
        lowered = raw.lower()
        if status_code == 429 or "resource_exhausted" in lowered or "quota" in lowered:
            status = "quota"
            message = "Quota exhausted or rate limited."
        elif status_code == 503 or "unavailable" in lowered or "high demand" in lowered:
            status = "unavailable"
            message = "Model is overloaded or temporarily unavailable."
        else:
            status = "error"
            message = raw[:240]
        return {
            "model": model,
            "status": status,
            "message": message,
        }


def build_chunk_ranges(video_duration: float, max_chunk_seconds: float = CHUNK_DURATION_SECONDS) -> list:
    """Split a video duration into (start, end) ranges of at most max_chunk_seconds each.
    Tries to balance chunks roughly evenly instead of leaving a tiny last chunk."""
    if video_duration <= 0:
        return [(0.0, 0.0)]
    n = max(1, math.ceil(video_duration / max_chunk_seconds))
    chunk_size = video_duration / n
    ranges = []
    for i in range(n):
        start = i * chunk_size
        end = (i + 1) * chunk_size if i < n - 1 else video_duration
        ranges.append((round(start, 2), round(end, 2)))
    return ranges


def extract_video_chunk(video_path: str, start: float, end: float, output_path: str,
                         accurate: bool = True) -> str:
    """Extract [start..end] from video_path into output_path.

    When `accurate=True` (default for analyze-range / Whisper transcription),
    uses output-side seek + re-encoding so the extracted file's first frame
    is EXACTLY at `start` — no keyframe-snap drift. Slower (~30s for 10 min
    of 1080p) but Whisper word timestamps line up perfectly with the audio
    you hear in preview/export.

    When `accurate=False`, uses fast stream copy (instant but snaps to nearest
    keyframe — drift of 0-3 seconds is possible).
    """
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    duration = end - start

    if accurate:
        # Output-side seek = decoded-frame-accurate cut. Re-encode is required.
        cmd = [
            ffmpeg, "-y",
            "-i", video_path,
            "-ss", str(start),
            "-t", str(duration),
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k",
            "-loglevel", "error",
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        if result.returncode == 0 and os.path.exists(output_path):
            return output_path
        # Fall through to stream copy if accurate re-encode fails for any reason

    # Fast path: stream copy (keyframe snap, no decoding)
    cmd = [
        ffmpeg, "-y",
        "-ss", str(start),
        "-i", video_path,
        "-t", str(duration),
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        "-loglevel", "error",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
    if result.returncode != 0 or not os.path.exists(output_path):
        # Last-resort fallback: re-encode with -ss before -i (still snap, but works on weird containers)
        cmd = [
            ffmpeg, "-y",
            "-ss", str(start),
            "-i", video_path,
            "-t", str(duration),
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
            "-c:a", "aac",
            "-loglevel", "error",
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        if result.returncode != 0:
            raise RuntimeError(f"Chunk extraction failed: {result.stderr[:300]}")
    return output_path


# Whitelist of safe emojis — must match Apple emoji set, verified to render
# correctly with Pilmoji. Captions are filtered against this list; anything
# outside it gets stripped.
SAFE_EMOJIS = {
    "💀", "😂", "🥺", "✨", "🔥", "❤️", "💪", "👀", "🤔",
    "❤️‍🩹", "😱", "😭", "💔", "🤯",
}


def restore_name_casing(text: str, creator_name: str) -> str:
    """After the lowercase rule, restore each creator name to its proper
    capitalization wherever it appears in the caption (case-insensitive match)."""
    if not text or not creator_name:
        return text
    names = [n.strip() for n in creator_name.split(",") if n.strip()]
    for name in names:
        # Replace any case-insensitive occurrence of the full name with the
        # properly-cased version. Word-boundary anchored so we don't touch
        # substrings inside other words.
        pattern = re.compile(re.escape(name), re.IGNORECASE)
        text = pattern.sub(name, text)
    return text


def filter_emojis_to_whitelist(text: str) -> str:
    """Strip any emoji not in SAFE_EMOJIS. Keeps whitespace and text intact."""
    if not text:
        return text
    # Match characters in emoji unicode ranges
    emoji_pattern = re.compile(
        r"[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F9FF]+"
        r"(?:‍[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F9FF️]+)*"
        r"️?"
    )
    def _check(m):
        candidate = m.group(0)
        return candidate if candidate in SAFE_EMOJIS else ""
    cleaned = emoji_pattern.sub(_check, text)
    # Collapse double spaces left by stripped emojis
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned


# Common English stop-words we ignore when matching captions to transcripts
_STOP_WORDS = set((
    "is the a an and to in on for of with but or so he she it they his her its "
    "their this that as at by are was were be been have has had do did does i "
    "me my we us our you your am pm just very much really still even still also "
    "no not get got go went going gonna wanna make made make want like said say "
    "tell told all out up off down too only own any some more most"
).split())


def validate_caption_against_transcript(caption: str, clip_start: float, clip_end: float, transcript: dict) -> tuple:
    """Compare a clip's caption against the Whisper transcript words within
    the clip's time range. Returns (transcript_snippet, confidence) where
    confidence is 'match' | 'mismatch' | 'no_audio'.

    - 'match'    → ≥40% of caption keywords appear in the transcript
    - 'mismatch' → caption has keywords but they're not in the transcript
    - 'no_audio' → Whisper detected no words at all in this range
    """
    if not transcript or not transcript.get("words"):
        return ("", "no_audio")

    # Gather words within the clip's time range
    range_words = []
    for w in transcript["words"]:
        if w.get("end", 0) < clip_start:
            continue
        if w.get("start", 0) > clip_end:
            break
        range_words.append(str(w.get("word", "")).strip())

    transcript_snippet = " ".join(w for w in range_words if w).strip()
    if not transcript_snippet:
        return ("", "no_audio")

    # Extract meaningful keywords from the caption
    caption_words = re.findall(r"[A-Za-z']+", (caption or "").lower())
    keywords = [w for w in caption_words if len(w) > 2 and w not in _STOP_WORDS]
    if not keywords:
        # Caption is all stop words / too short to validate — treat as match
        return (transcript_snippet, "match")

    transcript_lower = transcript_snippet.lower()
    matches = sum(1 for k in keywords if k in transcript_lower)
    ratio = matches / len(keywords)

    return (transcript_snippet, "match" if ratio >= 0.4 else "mismatch")


def _split_words_into_phrases(
    words: list[dict],
    gap_threshold: float = 0.4,
    max_words_per_phrase: int = 10,
) -> list[list[dict]]:
    """Group consecutive Whisper words into phrases so each phrase can be
    translated and time-aligned independently.

    Boundaries: any silence gap >= gap_threshold seconds between consecutive
    words OR `max_words_per_phrase` words reached, whichever comes first.

    Why: speech naturally has pauses at clause/sentence boundaries. Aligning
    Spanish words to phrase-sized windows (vs the WHOLE clip) collapses the
    "drift" caused by word-order differences and length mismatches between
    EN and ES from ~5–15s down to ~0.3–1s — Spanish words now land in the
    SAME time window as the equivalent English phrase, not somewhere else
    in the clip.
    """
    if not words:
        return []
    phrases: list[list[dict]] = []
    current: list[dict] = [words[0]]
    for w in words[1:]:
        try:
            gap = float(w.get("start", 0)) - float(current[-1].get("end", 0))
        except Exception:
            gap = 0.0
        if gap >= gap_threshold or len(current) >= max_words_per_phrase:
            phrases.append(current)
            current = [w]
        else:
            current.append(w)
    if current:
        phrases.append(current)
    return phrases


def _redistribute_phrase_timing(en_phrase: list[dict], es_tokens: list[str]) -> list[dict]:
    """Map a list of Spanish tokens onto the time window of an English phrase.

    Each Spanish token is given a slice of [phrase_start..phrase_end] weighted
    by character length so multi-syllable words get more on-screen time than
    short particles ("y", "es"). Returns list of {word, start, end} dicts.
    """
    if not es_tokens or not en_phrase:
        return []
    start = float(en_phrase[0].get("start", 0.0))
    end = float(en_phrase[-1].get("end", start))
    dur = max(0.01, end - start)
    weights = [max(1, len(t)) for t in es_tokens]
    total_w = sum(weights)
    out: list[dict] = []
    t = start
    for tok, w in zip(es_tokens, weights):
        seg = dur * (w / total_w)
        out.append({"word": tok, "start": round(t, 3), "end": round(t + seg, 3)})
        t += seg
    # Snap the last word's end to the phrase end (avoid float drift across
    # phrases — if every phrase ends slightly early, subs drift backward).
    out[-1]["end"] = round(end, 3)
    return out


def translate_clip_to_spanish(
    caption: str,
    words: list[dict],
    model: str = None,
) -> dict:
    """Translate a clip's English caption + Whisper word list to Spanish,
    aligning subtitle timing PHRASE-BY-PHRASE so Spanish subs stay close
    to the moment the equivalent English was actually spoken.

    Returns: { "caption_es": "...", "words_es": [{"word","start","end"}, ...] }

    How it stays in sync:
    1. Split Whisper words into phrases at silence gaps (>= 0.4s) or 10-word
       chunks via `_split_words_into_phrases`.
    2. ONE Gemini call sends all phrases as a parallel array and asks for a
       parallel Spanish array (same length, one ES phrase per EN phrase).
    3. For each ES phrase, redistribute time WITHIN the matching EN phrase's
       window. Spanish words can't drift outside their phrase's start/end.

    Fallback: if Gemini returns a mismatched phrase count (rare — usually
    means it ignored the structure), we treat the whole transcript as one
    bucket — that's the previous (worse but still working) behaviour, so
    we never produce zero subs.

    Returns {} on failure so the caller can fall back to the English version.
    """
    if not words:
        return {}

    target_model = (model or settings.GEMINI_MODEL).strip()
    # Drop empty Whisper tokens (Whisper sometimes emits "" for false detections).
    en_words = [w for w in words if str(w.get("word", "")).strip()]
    if not en_words:
        return {}

    en_phrases = _split_words_into_phrases(en_words)
    # Pre-serialize phrases as plain strings; we keep the timing on our side.
    en_phrase_strs = [" ".join(str(w.get("word", "")).strip() for w in p) for p in en_phrases]

    safe_emojis_str = " ".join(sorted(SAFE_EMOJIS))
    # NOTE the prompt asks for a PARALLEL array — same length, one ES phrase
    # per EN phrase. Empty ES strings allowed for phrases that translate to
    # nothing (e.g. filler-only phrases like "you know like uh").
    prompt_text = (
        "Translate the following English clip content to natural Latin-American Spanish.\n"
        "Return ONLY a JSON object with these EXACT keys, no other text:\n"
        '  { "caption_es": "<translated caption>", "phrases_es": ["<es phrase 1>", "<es phrase 2>", ...] }\n\n'
        "RULES for caption_es:\n"
        "- Max 20 words total.\n"
        "- No punctuation except apostrophes.\n"
        "- All lowercase EXCEPT the first letter of the caption.\n"
        "- Must end with EXACTLY ONE emoji from this whitelist (pick the most fitting one):\n"
        f"  {safe_emojis_str}\n"
        "- Keep proper names (people, brands) in their original spelling.\n"
        "- Natural-sounding Spanish, not literal word-for-word.\n\n"
        "RULES for phrases_es (CRITICAL — read carefully):\n"
        "- It is a PARALLEL array: same length as ENGLISH_PHRASES below, item i is the translation of EN phrase i.\n"
        "- DO NOT merge phrases. DO NOT split phrases. DO NOT reorder them.\n"
        "- If an English phrase is just filler (\"you know\", \"uh\", \"like\") the ES phrase can be an EMPTY string \"\" — preferred over inventing words.\n"
        "- No punctuation inside phrases (no commas, periods, ¿?, ¡!). Apostrophes OK.\n"
        "- Keep proper names as-is.\n"
        "- Each ES phrase should be the natural spoken equivalent of its EN phrase — don't pad to match word count.\n\n"
        f"ORIGINAL ENGLISH CAPTION:\n{caption}\n\n"
        "ENGLISH_PHRASES (translate each into the same index of phrases_es):\n"
        + json.dumps(en_phrase_strs, ensure_ascii=False)
    )

    try:
        response = client.models.generate_content(
            model=target_model,
            contents=prompt_text,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.5,    # lower temp → more parallel-array discipline
            ),
        )
        raw = (response.text or "").strip()
        if raw.startswith("```json"):
            raw = raw[7:]
        if raw.endswith("```"):
            raw = raw[:-3]
        data = json.loads(raw)
    except Exception as e:
        print(f"[Gemini] Spanish translation failed: {e}")
        return {}

    caption_es = str(data.get("caption_es", "")).strip()
    es_phrases_raw = data.get("phrases_es", None)

    # Normalize the caption the same way English captions are normalized.
    caption_es = caption_es.replace("’", "'").replace("‘", "'")
    caption_es = re.sub(r"\s+", " ", caption_es).strip()
    caption_es = filter_emojis_to_whitelist(caption_es)
    if caption_es:
        caption_es = caption_es[:1].upper() + caption_es[1:]

    words_es: list[dict] = []

    if isinstance(es_phrases_raw, list) and len(es_phrases_raw) == len(en_phrases):
        # Happy path: parallel arrays line up. Time-align each ES phrase
        # within its own EN phrase window.
        print(f"[Gemini] ES translation: phrase-aligned ({len(en_phrases)} phrases)")
        for en_phrase, es_text in zip(en_phrases, es_phrases_raw):
            es_str = str(es_text or "").strip()
            es_str = re.sub(r"[¿¡!?,.;:]+", "", es_str)
            es_tokens = [t for t in re.split(r"\s+", es_str) if t]
            words_es.extend(_redistribute_phrase_timing(en_phrase, es_tokens))
    else:
        # Fallback: Gemini ignored the structure. Treat the whole transcript
        # as one bucket — this is the older (less accurate) behaviour, but
        # still gives the user something to look at.
        es_blob = ""
        if isinstance(es_phrases_raw, list):
            es_blob = " ".join(str(x or "") for x in es_phrases_raw)
        elif isinstance(es_phrases_raw, str):
            es_blob = es_phrases_raw
        es_blob = re.sub(r"[¿¡!?,.;:]+", "", es_blob)
        es_tokens = [t for t in re.split(r"\s+", es_blob) if t]
        if es_tokens:
            print(f"[Gemini] ES translation: FALLBACK whole-clip alignment "
                  f"(expected {len(en_phrases)} phrases, got "
                  f"{len(es_phrases_raw) if isinstance(es_phrases_raw, list) else 'non-list'})")
            words_es = _redistribute_phrase_timing(en_words, es_tokens)

    return {"caption_es": caption_es, "words_es": words_es}


def filter_transcript_for_range(transcript: dict, start: float, end: float) -> dict:
    """Return a transcript dict containing only the words within [start..end],
    with timestamps shifted so the chunk starts at 0. Used when analyzing a chunk."""
    if not transcript or not transcript.get("words"):
        return transcript
    words_in_range = []
    for w in transcript["words"]:
        if w["end"] < start:
            continue
        if w["start"] > end:
            break
        words_in_range.append({
            "word": w["word"],
            "start": max(0.0, w["start"] - start),
            "end": max(0.0, w["end"] - start),
        })
    text_in_range = " ".join(w["word"].strip() for w in words_in_range)
    return {
        "text": text_in_range,
        "language": transcript.get("language", ""),
        "words": words_in_range,
    }


def count_tokens(file_obj) -> int:
    """Count tokens for an uploaded Gemini file. Returns 0 if it fails."""
    try:
        result = client.models.count_tokens(
            model=settings.GEMINI_MODEL,
            contents=[types.Content(role="user", parts=[
                types.Part.from_uri(file_uri=file_obj.uri, mime_type=file_obj.mime_type),
            ])]
        )
        total = result.total_tokens
        print(f"[Gemini] Token count: {total:,} / 1,048,576")
        return total
    except Exception as e:
        print(f"[Gemini] Token count failed (ignoring): {e}")
        return 0


def analyze_video(
    file_obj,
    video_duration: float,
    target_clips: int = 25,
    min_duration: int = 15,
    custom_prompt: str = "",
    start_time_offset: float = 0,
    transcript: dict = None,
    model: str = None,
    creator_name: str = "",
) -> list[ClipData]:
    """
    Use Gemini to analyze a video and identify viral clip candidates.
    
    Args:
        file_obj: Gemini file object (already processed)
        video_duration: Total video duration in seconds
        target_clips: Number of clips to find
        min_duration: Minimum clip duration in seconds
        custom_prompt: User's custom instruction for the AI
        start_time_offset: Start analysis from this timestamp
    
    Returns:
        List of ClipData objects
    """

    # Build the instruction line
    if custom_prompt.strip():
        instruction = custom_prompt.strip()
    else:
        instruction = prompts.get_text("default_instruction")

    # Build the creator-name guidance block (only if a name was provided)
    if creator_name and creator_name.strip():
        names = [n.strip() for n in creator_name.split(",") if n.strip()]
        names_list = ", ".join(names)
        creator_section = prompts.render("creator_section", NAMES_LIST=names_list)
    else:
        creator_section = ""

    # Build transcript section if available
    if transcript and transcript.get("words"):
        words_summary = " ".join(
            f"{w['word']}[{w['start']:.1f}s]" for w in transcript["words"]
        )
        words_summary = words_summary[:3000] + ("..." if len(words_summary) > 3000 else "")
        transcript_section = prompts.render(
            "transcript_section",
            LANGUAGE=transcript.get("language", "unknown"),
            FULL_TEXT=transcript.get("text", ""),
            WORDS_SUMMARY=words_summary,
        )
    else:
        transcript_section = ""

    system_prompt = prompts.render(
        "analysis_system",
        TARGET_CLIPS=target_clips,
        MIN_DURATION=min_duration,
        VIDEO_DURATION=video_duration,
        DUR_MIN=f"{video_duration/60:.1f}",
        THIRD1=f"{video_duration/3:.0f}",
        THIRD2=f"{video_duration*2/3:.0f}",
        VIDEO_DURATION_INT=f"{video_duration:.0f}",
        START_MAX=(video_duration - min_duration),
        INSTRUCTION=instruction,
        CREATOR_SECTION=creator_section,
        TRANSCRIPT_SECTION=transcript_section,
    )

    active_model = model or settings.GEMINI_MODEL
    print(f"[Gemini] Analyzing video: model={active_model}, duration={video_duration:.1f}s, target={target_clips} clips, min_duration={min_duration}s, transcript={'yes' if transcript else 'no'}")

    response = client.models.generate_content(
        model=active_model,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part.from_uri(
                        file_uri=file_obj.uri,
                        mime_type=file_obj.mime_type,
                    ),
                    types.Part.from_text(
                        text=f"Find {target_clips} viral clips in this video, starting from {start_time_offset} seconds onwards."
                    ),
                ],
            )
        ],
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
            temperature=0.85,
        ),
    )

    # Parse response
    if not response.text:
        raise RuntimeError("Gemini returned an empty response. Try again.")
    raw_text = response.text.strip()
    if raw_text.startswith("```json"):
        raw_text = raw_text[7:]
    if raw_text.endswith("```"):
        raw_text = raw_text[:-3]

    # Fix leading zeros in numbers
    raw_text = re.sub(r"\b0+(\d)", r"\1", raw_text)

    # Gemini occasionally emits JSON with unescaped quotes inside strings or
    # smart-quote characters. Try strict parse first; on failure, sanitize and
    # retry before giving up.
    try:
        clips_raw = json.loads(raw_text)
    except json.JSONDecodeError as e:
        print(f"[Gemini] Initial JSON parse failed at char {e.pos}: {e.msg}")
        print(f"[Gemini] Context around error: ...{raw_text[max(0,e.pos-60):e.pos+60]!r}...")
        sanitized = raw_text
        # Normalize smart/curly quotes to straight ones
        sanitized = (sanitized
                     .replace('“', '"').replace('”', '"')
                     .replace('‘', "'").replace('’', "'"))
        # Replace literal newlines inside strings with escaped \n
        # (heuristic: any raw newline inside a JSON string value)
        sanitized = re.sub(r'(?<!\\)\n(?=[^"]*"\s*[,}\]])', r'\\n', sanitized)
        # Strip trailing commas before } or ]
        sanitized = re.sub(r',(\s*[}\]])', r'\1', sanitized)
        try:
            clips_raw = json.loads(sanitized)
            print("[Gemini] Recovered after sanitization")
        except json.JSONDecodeError as e2:
            # Last resort: try to salvage what we can by truncating at the last
            # complete object before the error position.
            try:
                # Find the last `},` before the error position and cut+close array
                cutoff = raw_text.rfind('},', 0, e.pos)
                if cutoff > 0:
                    salvaged = raw_text[:cutoff + 1] + ']'
                    clips_raw = json.loads(salvaged)
                    print(f"[Gemini] Recovered {len(clips_raw)} clips by truncating at malformed entry")
                else:
                    raise e2
            except Exception:
                raise RuntimeError(
                    f"Gemini returned malformed JSON that couldn't be salvaged: {e.msg} "
                    f"at line {e.lineno} col {e.colno}. Try analyzing again."
                )

    print(f"[Gemini] min_duration={min_duration}, clips from Gemini: {len(clips_raw)}")

    def build_clips(clips_raw, video_duration, min_duration, existing_starts: list = []):
        clips = []
        skipped = 0
        # Seed deduplication with already-accepted starts so the retry pass
        # doesn't re-accept timestamps that were already taken in the first pass.
        accepted_starts = sorted(existing_starts)

        # Sort by start_time so deduplication is consistent
        sorted_raw = sorted(clips_raw, key=lambda c: float(c.get("start_time", 0)))

        for i, clip in enumerate(sorted_raw):
            start = float(clip.get("start_time", 0))
            end = float(clip.get("end_time", 0))
            original_duration = end - start

            # Skip clips that start beyond the video
            if start >= video_duration:
                print(f"[Gemini] Clip {i+1}: SKIPPED — start_time {start:.1f}s exceeds video duration {video_duration:.1f}s")
                skipped += 1
                continue

            # Clamp end_time to video duration
            if end > video_duration:
                end = video_duration

            # Enforce maximum duration of 60 seconds
            if end - start > 60:
                end = start + 60

            # Enforce minimum duration — extend end if too short
            if end - start < min_duration:
                end = start + min_duration
                if end > video_duration:
                    print(f"[Gemini] Clip {i+1}: SKIPPED — too close to end of video")
                    skipped += 1
                    continue

            # Deduplication: skip if too close to ANY already-accepted start
            too_close = any(abs(start - s) < min_duration for s in accepted_starts)
            if too_close:
                nearest = min(accepted_starts, key=lambda s: abs(start - s))
                print(f"[Gemini] Clip {i+1}: SKIPPED (duplicate) — starts {start:.1f}s, too close to accepted {nearest:.1f}s (gap < {min_duration}s)")
                skipped += 1
                continue

            accepted_starts.append(start)
            print(f"[Gemini] Clip {i+1}: {start:.1f}-{end:.1f} ({original_duration:.1f}s raw -> {end-start:.1f}s enforced)")

            caption = clip.get("viral_caption", "")
            # Normalize curly/smart apostrophes (U+2018, U+2019) to straight apostrophe
            caption = caption.replace('\u2019', "'").replace('\u2018', "'")
            # Strip punctuation but PRESERVE letters, digits, apostrophes, and emoji unicode
            # Emojis are kept by allowing characters in common emoji unicode ranges
            caption = re.sub(
                r"[^\w\s'\U0001F300-\U0001FAFF\U00002600-\U000027BF\u2700-\u27bf\u2600-\u26ff]",
                '', caption
            ).strip()
            # Remove extra spaces
            caption = re.sub(r'\s+', ' ', caption).strip()
            # Strip any emoji NOT on the whitelist — keeps only the safe set
            caption = filter_emojis_to_whitelist(caption)
            # All lowercase except first letter (only on the text portion, not emojis)
            if caption:
                # Split off trailing emoji so case-conversion doesn't break it
                import re as _re
                m = _re.match(r"^(.*?)(\s*[\U0001F300-\U0001FAFF\U00002600-\U000027BF]+)?\s*$", caption)
                if m:
                    text_part, emoji_part = m.group(1) or "", m.group(2) or ""
                    text_part = text_part[:1].upper() + text_part[1:].lower()
                    # Restore creator-name capitalization (lost by .lower())
                    text_part = restore_name_casing(text_part, creator_name)
                    caption = (text_part + emoji_part).strip()

            clips.append(ClipData(
                id=len(clips) + 1,
                start_time=start,
                end_time=end,
                description=clip.get("description", "clip"),
                viral_caption=caption,
                viral_reason=clip.get("viral_reason", ""),
                viral_score=max(1, min(10, int(clip.get("viral_score", 5)))),
                viral_score_reason=clip.get("viral_score_reason", ""),
                ig_description=clip.get("ig_description", ""),
            ))
        return clips, skipped

    clips, skipped = build_clips(clips_raw, video_duration, min_duration)

    # Truncate to requested count if Gemini returned more than asked
    if len(clips) > target_clips:
        print(f"[Gemini] Truncating {len(clips)} clips to requested {target_clips}")
        clips = clips[:target_clips]
        skipped = 0  # Don't retry if we already have enough

    # If Gemini gave invalid clips, retry once asking for exactly the missing amount
    if skipped > 0:
        print(f"[Gemini] {skipped} clips were out of range. Retrying to get {skipped} more valid clips...")
        retry_response = client.models.generate_content(
            model=active_model,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_uri(
                            file_uri=file_obj.uri,
                            mime_type=file_obj.mime_type,
                        ),
                        types.Part.from_text(
                            text=(
                                f"Find {skipped} more viral clips in this video. "
                                f"CRITICAL: The video is EXACTLY {video_duration:.1f} seconds long. "
                                f"ALL timestamps MUST be between 0 and {video_duration:.1f}. "
                                f"Do NOT repeat clips already found near these timestamps: "
                                f"{[f'{c.start_time:.0f}-{c.end_time:.0f}' for c in clips]}. "
                                f"Return ONLY a raw JSON list."
                            )
                        ),
                    ],
                )
            ],
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                response_mime_type="application/json",
                temperature=0.7,
            ),
        )
        try:
            retry_text = retry_response.text.strip()
            if retry_text.startswith("```json"):
                retry_text = retry_text[7:]
            if retry_text.endswith("```"):
                retry_text = retry_text[:-3]
            retry_text = re.sub(r"\b0+(\d)", r"\1", retry_text)
            retry_raw = json.loads(retry_text)
            retry_clips, _ = build_clips(retry_raw, video_duration, min_duration,
                                          existing_starts=[c.start_time for c in clips])
            # Renumber and append
            for c in retry_clips:
                c.id = len(clips) + 1
                clips.append(c)
            print(f"[Gemini] Retry gave {len(retry_clips)} valid clips. Total: {len(clips)}")
        except Exception as e:
            print(f"[Gemini] Retry failed (ignoring): {e}")

    # Truncate again after retry in case it returned too many
    if len(clips) > target_clips:
        print(f"[Gemini] Post-retry truncating {len(clips)} clips to {target_clips}")
        clips = clips[:target_clips]

    # If still under target, fill remaining slots with duplicate clips (different captions)
    if len(clips) < target_clips:
        still_needed = target_clips - len(clips)
        print(f"[Gemini] Only {len(clips)} unique clips found. Generating {still_needed} alternate-caption duplicates...")
        clips = _fill_with_alternates(file_obj, clips, still_needed, system_prompt)

    return clips


def _verify_clip_timestamps(file_obj, clips: list, video_duration: float, min_duration: int) -> list:
    """Ask Gemini to verify each clip's timestamp actually matches its caption/description.
    Returns corrected list — invalid clips are dropped, wrong timestamps are fixed."""
    if not clips:
        return clips

    clips_info = "\n".join([
        f'  {{"id": {c.id}, "start_time": {c.start_time:.1f}, "end_time": {c.end_time:.1f}, "caption": "{c.viral_caption}", "description": "{c.description}"}}'
        for c in clips
    ])

    print(f"[Gemini] Verifying timestamps for {len(clips)} clips...")

    try:
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[types.Content(role="user", parts=[
                types.Part.from_uri(file_uri=file_obj.uri, mime_type=file_obj.mime_type),
                types.Part.from_text(text=prompts.render(
                    "verify_timestamps",
                    CLIPS_INFO=clips_info,
                    VIDEO_DURATION=f"{video_duration:.1f}",
                )),
            ])],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )

        raw = response.text.strip()
        if raw.startswith("```json"):
            raw = raw[7:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = re.sub(r"\b0+(\d)", r"\1", raw)
        verified = json.loads(raw)

        # Build lookup by id
        verified_by_id = {int(v.get("id", -1)): v for v in verified}

        corrected_clips = []
        for clip in clips:
            v = verified_by_id.get(clip.id)
            if v is None:
                # Not in response — keep original
                corrected_clips.append(clip)
                continue
            if not v.get("valid", True):
                print(f"[Gemini] Clip {clip.id} INVALID — dropping: {clip.viral_caption!r}")
                continue
            if v.get("corrected", False):
                new_start = float(v.get("start_time", clip.start_time))
                new_end = float(v.get("end_time", clip.end_time))
                # Validate corrected timestamps
                if new_start < video_duration and new_end <= video_duration and (new_end - new_start) >= min_duration:
                    print(f"[Gemini] Clip {clip.id} CORRECTED: {clip.start_time:.1f}-{clip.end_time:.1f} → {new_start:.1f}-{new_end:.1f}")
                    clip.start_time = new_start
                    clip.end_time = new_end
                else:
                    print(f"[Gemini] Clip {clip.id} correction invalid, keeping original timestamps")
            corrected_clips.append(clip)

        print(f"[Gemini] Verification done: {len(corrected_clips)}/{len(clips)} clips passed")
        return corrected_clips

    except Exception as e:
        print(f"[Gemini] Verification failed (keeping original clips): {e}")
        return clips


def _fill_with_alternates(file_obj, clips: list, needed: int, system_prompt: str) -> list:
    """Fill remaining slots by reusing best clips with alternative captions."""
    if not clips or needed <= 0:
        return clips

    # Pick the best clips to duplicate (cycle through them)
    best = sorted(clips, key=lambda c: len(c.viral_reason or ""), reverse=True)
    targets = [best[i % len(best)] for i in range(needed)]

    # Ask Gemini for alternative captions for these clips
    clips_info = "\n".join([
        f"- Clip at {c.start_time:.1f}s-{c.end_time:.1f}s (current caption: \"{c.viral_caption}\")"
        for c in targets
    ])

    try:
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[types.Content(role="user", parts=[
                types.Part.from_uri(file_uri=file_obj.uri, mime_type=file_obj.mime_type),
                types.Part.from_text(text=prompts.render(
                    "alternate_captions", CLIPS_INFO=clips_info, NEEDED=needed,
                )),
            ])],
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                response_mime_type="application/json",
                temperature=1.0,
            ),
        )

        raw = response.text.strip()
        if raw.startswith("```json"):
            raw = raw[7:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = re.sub(r"\b0+(\d)", r"\1", raw)
        alt_data = json.loads(raw)

        # Build lookup by start_time so order doesn't matter
        alt_by_start = {float(a.get("start_time", -1)): a for a in alt_data}

        for i in range(min(needed, len(targets))):
            orig = targets[i]
            # Try to match by start_time first, fall back to array index
            alt = alt_by_start.get(orig.start_time) or (alt_data[i] if i < len(alt_data) else {})
            caption = alt.get("viral_caption", orig.viral_caption)
            caption = caption.replace('\u2019', "'").replace('\u2018', "'")
            caption = re.sub(r"[^\w\s']", '', caption).strip()
            caption = re.sub(r'\s+', ' ', caption).strip()
            caption = caption[:1].upper() + caption[1:].lower() if caption else caption

            new_clip = ClipData(
                id=len(clips) + 1,
                start_time=orig.start_time,
                end_time=orig.end_time,
                description=orig.description + " (alt)",
                viral_caption=caption,
                viral_reason=orig.viral_reason,
                ig_description=orig.ig_description,
            )
            clips.append(new_clip)
            print(f"[Gemini] Alt clip {new_clip.id}: {orig.start_time:.1f}s reused with new caption: {caption!r}")

    except Exception as e:
        print(f"[Gemini] Alt caption generation failed, using originals as fallback: {e}")
        for i in range(needed):
            orig = targets[i]
            new_clip = ClipData(
                id=len(clips) + 1,
                start_time=orig.start_time,
                end_time=orig.end_time,
                description=orig.description + " (alt)",
                viral_caption=orig.viral_caption,
                viral_reason=orig.viral_reason,
                ig_description=orig.ig_description,
            )
            clips.append(new_clip)

    return clips
