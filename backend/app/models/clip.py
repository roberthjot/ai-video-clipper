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
    # Transition INTO this segment from the previous one. The first segment's
    # transition_in is ignored (nothing to transition from). "cut" / "" / "none"
    # = hard cut (default, current behaviour). Any other value is an FFmpeg
    # xfade transition name: fade, fadeblack, fadewhite, slideleft, slideright,
    # slideup, slidedown, circleopen, circleclose, dissolve, pixelize, radial,
    # wipeleft, wiperight, zoomin, smoothleft, smoothright, ...
    transition_in: str = "cut"
    transition_duration: float = 0.4   # seconds (clamped to half of both neighbours at render)


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


class VideoOverlay(BaseModel):
    """A video (B-roll) painted on top of the main video for a time range.

    Mirrors ImageOverlay's position/scale/timing model and adds:
    - broll_in / broll_out: which slice of the B-roll source plays (in B-roll
      seconds, not output seconds). broll_out=0 means "play to the end".
    - audio_mode: what to do with the B-roll's audio track during overlay.
        "mute"    -> drop it (default, simplest)
        "mix"     -> amix at 50% with the main audio while the overlay is on
        "replace" -> swap original with B-roll audio during overlay (v2; not
                     wired in the filter chain yet — falls back to "mix")
    Same canvas-relative coordinate system as ImageOverlay (0..1 of 1080×1920).
    """
    path: str                       # server path to the uploaded mp4
    x: float = 0.80                 # default top-right corner
    y: float = 0.18
    scale: float = 0.30             # width as fraction of canvas width
    opacity: float = 1.0
    start: float = 0.0              # output seconds: when it appears
    end: float = 99999.0            # output seconds: when it disappears
    broll_in: float = 0.0           # B-roll seconds: where its playback starts
    broll_out: float = 0.0          # B-roll seconds: 0 = until natural end
    audio_mode: str = "mute"        # "mute" | "mix" | "replace"


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

    # Per-clip style override (editor "Aplicar a: Este clip / Varios"). When
    # present, preview + export use THIS instead of the project-wide style.
    # None = inherit the project style (default).
    style_override: Optional["StyleConfig"] = None

    # Spanish translation cache. Populated by the "Generar versión en español"
    # button. Empty = not translated yet. When export runs with language="es"
    # it uses caption_es as the PIL caption text and words_es as the transcript
    # passed to subtitle generation. Keeps the English export untouched.
    caption_es: str = ""
    words_es: list[dict] = []

    # Auto-reframe / face-tracking cache. Populated by POST /analyze-faces.
    # Empty dict = not analyzed yet. Shape mirrors face_track_service.analyze_clip:
    #   { fps, width, height, start_time, end_time,
    #     samples: [{t, faces: [{id, x, y, w, h, confidence}]}],
    #     people:  [{id, first_t, thumb_t, thumb_box, appearance_count}] }
    # The trajectory itself is recomputed on demand from face_track + mode/follow_face_id
    # (cheap math, no need to cache) so the user can switch modes without re-analyzing.
    face_track: dict = {}

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

    # Background music (editor audio track). Mixed in as a post-step on export.
    music_path: str | None = None       # server path to the uploaded audio file
    music_volume: float = 0.8           # 0..2 — music track gain
    original_volume: float = 1.0        # 0..2 — original video audio gain
    # Music trim — which SLICE of the source music file to use. start in
    # seconds from the music's natural beginning; end=0 means "play to the
    # natural end". Useful when the user wants a specific drop / chorus and
    # not the silent intro. mix_music_track applies these as atrim+asetpts.
    music_start: float = 0.0
    music_end: float = 0.0

    # Master toggle: skip caption + burned-in subtitles entirely (clean video)
    no_text: bool = False

    # Strip emojis from captions at render time (caption data is preserved,
    # only the displayed text loses the emoji). Independent of no_text.
    no_emojis: bool = False

    # Caption font choice (key in video_service.FONT_MAP). Trebuchet Bold =
    # the rounded CapCut-ish look for the white box.
    caption_font: str = "trebuchet"

    # White-box appearance controls (caption_style == "box"), CapCut-like.
    caption_box_radius: float = 0.40    # 0 = square corners, 1 = pill
    caption_box_opacity: float = 0.95   # 0-1 box fill opacity
    caption_box_color: str = "#FFFFFF"  # box fill color
    caption_box_pad_x: int = 30         # horizontal padding (Width — grows box sideways)
    caption_box_pad_y: int = 6          # per-line vertical padding (Height — grows step zone)

    # Image overlays (editor mode) — images painted on top of the video for a
    # time range. Empty by default. Burned in at export.
    image_overlays: list[ImageOverlay] = []

    # Video overlays (B-roll picture-in-picture). Same position/timing model
    # as image_overlays but each entry is an MP4 with a sub-range (broll_in /
    # broll_out) and an audio mode. Burned in at export — see
    # export_service for the filter chain.
    video_overlays: list[VideoOverlay] = []

    # Auto-reframe (face-tracking). When enabled, the export pipeline replaces
    # the static fg crop with a dynamic crop window that follows the face
    # trajectory computed from clip.face_track. Off by default — must be
    # explicitly enabled per clip from the editor's "🎯 Auto-encuadre" panel.
    # Incompatible with split_screen (both stack vertical regions); the UI
    # blocks both being on simultaneously.
    auto_reframe_enabled: bool = False
    auto_reframe_mode: str = "all"          # "all" | "biggest" | "follow"
    auto_reframe_follow_id: int | None = None   # face id when mode=="follow"
    auto_reframe_padding: float = 0.30      # 0..1 — headroom around faces
    auto_reframe_smoothing: float = 0.85    # 0..0.99 — EMA factor (higher = smoother camera)

    # Anti-detect / uniquify (export only, not applied to preview)
    strip_metadata: bool = False
    flip_horizontal: bool = False
    zoom_uniquify: bool = False   # zoom +2% to break fingerprint
    boost_contrast: bool = False  # subtle eq boost

    # Cyclic mirror: hflip toggles ON for N seconds, then OFF for N seconds,
    # repeating. Breaks perceptual hashing without leaving text/UI mirrored
    # the whole time. Only the FG video flips — captions / watermark / subs
    # are overlaid AFTER and stay normal.
    mirror_cyclic_enabled: bool = False
    mirror_cyclic_interval: float = 5.0   # seconds; 1.0–10.0 sensible range

    # Sway: foreground video drifts side-to-side following a sine curve.
    # Period = seconds for one full back-and-forth, amplitude = max pixel
    # offset from center. Captions stay fixed.
    sway_enabled: bool = False
    sway_period: float = 3.0      # seconds per full cycle
    sway_amplitude: int = 40      # pixels of horizontal offset


# Resolve ClipData's forward reference to StyleConfig (defined above this line).
ClipData.model_rebuild()


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
    # VOD / single-shot mode (downloads a specific HH:MM:SS slice with -c copy,
    # no re-encode, no looping). When set, segment_minutes / start_offset_minutes
    # are ignored.
    is_vod: bool = False                 # auto-set when URL contains /videos/
    single_shot: bool = False            # record one slice then stop
    start_offset_seconds: int = 0        # exact seek into the stream / VOD
    duration_seconds: int = 0            # 0 = no override, use segment_minutes * 60
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
    start_offset_minutes: int = 0  # Rewind N minutes before recording starts (live)
    # VOD / single-shot mode
    single_shot: bool = False
    start_offset_seconds: int = 0
    duration_seconds: int = 0
