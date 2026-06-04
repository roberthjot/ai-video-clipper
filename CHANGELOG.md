# AI Video Clipper — Changelog

A running log of all the improvements added on top of v9.5 base.

## ⚙️ Per-clip styles, editable prompts, editable API key

### Per-clip style overrides — "Aplicar a: Todos / Este clip / Varios"
- A scope selector at the top of the Visual Editor (Paso 3) decides where style
  edits go: the whole project (`project.style`, default), only the selected clip,
  or all the clips checked in "Clips a exportar".
- `ClipData.style_override` (per-clip `StyleConfig`); `PUT/DELETE
  /api/export/style/{project}/{clip}`. Preview + export use
  `clip.style_override or project.style`. "Usar estilo general" clears a clip's
  override. Frontend keeps overrides in sync and only writes a real edit (never a
  spurious override on mere scope/clip switching).

### Editable prompts (Ajustes → Prompts)
- New `services/prompts.py` registry: every Gemini prompt (analysis, timestamp
  verification, alternates, per-clip reanalyze, meme text/crop, music artist/vibe,
  IG descriptions) lives there as a default template with `{{TOKEN}}` markers.
  `gemini_service`, `meme_service` and `clips.py` now render from the registry.
- Overrides are persisted to `prompts.json` (gitignored) and survive restart.
  `GET/PUT/POST-reset /api/prompts`. The UI lists every prompt with its tokens,
  an editable textarea, and Guardar / Restablecer.

### Editable Gemini API key (Ajustes)
- The API key can be changed from the UI: `gemini_service.set_api_key()` recreates
  the client and persists to `runtime_config.json` (gitignored); on boot it uses
  that file if present, else `.env`. `GET /api/settings/api-key` returns only a
  masked preview; `PUT` swaps it. `meme_service` now uses the live client.

### Misc
- Browser tab: title "Clipper" + scissors favicon (`public/clipper.svg`).

## 🎨 "Studio" frontend redesign (light/dark)

Full visual redesign of the React UI to a minimal, Notion-like **Studio** look
(off-white / near-black, no gradients, no emojis), faithful to the handoff in
`design_handoff_clipper_studio/` (README + `screenshots/`). **Backend and all app
logic are unchanged — this is purely the visual layer + theming.**

### Design tokens & theming
- `frontend/src/theme.css`: `--st-*` CSS variables for **light and dark**
  (bg/surface/alt/soft/border/line/text/muted/faint/accent/on-accent + semantic
  ok/live/gold), font families (Bricolage Grotesque / Hanken Grotesk / JetBrains
  Mono), shared classes (`.st-btn`, `.st-card`, `.st-input`, `.st-select`,
  `.st-textarea`, `.st-iconbtn`, `.st-eyebrow`, `.st-row` for `<details>`),
  `@keyframes st-spin` + `pulse`. Theme via `data-theme` + `ThemeContext`.
- App wrapped in `.st-root`; dark mode toggled from the sidebar and Ajustes.

### Shared UI module (`frontend/src/components/studio.jsx`)
- `StSection`, `StChip`, `StSlider`, `StToggle`, `StFieldRow`, `StRow`
  (collapsible), `StSegmented` — single source of truth for the building blocks.
  De-duplicated the two slider components (EditorMode `FrameSlider` is now a thin
  adapter over `StSlider`) and the Settings toggle/row.

### Screens migrated
- **Sidebar** (left nav, project selector, Gemini chip, Ajustes + theme toggle).
- **Subir video** (`UploadStep`) — clean dropzone + config card; emoji-free
  content-type chips with line icons; **Modelo de IA** and **Analizar un rango**
  collapsed into expandable rows; model labels de-emojified.
- **Clips detectados** (`ClipsStep`, `ScoreBadge`, `ConfDot`).
- **Visual Editor / Paso 3** (`EditorStep`) — header (TikTok/Instagram segmented
  + Exportar todos) + preview (caption/watermark drag preserved) + 360px inspector
  with always-open sections and collapsible rows (Text Overlay, Watermark, Split
  Screen, Formato IG, Opciones de texto, Anti-Detect, Clips a exportar).
- **Editor** (`EditorMode`) — full-screen studio layout (60px tool rail replaces
  the sidebar) + preview/transport + 312px inspector + bottom timeline.
- **Analyzer**, **Live Stream**, **Meme Generator / Music Vibe**, the **Analizando**
  flow (stepper + SVG progress ring), the **Exportando / Export completado** flows,
  and a new **Ajustes** screen (only the dark-mode toggle is wired; other settings
  are display/local-state placeholders — no settings store yet).

### Responsive
- Sidebar and the editor inspectors use `clamp()` widths so narrow windows don't
  crush the preview/content.

