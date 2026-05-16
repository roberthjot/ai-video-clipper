> ⚠️ **STALE — do not trust the details below.** This describes the old v2.0
> structure (e.g. it references `analysis.json` which the app no longer uses,
> and predates chunking, subtitles, emojis, filters, model selector, etc.).
> **Read `AGENTS.md` instead** — that is the current, authoritative guide for
> the codebase. This file is kept only for historical context.

# 🏗️ Architecture: AI Video Clipper v2.0

## Directory Structure

```
ai-video-clipper/
├── backend/                # Python FastAPI Backend
│   ├── app/
│   │   ├── main.py        # Entry point, CORS config
│   │   ├── config.py      # App settings (API keys, paths)
│   │   ├── models/        # Pydantic models (ClipData, Project)
│   │   ├── routes/        # API Endpoints
│   │   │   ├── upload.py  # File upload & analysis trigger
│   │   │   ├── clips.py   # Clip generation & preview
│   │   │   └── export.py  # Final video export logic
│   │   └── services/      # Business Logic
│   │       ├── gemini_service.py # Google AI interactions
│   │       ├── video_service.py  # FFmpeg processing (cutting/preview)
│   │       └── export_service.py # Complex FFmpeg filters (text/watermark)
│   └── requirements.txt
│
├── frontend/               # React Frontend (Vite)
│   ├── src/
│   │   ├── App.jsx        # Main UI Component
│   │   ├── App.css        # Styling (Vanilla CSS)
│   │   └── services/
│   │       └── api.js     # API client functions
│   ├── package.json
│   └── vite.config.js
│
├── projects/               # Storage for uploaded files & metadata
│   └── {project_id}/
│       ├── source.mp4
│       ├── analysis.json   # AI results
│       ├── output/         # Encoded temporary previews
│       └── exported/       # Final user exports
│
├── uploads/                # Temporary upload storage
└── README.md
```

## Key Components

### Backend (FastAPI)

1.  **`main.py`**: Initializes the FastAPI app and sets up CORS middleware to allow the frontend connection (important for development on different ports like 5173/5174).
2.  **`gemini_service.py`**: Handles communication with Google's Gemini 3 Pro API. It uploads video files to the Gemini File API and prompts the model to return structured JSON data about potential viral clips.
3.  **`export_service.py`**: The heavy lifter. Contains the complex FFmpeg filter chain logic to:
    - Crop to 9:16 vertical video.
    - Create a blurred background from the original video.
    - Overlay text captions (avoiding special characters).
    - Composite a watermark.
    - Includes a **fallback mechanism**: if the complex filter chain fails, it falls back to a simple cut-only export.
4.  **`video_service.py`**: Utility functions for basic FFmpeg operations like probing video duration, generating thumbnails, and creating low-res previews for the frontend player.

### Frontend (React)

1.  **`App.jsx`**: A single-page application managing the wizard flow:
    - **Step 1 (Upload)**: File selection, configuration (number of clips), progress bar polling.
    - **Step 2 (Review)**: List of AI-detected clips, editable captions, video preview modal.
    - **Step 3 (Editor)**: Visual canvas for positioning text/watermark. It calculates relative coordinates (0.0 - 1.0) to send to the backend.
2.  **`api.js`**: Centralized API calls. Uses `fetch` for most requests and `XMLHttpRequest` for file uploads (to track upload progress percentage).

## Data Flow

1.  **Upload**: User uploads a video → Saved to `uploads/` → `Project` created in memory.
2.  **Analysis**: Backend uploads to Gemini File API → Waits for processing → Prompts model → Receives JSON → Parses into `ClipData` objects.
3.  **Preview**: User requests preview → `video_service` generates a short `ultrafast` preset video clip → Served via static file endpoint.
4.  **Export**: User configures style (text/watermark) → `export_service` builds an FFmpeg command with complex filters → Runs in a background thread → Updates progress dict.
5.  **Download**: Frontend polls progress endpoint → When complete, provides download links.

## Known Issues / Considerations

-   **FFmpeg Filters**: The `boxblur` filter can be slow on older CPUs. We use `boxblur=12:2` for a balance of speed and quality.
-   **CORS**: Ensure `allow_credentials=False` if allowing `allow_origins=["*"]`.
-   **Gemini Quotas**: The app relies on the user's API quota. Large videos (>1GB) may hit limits or timeouts.
