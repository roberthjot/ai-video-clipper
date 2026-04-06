from pydantic import BaseModel
from typing import Optional


class ClipData(BaseModel):
    """A single clip identified by the AI."""
    id: int
    start_time: float
    end_time: float
    description: str
    viral_caption: str
    viral_reason: str
    viral_score: int = 5        # 1-10 viral potential score from AI
    viral_score_reason: str = ""  # Short reason for the score
    ig_description: str = ""   # Long Instagram post caption (3-4 paragraphs + hashtags)
    duration: float = 0.0

    def model_post_init(self, __context):
        if self.duration == 0.0:
            self.duration = self.end_time - self.start_time


class StyleConfig(BaseModel):
    """Visual style configuration for export."""
    # Text overlay
    text_x: float = 0.5        # 0-1 relative position (center)
    text_y: float = 0.15       # 0-1 relative position (near top)
    font_size: int = 70        # Larger font for better readability
    font_family: str = "Arial"
    text_color: str = "#FFFFFF"
    text_stroke_color: str = "#000000"
    text_stroke_width: int = 5  # Thicker stroke for better visibility

    # Video fill mode: "fit" = fill width (full video visible), "fill" = fill full frame (sides crop)
    fill_mode: str = "fit"

    # IG-specific fill mode (independent from TikTok fill_mode)
    ig_fill_mode: str = "fit"
    ig_top_padding: int = 130  # pixels from top to caption text in IG preview
    ig_watermark_y: float = 0.85  # IG-specific watermark Y position (0-1 relative to video zone)

    # Watermark
    watermark_path: Optional[str] = None
    watermark_x: float = 0.5   # 0-1 relative position (center)
    watermark_y: float = 0.85  # 0-1 relative position (near bottom)
    watermark_scale: float = 0.8  # 0-1 scale
    watermark_opacity: float = 0.9  # 0-1 opacity

    # Split-screen (video top + image bottom)
    split_screen_enabled: bool = False
    split_image_path: Optional[str] = None
    split_ratio: float = 0.5  # fraction of canvas height for video (0.3-0.7)

    # Caption style: "box" = white rounded box (default), "tiktok" = white text + black outline
    caption_style: str = "box"

    # Anti-detect / uniquify (export only, not applied to preview)
    strip_metadata: bool = False
    flip_horizontal: bool = False
    zoom_uniquify: bool = False   # zoom +2% to break fingerprint
    boost_contrast: bool = False  # subtle eq boost


class ProjectConfig(BaseModel):
    """Configuration for a clip extraction project."""
    video_filename: str
    clip_count: int = 25
    min_duration: int = 15
    custom_prompt: str = ""
    start_time: float = 0
    duration_override: Optional[float] = None


class ExportRequest(BaseModel):
    """Request to export clips with style."""
    project_id: str
    style: StyleConfig
    clip_ids: Optional[list[int]] = None  # None = export all


# ─── Live Stream Models ───────────────────────────────────────────────────────

class StreamSegment(BaseModel):
    """One recorded segment from a live stream."""
    index: int
    file_path: str = ""
    status: str = "pending"   # recording | ready | skipped | failed
    error: str = ""
    duration_recorded: float = 0.0
    started_at: str = ""      # ISO timestamp when recording started


class StreamSession(BaseModel):
    """A live stream clipping session."""
    session_id: str
    url: str
    platform: str = ""        # "twitch" | "kick" | "other"
    segment_minutes: int = 10
    clips_per_segment: int = 5
    resolution: str = "720p"
    start_offset_minutes: int = 0
    status: str = "idle"      # starting | recording | stopping | stopped | error
    error: str = ""
    segments: list[StreamSegment] = []
    created_at: str = ""


class StreamStartRequest(BaseModel):
    """Request body to start a stream session."""
    url: str
    segment_minutes: int = 10
    clips_per_segment: int = 5
    resolution: str = "720p"  # "480p" | "720p" | "1080p"
    start_offset_minutes: int = 0  # Rewind N minutes before recording starts