### Global model selection
- New `ModelContext.jsx` (localStorage-persisted) — the chosen Gemini model is a
  single source of truth shared by the sidebar chip, **Ajustes** (now a real
  dropdown), and the Upload/Analyzer model pickers. Change it anywhere and the
  sidebar chip updates live. (API Key stays read-only — it loads from the server
  `.env`.)

### Visual Editor centering guides
- Center guide lines (vertical + horizontal) in the Paso 3 preview, toggled by a
  **Guías** button. The draggable caption now also works while a preview is
  showing, **snaps** to the center on each axis (~2.5% threshold), and the
  matching guide turns gold when snapped.

## 🎬 Editor mode + manual editing session (v9.6)

A whole new **standalone Editor** (5th mode button) plus per-clip editing in
the Video Clipper. No AI clip detection — fully manual editing.

### New mode: 🎬 Editor (`routes/editor.py`, `EditorMode` in App.jsx)
- Upload a video → cut it on a CapCut-style timeline → add subtitles → export.
- `POST /api/editor/upload`, `POST /api/editor/{id}/transcribe` (Whisper runs
  only on the current cut, not the whole video), `PUT /api/editor/{id}/segments`,
  `POST /api/editor/{id}/thumbnails`, `POST /api/editor/{id}/overlay-image`,
  plus static serve routes for thumbs/overlays.

### Timeline editor (compacted, reorderable — CapCut model)
- `ClipData.segments: list[Segment]` — kept pieces in playback order.
- Thumbnail strip, ruler for scrubbing, blocks below.
- **Cut** (split at playhead), **delete**, **reorder** (drag blocks),
  **resize** (drag right edge to stretch).
- Playback plays segments in array order, skipping removed gaps.
- Export uses **concat-first**: kept pieces are concatenated to a temp mp4
  (`video_service.concat_segments`), then the normal export pipeline runs on it.
  Transcript is remapped to the cut timeline (`remap_transcript_to_segments`).

### Keyframes (animated zoom/pan)
- `ClipData.keyframes: list[Keyframe]` → FFmpeg `zoompan` expression
  (`build_zoompan_filter`) with linear interpolation. Live JS interpolation in
  the editor modal preview.

### Per-segment speed
- `Segment.speed` (0.25x–4x). Video: `setpts` + `atempo` chain. Audio pitch
  preserved. Output duration recomputed per segment.

### Image as a clip
- `Segment.type == "image"` — a still spliced into the timeline (full-screen,
  silent, configurable duration). Normalised to canvas size in concat.

### Image overlays
- `StyleConfig.image_overlays` — images burned on top of the video for a time
  range, draggable + resizable in the preview, `enable='between(t,a,b)'`.

### Aspect ratio
- `StyleConfig.aspect_ratio`: 9:16 / 1:1 / 16:9 / 4:5
  (`video_service.get_canvas_dimensions`). Export + preview adapt.

### Subtitle vertical position
- `StyleConfig.subtitle_y` (-0.5..+0.5) offsets the ASS `marginV`. Slider in
  the editor. Live word-by-word overlay (`SubtitleOverlay`) renders all 8
  styles in CSS so the user sees subtitles on the video while editing.

### Mouse pan/zoom in preview
- Drag the video to reposition, wheel to zoom → writes `edit_zoom/pan_x/pan_y`.

### Fill-mode fine-tune
- `StyleConfig.fill_mode_scale` (0.5–1.5) multiplies the chosen fill preset.

### Bug fixes
- **`video_preview` 500 (UnboundLocal `video_h`)** — overlay-XY was built
  outside the `if use_split` block. Now built inside each branch.
- **`no_text` hid subtitles in editor** — that flag also disables burned-in
  subtitles; editor now sends `no_text:false` (AI caption is empty anyway).
- **Chunked analysis**: threshold raised 10min → 30min (15-min chunks); failed
  chunks now retry 2×; single-shot also retries. Fixes "asked 9, got 5".
- **Timeline reorder drag** conflicted with click-to-seek → split into a ruler
  (scrub) + manual drag with movement threshold.
- **Playhead** now moves via RAF while playing (was stuck at start).
- Exposed real tracebacks in the `video-preview` route + FFmpeg cmd/stderr logs.

---

## Latest session additions

### Cinematic visual filters
5 color-grading filters (selectable per project, applied in both preview and export):
- **🎬 Cinematic** — teal shadows + orange highlights + S-curve contrast
- **🌅 Warm** — golden / yellow "main character energy" shift
- **⚡ Vivid** — strong saturation (1.65) + contrast (1.30) for stop-scroll
- **🌑 Moody** — heavy desaturation (0.55) + darker + cool tint
- **⚫ B&W** — full desaturation + contrast boost

