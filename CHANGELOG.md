# Changelog

All notable changes to this project will be documented in this file.

## [v9.6] - 2026-03-18

### Added
- **Medium fill mode for Video Format (TikTok)**: New `Medium` button in Video Format alongside Fit · Zoom · Fill · Small. Uses the same 65% scale as IG Medium (`scale=-2:{int(H*0.65)}`). Added to `generate_preview_frame`, `generate_preview_clip`, and `export_service.py`.
- **Text X position slider in clip editor**: Move caption text left/right (0%–100% of canvas width). Default 50% (centered). Applied across preview frame, preview clip, and export.
- **Font size slider in clip editor**: Adjust caption font size from 30px to 120px (default 72px). Applied across all preview and export functions.

### Fixed
- **Medium fill_mode was ignored in TikTok preview**: `medium` fell into the `else` case in `generate_preview_clip` and `generate_preview_frame`, behaving identically to `fit`. Now correctly applies `scale=-2:{int(target_h*0.65)}`.
- **Removed TikTok preview button**: Reverted accidental addition of a 🎵 TikTok preview button that was not requested.

---

## [v9.5.1] - 2026-03-18

### Added (Meme Generator improvements)
- **Font size slider** per meme card: Adjust from 40px to 180px (default 80px). Changing font size resets the video offset to 0 (auto-position).
- **Text X slider**: Move meme text left/right (0%–90% of canvas). Default 5% (left-aligned). Pixel-width-based wrapping recalculates automatically based on available width from X position to right edge.
- **Text Y slider**: Move meme text up/down (0%–70% of canvas). Default 5%.
- **Video offset slider**: Fine-tune video vertical position ±400px from the auto-calculated center. Resets to 0 when font size or text Y changes.
- **Video scale slider**: Adjust video width from 40% to 100% of canvas (default 90%).
- **Re-export button per card**: After generating, each meme shows sliders. "Re-exportar con estos ajustes" re-runs only FFmpeg (no Gemini call) with the new settings. Cache-busting `?t=` param refreshes the video preview.
- **Sentence case formatting**: Gemini meme text is now formatted with only the first letter capitalized, rest lowercase. Applied in the backend after Gemini response.
- **Max 12 words**: Meme text capped at 12 words total (down from 24). Truncated after generation.
- **Left-aligned text default**: Text defaults to left-aligned starting from `text_x * W`. Lines wrap pixel-by-pixel to stay within the canvas right edge.
- **Re-export endpoint**: `POST /api/meme/reexport/{batch_id}/{index}` — re-runs export with new `text_y`, `video_y`, `text_x`, `font_size`, `video_scale` params (no Gemini).

### Fixed
- **Meme video not centered**: Video was centered in full 1920px canvas regardless of text height. Fixed to center in the zone below the text (from `text_bottom_y + padding` to canvas bottom).
- **Background forced to 1080×1920**: Added explicit `scale=1080:1920,setsar=1[bg]` step in FFmpeg filter to prevent output inheriting video source dimensions.
- **Text overflow when X > 0**: `_wrap_text(max_chars=26)` didn't account for reduced width when text starts mid-canvas. Replaced with `_wrap_text_px(font, max_width)` that measures actual pixel width per line.

---

## [v9.5] - 2026-03-18

### Added
- **Meme Generator mode**: Third mode button (😂 Meme Generator) in the header, completely independent from Video Clipper and Live Stream.
- **Multi-video upload**: Drag-and-drop or file picker supports up to ~20 short videos at once.
- **Gemini meme text generation**: For each video, Gemini watches the full video and generates the funniest, most relatable English meme text (max 3 short lines, no hashtags, no emojis, punchy and shareable). `temperature=1.0` for creativity.
- **Background color selector**: Choose black or white background for the meme canvas.
- **Full-video meme export**: Each video is exported as-is (no cuts, no timestamps) overlaid on a 1080×1920 canvas. Meme text in Calibri Bold appears at top; full video centered below in the remaining zone.
- **Batch processing**: Videos processed sequentially in a background thread — upload → Gemini analysis → text generation → FFmpeg export. Status polling every 2s.
- **Per-item download**: Each finished meme shows its generated text and a ⬇ Descargar button.
- **New backend files**: `backend/app/services/meme_service.py`, `backend/app/routes/meme.py`
- **New API endpoints**: `POST /api/meme/process`, `GET /api/meme/status/{batch_id}`, `GET /api/meme/download/{batch_id}/{index}`, `POST /api/meme/reexport/{batch_id}/{index}`

