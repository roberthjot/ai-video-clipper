# AGENTS.md — AI Video Clipper

> Read this first. This file is the authoritative onboarding guide for AI
> coding agents (Codex, Claude Code, etc.) working on this repo. It reflects
> the **current** state of the code, not the older `ARCHITECTURE.md` (which is
> stale — v2.0 era, ignore the `analysis.json` references in it).
> For a feature-by-feature history see `CHANGELOG.md`.

---

## 1. What this is

A local full-stack web app that uses Google Gemini to find viral moments in
long videos and export them as 9:16 vertical clips (TikTok / Reels / Shorts)
with CapCut-style captions, burned-in subtitles, emojis, and cinematic filters.

- **Backend**: Python + FastAPI, port **8000**
- **Frontend**: React + Vite, port **5173**
- **AI**: Google Gemini (model selectable per project)
- **Transcription**: faster-whisper (local, CPU)
- **Video**: FFmpeg (via `imageio-ffmpeg` bundled binary) + PIL/Pilmoji

It is a **single-user desktop-style app**. The project store is **in-memory**
(`backend/app/routes/upload.py: projects = {}`) and is **wiped on every
backend restart** by design. Uploaded files persist on disk but their
`Project` metadata (clips, transcript, style) does not.

---

## 2. Quick start

### Backend
```bash
cd backend
python -m uvicorn app.main:app --reload --port 8000
# or from repo root: start_server.bat
```
- Requires `GOOGLE_API_KEY` in `/.env` at repo root (see `.env.example`).
- Dependencies: `backend/requirements.txt`
  (`google-genai python-dotenv imageio-ffmpeg fastapi[standard]
  uvicorn[standard] python-multipart pydantic pilmoji`).
- `faster-whisper` is also required at runtime (imported lazily in
  `whisper_service.py`); install with `pip install faster-whisper` if missing.
- First Whisper run downloads the `base` model (~150 MB) to the HF cache.

### Frontend
```bash
cd frontend
npm install
npm run dev          # serves on http://localhost:5173
# or from repo root: start_frontend.bat
```
- API base is hardcoded to `http://localhost:8000/api` in
  `frontend/src/services/api.js`.

### Environment
- `.env` (repo root): `GOOGLE_API_KEY=...` — loaded by `backend/app/config.py`.
- `.env` is gitignored. Never commit it.

---

## 3. Directory map (current, accurate)

```
ai-video-clipper/
├── .env                       # GOOGLE_API_KEY (gitignored)
├── AGENTS.md                  # this file
├── CHANGELOG.md               # detailed feature/fix log — keep updated
├── ARCHITECTURE.md            # STALE (v2.0) — do not trust details
├── README.md                  # user-facing docs
├── start_server.bat / start_frontend.bat
├── uploads/                   # raw uploaded videos: {project_id}_{filename}
├── projects/{project_id}/     # per-project output
│   ├── preview_clip_{id}.mp4  # cached Play-Clip previews
│   ├── preview_clip_{id}.jpg  # image previews
│   ├── exported/              # final TikTok exports + clips_info.txt
│   ├── watermark.png / split_image.png
│   └── _meme_exports/, _meme_uploads/  (Meme Generator mode)
├── backend/app/
│   ├── main.py                # FastAPI app, CORS, route registration
│   ├── config.py              # Settings: GOOGLE_API_KEY, GEMINI_MODEL, dirs
│   ├── models/
│   │   ├── clip.py            # ClipData, StyleConfig, request models
│   │   └── project.py         # Project (in-memory record)
│   ├── routes/
│   │   ├── upload.py          # POST /api/upload, GET /api/status/{id}, project store
│   │   ├── clips.py           # POST /api/clips/analyze, previews, reanalyze, model switch
│   │   ├── export.py          # PUT /api/export/style, export endpoints
│   │   ├── stream.py          # Live-stream recording mode
│   │   └── meme.py            # Meme Generator mode
│   └── services/
│       ├── gemini_service.py  # Gemini calls, prompt, clip parsing, chunking,
│       │                      #   emoji whitelist, transcript validation
│       ├── whisper_service.py # faster-whisper transcription (word timestamps)
│       ├── subtitle_service.py# ASS subtitle generation (8 styles)
│       ├── video_service.py   # FFmpeg previews, caption PNG (PIL/Pilmoji),
│       │                      #   QSV helper, visual filters, line splitting
│       ├── export_service.py  # Final export FFmpeg filter chains
│       ├── video_service_SIMPLE.py  # legacy/unused fallback — ignore
│       ├── meme_service.py    # Meme Generator logic
│       └── stream_service.py  # Live-stream recording logic
└── frontend/src/
    ├── App.jsx                # ENTIRE UI (single file, ~1600 lines):
    │                          #   UploadStep, ClipsStep, EditorStep,
    │                          #   LiveStream, MemeGenerator
    ├── App.css / index.css
    └── services/api.js        # all fetch/XHR API client functions
```

---

## 4. Core pipeline (video clipper, the main mode)

1. **Upload** (`POST /api/upload`) → saves file to `uploads/`, creates
   in-memory `Project`. Form fields: `clip_count`, `min_duration`,
   `custom_prompt`, `gemini_model`, `creator_name`.
