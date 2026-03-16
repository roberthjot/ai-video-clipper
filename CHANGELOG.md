# Changelog

All notable changes to this project will be documented in this file.

## [v9.2] - 2026-03-15

### Added
- **Live Stream Clipper mode**: New mode toggle at the top of the UI switches between Video Clipper and Live Stream Clipper.
- **Twitch & Kick recording**: Paste any Twitch or Kick stream URL — `streamlink` resolves the HLS URL automatically, FFmpeg records it to disk in continuous segments.
- **Segment-based recording**: Records N-minute segments one after another. Each segment is independently downloadable as an MP4. After recording, user downloads a segment and uploads it to the Video Clipper tab to analyze with Gemini.
- **Resolution selector**: Three buttons (480p / 720p / 1080p) let you choose recording quality before starting. Streamlink selects the best matching stream quality; FFmpeg scales to the target resolution (`854:480`, `1280:720`, `1920:1080`).
- **Segment duration selector**: 6 options — 5, 7, 10, 15, 20, 30 minutes. 30 min is the max (Gemini's file size limit becomes a concern beyond that).
- **Live countdown timer**: Each recording segment shows a progress bar and countdown timer ("X:XX restantes") that counts down based on the `started_at` ISO timestamp from the backend. Updates every second via `setInterval`.
- **Download button**: Once a segment is `ready`, a ⬇ Descargar button appears that triggers a direct MP4 download via `/api/stream/download/{session_id}/{segment_index}`.
- **Graceful stop**: Stop button signals a `threading.Event`; FFmpeg terminates cleanly after writing valid MP4 output.
- **New API endpoints**: `/api/stream/start`, `/api/stream/stop/{id}`, `/api/stream/status/{id}`, `/api/stream/download/{id}/{index}`, `/api/stream/sessions`
- **New backend files**: `backend/app/services/stream_service.py`, `backend/app/routes/stream.py`
- **New models**: `StreamSession`, `StreamSegment`, `StreamStartRequest` added to `clip.py`

### Changed
- Removed Gemini auto-analysis from stream segments — kept as a pure recorder. User downloads and uploads manually for full control over which segments to analyze.

## [v8.0] - 2026-02-27

### Fixed
- **Apostrophes now render correctly in ALL cases**: Replaced FFmpeg `drawtext` filter entirely with PIL-based text rendering. FFmpeg's filter-graph parser treats `'` as a quoting delimiter at the filter-graph level, making it impossible to reliably embed apostrophes via any escape sequence (`\'`, `"..."`, backslash, etc.). All attempts were empirically verified to fail. The solution is to render the white rounded box AND the caption text as a single PNG image using PIL/Pillow, then overlay it via FFmpeg's `overlay` filter. This means captions like "He's got the whole team behind him on this" now render perfectly with no workarounds.
- **`gemini_service.py` was stripping apostrophes**: The regex `re.sub(r'[^\w\s]', '', caption)` matched `'` as a non-word/non-space character and removed it, turning "he's" into "hes". Fixed to `re.sub(r"[^\w\s']", '', caption)` to explicitly exclude `'` from stripping.
- **Silent FFmpeg failures**: `generate_preview_frame` had `except: pass` around the FFmpeg subprocess call, silently swallowing all errors. The "Preview file not generated" error gave no hint of the actual FFmpeg failure. Fixed to `except subprocess.CalledProcessError` with proper error logging and `raise RuntimeError`.

### Changed
- **Caption rendering architecture**: `create_rounded_box()` + FFmpeg `drawtext` replaced by new `create_caption_overlay()` function. The new function renders both the white rounded rectangle (r=14) and the text (Calibri Bold 72px, centered, black) directly onto a transparent PNG using PIL, then returns the path for FFmpeg to use as an image overlay. No drawtext filter is used anywhere in the pipeline.
- **`sanitize_for_drawtext()` no longer called**: The function still exists in `video_service.py` but is no longer referenced since drawtext is eliminated.

## [v7.9] - 2026-02-27

### Fixed
- **Apostrophes now render correctly in captions**: Instead of removing apostrophes entirely (making "don't" → "dont"), they are now escaped as `\'` inside FFmpeg's single-quoted `text='...'` filter value. The key is order of operations: backslashes from the original text are stripped first, then `'` is replaced with `\'` so the escape backslashes are never accidentally removed. Words like "he's", "don't", "that's" now render correctly in the video.
- **Curly apostrophes from Gemini (U+2019 `'`) normalized**: Gemini sometimes outputs the curly/smart apostrophe `'` instead of the straight one `'`. These were previously stripped by the non-ASCII filter before any conversion could happen. Now they are converted to `'` first, then properly escaped as `\'` for FFmpeg.

## [v7.8] - 2026-02-26

### Added
- **"Small" video format mode**: Fourth fill_mode option that scales the video to 78% of the frame height (1497px), creating a noticeable blur border on all sides without shrinking the content too much. Sits between Zoom (90% height) and Fit (full width) in visual size.
- **Watermark center guide line**: When a watermark is uploaded and no preview is active, a vertical dashed white line appears at the horizontal center of the canvas (50%). Helps align the watermark logo precisely to center without guesswork. The line is purely visual (pointer-events: none) and disappears when preview is active.

### Changed
- **Video Format buttons**: Added `flexWrap: wrap` so the four buttons (Fit / Zoom / Fill / Small) wrap cleanly on narrow panels.
- **Format description**: Updated hint text to `Fit = full · Zoom = grande · Fill = frame completo · Small = reducido`.

## [v7.4] - 2026-02-26

### Fixed
- **Caption splits into 3 lines unnecessarily**: `max_chars` was 15, too short for typical captions like "He came with a different energy" or "He said his whole crew is ready for anything". These would hit 3 lines when 2 would look cleaner. Increased `max_chars` from 15 → 25 so lines are wider and captions distribute naturally into 1–2 lines instead of 3.

### Changed
- **Caption line length**: `max_chars=25` across preview frame, preview clip, and export. Box adapts wider (CapCut-style) and uses fewer lines, matching the reference style.

## [v7.3] - 2026-02-26

### Fixed
- **Box grows when font grows**: `split_text_into_lines` was absorbing ALL remaining words onto line 3 with no character limit, causing very long line 3 → wide box. Now all 3 lines enforce `max_chars=15` and extra words are dropped. Box size is now independent of font size.

### Changed
- **Caption font size**: Increased from `95px` to `100px`. With the line-length fix, the box stays compact while text is visibly larger.

## [v7.2] - 2026-02-25

### Fixed
- **Apostrophe still looks wrong**: Replaced U+2019 curly apostrophe with full removal — TikTok captions don't use apostrophes, avoids any FFmpeg font rendering issues.

### Changed
- **Caption font size**: Increased from `48px` to `62px` for stronger, more legible text on mobile.

## [v7.1] - 2026-02-25

### Fixed
- **Apostrophe renders as backtick**: `sanitize_for_drawtext()` was replacing `'` with `` ` `` to avoid breaking FFmpeg. Replaced with Unicode curly apostrophe `'` (U+2019) which is visually correct and safe for FFmpeg filter parsing.

### Changed
- **Caption font**: Switched from Arial Bold (`arialbd.ttf`) to Calibri Bold (`calibrib.ttf`) — rounder, more modern, closer to CapCut's caption style.
- **Caption font size**: Increased from `42px` to `48px` for better readability on mobile screens.

## [v7.0] - 2026-02-25

### Fixed
- **Gemini model deprecated**: `gemini-2.5-pro-exp-03-25` was shut down by Google without notice. Updated to the stable release `gemini-2.5-pro`.

## [v6.9] - 2026-02-25

### Fixed
- **All clips same duration / clustered at start**: Gemini was returning near-zero raw durations (e.g., `0.2s`) for all clips because `response_mime_type="application/json"` was missing from `GenerateContentConfig`. Without it, the model returned plain text that happened to parse, but with garbage timestamps. Added `response_mime_type="application/json"` to both the main call and the retry call.
- **Duplicate/overlapping clips**: Even with valid timestamps, clips could start very close together. Added deduplication in `build_clips`: clips are now sorted by `start_time` and any clip whose start is within `min_duration` seconds of the last accepted clip is skipped.
- **Video preview stuck forever on "Generating video preview..."**: Introduced a deadlock in the previous session — `(loadingPreview || loadingVideo)` blocked the `<video>` element from rendering, so `onCanPlay` never fired. Fixed by separating the two states: `loadingPreview` hides the video canvas, but `loadingVideo` renders the `<video>` hidden with an overlay spinner so `onCanPlay` can fire and clear the spinner.

### Changed
- **Debug logging**: Added `[Gemini] Analyzing video: duration=Xs, target=N clips, min_duration=Xs` log line at the start of each analysis for easier diagnosis.

## [v6.8] - 2026-02-25

### Fixed
- **FFmpeg text crash**: Added `sanitize_for_drawtext()` helper that strips characters breaking FFmpeg's drawtext filter (`,` `:` `%` `[` `]` `{` `}` `"` `\` and non-ASCII). Applied in preview frame, preview clip, and export.
- **Video preview not playing**: `generate_preview_clip` was ignoring the `max_seconds=10` parameter and generating the full clip duration (up to 90s), causing the browser to time out. Fixed with `min(duration, max_seconds)`.
- **No loading feedback on video play**: Both Step 2 ("Play" button) and Step 3 ("Play Clip" button) were setting `loadingVideo=false` immediately before the video was ready. Fixed with `onCanPlay`/`onError` handlers so the spinner stays until the video is playable.

### Changed
- **Gemini model**: Switched back from `gemini-2.5-flash` to `gemini-2.5-pro-exp-03-25` for higher quality clip detection.
- **Improved Gemini prompt**: Complete rewrite of system prompt with explicit viral criteria (hooks, emotional reactions, story arc), stricter caption rules (max 10 words, no punctuation, third person, lowercase), and better timestamp validation. Added post-processing regex to strip any remaining punctuation from captions.
- **Retry mechanism**: If Gemini returns clips with invalid timestamps, the backend now automatically retries to get the missing clips rather than silently dropping them.
- **Vite config**: Added `host: true` and explicit `port: 5173` for consistent local network access.

## [2.0.0] - 2026-02-15

### Added
- **Full-Stack Web App**: Migrated from a CLI tool to a modern React + FastAPI web application.
- **Visual Editor**: Interactive canvas to position text captions and watermarks.
- **Video Preview**: Added a video player in the clip review step to watch generated clips before exporting.
- **Selective Export**: Ability to select specific clips to export instead of exporting all.
- **Progress Tracking**: Real-time progress bars for file upload, AI analysis, and video export.
- **Hardware Acceleration**: Optimized FFmpeg commands for faster encoding (`ultrafast` preset for previews).
- **Fallback Mechanism**: Automatic fallback to simple cut export if complex filters (blur/text) fail.

### Fixed
- **Black Screen Export**: Resolved issue where exported videos were black due to incompatible FFmpeg filters. Switched to a simpler filter chain with `boxblur` and standard `yuv420p` format.
- **Export Speed**: Reduced blur intensity (`boxblur=12:2`) to significantly speed up export times.
- **CORS Issues**: Fixed Cross-Origin Resource Sharing (CORS) errors preventing the frontend (port 5173/5174) from communicating with the backend (port 8000).
- **Clip Count**: Fixed bug where clip count reverted to 10; now supports custom values (min 1).
- **Space Handling**: Improved filename handling for videos with spaces in their names.

### Changed
- **Architecture**: Split into `backend/` (Python) and `frontend/` (React).
- **API**: Replaced direct script execution with REST API endpoints (`/api/upload`, `/api/analyze`, `/api/export`).
- **Dependencies**: Added `fastapi`, `uvicorn`, `python-multipart` to backend requirements.
