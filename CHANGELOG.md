# Changelog

All notable changes to this project will be documented in this file.

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
