# AI Video Clipper — Changelog

A running log of all the improvements added on top of v9.5 base.

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
