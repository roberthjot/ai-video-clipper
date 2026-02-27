import time
import json
import re
from google import genai
from google.genai import types
from ..config import settings
from ..models.clip import ClipData


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
            "Scan the ENTIRE video from start to finish. Pick only the moments that will make someone stop scrolling instantly. "
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

    WHAT MAKES A CLIP GO VIRAL:
    - Hooks viewers in the first 2 seconds — starts at the peak of the action
    - Creates an emotional reaction: shock, laughter, tears, anger, or disbelief
    - Has a clear story arc even in a short clip
    - Makes people want to comment, share, or watch again
    - Feels like something people have never seen before

    WHAT TO AVOID:
    - Slow build-ups or boring introductions
    - Clips that need context from earlier in the video
    - Repetitive or similar moments — each clip must be UNIQUE
    - Dead air, silence, or transitions

    INSTRUCTION: {instruction}

    CAPTION RULES (CRITICAL):
    - Write in THIRD PERSON only (e.g. "She finally told the truth" not "I told the truth")
    - NO first person: no "I", "me", "my", "we"
    - Maximum 10 words — short, punchy, scroll-stopping
    - Write like a fan account teasing the drama
    - NO punctuation of any kind: no periods, no commas, no exclamation marks, no question marks
    - Apostrophes in contractions ARE allowed: he's, she's, don't, can't, won't, it's, that's, they're — use them naturally
    - All lowercase EXCEPT the very first letter of the caption

    Output Format:
    Return ONLY a raw JSON list. No markdown, no ```json, no explanation — just the JSON array.
    Each object must have:
    - "start_time": (float) Start time in seconds.
    - "end_time": (float) End time in seconds.
    - "description": (string) 3-5 word label for the clip (English).
    - "viral_caption": (string) Short punchy overlay text. MAX 10 words. No punctuation.
    - "viral_reason": (string) One sentence explaining the viral potential.

    TIMESTAMP RULES (CRITICAL):
    1. Use simple decimal numbers only (e.g. 10.5). NO leading zeros.
    2. Clip duration MUST be between {min_duration} and 60 seconds. Vary the durations — not all clips the same length.
    3. The video is EXACTLY {video_duration} seconds long ({video_duration/60:.1f} minutes).
       - "start_time" MUST be less than {video_duration - min_duration}.
       - "end_time" MUST be less than or equal to {video_duration}.
       - Clips beyond {video_duration} seconds DO NOT EXIST and will be rejected.
    """

    print(f"[Gemini] Analyzing video: duration={video_duration:.1f}s, target={target_clips} clips, min_duration={min_duration}s")

    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
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

    def build_clips(clips_raw, video_duration, min_duration):
        clips = []
        skipped = 0
        last_accepted_start = -9999.0  # For deduplication

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

            # Deduplication: skip if too close to the last accepted clip
            if start - last_accepted_start < min_duration:
                print(f"[Gemini] Clip {i+1}: SKIPPED (duplicate) — starts {start:.1f}s, last accepted at {last_accepted_start:.1f}s (gap < {min_duration}s)")
                skipped += 1
                continue

            last_accepted_start = start
            print(f"[Gemini] Clip {i+1}: {start:.1f}-{end:.1f} ({original_duration:.1f}s raw -> {end-start:.1f}s enforced)")

            caption = clip.get("viral_caption", "")
            # Normalize curly/smart apostrophes (U+2018, U+2019) to straight apostrophe
            caption = caption.replace('\u2019', "'").replace('\u2018', "'")
            # Remove punctuation/symbols but keep apostrophes (for contractions like he's, don't)
            caption = re.sub(r"[^\w\s']", '', caption).strip()
            # Remove extra spaces
            caption = re.sub(r'\s+', ' ', caption).strip()
            # All lowercase except first letter
            caption = caption[:1].upper() + caption[1:].lower() if caption else caption

            clips.append(ClipData(
                id=len(clips) + 1,
                start_time=start,
                end_time=end,
                description=clip.get("description", "clip"),
                viral_caption=caption,
                viral_reason=clip.get("viral_reason", ""),
            ))
        return clips, skipped

    clips, skipped = build_clips(clips_raw, video_duration, min_duration)

    # If Gemini gave invalid clips, retry once asking for exactly the missing amount
    if skipped > 0:
        print(f"[Gemini] {skipped} clips were out of range. Retrying to get {skipped} more valid clips...")
        retry_response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
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
            retry_clips, _ = build_clips(retry_raw, video_duration, min_duration)
            # Renumber and append
            for c in retry_clips:
                c.id = len(clips) + 1
                clips.append(c)
            print(f"[Gemini] Retry gave {len(retry_clips)} valid clips. Total: {len(clips)}")
        except Exception as e:
            print(f"[Gemini] Retry failed (ignoring): {e}")

    return clips
