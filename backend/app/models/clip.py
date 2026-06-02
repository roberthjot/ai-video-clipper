from pydantic import BaseModel
from typing import Optional


class Segment(BaseModel):
    """One kept piece of the source video, in ORIGINAL-video seconds.

    A clip's final output is the concatenation of its segments in order.
    Empty segments list on a ClipData means "single range" (legacy):
    use start_time/end_time. Non-empty means the user cut the clip up in
    the timeline editor and we concat the kept pieces.

    A segment can also be an IMAGE clip (type="image"): a still shown
    full-screen for `duration` output seconds, spliced into the timeline.
    """
    start: float
    end: float
    speed: float = 1.0                  # 0.25–4.0; 2.0 = 2x faster (video only)
    type: str = "video"                # "video" | "image"
    image_path: Optional[str] = None   # source image when type == "image"
    duration: float = 0.0              # image clip length in output seconds


class ImageOverlay(BaseModel):
    """An image painted on top of the video for a time range (output seconds).

    Positions are relative to the 1080×1920 canvas so they survive any preview
    scaling. start/end are in the FINAL output timeline (after cuts).
    """
    path: str                  # server path to the uploaded image
    x: float = 0.5             # center X, 0-1 of canvas width
    y: float = 0.4             # center Y, 0-1 of canvas height
    scale: float = 0.4         # width as fraction of canvas width
    start: float = 0.0         # show from (output seconds)
    end: float = 99999.0       # show until (output seconds)
    opacity: float = 1.0       # 0-1


class Keyframe(BaseModel):
    """A single keyframe on the per-clip animation timeline.

    Time is RELATIVE to the clip start (0 = first frame of the trimmed clip),
    so keyframes survive trim changes without manual recomputation.
    Values are the same shape as the static edit_* transform.
    Linear interpolation between consecutive keyframes; the first/last value
    is held outside the keyframe range.
    """
    time: float                    # seconds from clip start (0 = clip start)
    zoom: float = 1.0              # 1.0–3.0 (keyframes use zoompan → no zoom-out below 1)
    pan_x: float = 0.0             # -100 to +100 (% of available pan range)
    pan_y: float = 0.0


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
    # Caption validation against Whisper transcript
    transcript_snippet: str = ""           # what Whisper heard in this clip's range
    match_confidence: str = "unverified"   # "match" | "mismatch" | "no_audio" | "unverified"
    # Per-clip transform (set by the in-app editor modal)
    edit_zoom: float = 1.0          # 1.0 = no zoom, 2.0 = 2x
    edit_pan_x: float = 0.0         # -50 to +50 (% of frame width)
    edit_pan_y: float = 0.0         # -50 to +50 (% of frame height)
    # Keyframe animation — if non-empty, OVERRIDES the static edit_* values
    # above. Empty list = static mode (current behaviour). Non-empty list =
    # animated mode (FFmpeg uses zoompan with expressions built from these).
    keyframes: list[Keyframe] = []

    # Timeline editor cuts — if non-empty, the clip output is the concatenation
    # of these segments (in original-video seconds). Empty = single range
    # defined by start_time/end_time. Lets the user remove boring middles.
    segments: list[Segment] = []

    def model_post_init(self, __context):
        if self.duration == 0.0:
            self.duration = self.end_time - self.start_time

    def effective_segments(self) -> list[tuple]:
        """Return the list of (start, end) pieces this clip exports, in order.

        Single-range clips return one tuple from start_time/end_time so callers
        can treat both modes uniformly.
        """
        if self.segments:
            return [(s.start, s.end) for s in self.segments]
        return [(self.start_time, self.end_time)]

    def total_duration(self) -> float:
        """Sum of all kept segments (the final output length)."""
        return sum(max(0.0, e - s) for s, e in self.effective_segments())


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

    # Output aspect ratio: "9:16" (default, TikTok), "1:1", "16:9", "4:5"
    aspect_ratio: str = "9:16"

    # Video fill mode: "fit" = fill width (full video visible), "fill" = fill full frame (sides crop)
    fill_mode: str = "fit"

    # Global multiplier on top of fill_mode (0.5–1.5, default 1.0 = no-op).
    # Lets the user fine-tune the video size beyond the 6 named presets — e.g.
    # "Medium but a little bigger". Applied in addition to per-clip edit_zoom.
    fill_mode_scale: float = 1.0

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

    # Subtitle style (burned into video on export): "none" | "clean" | "karaoke" | "popup"
    subtitle_style: str = "none"

    # Subtitle text size multiplier (0.6 - 1.6, default 1.0)
    subtitle_size_scale: float = 1.0

    # Subtitle vertical offset — additive relative to the style's default
    # marginV. Range -0.5 (down half the canvas) to +0.5 (up half the canvas).
    # 0.0 = use the style's hardcoded default (clean=30% from bottom, etc.)
    subtitle_y: float = 0.0

    # Cinematic visual filter: "none" | "cinematic" | "warm" | "vivid" | "moody" | "bw"
    visual_filter: str = "none"

    # Background style behind the video: "blur" (current default) or "black" (solid)
    background_style: str = "blur"

    # Master toggle: skip caption + burned-in subtitles entirely (clean video)
    no_text: bool = False

    # Strip emojis from captions at render time (caption data is preserved,
    # only the displayed text loses the emoji). Independent of no_text.
    no_emojis: bool = False

    # Caption font choice (key in video_service.FONT_MAP). Default keeps Calibri.
    caption_font: str = "calibri"

    # Image overlays (editor mode) — images painted on top of the video for a
    # time range. Empty by default. Burned in at export.
    image_overlays: list[ImageOverlay] = []

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
