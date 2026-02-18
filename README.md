# 🎬 AI Video Clipper v3.0

An intelligent, full-stack web application that automatically identifies, extracts, and edits viral-worthy moments from long videos — styled like CapCut/TikTok clips.

**Powered by:** Google Gemini 2.0 Flash (Experimental) + FFmpeg + PIL

---

## ✨ Features

- **🧠 AI Analysis**: Uploads video to Gemini, which watches it and identifies the most engaging, funny, or dramatic moments automatically.
- **✂️ Smart Clipping**: Extracts clips with precise timestamps, enforcing a **60-second max duration** per clip for viral optimization.
- **🎞️ Live Preview**: Play generated clips directly in the browser before exporting.
- **🎨 CapCut-Style Overlay**:
  - White rounded box with black **Impact** font text
  - Blurred background (boxblur) with centered subject
  - Multiline caption splitting (max 35 chars/line)
- **📦 Selective Export**: Choose exactly which clips to render and download.
- **📊 Real-time Progress**: Track upload, analysis, and export with live status bars.
- **📱 9:16 Vertical Format**: Auto-crops and scales to vertical format optimized for TikTok, Reels, and Shorts.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite (vanilla CSS) |
| Backend | Python + FastAPI + Uvicorn |
| AI Model | Google Gemini 2.0 Flash Experimental |
| Video Processing | FFmpeg + PIL (Pillow) |
| Text Rendering | FFmpeg `drawtext` with Impact font |
| Box Rendering | PIL-generated rounded rectangle PNGs overlaid via FFmpeg |

---

## 🚀 Installation

### Prerequisites
- Python 3.10+
- Node.js 18+
- FFmpeg installed and accessible (or via `imageio-ffmpeg`)
- [Google AI Studio API Key](https://aistudio.google.com/)
- Windows (font paths use `C:/Windows/Fonts/impact.ttf`)

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

---

## 📁 Project Structure

```
ai-video-clipper/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI entry point, CORS setup
│   │   ├── config.py                # Settings (API key, paths)
│   │   ├── models/
│   │   │   └── clip.py              # ClipData, StyleConfig Pydantic models
│   │   ├── routes/
│   │   │   ├── clips.py             # /clips endpoints (analyze, preview, export)
│   │   │   └── upload.py            # /upload endpoint
│   │   └── services/
│   │       ├── gemini_service.py    # Gemini API calls + clip parsing
│   │       ├── video_service.py     # Preview generation, rounded box, text overlay
│   │       └── export_service.py   # Final clip export with all styling
│   └── requirements.txt
├── frontend/
│   └── src/
│       └── App.jsx                  # Full React UI (upload, review, export)
└── README.md
```

---

## 🔧 Key Implementation Details

### Text Overlay (CapCut Style)
- **Rounded white box** generated as PNG using PIL (`ImageDraw.rounded_rectangle`)
- Overlaid on video using FFmpeg `overlay` filter
- Text rendered on top using FFmpeg `drawtext` with **Impact** font
- Text split into lines of max 35 characters for readability

### Video Processing Pipeline
```
Input Video
  → scale to 1080x1920 (blurred background)
  → overlay original centered (clear subject)
  → overlay rounded white PNG box
  → drawtext (Impact font, black, centered)
  → encode H.264 + AAC, SAR 1:1
  → Output MP4 (browser compatible)
```

### AI Clip Detection
- Video uploaded as binary to Gemini multimodal API
- Prompt instructs Gemini to find 5-8 viral moments
- Each clip: `start_time`, `end_time`, `viral_caption`, `reason`
- Max clip duration enforced at **60 seconds** (both prompt + backend validation)

---

## ⚠️ Known Issues & Bugs

### Fixed
| Bug | Fix |
|-----|-----|
| Export showed "stuck at 100%" | Frontend checked for `"done"` but backend returns `"completed"` — fixed to check both |
| `'ClipData' object has no attribute 'title'` | Used `getattr(clip, 'title', f'clip_{clip.id}')` fallback |
| Video not playable in browser (SAR error) | Added `-sar "1:1"` to FFmpeg command |
| Ghost text appearing behind text overlay | Simplified filter chain to drawbox → drawtext (removed redundant layers) |
| White box not rendering (appeared gray) | Switched from `box=1` drawtext param to explicit `drawbox` filter with `color=white@0.95` |
| Font path error in FFmpeg on Windows | Escaped colon: `C\\:/Windows/Fonts/impact.ttf` |
| Clips too long (90+ seconds) | Modified Gemini prompt + added backend validation for 60s max |
| Videos cached, old version served | Added cache-busting timestamp to preview URLs |

### Active / Pending
| Bug | Status |
|-----|--------|
| Exported clip duration doesn't match UI duration | 🔴 Under investigation — clip cut timing may be off |
| Font boldness — Impact font applied but not visually confirmed | 🟡 Needs testing after server restart |

---

## 🌍 Environment Variables

Create a `.env` file in `backend/`:

```env
GOOGLE_API_KEY=your_gemini_api_key_here
```

---

## 📄 License
MIT License
