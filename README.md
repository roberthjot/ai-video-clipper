# 🎬 AI Video Clipper v10.0

An intelligent, full-stack web application that automatically identifies, extracts, and edits viral-worthy moments from long videos — styled like CapCut/TikTok clips with a dedicated Instagram export mode, a Meme Generator, and a Music Vibe extractor.

**Powered by:** Faster-Whisper + Intel QSV + Google Gemini 2.5 + FFmpeg + PIL

---

## ⚡ Performance & Engine Optimizations (v10.0)

- **🚀 Ultra-Fast Local Whisper Transcription**:
  - Powered by `faster-whisper` optimized with multi-threading (`cpu_threads=8`), greedy decoding (`beam_size=1`), and Voice Activity Detection (`vad_filter=True`).
  - Transcribes 15+ minute raw videos in ~90 seconds locally with zero cloud API latency or quota limits.
- **🏎️ Intel Quick Sync Video (QSV) Hardware Acceleration**:
  - Parallel batch exports using `h264_qsv` with a 3-worker thread pool (`ThreadPoolExecutor(max_workers=3)`).
  - Renders 10 Full HD 1080×1920 vertical videos with dynamic background blur, auto-crop, and animated subtitles in under 3.5 minutes (~20 seconds per video).
- **🔌 Direct Ingestion APIs**:
  - `POST /api/import-preanalyzed`: Instant project injection bypassing cloud API token saturation and 429 rate limits.
  - `POST /api/meme/import-batch`: Direct registration of pre-analyzed meme and music vibe batches.
- **🔗 Deep URL Routing**:
  - Direct project loading via `http://localhost:5173/?project=<PROJECT_ID>`.
  - Direct meme/music batch loading via `http://localhost:5173/?mode=meme&batch=<BATCH_ID>`.
- **🎯 Standardized Meme & Music Vibe Presets**:
  - Default font: **Arial (meme)** (`arial.ttf`).
  - Default alignment: **Centro** (`center`).
  - Default font size: **55px**.
  - Strict formatting rules: **Sentence case** enforcement, 3rd-person viral hooks, and zero emojis.

---

## ✨ Features

### 🎬 Video Clipper
- **🧠 AI Analysis**: Gemini watches the video and identifies the most engaging, funny, or dramatic moments automatically.
- **✂️ Smart Clipping**: Extracts clips with precise timestamps and AI-generated captions. Deduplication prevents the same moment from appearing twice.
- **🎞️ Live Preview**: Play generated clips in the browser with full styling applied before exporting.
- **📊 Real-time Progress**: Live status bars for upload, analysis, and export.
- **📱 9:16 Vertical Format**: Auto-crops and scales to vertical format for TikTok, Reels, and Shorts.
- **📄 IG Description per clip**: Gemini generates a 3-4 paragraph Instagram post caption + 12-15 hashtags per clip, saved to `clips_info.txt`.

### TikTok Export
- **🎨 CapCut-Style Overlay**: White rounded box (r=14) with black **Calibri Bold** font (72px), PIL-rendered — no FFmpeg drawtext, apostrophes fully supported.
- **↔️ Text X Position**: Move caption text left/right across the full canvas width.
- **↕️ Text Y Position**: Move caption text anywhere from 5% to 95% of the frame height.
- **🔡 Font Size**: Adjust caption font size from 30px to 120px.
- **🔲 5 Video Format Modes**: Fit · Medium · Zoom · Fill · Small
- **💧 Watermark Support**: Upload logo, drag to position, adjust opacity and scale.
- **📐 Split-Screen Mode**: Video (top) + static image (bottom), adjustable 30/70 ratio slider.

### 📸 Instagram Export
- **Static JPEG Preview**: Press 📸 IG to generate a white-background Instagram post image instantly.
- **White Canvas Format**: 1080×1920 white bg, **Calibri Bold** caption text at top, video centered in lower zone.
- **5 IG Video Size Modes** (independent from TikTok):

  | Mode | Scale | Description |
  |------|-------|-------------|
  | Fit | `scale=1080:-2` | Full width, small for landscape |
  | Medium | `scale=-2:715` | ~65% of zone height |
  | Zoom | `scale=-2:990` | 90% of video zone |
  | Fill | `scale=1080:1100` | Fills full zone, crops sides |
  | Small | `scale=-2:858` | 78% of zone |

- **IG Text Position Slider**: Move caption text up/down (40–400px from top).
- **IG Watermark Slider**: Separate watermark Y position for IG, independent from TikTok.
- **Long IG Description**: Gemini generates a 3-4 paragraph fan-account caption + hashtags per clip, exported to `clips_info.txt`.

### 😂 Meme Generator (v9.5)
A completely independent mode — no clipping, no timestamps. Upload short videos and let Gemini write the meme text.