2. **Analyze** (`POST /api/clips/analyze`):
   - Whisper transcription starts **in parallel** (asyncio task) with the
     Gemini file upload + processing (saves ~30-40% wall time).
   - If video > **10 min** → **chunked analysis**: video is split into
     ~10-min segments (`gemini_service.build_chunk_ranges` +
     `extract_video_chunk`), each uploaded & analyzed separately, chunk-local
     timestamps shifted back to global time, merged, deduped, truncated to
     `clip_count`. This is the single biggest accuracy improvement for long
     videos — keep it intact.
   - Else → single-shot analysis.
   - Transcript saved to `project.transcript`; each clip gets
     `transcript_snippet` + `match_confidence` (caption-vs-transcript check,
     local & free).
3. **Review** (ClipsStep in `App.jsx`): list of clips, viral score, duration
   filter, confidence filter, **📄 Guión** modal (shows Whisper transcript
   vs caption side by side), on-the-fly model switcher, batch reanalyze
   (20 s delay between requests to dodge rate limits).
4. **Preview**: `🖼 Preview` = fast JPEG frame; `▶ Play` = 10 s MP4 with
   captions + subtitles + filter burned in (720×1280, `ultrafast`, CRF 28 —
   preview only).
5. **Style & Export** (EditorStep): caption style, subtitle style + size
   slider, cinematic filter, fill mode, watermark, split-screen, anti-detect.
   `PUT /api/export/style/{id}` saves `StyleConfig` to the project.
6. **Export** (`export_service.export_clip_with_style`): full 1080×1920,
   preset `fast`, CRF 23 — **never downgrade export quality for speed**.

### FFmpeg filter chain (TikTok export, no split)
```
input -ss(fast_seek=start-4) -to ... 
  [0:v] scale 1080x1920 + boxblur  -> [bg]
  [0:v] {fill_mode scale}          -> [fg]
  [bg][fg] overlay center          -> [v]
  [v][caption.png] overlay         -> [boxed]
  [wm] scale+alpha ; overlay       -> [watermarked]
  anti-detect (hflip/zoom/eq)      -> [uniquified]
  subtitles={ass basename}         -> [subbed]
  cinematic filter (eq/colorbalance)-> [...]
  format=yuv420p                   -> [out]
-ss(buffer) -t(duration) accurate output trim
```
Inputs order: `[0]=video [1]=split image? [2]=caption png [3]=watermark`.

---

## 5. Critical gotchas (read before editing)

- **In-memory store**: restarting the backend deletes all projects. A clip's
  `transcript`/`style` only exist while the server is up. Old `project_id`s
  404 after restart.
- **Windows + FFmpeg `subtitles=` filter**: absolute Windows paths break the
  filter (drive-letter colon parsed as a param separator). The working
  solution: copy the `.ass` to the current working dir and pass the
  **basename only**. Do not "fix" this back to absolute paths.
- **Caption rendering is PIL/Pilmoji, NOT FFmpeg drawtext.**
  `video_service.create_caption_overlay` (white box) and
  `create_tiktok_caption_overlay` (white text + outline) render a PNG that is
  overlaid by FFmpeg. This avoids all drawtext escaping issues.
- **Emoji vertical offset**: Pilmoji anchors emojis to the font baseline.
  TikTok caption shifts the emoji up via `emoji_position_offset=(0,
  -font_size*0.80)`. Naive y-shifts do **not** work — must use Pilmoji's
  `emoji_position_offset`.
- **Emoji whitelist**: only 14 emojis are allowed
  (`gemini_service.SAFE_EMOJIS`). The prompt restricts Gemini and
  `filter_emojis_to_whitelist()` strips anything else (prevents "tofu"
  missing-glyph boxes). Keep both in sync.
- **Lowercase rule vs creator name**: captions are lowercased except the
  first letter. `restore_name_casing()` re-capitalizes creator names after.
  Known limitation: it uses substring matching, so short names that are
  substrings of common words (Rain, Sky, Rose) will mis-capitalize
  ("raining" → "Raining"). Add word boundaries if fixing.
- **Filename non-ASCII crash**: the Gemini SDK puts the upload filename in an
  HTTP header (ASCII only). Files with curly quotes/accents (e.g.
  `Here's.mp4` with U+2019) crash `client.files.upload`. Current workaround
  is **manual**: user renames the file. There is no auto-sanitization in the
  repo (a fix was written and reverted at the user's request — do not
  re-add without asking).
- **Gemini models** (whitelisted in `gemini_service.VIDEO_ANALYSIS_MODELS`):
    - `gemini-2.5-flash` — free 1500/day (default, recommended)
    - `gemini-2.5-flash-lite` — free ~1000/day
    - `gemini-3.1-flash-lite-preview` — free, preview
    - `gemini-3-flash-preview` — free 20/day
    - `gemini-2.5-pro` — free 50/day
    - `gemini-3.5-flash` — **paid only** ($1.50/$9 per 1M tok, released May 2026)
    - `gemini-3.1-pro-preview` — **paid only**
  Free tier returns 503 during peak hours (Google capacity, not a bug).
  429 = quota exhausted → switch model. No automatic retry/backoff is
  implemented yet.