Filters were intensified after the first pass — original values were too
subtle to notice on a TikTok feed.

### 5 additional subtitle styles
On top of the original Limpio / Karaoke / Pop-up, added:
- **📦 Highlight Box** — Submagic-style, active word in black on yellow box
- **🔠 Big Center** — single giant word at vertical center, high impact
- **2️⃣ Two-Word** — two words per group, fast rhythm for beat-driven clips
- **🎢 Bounce** — strong bounce-in animation, overshoot + settle
- **⌨️ Typewriter** — letters appear progressively within each word

### Subtitle size slider
- Range 60% → 160% of base font size
- Appears in the editor when a subtitle style is active
- Reset button, auto-refreshes preview on change

### Mini fill mode
- New "Mini" video size option at 50% of canvas height
- Smallest option, more blur background visible
- Available in both TikTok and Instagram exports

### Emoji rendering fixes
- Caption box height bumped from 1.25× to 1.40× font size so emojis fit
- TikTok caption style (transparent + outline) now renders color emojis
  via Pilmoji on top of the outlined text (previously emojis were skipped
  or smeared by the stroke loop)
- `split_text_into_lines` now detects when the final line is only emojis
  and pulls the previous line's last word down — emojis never appear
  alone in their own tiny standalone box
- Emoji vertical alignment in TikTok style fixed via Pilmoji's
  `emoji_position_offset=(0, -font_size*0.80)` (Pilmoji anchors to the
  baseline, which is why naive y-shifts didn't work; the empirical offset
  needed is ~80% of font_size)
- White-box caption uses a smaller `emoji_position_offset` since Pilmoji
  draws text+emoji together there and handles most of the alignment

### Backend: on-the-fly model switching
- New `PUT /api/clips/{project_id}/model` endpoint
- Selector with 3 buttons above the clip list (2.5 Flash / 2.5 Pro / 3 Flash)
- Reanalyze (single + batch) uses the project's currently selected model
- User can switch when one model hits its quota — no re-upload needed


## Caption rendering

### TikTok-style staircase boxes
- Each line of the caption is rendered as its own fully-rounded white box
- Boxes are drawn bottom-to-top with a `radius`-pixel overlap so adjacent
  boxes meet seamlessly (no visible gap, no seam fill that flattens the look)
- When lines differ in width, the wider box's outer rounded corners stick
  out creating the TikTok "step" effect
- Corner radius is proportional: `int(line_h * 0.19)` ≈ 17px at font_size=72

