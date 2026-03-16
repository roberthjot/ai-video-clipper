# 🎬 AI Video Clipper v9.2

An intelligent, full-stack web application that automatically identifies, extracts, and edits viral-worthy moments from long videos — styled like CapCut/TikTok clips with a dedicated Instagram post export mode.

**Powered by:** Google Gemini 2.5 Pro + FFmpeg + PIL

---

## ✨ Features

### Core
- **🧠 AI Analysis**: Uploads video to Gemini, which watches it and identifies the most engaging, funny, or dramatic moments automatically.
- **✂️ Smart Clipping**: Extracts clips with precise timestamps, each with a different duration (up to 60s max) based on the moment.
- **🎞️ Live Preview**: Play generated clips directly in the browser with full styling applied before exporting.
- **📊 Real-time Progress**: Track upload, analysis, and export with live status bars.
- **📱 9:16 Vertical Format**: Auto-crops and scales to vertical format optimized for TikTok, Reels, and Shorts.
- **📄 Clips Info TXT**: After exporting, download a `clips_info.txt` with each clip's title, timestamps, caption, and why it went viral.

### TikTok Export
- **🎨 CapCut-Style Overlay**: White rounded box (r=14) with black **Calibri Bold** font (72px), PIL-rendered — no FFmpeg drawtext, apostrophes fully supported.
- **🔲 4 Video Format Modes**: Fit · Zoom · Fill · Small
- **📍 Caption Position Slider**: Move text anywhere from 5% to 95% of the frame height.
- **💧 Watermark Support**: Upload logo, drag to position, adjust opacity and scale.
- **📐 Split-Screen Mode**: Video (top) + static image (bottom), adjustable 30/70 ratio slider.

### 📸 Instagram Export (v9.1)
- **Static JPEG Preview**: Press 📸 IG to generate a white-background Instagram post image instantly.
- **White Canvas Format**: 1080×1920 white bg, **Calibri Bold** caption text at top, video centered in lower zone.
- **5 IG Video Size Modes** (independent from TikTok):
  | Mode | Scale | Description |
  |------|-------|-------------|
  | Fit | `scale=1080:-2` | Full width, small for landscape |
  | Medium | `scale=-2:715` | ~18% bigger than Fit |
  | Zoom | `scale=-2:990` | 90% of video zone |
  | Fill | `scale=1080:1100` | Fills full zone, crops sides |
  | Small | `scale=-2:858` | 78% of zone |
- **IG Text Position Slider**: Move caption text up/down (40–400px from top) without changing video size.
- **IG Watermark Slider**: Separate watermark Y position for IG, independent from TikTok.
- **Fixed Video Zone**: Video zone is always 1100px tall (y=740–1840), video size never changes with text position.
- **Canvas Centering**: Video frame is always centered in the full 1920px canvas; text pushes it down only if they'd overlap.
- **IG Export**: Exports video clips in IG post format (white bg + text + centered video) as MP4 files.

### 🔴 Live Stream Clipper (v9.2)
- **Twitch & Kick support**: Paste any stream URL — resolved automatically via `streamlink`
- **Segment recording**: Records continuous N-minute segments to disk; each segment is independently downloadable
- **Resolution selector**: Choose **480p / 720p / 1080p** before starting; streamlink picks the matching quality
- **Segment duration**: 5 / 7 / 10 / 15 / 20 / 30 minutes per segment
- **Live countdown timer**: Each recording segment shows a progress bar and time remaining
- **Download button**: Download any completed segment as MP4 directly from the browser
- **Auto-restart loop**: As soon as one segment finishes, recording starts immediately for the next
- **Graceful stop**: Stop button ends recording after the current segment finishes cleanly
- **Workflow**: Record → Download segment → Upload to Video Clipper → Analyze with Gemini

