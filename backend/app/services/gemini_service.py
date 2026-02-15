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
            "Focus on EVERYTHING viral-worthy. Drama, emotions, funny moments, "
            "confessions, or intensity. Prioritize clips with high viral potential. "
            "Duration is flexible — longer clips are encouraged if the moment is worth it."
        )

    system_prompt = f"""
    You are an expert viral video editor specializing in TikTok content for an immense American audience. 
    Your task is to watch the entire video provided and identify the BEST {target_clips} clips that have the highest potential to go viral.
    
    Target Audience: USA (English).
    Platform: TikTok / Reels / Shorts.
    
    Goal: Identify exactly {target_clips} clips.
    Constraint: Each clip MUST be at least {min_duration} seconds long.
    
    INSTRUCTION: {instruction}
    
    IMPORTANT - CAPTION STYLE:
    - The captions MUST be in **THIRD PERSON** (e.g., "She bought a car", "Look at her reaction").
    - DO NOT use "I", "Me", "My", or "POV: You...".
    - Write as if you are a fan account reporting on the creator.
    
    Output Format:
    Return ONLY a raw JSON list of objects. Do not include markdown formatting (like ```json).
    Each object must have:
    - "start_time": (float) Start time in seconds.
    - "end_time": (float) End time in seconds.
    - "description": (string) A very short 3-5 word label for the clip (English).
    - "viral_caption": (string) A descriptive, engaging text for the video overlay (English). Length: 15-30 words.
    - "viral_reason": (string) A brief explanation of why this specific clip has viral potential.
    
    IMPORTANT:
    1. Timestamps MUST be simple numbers (e.g. 10.5). Do NOT use leading zeros.
    2. Duration of each clip MUST be > {min_duration} seconds. LONG clips (up to 90s) are allowed and encouraged if the viral moment requires it.
    3. ABSOLUTE LIMIT: The video is approximately {video_duration} seconds long.
       - Focus your search from {start_time_offset} seconds to {video_duration} seconds.
       - ALL "start_time" and "end_time" MUST be less than {video_duration}.
    """

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
    raw_text = response.text.strip()
    if raw_text.startswith("```json"):
        raw_text = raw_text[7:]
    if raw_text.endswith("```"):
        raw_text = raw_text[:-3]

    # Fix leading zeros in numbers
    raw_text = re.sub(r"\b0+(\d)", r"\1", raw_text)

    clips_raw = json.loads(raw_text)

    clips = []
    for i, clip in enumerate(clips_raw):
        clips.append(
            ClipData(
                id=i + 1,
                start_time=float(clip.get("start_time", 0)),
                end_time=float(clip.get("end_time", 0)),
                description=clip.get("description", "clip"),
                viral_caption=clip.get("viral_caption", ""),
                viral_reason=clip.get("viral_reason", ""),
            )
        )

    return clips