- **Multi-video upload**: Drag-and-drop up to ~20 videos at once.
- **AI meme text**: Gemini watches each video and generates punchy English meme text — max 12 words, sentence case, no hashtags, no emojis.
- **Background**: Choose black or white canvas (1080×1920).
- **Full-video export**: The entire video is exported as-is overlaid on the canvas — meme text at top, video centered below.
- **Batch processing**: All videos processed sequentially in background. Status updates every 2s.
- **Per-item editor**: After processing, each meme card shows sliders:
  - **Text Y** — move text up/down
  - **Text X** — move text left/right (text wraps to fit remaining canvas width)
  - **Font Size** — 40px to 180px
  - **Video Offset** — fine-tune video vertical position ±400px from auto-center
  - **Video Scale** — video width 40%–100% of canvas
- **Re-export**: "Re-exportar con estos ajustes" re-runs FFmpeg with new settings instantly (no Gemini re-call).
- **Per-item download**: Each finished meme has a ⬇ Descargar button.

### 🔴 Live Stream Clipper
- **Twitch & Kick support**: Paste any stream URL — resolved automatically via `streamlink`
- **Segment recording**: Records continuous N-minute segments to disk; each segment is independently downloadable
- **Resolution selector**: Choose **480p / 720p / 1080p** before starting
- **Segment duration**: 5 / 7 / 10 / 15 / 20 / 30 minutes per segment
- **Live countdown timer**: Each recording segment shows a progress bar and time remaining
- **Download button**: Download any completed segment as MP4 directly from the browser
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
| Stream Recording | streamlink + FFmpeg |
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

### Video Clipper
1. **Upload** a video file (MP4, MOV, etc.)
2. **Analyze** — Gemini AI watches the video and identifies viral moments
3. **Review** — See clips with timestamps and AI-generated captions
4. **Edit** — Adjust caption position (X/Y), font size, fill mode, watermark, anti-detect options
5. **Preview** — Click `👁 Preview` for a TikTok-style still, `▶ Play Clip` for raw video, `📸 IG` for Instagram post preview
6. **Export TikTok** — Export selected clips as vertical 9:16 MP4s with CapCut-style overlay
7. **Export Instagram** — Export selected clips in white-bg Instagram post format
8. **Download** — Files saved to `projects/{id}/exported/` or `projects/{id}/instagram_exported/`

> 💡 **Tip for large videos:** Compress to 720p first (HandBrake is free) to stay under Gemini's ~2GB upload limit.

### Meme Generator
1. Click **😂 Meme Generator** in the header
2. **Upload** short videos (drag-and-drop, up to ~20 at once)
3. Select **background** (black or white)
4. Click **Generar Memes** — Gemini analyzes each video and generates text; FFmpeg exports
5. When each meme is **Listo**, adjust sliders (text position, font size, video scale) and click **Re-exportar** to preview
6. **Download** each finished meme

### Live Stream
1. Click **🔴 Live Stream** in the header
2. Paste a Twitch or Kick URL
3. Select resolution and segment duration
4. Click **Start Recording**
5. When a segment finishes → **Download** it → **Upload** to Video Clipper

### Buscar clips de un VOD de Kick
1. Pega la URL completa del VOD, con el canal incluido:
   `https://kick.com/<canal>/videos/<id-del-vod>`.
2. Abre **Momentos virales del VOD** y pulsa **Top clips**.

Kick cambió los identificadores de sus VOD recientes a UUIDv7. La aplicación
resuelve estos VOD mediante el endpoint actual de Kick cuando la URL contiene
el canal. Las URLs antiguas o los VOD eliminados/no públicos no pueden listar
clips. Kick no ofrece una API pública estable para esta función, por lo que un
reto de Cloudflare puede requerir reintentar unos minutos después.

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
│   │   │   ├── meme.py              # /meme endpoints (process, status, download, reexport)
│   │   │   └── stream.py            # /stream endpoints (start, stop, status, download)
│   │   └── services/
│   │       ├── gemini_service.py    # Gemini API calls + clip parsing + ig_description
│   │       ├── video_service.py     # TikTok/IG preview, PIL overlays, fill modes
│   │       ├── export_service.py    # TikTok/IG export, background threads, fill modes
│   │       ├── meme_service.py      # Meme text generation, PIL bg, FFmpeg export, batch
│   │       └── stream_service.py    # Live stream recording via streamlink + FFmpeg
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── App.jsx                  # Full React UI (Video Clipper + Live Stream + Meme)
│       └── services/
│           └── api.js               # API client (all endpoints incl. meme + stream)
├── CHANGELOG.md
└── README.md
```

---

## 🔧 Key Implementation Details

### Caption Rendering (100% PIL — No FFmpeg drawtext)
All text is rendered in Python using PIL before FFmpeg ever runs:
- `create_caption_overlay()` → RGBA PNG with white rounded box + black Calibri Bold text
- PNG passed to FFmpeg as `-loop 1` input and overlaid with `overlay` filter
- **Benefit**: apostrophes, quotes, special characters all work with zero escaping

### TikTok Video Format Modes
| Mode | Filter | Effect |
|------|--------|--------|
| fit | `scale={W}:-2` | Full width, height by aspect ratio — blur top/bottom for landscape |
| medium | `scale=-2:{H*0.65}` | 65% of canvas height — larger video, some blur |
| zoom | `scale=-2:{H*0.9}` | 90% of canvas height — large, sides crop for landscape |
| fill | `scale={W}:{H},crop` | Covers full canvas, crops to fit |
| small | `scale=-2:{H*0.78}` | 78% of canvas height — visible blur border all sides |

### TikTok Video Pipeline
```
Input → -ss start -to end
  → scale 1080×1920 (boxblur bg)
  → overlay video centered (fill_mode scale)
  → overlay PIL caption PNG (text_x, text_y, font_size)
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
  → format=yuv420p → H.264 + AAC output