### 🛡️ Anti-Detect (Export Only)
- **Strip Metadata**: Removes all EXIF/MP4 metadata (`-map_metadata -1`)
- **Flip Horizontal**: Mirror the video (`hflip`)
- **Zoom Uniquify**: Scale +2% then crop back to 1080×1920 to break fingerprint
- **Boost Contrast**: Subtle `eq=contrast=1.05:brightness=0.02:saturation=1.05`

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite (vanilla CSS) |
| Backend | Python + FastAPI + Uvicorn |
| AI Model | Google Gemini 2.5 Pro |
| Video Processing | FFmpeg + PIL (Pillow) |
| Stream Recording | streamlink 8.2.1 (HLS resolver) + FFmpeg |
| Text Rendering | PIL `ImageDraw` with Calibri Bold — 100% PIL, no FFmpeg drawtext |
| Box Rendering | PIL rounded rectangle PNGs overlaid via FFmpeg |

---

## 🚀 Installation

### Prerequisites
- Python 3.10+
- Node.js 18+
- FFmpeg (via `imageio-ffmpeg`, auto-installed)
- [Google AI Studio API Key](https://aistudio.google.com/)
- Windows (font paths use `C:/Windows/Fonts/calibrib.ttf`)
- streamlink (`pip install streamlink`) — required for Live Stream feature

### 1. Clone the Repository
```bash
git clone https://github.com/roberthjot/ai-video-clipper.git
cd ai-video-clipper
```

### 2. Backend Setup
```bash
cd backend
pip install -r requirements.txt

# Create .env file
cp .env.example .env
# Edit .env and add your GOOGLE_API_KEY
```

### 3. Frontend Setup
```bash
cd frontend
npm install
```

---

## 🏃 Running the App

### Terminal 1 — Backend
```bash
cd backend
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

> ⚠️ **Windows reload issue:** `--reload` doesn't always apply changes. After any backend edit, kill and restart manually:
> ```bash
> taskkill /F /IM python.exe
> python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
> ```

### Terminal 2 — Frontend
```bash
cd frontend
npm run dev
```

Open `http://localhost:5173`

---

## 📖 Usage Guide

1. **Upload** a video file (MP4, MOV, etc.)
2. **Analyze** — Gemini AI watches the video and identifies viral moments
3. **Review** — See clips with timestamps and AI-generated captions
4. **Edit** — Adjust caption position, fill mode, watermark, anti-detect options
5. **Preview** — Click `👁 Preview` for a TikTok-style still, `▶ Play Clip` for video, `📸 IG` for Instagram post preview
6. **Export TikTok** — Export selected clips as vertical 9:16 MP4s with CapCut-style overlay
7. **Export Instagram** — Export selected clips in white-bg Instagram post format
8. **Download** — Find files in `projects/{id}/exported/` or `projects/{id}/instagram_exported/`

> 💡 **Tip for large videos:** Compress to 720p first (HandBrake is free) to stay under Gemini's ~2GB upload limit.

---

## 📁 Project Structure

```
ai-video-clipper/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI entry point, CORS, route registration
│   │   ├── config.py                # Settings (API key, paths, Gemini model)
│   │   ├── models/
│   │   │   └── clip.py              # ClipData, StyleConfig, StreamSession Pydantic models
│   │   ├── routes/
│   │   │   ├── clips.py             # /clips endpoints (analyze, preview, instagram-preview)
│   │   │   ├── export.py            # /export endpoints (TikTok + Instagram render/progress)
│   │   │   ├── upload.py            # /upload endpoint
│   │   │   └── stream.py            # /stream endpoints (start, stop, status, download, sessions)
│   │   └── services/
│   │       ├── gemini_service.py    # Gemini API calls + clip parsing + prompt
│   │       ├── video_service.py     # TikTok preview, IG preview frame, PIL overlays
│   │       ├── export_service.py   # TikTok export, Instagram export, background threads
│   │       └── stream_service.py   # Live stream recording via streamlink + FFmpeg
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── App.jsx                  # Full React UI (Video Clipper + Live Stream modes)
│       └── services/
│           └── api.js               # API client (all endpoints incl. stream)
└── README.md
```

---

## 🔧 Key Implementation Details

### Caption Rendering (100% PIL — No FFmpeg drawtext)
All text is rendered in Python using PIL before FFmpeg ever runs:
- `create_caption_overlay()` → RGBA PNG with white rounded box + black Calibri Bold text
- PNG passed to FFmpeg as `-loop 1` input and overlaid with `overlay` filter
- **Benefit**: apostrophes, quotes, special characters all work with zero escaping

### TikTok Video Pipeline
```
Input → -ss start -to end
  → scale 1080×1920 (boxblur bg)
  → overlay subject centered
  → overlay PIL caption PNG
  → overlay watermark PNG
  → [anti-detect filters if enabled]
  → format=yuv420p → H.264 + AAC output
```

### Instagram Post Pipeline
```
Python:
  create_instagram_frame_bg(caption, top_padding)
    → 1080×1920 white PNG, Calibri Bold text at top_padding Y
    → video zone always fixed: top=740, height=1100

FFmpeg:
  [0:v] scale per ig_fill_mode → [fg]
  [1:v=white_frame][fg] overlay=(W-w)/2 : overlay_y → [with_video]
  overlay_y = max(text_bottom, (H-h)/2) clamped to canvas
            (no-comma arithmetic: max(a,b)=(a+b+abs(a-b))/2)
  → [watermark overlay if enabled]
  → [anti-detect filters if enabled]
  → format=yuv420p → H.264 + AAC output
```

**Key design decisions:**
- Video zone height (`IG_VIDEO_H = 1100`) is a **constant** — never changes when text slider moves
- Video is centered in the **full 1920px canvas** (`paste_y = (H-h)//2`), clamped only to avoid text overlap
- FFmpeg `min()`/`max()` are replaced with comma-free arithmetic to avoid filter parsing errors

### IG Fill Modes
| Mode | Filter | video_h=1100 result |
|------|--------|---------------------|
| fit | `scale=1080:-2` | ~607px for 16:9 source |
| medium | `scale=-2:715` | 715px (~18% bigger than fit) |
| zoom | `scale=-2:990` | 990px (90% of zone) |
| fill | `scale=1080:1100,crop` | 1100px (full zone, sides crop) |
| small | `scale=-2:858` | 858px (78% of zone) |

### Split-Screen Mode
```
[0:v] scale+crop+boxblur → [bg] (video_h tall)
[0:v] fg_filter          → [fg]
[bg][fg] overlay         → [video_part] (yuv420p)
[1:v=split_img] scale+crop → [img_part] (yuv420p)
[video_part][img_part] vstack=2 → full 1080×1920
```

### Anti-Detect Filter Chain (export only)
Applied as `extra_vf` before `format=yuv420p[out]`:
```
hflip                                    # flip_horizontal
scale=1102:1958,crop=1080:1920           # zoom_uniquify (+2%)
eq=contrast=1.05:brightness=0.02:saturation=1.05  # boost_contrast
```

### Gemini Caption Rules
- Max **10 words** per caption
- **Third person** — "He got the moves", "Watch her reaction"
- No "I", "Me", "My", "POV: You..."
- No punctuation, all lowercase
- Written as a fan account reporting on the creator

---

## 🔌 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/upload` | Upload video, return project_id |
| `POST` | `/api/clips/analyze` | Analyze video with Gemini |
| `GET` | `/api/status/{project_id}` | Poll analysis progress |
| `PUT` | `/api/export/style/{project_id}` | Update style config |
| `GET` | `/api/clips/{pid}/{cid}/preview` | Generate TikTok preview JPEG |
| `GET` | `/api/clips/{pid}/{cid}/preview-video` | Generate TikTok preview MP4 |
| `GET` | `/api/clips/{pid}/{cid}/instagram-preview` | Generate IG post preview JPEG |
| `POST` | `/api/export/start/{project_id}` | Start TikTok background export |
| `GET` | `/api/export/progress/{project_id}` | Poll TikTok export progress |
| `POST` | `/api/export/instagram-render/{project_id}` | Start Instagram background export |
| `GET` | `/api/export/instagram-progress/{project_id}` | Poll Instagram export progress |
| `POST` | `/api/export/split-image/{project_id}` | Upload split-screen image |
| `GET` | `/api/export-info/{project_id}` | Download clips_info.txt |
| `POST` | `/api/stream/start` | Start live stream recording session |
| `POST` | `/api/stream/stop/{session_id}` | Stop recording session |
| `GET` | `/api/stream/status/{session_id}` | Poll session status + segments |
| `GET` | `/api/stream/download/{session_id}/{segment_index}` | Download recorded segment as MP4 |
| `GET` | `/api/stream/sessions` | List all stream sessions |

---

## ⚠️ Known Issues & Changelog

### v9.2 — Live Stream Clipper
| Feature | Detail |
|---------|--------|
| Live Stream mode | Toggle between Video Clipper and Live Stream in header |
| Twitch & Kick support | streamlink resolves HLS URL automatically |
| Segment recording | Continuous N-minute segments, each independently downloadable |
| Resolution selector | 480p / 720p / 1080p — streamlink picks matching quality, FFmpeg scales to match |
| Segment durations | 5 / 7 / 10 / 15 / 20 / 30 minutes |
| Countdown timer | Live progress bar + "X:XX remaining" per segment using `started_at` ISO timestamp |
| Download button | Download any ready segment as MP4 directly from the browser |
| Graceful stop | `threading.Event` signals FFmpeg to terminate cleanly |

### v9.1 — Instagram Export
| Change | Detail |
|--------|--------|
| Instagram post export | White bg + caption text + centered video, 5 fill modes |
| Fixed IG export 0/5 clips | FFmpeg `min(max())` commas break filter_complex — replaced with `(a+b±abs(a-b))/2` arithmetic |
| Fixed video size changes with text | `IG_VIDEO_H=1100` constant, video zone never changes |
| Fixed video not centered | `paste_y = max(text_bottom, (H-h)//2)` centers in full canvas |
| Fixed blank first frame on IG export | Added `setpts=PTS-STARTPTS` to video filter — input seeking keyframe delay caused [0:v] to arrive 1 frame late while white PNG was already at t=0 |
| IG watermark slider | Independent from TikTok watermark_y |
| Medium fill mode | 65% of zone height, ~18% bigger than Fit for landscape video |

### v9.0 — Split Screen + Anti-Detect
| Feature | Detail |
|---------|--------|
| Split-screen mode | Video (top) + static image (bottom), vstack pipeline |
| Anti-detect | Strip metadata, flip, zoom+2%, contrast boost |
| Caption position slider | `text_y` ratio 0.0–1.0 relative to target height |

### v8.x — PIL Caption Rendering
| Version | Change |
|---------|--------|
| v8.0 | Switched from FFmpeg drawtext to 100% PIL rendering — apostrophes now work |
| v8.0 | `create_caption_overlay()` generates RGBA PNG, overlaid via FFmpeg |

### v7.x — Stability
| Version | Fix |
|---------|-----|
| v7.4 | `max_chars` 15 → 25 for better line distribution |
| v7.0 | Gemini model updated to stable `gemini-2.5-pro` |
| v6.9 | Fixed near-zero timestamps, preview deadlock, clip deduplication |

### Active / Pending
| Issue | Status |
|-------|--------|
| In-memory project store resets on server restart | 🟡 By design; disk persistence not implemented |
| `--reload` unreliable on Windows | 🟡 Kill python.exe and restart manually after backend changes |

---

## 🌍 Environment Variables

Create `backend/.env`:
```env
GOOGLE_API_KEY=your_gemini_api_key_here
```

---

## 📄 License
MIT License
