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


# Video chunking thresholds (videos longer than this get split for analysis)
CHUNK_THRESHOLD_SECONDS = 10 * 60   # 10 min
CHUNK_DURATION_SECONDS = 10 * 60    # ~10 min per chunk


# Initialize Gemini client
client = genai.Client(api_key=settings.GOOGLE_API_KEY)


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


def extract_video_chunk(video_path: str, start: float, end: float, output_path: str) -> str:
    """Extract [start..end] from video_path into output_path using FFmpeg stream copy
    (no re-encoding — fast, no quality loss)."""
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    duration = end - start
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
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if result.returncode != 0 or not os.path.exists(output_path):
        # Stream copy can fail on some containers — fall back to re-encoding
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
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
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
        instruction = (
            "Scan the ENTIRE video from start to finish — every second. Pick the moments that will make someone stop scrolling instantly. "
            "Prioritize: shocking reveals, explosive arguments, emotional breakdowns, unexpected plot twists, "
            "hilarious reactions, jaw-dropping confessions, and intense confrontations. "
            "Skip boring transitions, slow dialogue, or anything that wouldn't hook someone in the first 2 seconds. "
            "Each clip must start at the PEAK of the moment — not before it builds up."
        )

    system_prompt = f"""
    You are the #1 viral video editor on TikTok with 10 years of experience creating content that gets hundreds of millions of views.
    Your job is to watch this video and extract the {target_clips} most explosive, attention-grabbing clips that will go viral on TikTok, Reels, and Shorts.

    Target Audience: USA (English speakers).
    Platform: TikTok / Instagram Reels / YouTube Shorts.

    YOUR GOAL: Find exactly {target_clips} clips. Each clip MUST be at least {min_duration} seconds long.
    Scan the ENTIRE video from start to finish — do not miss moments in the second half.

    DISTRIBUTION RULE (CRITICAL): Your {target_clips} clips MUST be spread across the full {video_duration/60:.1f} minutes.
    - First third (0s to {video_duration/3:.0f}s): find clips here
    - Middle third ({video_duration/3:.0f}s to {video_duration*2/3:.0f}s): find clips here
    - Last third ({video_duration*2/3:.0f}s to {video_duration:.0f}s): find clips here
    Do NOT return more than 40% of clips from the first third alone.

    WHAT MAKES A CLIP GO VIRAL:
    - Hooks viewers in the first 2 seconds — starts at the peak of the action
    - Creates an emotional reaction: shock, laughter, tears, anger, or disbelief
    - Has a clear story arc even in a short clip
    - Makes people want to comment, share, or watch again
    - Feels like something people have never seen before

    WHAT TO AVOID:
    - Slow build-ups or boring introductions
    - Clips that need context from earlier in the video
    - Dead air, silence, or transitions

    INSTRUCTION: {instruction}

    CAPTION RULES (CRITICAL):
    - Write in THIRD PERSON only (e.g. "She finally told the truth" not "I told the truth")
    - NO first person: no "I", "me", "my", "we"
    - Maximum 15 words — short, punchy, scroll-stopping
    - Write like a fan account teasing the drama
    - NO punctuation of any kind: no periods, no commas, no exclamation marks, no question marks
    - Apostrophes in contractions ARE allowed: he's, she's, don't, can't, won't, it's, that's, they're — use them naturally
    - All lowercase EXCEPT the very first letter of the caption
    - END with EXACTLY ONE emoji that matches the emotion of the moment (TikTok style).
      You MUST pick the emoji from THIS EXACT LIST — no other emojis are allowed:
        💀 😂 🥺 ✨ 🔥 ❤️ 💪 👀 🤔 ❤️‍🩹 😱 😭 💔 🤯
      Match the emoji to the moment's emotion:
        * Drama / shock / mind-blown → 😱 🤯 💀 👀
        * Funny / "I'm dead" → 😂 💀
        * Motivational / "fire" / strong → 🔥 💪 ✨
        * Sad / crying / heartbreak → 😭 💔 🥺 ❤️‍🩹
        * Love / wholesome → ❤️ ✨
        * Suspicious / thinking / watching → 👀 🤔
      Place the emoji at the very end after a space. ONLY ONE emoji per caption.
      DO NOT use any emoji that is not in the list above.

    Output Format:
    Return ONLY a raw JSON list. No markdown, no ```json, no explanation — just the JSON array.
    Each object must have:
    - "start_time": (float) Start time in seconds.
    - "end_time": (float) End time in seconds.
    - "description": (string) 3-5 word label for the clip (English).
    - "viral_caption": (string) Short punchy overlay text. MAX 15 words. No punctuation.
    - "viral_reason": (string) One sentence explaining the viral potential.
    - "viral_score": (int) A score from 1 to 10 rating the viral potential of this clip. 10 = guaranteed viral, 1 = boring. Be honest and vary the scores.
    - "viral_score_reason": (string) One short phrase (max 6 words) explaining the score. Examples: "Strong emotional hook", "Slow build-up", "Unexpected twist ending", "Weak payoff".
    - "ig_description": (string) A long Instagram post caption for this clip. Follow these rules:
        * First, try to identify the creator's name from audio, text on screen, or context in the video. If identified, use their real name naturally throughout.
        * Write 3-4 paragraphs in English. Start with a hook sentence about this specific moment.
        * Paragraph 1: Describe what happens in this clip and why it's a standout moment.
        * Paragraph 2: Provide context about the creator — who they are, what they're known for, what makes them interesting.
        * Paragraph 3: Why this moment resonates with fans / what the audience reaction will be.
        * End with 12-15 highly relevant hashtags on a new line (mix of niche and broad tags).
        * Tone: enthusiastic fan account, third person, admiring but not over-the-top. No emojis.

    TIMESTAMP RULES (CRITICAL):
    1. Use simple decimal numbers only (e.g. 10.5). NO leading zeros.
    2. Clip duration MUST be between {min_duration} and 60 seconds. Vary the durations — not all clips the same length.
    3. The video is EXACTLY {video_duration} seconds long ({video_duration/60:.1f} minutes).
       - "start_time" MUST be less than {video_duration - min_duration}.
       - "end_time" MUST be less than or equal to {video_duration}.
       - Clips beyond {video_duration} seconds DO NOT EXIST and will be rejected.

    TIMESTAMP ACCURACY (EXTREMELY IMPORTANT):
    Before writing each clip's start_time and end_time, STOP and ask yourself:
    - "If I seek to exactly this second in the video, will I see THIS specific moment?"
    - "Am I 100% sure this timestamp is NOT from a different topic or segment?"
    - "Does the viral_caption describe EXACTLY what happens at these seconds — not what happens elsewhere?"
    A caption about person X MUST have timestamps where person X actually appears.
    A caption about topic Y MUST have timestamps where topic Y is actually discussed.
    NEVER assign a caption from one moment to the timestamps of a different moment.
    When in doubt about a timestamp, skip that clip entirely.
    __TRANSCRIPT_SECTION__
    """

    # Build transcript section if available
    if transcript and transcript.get("words"):
        words_summary = " ".join(
            f"{w['word']}[{w['start']:.1f}s]" for w in transcript["words"]
        )
        transcript_section = f"""
    AUDIO TRANSCRIPT WITH EXACT TIMESTAMPS (USE THESE FOR ACCURACY):
    Language detected: {transcript.get('language', 'unknown')}
    Full text: {transcript.get('text', '')}
    Word-level timestamps: {words_summary[:3000]}{"..." if len(words_summary) > 3000 else ""}

    CRITICAL: The word timestamps above are 100% accurate. When you identify a viral moment,
    use the word timestamps to set start_time and end_time precisely.
    Start the clip 0.2s BEFORE the first relevant word. End it 0.3s AFTER the last relevant word.
    """
    else:
        transcript_section = ""

    system_prompt = system_prompt.replace("__TRANSCRIPT_SECTION__", transcript_section)

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

    clips_raw = json.loads(raw_text)

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
                types.Part.from_text(text=(
                    f"You previously identified these clips from this video:\n[\n{clips_info}\n]\n\n"
                    f"For EACH clip, seek to its start_time and verify:\n"
                    f"1. Does the video content at that timestamp actually match the caption and description?\n"
                    f"2. If NOT, find the CORRECT start_time and end_time where that caption/description actually occurs.\n"
                    f"3. If the content described in the caption does NOT exist anywhere in the video, mark it invalid.\n\n"
                    f"Return ONLY a raw JSON array. Each object must have:\n"
                    f"- \"id\": (int) the clip id\n"
                    f"- \"valid\": (bool) true if content matches OR was corrected, false if content doesn't exist in video\n"
                    f"- \"start_time\": (float) correct start time in seconds\n"
                    f"- \"end_time\": (float) correct end time in seconds\n"
                    f"- \"corrected\": (bool) true if you changed the timestamps\n"
                    f"The video is {video_duration:.1f} seconds long. All timestamps must be within this range."
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
                types.Part.from_text(text=(
                    f"For each clip listed below, write ONE alternative viral caption that approaches "
                    f"the moment from a DIFFERENT angle than the current caption.\n"
                    f"Each new caption must feel fresh — different wording, different emotion, different hook.\n\n"
                    f"{clips_info}\n\n"
                    f"Return ONLY a raw JSON array where each object has:\n"
                    f"- \"start_time\": (float) same start time as the clip\n"
                    f"- \"viral_caption\": (string) NEW caption, max 10 words, no punctuation except apostrophes, "
                    f"all lowercase except first letter\n"
                    f"Return exactly {needed} objects."
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
