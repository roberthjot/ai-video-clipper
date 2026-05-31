from pydantic import BaseModel
from typing import Optional
from .clip import ClipData, StyleConfig
import time


class Project(BaseModel):
    """Represents a video processing project/session."""
    id: str
    video_filename: str
    video_path: str
    clip_count: int
    min_duration: int
    custom_prompt: str = ""
    creator_name: str = ""  # comma-separated names to weave into captions/titles
    status: str = "created"  # created, uploading, analyzing, ready, exporting, done
    clips: list[ClipData] = []
    style: StyleConfig = StyleConfig()
    video_duration: float = 0.0
    created_at: float = 0.0
    output_dir: str = ""
    token_count: int = 0
    transcript: Optional[dict] = None  # Whisper transcript with word-level timestamps
    gemini_model: str = "gemini-2.5-flash"  # which Gemini model to use for analysis
    analyze_start: float = 0.0  # seconds — start of analysis window (0 = from beginning)
    analyze_duration: float = 0.0  # seconds — length of window (0 = analyze to end)

    def model_post_init(self, __context):
        if self.created_at == 0.0:
            self.created_at = time.time()