```

### Meme Generator Pipeline
```
Python:
  create_meme_bg_png(text, bg_color, W, H, text_y, text_x, font_size)
    → 1080×1920 solid black/white PNG
    → Calibri Bold text, left-aligned from text_x*W
    → pixel-width wrapping (stays within canvas right edge)
    → returns (png_path, text_bottom_y)

FFmpeg:
  [1:v] scale=1080:1920,setsar=1 → [bg]
  [0:v] setpts=PTS-STARTPTS, scale={W*video_scale}:-2 → [fg]
  [bg][fg] overlay=(W-w)/2 : video_center_y → [out]
  video_center_y = auto-computed from text_bottom_y, centered in remaining space
  + video_offset for fine-tuning
  → H.264 + AAC, -shortest (full video, no cuts)
```

### Clip Deduplication (v9.3 fix)
`build_clips()` takes `existing_starts: list` — when the retry pass runs, it gets seeded with all start times from the first pass. Dedup: `any(abs(start - s) < min_duration for s in accepted_starts)` prevents identical timestamps from appearing in both passes.

### Anti-Detect Filter Chain (export only)
Applied as `extra_vf` before `format=yuv420p[out]`:
```
hflip                                    # flip_horizontal
scale=1102:1958,crop=1080:1920           # zoom_uniquify (+2%)
eq=contrast=1.05:brightness=0.02:saturation=1.05  # boost_contrast
```

---

## 🔌 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/upload` | Upload video, return project_id |
| `POST` | `/api/clips/analyze` | Analyze video with Gemini |
| `GET` | `/api/status/{project_id}` | Poll analysis progress |
| `PUT` | `/api/export/style/{project_id}` | Update style config |
| `GET` | `/api/clips/{pid}/{cid}/preview` | Generate TikTok preview JPEG |
| `GET` | `/api/clips/{pid}/{cid}/video-preview` | Generate TikTok preview MP4 |
| `GET` | `/api/clips/{pid}/{cid}/instagram-preview` | Generate IG post preview JPEG |
| `POST` | `/api/export/start/{project_id}` | Start TikTok background export |
| `GET` | `/api/export/progress/{project_id}` | Poll TikTok export progress |
| `POST` | `/api/export/instagram-render/{project_id}` | Start Instagram background export |
| `GET` | `/api/export/instagram-progress/{project_id}` | Poll Instagram export progress |
| `POST` | `/api/export/split-image/{project_id}` | Upload split-screen image |
| `GET` | `/api/export-info/{project_id}` | Download clips_info.txt |
| `POST` | `/api/meme/process` | Upload videos + start meme batch |
| `GET` | `/api/meme/status/{batch_id}` | Poll meme batch status |
| `GET` | `/api/meme/download/{batch_id}/{index}` | Download finished meme video |
| `POST` | `/api/meme/reexport/{batch_id}/{index}` | Re-export meme with new slider settings |
| `POST` | `/api/stream/start` | Start live stream recording session |
| `POST` | `/api/stream/stop/{session_id}` | Stop recording session |
| `GET` | `/api/stream/status/{session_id}` | Poll session status + segments |
| `GET` | `/api/stream/download/{session_id}/{segment_index}` | Download recorded segment as MP4 |
| `GET` | `/api/stream/sessions` | List all stream sessions |

---

## ⚠️ Known Issues

| Issue | Status |
|-------|--------|
| In-memory project store resets on server restart | 🟡 By design; disk persistence not implemented |
| `--reload` unreliable on Windows | 🟡 Kill `python.exe` and restart manually after backend changes |
| Meme batch resets on server restart | 🟡 Same as above — `meme_batches` is in-memory |

---

## 🌍 Environment Variables

Create `backend/.env`:
```env
GOOGLE_API_KEY=your_gemini_api_key_here
```

---

## 📄 License
MIT License
