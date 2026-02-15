# Changelog

All notable changes to this project will be documented in this file.

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
