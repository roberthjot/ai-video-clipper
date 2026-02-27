# 🎬 AI Video Clipper v7.9

An intelligent, full-stack web application that automatically identifies, extracts, and edits viral-worthy moments from long videos — styled like CapCut/TikTok clips.

**Powered by:** Google Gemini 2.5 Pro + FFmpeg + PIL

---

## ✨ Features

- **🧠 AI Analysis**: Uploads video to Gemini, which watches it and identifies the most engaging, funny, or dramatic moments automatically.
- **✂️ Smart Clipping**: Extracts clips with precise timestamps, each with a different duration (up to 60s max) based on the moment.
- **🎞️ Live Preview**: Play generated clips directly in the browser before exporting.
- **🎨 CapCut-Style Overlay**:
  - White rounded box (radius=14) with black **Calibri Bold** font text (72px)
  - Box width measured precisely with PIL `getlength()` — fits text exactly
  - Max 3 lines, 25 chars per line — clean 1–2 line distribution for short captions
  - Blurred background (boxblur) with centered subject
  - Apostrophes escaped as `\'` for FFmpeg — renders as `'` in the video (he's, don't, that's)
  - Emoji characters automatically stripped (FFmpeg drawtext limitation)
- **💧 Watermark Support**: Upload your own logo/watermark and overlay it on all clips.
- **📦 Selective Export**: Choose exactly which clips to render and download.
- **📊 Real-time Progress**: Track upload, analysis, and export with live status bars.
- **📱 9:16 Vertical Format**: Auto-crops and scales to vertical format optimized for TikTok, Reels, and Shorts.
- **🔲 4 Video Format Modes**: Fit (full width) · Zoom (90% height) · Small (78% height, blur borders) · Fill (full frame, no borders).
- **📐 Watermark Center Guide**: Dashed vertical line at canvas center appears while positioning the watermark logo — ensures perfect horizontal alignment.
- **📄 Clips Info TXT**: After exporting, download a `clips_info.txt` file with each clip's title, timestamps, caption, and why it went viral.
- **🚫 No overlay on preview**: Draggable text/watermark HTML elements hidden when preview image/video is active.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite (vanilla CSS) |
| Backend | Python + FastAPI + Uvicorn |
| AI Model | Google Gemini 2.5 Pro |
| Video Processing | FFmpeg + PIL (Pillow) |
| Text Rendering | FFmpeg `drawtext` with Calibri Bold font |
| Box Rendering | PIL-generated rounded rectangle PNGs overlaid via FFmpeg |

---

## 🚀 Installation

### Prerequisites
- Python 3.10+
- Node.js 18+
- FFmpeg installed and accessible (or via `imageio-ffmpeg`)
- [Google AI Studio API Key](https://aistudio.google.com/)
- Windows (font paths use `C:/Windows/Fonts/calibrib.ttf`)

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

> ⚠️ **Important:** If you make code changes, always kill and restart the backend manually. `--reload` on Windows does not always reload modules correctly.
> ```bash
> taskkill /F /IM python.exe
> ```

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

> 💡 **Tip for large videos:** For 30+ minute videos, compress to 720p first (HandBrake is free) to avoid Gemini upload limits (~2GB).

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
│   │       ├── gemini_service.py    # Gemini API calls + clip parsing + prompt
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
  - Corner radius: `14px`
  - Padding: `12px horizontal, 8px vertical`
  - Width measured with `ImageFont.getlength()` — pixel-perfect fit
- Overlaid on video using FFmpeg `overlay` filter
- Text rendered on top using FFmpeg `drawtext` with **Calibri Bold** font (72px)
- Max **3 lines**, 25 chars per line — short captions naturally fit in 1–2 lines
- Apostrophes escaped as `\'` for FFmpeg — renders correctly as `'` in the final video
- Non-ASCII characters (emojis) stripped before passing to FFmpeg

### Video Format Modes
| Mode | FFmpeg Scale | Result |
|------|-------------|--------|
| `fit` | `scale={W}:-2` | Full width (1080px), letterboxed |
| `zoom` | `scale=-2:{H*0.9}` | 90% of frame height, slight blur border |
| `small` | `scale=-2:{H*0.78}` | 78% of frame height, visible blur borders |
| `fill` | `scale=-2:{H}` | Full frame height, no blur border visible |

### Gemini Caption Rules
- **Max 10 words** per caption (strict, counted in prompt)
- **Third person only** — "He got the moves", "Watch her reaction"
- No "I", "Me", "My", "POV: You..."
- No punctuation, all lowercase
- Written as if a fan account reporting on the creator
- Clip duration: variable per clip, min set by user, max 60 seconds

### Video Processing Pipeline
```
Input Video
  → -ss start -to end (precise seek BEFORE input)
  → scale to 1080x1920 (blurred background)
  → overlay original centered (clear subject)
  → overlay rounded white PNG box (-loop 1 -t duration)
  → drawtext (Calibri Bold, black, centered)
  → overlay watermark PNG (-loop 1 -t duration)
  → encode H.264 + AAC, SAR 1:1
  → Output MP4 (browser compatible)
```

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

### Added in v7.8
| Feature | Detail |
|---------|--------|
| "Small" video format | `scale=-2:{H*0.78}` — 78% of frame height, visible blur borders on all sides |
| Watermark center guide | Dashed vertical line at `left: 50%` on canvas when watermark is loaded and no preview active |

### Fixed in v7.x
| Version | Fix |
|---------|-----|
| v7.4 | `max_chars` increased 15 → 25 so captions fit in 1–2 lines instead of 3 |
| v7.3 | Box width no longer grows unbounded when font increases |
| v7.2 | Apostrophes removed entirely instead of replaced (TikTok style) |
| v7.1 | Switched from Arial Bold to Calibri Bold; font size 42 → 48 → 100px |
| v7.0 | Gemini model updated from deprecated `gemini-2.5-pro-exp` to stable `gemini-2.5-pro` |
| v6.9 | Fixed Gemini returning near-zero timestamps; fixed video preview deadlock; added clip deduplication |
| v6.8 | Fixed FFmpeg text crash on special chars; fixed preview not playing; rewrote Gemini prompt |

### Fixed in v6.0
| Bug | Fix |
|-----|-----|
| Draggable text/watermark visible on top of preview | Hidden when `previewUrl` or `videoPreviewUrl` is set in App.jsx |
| Text truncated on clips with long captions | Line 3 now absorbs all remaining words instead of cutting off |
| Caption word limit not enforced | Gemini prompt changed to strict 10-word max |
| All clips same duration | Gemini prompt updated to use variable durations up to 60s per moment |
| Box width too wide/narrow | Switched from char-count estimate to PIL `getlength()` pixel measurement |
| Border radius too large | Tested r=4, r=8, r=12, r=14 — user chose r=14 |

### Fixed in v5.0
| Bug | Fix |
|-----|-----|
| Emoji characters showing as boxes in video overlay | Strip non-ASCII with `re.sub(r'[^\x00-\x7F]+', '', text)` before FFmpeg drawtext |
| "Download Clips Info" button returned 404 | Endpoint reads `clips_info.txt` directly from disk |
| Server lost projects after code change + auto-reload | Download endpoint reads from disk path instead of in-memory store |

### Fixed in v4.0
| Bug | Fix |
|-----|-----|
| Exported clips were full video length | `-ss/-to` moved before `-i`, added `-t duration` to all `-loop 1` image inputs |
| Export showed "stuck at 100%" | Frontend checks both `"done"` and `"completed"` status |
| Video not playable in browser (SAR error) | Added `-sar "1:1"` to FFmpeg command |

### Active / Pending
| Issue | Status |
|-------|--------|
| In-memory project store resets on server restart | 🟡 By design for desktop app; disk-based persistence not yet implemented |
| `--reload` doesn't always apply changes on Windows | 🟡 Workaround: kill python.exe and restart manually after code changes |

---

## 🌍 Environment Variables

Create a `.env` file in `backend/`:

```env
GOOGLE_API_KEY=your_gemini_api_key_here
```

---

## 📄 License
MIT License