- **Model health check**: `POST /api/clips/model-health` sends a tiny "ok"
  prompt to each requested model and classifies the response as
  `ok | quota | unavailable | error | invalid`. The frontend `ModelSelector`
  component shows this status as a colored badge on each model button. This
  is a **light** signal — a model that passes the ping can still fail later
  on a big video request due to token-level capacity pressure.
- **Intel QSV**: `video_service.get_video_codec_args()` tries `h264_qsv`,
  falls back to `libx264` automatically if the bundled FFmpeg lacks QSV or
  it fails at runtime. Don't assume QSV is present.
- **`--reload` on Windows** is unreliable — a clean restart (kill python.exe)
  is often needed for changes to take effect.
- **`config.py: GEMINI_MODEL`** is only the *global default*. Per-project
  model lives in `project.gemini_model`; reanalyze and analyze both use the
  project's choice. Don't hardcode `settings.GEMINI_MODEL` in request paths.

---

## 6. Key data shapes

`StyleConfig` (`backend/app/models/clip.py`) — saved per project, drives
export & preview:
- `text_x/text_y`, `font_size`, fill `fill_mode`
  (`fit|medium|mini|zoom|fill|small`)
- `caption_style`: `box` | `tiktok`
- `subtitle_style`: `none|clean|karaoke|popup|highlight|big_center|twoword|bounce|typewriter`
- `subtitle_size_scale`: 0.6–1.6
- `visual_filter`: `none|cinematic|warm|vivid|moody|bw`
- `watermark_*`, `split_screen_enabled/split_image_path/split_ratio`
- IG-specific: `ig_fill_mode`, `ig_top_padding`, `ig_watermark_y`
- anti-detect: `strip_metadata`, `flip_horizontal`, `zoom_uniquify`,
  `boost_contrast`

`ClipData`: `id, start_time, end_time, description, viral_caption,
viral_reason, viral_score (1-10), viral_score_reason, ig_description,
duration, transcript_snippet, match_confidence`.

`Project`: adds `transcript` (Whisper dict), `gemini_model`,
`creator_name`, `style`, `clips`, in-memory only.

---

## 7. Conventions

- Captions: third person, ≤15 words, no punctuation except apostrophes, all
  lowercase except first letter, exactly one whitelisted emoji at the end.
- Subtitle/visual changes must be applied in **both** `video_service.py`
  (preview) and `export_service.py` (final) — they have parallel filter code.
- The frontend auto-refreshes the preview (300 ms debounce) when style
  fields change; new style fields must be added to the `useEffect` dependency
  array in `App.jsx` (search `Auto-refresh preview when style changes`).
- Keep `CHANGELOG.md` updated when adding features.
- Don't create new docs/files unless asked; prefer editing existing ones.
- The user communicates in Spanish; code/comments are in English.

---

## 8. Where to look for X

| Task | File |
|------|------|
| Gemini prompt / clip parsing / chunking | `services/gemini_service.py` |
| Subtitle styles (ASS generation) | `services/subtitle_service.py` |
| Caption PNG (box + TikTok + emoji) | `services/video_service.py` |
| Cinematic filters | `video_service.get_visual_filter_chain` |
| Preview generation (Play Clip) | `video_service.generate_preview_clip` |
| Final export filter chain | `services/export_service.py` |
| Whisper transcription | `services/whisper_service.py` |
| Analyze orchestration / chunking loop | `routes/clips.py` |
| Upload / project store / status | `routes/upload.py` |
| Style save endpoint | `routes/export.py` |
| All UI (modes + Editor) | `frontend/src/App.jsx` |
| API client | `frontend/src/services/api.js` |
| Editor mode (upload/transcribe/segments/thumbnails/overlays) | `routes/editor.py` |
| Multi-segment concat / speed / image-clip / thumbnails | `services/video_service.py` (`concat_segments`, `get_canvas_dimensions`, `build_zoompan_filter`, `remap_transcript_to_segments`) |
| Editor UI (timeline, keyframes, overlays, ratio, speed) | `frontend/src/App.jsx` (`EditorMode`, `TimelineEditor`, `SubtitleOverlay`, `ClipEditorModal`) |

### Editor mode (v9.6) — quick map
- **Modes**: video / analyzer / stream / meme / **editor** (5th button).
- Editor is manual (no Gemini). `ClipData` gained `segments` (cuts, in playback
  order), `keyframes`, `edit_zoom/pan_*`. `Segment` has `speed` and a
  `type: "video"|"image"`. `StyleConfig` gained `aspect_ratio`,
  `image_overlays`, `subtitle_y`, `fill_mode_scale`.
- **Export concat-first**: if `clip.segments` is non-empty, `export_clip_with_style`
  concatenates the kept pieces to a temp mp4 first, then runs the normal
  pipeline on it (so subtitles/keyframes/overlays timing is trivially correct).
- Whisper for the editor runs **only on the current cut**, on demand
  (`POST /api/editor/{id}/transcribe`), not the whole upload.
