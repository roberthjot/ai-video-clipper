# Changelog

All notable changes to this project will be documented in this file.

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
