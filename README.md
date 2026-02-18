# 🎬 AI Video Clipper v5.0

An intelligent, full-stack web application that automatically identifies, extracts, and edits viral-worthy moments from long videos — styled like CapCut/TikTok clips.

**Powered by:** Google Gemini 2.0 Flash + FFmpeg + PIL

---

## ✨ Features

- **🧠 AI Analysis**: Uploads video to Gemini, which watches it and identifies the most engaging, funny, or dramatic moments automatically.
- **✂️ Smart Clipping**: Extracts clips with precise timestamps, enforcing a **60-second max duration** per clip for viral optimization.
- **🎞️ Live Preview**: Play generated clips directly in the browser before exporting.
- **🎨 CapCut-Style Overlay**:
  - White rounded box (radius=16, tight padding) with black **Arial Bold** font text (size 42)
  - Blurred background (boxblur) with centered subject
  - Multiline caption splitting (max 35 chars/line)
  - Emoji characters automatically stripped (FFmpeg drawtext limitation)
- **💧 Watermark Support**: Upload your own logo/watermark and overlay it on all clips.
- **📦 Selective Export**: Choose exactly which clips to render and download.
- **📊 Real-time Progress**: Track upload, analysis, and export with live status bars.
- **📱 9:16 Vertical Format**: Auto-crops and scales to vertical format optimized for TikTok, Reels, and Shorts.
- **📄 Clips Info TXT**: After exporting, download a `clips_info.txt` file with each clip's title, timestamps, caption, and why it went viral.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite (vanilla CSS) |
| Backend | Python + FastAPI + Uvicorn |
| AI Model | Google Gemini 2.0 Flash |
| Video Processing | FFmpeg + PIL (Pillow) |
| Text Rendering | FFmpeg `drawtext` with Arial Bold font |
| Box Rendering | PIL-generated rounded rectangle PNGs overlaid via FFmpeg |

---

## 🚀 Installation