### Caption text rules
- Word limit raised to **15 words**
- Up to **4 lines** of max **30 chars** each (was 3 × 25)
- Apostrophes preserved (he's, don't, that's all render correctly)
- All lowercase except first letter

### Emoji support (Apple/CapCut style)
- Gemini now appends exactly one emoji at the end of each caption,
  picked to match the moment's emotion:
  - Drama → 😱 💀 👀
  - Funny → 😂 🤣 💀
  - Motivational → 💪 🔥 ⚡
  - Sad → 💔 😭 🥺
  - Confession → 🤐 👀 😳
  - Wholesome → 🥰 ❤️
- Rendered with **Pilmoji** + Apple emoji source (same look as TikTok/CapCut)
- Caption regex preserves emoji unicode instead of stripping them
- Box width adjusts automatically to fit the emoji

## Subtitles (auto, burned into export & preview)

Three styles selectable per project:
- **Limpio** — white text + thick black outline, 3-4 words per line
- **Karaoke** — TikTok-style word-by-word highlight (current word yellow + slightly bigger)
- **Pop-up** — one word at a time with bounce-in animation (MrBeast style)
- **Ninguno** (default) — no subtitles

Implementation:
- Whisper word-level transcripts saved to `Project.transcript`
- `subtitle_service.generate_ass_for_clip()` builds ASS files per style
- FFmpeg `subtitles=` filter burns them into the output
- Windows path issue fixed by copying ASS to cwd and using basename only
- Export timestamps shifted by `buffer` seconds to align with the fast-seek
  trim (otherwise subtitles played during the trimmed-out buffer period)
- Subtitles also visible in preview (auto-refreshes when style changes)

## Gemini integration

### Model selector
- 3 buttons on upload + on the clips screen:
  - **⚡ 2.5 Flash** — 1500/day (default, recommended)
  - **🥇 2.5 Pro** — 50/day (highest quality)
  - **🆕 3 Flash** — 20/day (newest preview)
- Model saved per project (`Project.gemini_model`)
- Re-analyze uses the **project's** model, not the global config
- New `PUT /api/clips/{id}/model` endpoint to switch model mid-session

### Better prompt
- Caption rules: third person, lowercase, apostrophes allowed, 1 emoji at end
- **Distribution rule**: forces clips across all three thirds of the video
  with explicit timestamps for each third (no more clustering at the start)
- Asks Gemini for `viral_score` (1-10), `viral_score_reason`, and a long
  `ig_description` (3-4 paragraphs + hashtags) for Instagram posting

### Result post-processing
- Clips returned > requested count → truncated to requested count
- Post-retry truncate too (was adding more after retry)
- Whisper transcript passed to Gemini as word-level timestamps for accuracy

### Chunked analysis for long videos (>10 min)
- Videos longer than 10 min are split into chunks of ~10 min each
- Each chunk uploaded + analyzed separately so Gemini's timestamps stay
  precise within a small time window
- Chunk-local timestamps shifted back to global video time before merging
- Whisper transcript filtered per chunk for accurate per-chunk context
- Result: significantly fewer wrong timestamps in long videos
- Each chunk's clip count scaled proportionally to total requested

### Batch re-analyze
- Checkboxes on each clip card to select multiple
- "Re-analizar seleccionados" button processes them sequentially with
  **20-second delay between requests** to avoid hitting rate limits

### Whisper + Gemini in parallel
- Whisper transcription starts as an `asyncio` task at the very beginning
  of `/api/clips/analyze`, running concurrently with the Gemini upload +
  processing + token count
- Saves ~30-40% of total analysis time on long videos because Whisper is
  local CPU and Gemini is a remote network call — they don't compete

## Performance — FFmpeg

### Intel QSV hardware encoding (with fallback)
- New `get_video_codec_args()` and `_qsv_supported()` helpers
- Detects whether the bundled FFmpeg has `h264_qsv` available (cached)
- Both preview and export try QSV first; on encoder failure they automatically
  retry the same command with `libx264` so it never just fails
- On Intel CPUs with working QSV drivers: 2-3x faster preview/export with no
  visible quality difference at our CRF settings

### Faster Play Clip preview
- `-preset ultrafast` for x264 (was `fast`)
- `-crf 28` for x264 (was `23`) — smaller file, faster encode
- Output downscaled to 720x1280 at the end of the filter chain (3x fewer
  pixels to encode while the layout is still composed at 1080x1920)
- **Export pipeline is untouched** — keeps full 1080x1920 + preset `fast` + CRF 23

## Video formats (fill modes)

Available sizes for both TikTok and Instagram exports:
- **Fit** — 100% width (default, full screen width)
- **Zoom** — 90% height
- **Small** — 78% height
- **Medium** — 65% height
- **Mini** — 50% height (new, smallest)
- **Fill** — full frame cover (crops sides)

## UX improvements

### Redesigned loading screen
- Phase indicators (📤 Subiendo → 🧠 Analizando) with green checkmarks
- Big animated icon, gradient progress bar with glow
- Live `statusMsg` from polling shown in monospace below the title
- Info tip during the analyzing phase

### Content type buttons (upload step)
- **🎭 Drama / Entretenimiento** — default, uses the standard prompt
- **💪 Motivacional** — auto-fills custom prompt with motivational-content
  instructions (inspirational quotes, transformation stories, etc.)

### Clip review (clips step)
- Viral score badge on each clip (1-10 with one-line reason)
- Sort by: original / mayor score / menor score
- Filter by duration (min/max sliders)
- Drag-and-drop reorder
- Image preview (fast JPEG) + Play Clip (video preview)
- Browser notification when analysis completes
- Live model switcher above the clip list

## Bug fixes worth remembering

- `UnboundLocalError: transcript_section` — used `__TRANSCRIPT_SECTION__`
  placeholder + `.replace()` instead of putting it inside an f-string
- Caption seam visible — replaced "fill the gap with rectangle" approach
  (made boxes look merged/flat) with per-corner rounding + bottom-to-top draw
- Subtitle ordering bug — buggy `words.index(w)` lookup confused duplicate
  words like "the" / "y"; switched to strict slice-based grouping
- Subtitle commas/symbols — added `_clean_word()` to strip punctuation per word
- Subtitle export misalignment — added `time_offset` (= fast-seek buffer)
  so subs render at the right moment after the output trim
- Caption preview not refreshing on style change — `subtitle_style` and
  `caption_style` missing from the auto-refresh `useEffect` dep array
- Reanalyze used global `settings.GEMINI_MODEL` instead of `project.gemini_model`
- Clip count exceeded requested target — added post-retry truncation

## Notes on Gemini free tier (as of May 2026)

- **gemini-2.5-flash** — 1500/day, the workhorse, fast
- **gemini-2.5-pro** — 50/day, best quality (lots of users hit this fast)
- **gemini-3-flash-preview** — 20/day, newest model
- All three return 503 UNAVAILABLE during peak USA hours — that's Google's
  capacity, not your code/network. Retry later or switch models.