---

## [v9.4] - 2026-03-18

### Added
- **IG Description per clip**: Gemini now generates a long Instagram post caption for each clip alongside the short TikTok overlay caption. The description is 3-4 paragraphs + 12-15 hashtags, written in the style of a fan account. Gemini tries to identify the creator's name from audio, on-screen text, or video context and uses it naturally throughout. Included in `clips_info.txt` under each clip as "IG Description".
- **`ig_description` field in `ClipData`**: New field stores the long IG caption per clip.

---

## [v9.3] - 2026-03-18

### Fixed
- **Duplicate clips from Gemini retry**: `build_clips()` now accepts an `existing_starts` parameter. When the retry call runs (to fill skipped/invalid clips), it passes the already-accepted start times from the first pass. Deduplication now checks against ALL accepted starts (`any(abs(start - s) < min_duration ...)`), not just the last one in sequence. This prevented cases like Clip 2 (1:47) and Clip 22 (1:47) — identical timestamps that slipped through because the retry started with a fresh `last_accepted_start = -9999`.

---

## [v9.2] - 2026-03-15

### Added
- **Live Stream Clipper mode**: New mode toggle at the top of the UI switches between Video Clipper and Live Stream Clipper.
- **Twitch & Kick recording**: Paste any Twitch or Kick stream URL — `streamlink` resolves the HLS URL automatically, FFmpeg records it to disk in continuous segments.
- **Segment-based recording**: Records N-minute segments one after another. Each segment is independently downloadable as an MP4. After recording, user downloads a segment and uploads it to the Video Clipper tab to analyze with Gemini.
- **Resolution selector**: Three buttons (480p / 720p / 1080p) let you choose recording quality before starting.
- **Segment duration selector**: 6 options — 5, 7, 10, 15, 20, 30 minutes.
- **Live countdown timer**: Each recording segment shows a progress bar and countdown timer ("X:XX restantes").
- **Download button**: Once a segment is `ready`, a ⬇ Descargar button appears.
- **Graceful stop**: Stop button signals a `threading.Event`; FFmpeg terminates cleanly.

### Changed
- Removed Gemini auto-analysis from stream segments — kept as a pure recorder.

---

## [v8.0] - 2026-02-27

### Fixed
- **Apostrophes now render correctly in ALL cases**: Replaced FFmpeg `drawtext` filter entirely with PIL-based text rendering. All captions render as PNG via PIL, overlaid via FFmpeg `overlay` filter. Apostrophes, quotes, special characters all work with zero escaping.
- **`gemini_service.py` was stripping apostrophes**: The regex `re.sub(r'[^\w\s]', '', caption)` matched `'` — fixed to `re.sub(r"[^\w\s']", '', caption)`.

### Changed
- **Caption rendering architecture**: `create_rounded_box()` + FFmpeg `drawtext` replaced by `create_caption_overlay()` — PIL renders white rounded rectangle (r=14) + Calibri Bold text onto RGBA PNG.

---

## [v7.x] - 2026-02-25/26

- **v7.4**: `max_chars` 15 → 25 for better caption line distribution
- **v7.0**: Gemini model updated to stable `gemini-2.5-pro`
- **v6.9**: Fixed near-zero timestamps (`response_mime_type` missing), preview deadlock, clip deduplication
- **v6.8**: FFmpeg text crash fix, video preview max_seconds fix, loading spinner fix

---

## [2.0.0] - 2026-02-15

### Added
- **Full-Stack Web App**: Migrated from CLI to React + FastAPI web application.
- **Visual Editor**: Interactive canvas to position text captions and watermarks.
- **Video Preview**: Video player in clip review step.
- **Selective Export**: Select specific clips to export.
- **Progress Tracking**: Real-time progress bars for upload, analysis, and export.