### Prerequisites
- Python 3.10+
- Node.js 18+
- FFmpeg installed and accessible (or via `imageio-ffmpeg`)
- [Google AI Studio API Key](https://aistudio.google.com/)
- Windows (font paths use `C:/Windows/Fonts/arialbd.ttf`)

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
# Edit .env and set your GOOGLE_API_KEY
```

### 3. Frontend Setup
```bash
cd frontend
npm install
```

---

## 🏃 Running the App

### Terminal 1: Backend
```bash
cd backend
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Terminal 2: Frontend
```bash
cd frontend
npm run dev
```

Open your browser at `http://localhost:5173`

---

## 📖 Usage Guide

1. **Upload** a video file (MP4, MOV, etc.)
2. **Analyze** — Gemini AI watches the video and identifies viral moments
3. **Review** — See clips with timestamps and AI-generated captions
4. **Preview** — Watch each clip in the browser with full styling applied
5. **Export** — Select clips and export them as styled MP4 files
6. **Download** — Find exported files in the `projects/` folder or download from the UI
7. **Clips Info** — After export, click "📄 Download Clips Info (TXT)" to get a summary file with all clip details

---

## 📁 Project Structure

```
ai-video-clipper/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI entry point, CORS, /api/export-info endpoint
│   │   ├── config.py                # Settings (API key, paths, Gemini model)
│   │   ├── models/
│   │   │   └── clip.py              # ClipData, StyleConfig Pydantic models
│   │   ├── routes/
│   │   │   ├── clips.py             # /clips endpoints (analyze, preview, export)
│   │   │   └── upload.py            # /upload endpoint
│   │   └── services/
│   │       ├── gemini_service.py    # Gemini API calls + clip parsing
│   │       ├── video_service.py     # Preview generation, rounded box, text overlay
│   │       └── export_service.py   # Final clip export + clips_info.txt generation
│   └── requirements.txt
├── frontend/
│   └── src/
│       └── App.jsx                  # Full React UI (upload, review, export, download TXT)
└── README.md
```

---

## 🔧 Key Implementation Details

### Text Overlay (CapCut Style)
- **Rounded white box** generated as PNG using PIL (`ImageDraw.rounded_rectangle`)
  - Corner radius: `16px`
  - Padding: `24px horizontal, 16px vertical`
  - Width dynamically calculated from longest text line
- Overlaid on video using FFmpeg `overlay` filter
- Text rendered on top using FFmpeg `drawtext` with **Arial Bold** font (size 42)
- Text split into lines of max 35 characters for readability
- Non-ASCII characters (emojis) stripped before passing to FFmpeg

### Video Processing Pipeline
```
Input Video
  → -ss start -to end (precise seek BEFORE input)
  → scale to 1080x1920 (blurred background)
  → overlay original centered (clear subject)
  → overlay rounded white PNG box (-loop 1 -t duration)
  → drawtext (Arial Bold, black, centered)
  → overlay watermark PNG (-loop 1 -t duration)
  → encode H.264 + AAC, SAR 1:1
  → Output MP4 (browser compatible)
```

### AI Clip Detection
- Video uploaded as binary to Gemini multimodal API
- Prompt instructs Gemini to find 5-8 viral moments
- Each clip: `start_time`, `end_time`, `viral_caption`, `reason`
- Max clip duration enforced at **60 seconds** (both prompt + backend validation)

### clips_info.txt Format
After export, a `clips_info.txt` is saved to `projects/{id}/exported/` and available for download:
```
============================================================
AI VIDEO CLIPPER - CLIPS INFO
============================================================

CLIP 1 - Clip Title Here
Timestamps : 0:05 - 0:25 (20s)
Caption    : Your viral caption text here
Why viral  : Reason why this moment is engaging

------------------------------------------------------------
```

### Critical FFmpeg Fix — Clip Duration
When FFmpeg has multiple inputs (video + PNG box + watermark PNG),
using `-loop 1` without `-t` causes the loop to run forever, making exported clips as long as the full video.

**Wrong (causes full-length exports):**
```
ffmpeg -i video.mp4 -ss 10 -to 30 -loop 1 -i box.png -loop 1 -i watermark.png ...
```

**Correct (precise clip duration):**
```
ffmpeg -ss 10 -to 30 -i video.mp4 -loop 1 -t 20 -i box.png -loop 1 -t 20 -i watermark.png ...
```

Key rules:
- `-ss` and `-to` must go **before** `-i video` (input seeking)
- `-loop 1 -t {duration}` must be applied to **every** PNG/image input

---

## ⚠️ Known Issues & Bugs

### Fixed in v5.0
| Bug | Fix |
|-----|-----|
| Emoji characters showing as boxes in video overlay | Strip non-ASCII with `re.sub(r'[^\x00-\x7F]+', '', text)` before FFmpeg drawtext |
| Box border radius too large on some clips | Reduced to `corner_radius=16`, tight padding (pad_x=24, pad_y=16) |
| "Download Clips Info" button returned 404 | Endpoint now reads `clips_info.txt` directly from disk (not in-memory store) |
| "Download Clips Info" button returned 405 Method Not Allowed | Moved endpoint to `/api/export-info/{project_id}` in `main.py` (was conflicting with `/clips/{id}/{clip_id}` route) |
| Server lost projects after code change + auto-reload | uvicorn `--reload` restarts process, clearing in-memory store. Download endpoint now reads from disk path |
| Gemini model 404 error | `gemini-3-pro-preview` deprecated. Changed to `gemini-2.0-flash` |

### Fixed in v4.0
| Bug | Fix |
|-----|-----|
| Exported clips were full video length instead of clip duration | `-ss/-to` moved before `-i`, added `-t duration` to all `-loop 1` image inputs |
| Export showed "stuck at 100%" | Frontend checked for `"done"` but backend returns `"completed"` — fixed to check both |
| `'ClipData' object has no attribute 'title'` | Used `getattr(clip, 'title', f'clip_{clip.id}')` fallback |
| Video not playable in browser (SAR error) | Added `-sar "1:1"` to FFmpeg command |
| Ghost text appearing behind text overlay | Simplified filter chain to drawbox → drawtext |
| White box not rendering (appeared gray) | Switched to explicit `drawbox` filter with `color=white@0.95` |
| Font path error in FFmpeg on Windows | Escaped colon: `C\\:/Windows/Fonts/arialbd.ttf` |
| Clips too long (90+ seconds) | Modified Gemini prompt + added backend validation for 60s max |
| Videos cached, old version served | Added cache-busting timestamp to preview URLs |
| Font not bold enough | Changed from Impact to Arial Bold (arialbd.ttf, size 42) — tested manually before applying |

### Active / Pending
| Issue | Status |
|-------|--------|
| In-memory project store resets on server restart | 🟡 By design for desktop app; disk-based persistence not yet implemented |

---

## 🌍 Environment Variables

Create a `.env` file in `backend/`:

```env
GOOGLE_API_KEY=your_gemini_api_key_here
```

---

## 📄 License
MIT License
