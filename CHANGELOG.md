# AI Video Clipper — Changelog

A running log of all the improvements added on top of v9.5 base.

## 🎤 Whisper for Twitch clip flows (subtitles now work)

`process_clip_to_project` and `process_clips_batch_to_project` were skipping
Whisper entirely — they created projects with `project.transcript = None`.
Result: when the user opened the Editor and picked any subtitle style
(clean / karaoke / popup / etc.) the burned-in subs silently didn't render,
because `subtitle_service.generate_ass_for_clip` had no transcript to draw
from.

Fix:
- New shared helper `twitch_service._run_whisper(project_id, video_path)` —
  loads `whisper_service` lazily, transcribes, assigns the result to
  `project.transcript`. Non-fatal on failure (logs and continues; only the
  subtitle option becomes unavailable, the project still becomes `ready`).
- Both flows call it after the MP4 lands on disk and BEFORE spawning the
  Gemini caption background thread. Runs serially (~5-15s for a single
  clip, ~1-2 min for a batch of 10 concatenated clips). Whisper is local
  CPU; doesn't conflict with anything else.
- For the batch flow the transcript covers the WHOLE concatenated MP4,
  so each `ClipData`'s `start/end` already lines up with the right
  word-level timestamps for free — no manual remapping needed.

## 🌀 Cyclic mirror + sway (anti-detect for TikTok / Reels reuploads)

Two new editor effects that change the video's perceptual fingerprint without
moving the burned-in text — captions, watermark and subtitles stay fixed.

- **Cyclic mirror**: `hflip` toggles ON for N seconds, OFF for N seconds,
  repeating. Implemented via FFmpeg's `enable='lt(mod(t, N*2), N)'` so the
  flip is conditional on time. Slider exposes interval 1–10s (default 5).
  Applied to the FG stream BEFORE the caption / watermark / subs overlays,
  so those stay normal.
- **Sway**: foreground video drifts side-to-side following a sine curve.
  The overlay's X coordinate gets `+sin(2*PI*t/period)*amplitude`. Sliders
  for period (1–10s, default 3) and amplitude (10–100px, default 40).
- Both wired into `export_service.py` AND `video_service.generate_preview_clip`
  so the Play-clip preview shows the effect live (not just the final export).
  Added to `routes/clips.py: preview_clip_video` and to the auto-refresh
  `useEffect` dependency array so changes to the sliders re-render the
  preview within ~300ms.
- New fields in `StyleConfig`: `mirror_cyclic_enabled`, `mirror_cyclic_interval`,
  `sway_enabled`, `sway_period`, `sway_amplitude`.
- UI lives inside the existing 🛡 Anti-Detect section (Paso 3) — two
  toggle+slider cards alongside the existing chips.

## ⬇️ Universal video downloader (Fase 1)

New "Descargas" mode in the sidebar. Paste a URL from any major social site
and get the video back as MP4 (or MP3 audio). Powered by `yt-dlp` for most
sites + `tikwm.com` for TikTok specifically to bypass anti-bot blocks.

- **Sites**: YouTube, Instagram, TikTok (no watermark), Twitter/X, Twitch,
  Reddit, Vimeo, ~1000 others via yt-dlp's extractor registry.
- **Quality**: Máxima (default) → `bestvideo+bestaudio/best` merged via
  FFmpeg = 4K source preserved when available. Also 1080p / 720p presets +
  audio-only MP3 toggle.
- **TikTok fast path**: yt-dlp gets blocked by TikTok's anti-bot ("Your IP
  is blocked"). New cascade in `_worker()`: TikTok URLs hit `tikwm.com/api/`
  first (free public API that runs from rotating residential IPs — the same
  backend that powers SnapTik, SaveFrom, etc.). Returns the direct
  no-watermark MP4 URL + metadata. Falls back to yt-dlp if tikwm fails.
  End-to-end tested: 30-sec TikTok downloads in ~2 seconds, no watermark.
- **Backend**: new `services/downloader_service.py` with background jobs +
  progress tracking. `routes/downloader.py` exposes start / status / list /
  delete / stream-file endpoints.
- **Frontend**: new `DownloaderStep` component. Single URL input with live
  platform detection (📺 YouTube · 🎵 TikTok · 📸 Instagram · …). Active
  downloads show speed + ETA + progress bar. Finished items get a one-click
  download button. Polling switches off when the modal closes.
- **ffmpeg integration gotcha**: `imageio_ffmpeg` ships a versioned binary
  name (`ffmpeg-win-x86_64-v7.1.exe`), not `ffmpeg.exe`. yt-dlp's
  directory-based lookup couldn't find it. Fix: pass the binary's full
  path to `ffmpeg_location` (yt-dlp accepts a file path and uses it
  directly). curl-cffi is also installed to satisfy yt-dlp's
  "impersonation" requirement on modern TikTok extractor versions.

## 🎬 Twitch VOD download + viral clip discovery

A whole pipeline to take a Twitch VOD and end up in the editor with N
caption-ready clips, without leaving the app.

### VOD slice download (any URL with `/videos/`)
- HH:MM:SS inputs replace the minute-based chips when a VOD URL is pasted.
  Backend single-shot recording with `-c copy` (no re-encode) — a 30-min
  slice downloads in 2-5 minutes instead of 30. New fields on
  `StreamSession`: `is_vod`, `single_shot`, `start_offset_seconds`,
  `duration_seconds`.
- **Critical fix**: `streamlink`'s `hls-start-offset` doesn't propagate into
  the playlist URL we hand to FFmpeg, so every VOD download was starting
  at second 0 of the VOD regardless of the requested offset. Inject
  `-ss SECONDS` BEFORE `-i` in the FFmpeg command — input seek that lands
  on the nearest keyframe (±2s).
- Better failure surfacing: capture FFmpeg's stderr in `record_segment`
  and return `(elapsed, exit_code, stderr_tail)`. UI shows the actual
  error message instead of "muy corto" guesswork.

### Twitch Helix Clips API (viewer-curated viral signal)
- New `services/twitch_service.py` with OAuth client-credentials token
  (`/oauth2/token`, cached ~60 days). Requires `TWITCH_CLIENT_ID` and
  `TWITCH_CLIENT_SECRET` in `.env` (free from
  [dev.twitch.tv/console](https://dev.twitch.tv/console)).
- **Two-step fetch**: `/helix/clips` doesn't accept `video_id` as a filter
  (Twitch API quirk). So we hit `/helix/videos?id=X` first to get the
  broadcaster_id + stream date, then `/helix/clips?broadcaster_id=Y&
  started_at=...&ended_at=...` over a 30-day window, then filter the
  result client-side to keep only clips with `video_id == X` and a non-null
  `vod_offset`. Up to 500 clips by default (was 50), sorted by view count.
- New `GET /api/stream/twitch-clips?url=X&limit=N` endpoint.
- Frontend modal opens from the VOD page with a "🔍 Ver momentos virales"
  button. Each row shows thumbnail + title + timestamp + view count +
  creator. Click autopopulates the HH:MM:SS slice inputs at the moment's
  vod_offset (with a 3s lead-in).

### Chat velocity (Nivel 2, ships but with caveats)
- New `services/twitch_chat_service.py`: downloads VOD chat replay via
  Twitch's GraphQL `VideoCommentsByOffsetOrCursor` query and counts
  messages per 10-second bucket, tagging emote-spam buckets (>70%
  emote chars = chat going crazy). Returns a tiny JSON map of buckets +
  top-N peaks (sorted by count, deduped by 60s gap).
- **GraphQL integrity dance**: Twitch added an anti-bot check on `gql.twitch.tv`.
  First call `/integrity` to get a JWT, include it as `Client-Integrity`
  header in every chat-page request along with the rotating `X-Device-Id`.
  Token cached ~4h.
- **Cursor pagination is blocked by integrity** even with valid tokens —
  observed "failed integrity check" on every cursor request. Workaround:
  use offset-based pagination (`contentOffsetSeconds`) and advance by
  `last_message_offset + 1` after each page. Sustained ~60 msgs/sec
  during testing.
- Retries with exponential backoff on transient errors (service error,
  HTTP 429/5xx) + 80ms inter-request delay so we don't trigger rate limits.
- Background job + polling endpoint; frontend renders progress, then a
  CSS-bar chart of all buckets (peaks highlighted in gold) + top 10
  peaks list with click-to-autopopulate.
- **Known limitation**: download is slow on popular streams (xQc 4-hour
  VOD ~ 50k messages = ~14 minutes). UI shows live progress; user can
  cancel by closing the modal.

### One-click clip → Gemini project
- Click on a viewer clip in the modal → backend downloads the Twitch
  clip's signed MP4 URL (via `VideoAccessToken_Clip` GraphQL — much
  faster than VOD slicing because Twitch serves clips as standalone
  MP4s), creates a new Project with a single ClipData spanning the
  whole clip, and spawns a Gemini caption job in the background. Frontend
  polls `/api/status/{id}` and jumps the user to Step 2 when status =
  `ready`. New route `POST /api/stream/twitch-clip-to-project`.

### Multi-select batch
- Checkboxes on every clip row in the modal + footer with
  "Procesar N con Gemini". Selected clips get concatenated into one MP4
  via `ffmpeg -f concat -c copy` (stream-copy, fast; falls back to
  filter-graph concat if formats differ), creating ONE Project with N
  ClipData entries at the correct time offsets. Background thread runs
  Gemini caption on each clip sequentially. `project.analyze_progress`
  exposes `"3/10"` via the status endpoint so the UI shows a live counter.
  New route `POST /api/stream/twitch-clips-batch-to-project`.

## 🍿 Meme retry button + music_vibe prompt

- **Polling fix**: `MemeStep` was calling `clearInterval` as soon as
  `batch.status === "completed"`. After that, clicking Retry on a "ready"
  item correctly switched the backend to `processing` again, but the
  frontend never saw the new state because polling had stopped — spinner
  stuck forever, text never updated even though the backend had regenerated.
  Fix: keep polling at 2s for the modal's whole lifetime.
- **Retry spinner timing**: the per-item retry button used a fixed 1.2s
  setTimeout to clear the spinner — but the reanalyze actually takes
  20-40s. Replaced with an effect that only clears `retrying` when the
  item's `meme_text` actually changes (or status becomes `error`).
- **music_vibe prompt rewrite**: the old prompt listed 6 example phrases
  in quotes ("I was NOT ready for those vocals", "That song that takes
  you right back", …). Gemini was copying them verbatim — few-shot
  leakage. Replaced with 7 ENGAGEMENT MECHANICS described as abstract
  angles (POV, contrast, niche comparison, confession, unfinished thought,
  specific lyric/timestamp call-out, audience question), plus an explicit
  anti-template list. Sentence-case + "do NOT name the artist" rule.

## 🐛 Fix — caption wrap respects ONLY user-typed line breaks

A regression introduced with the `\n` support was making captions wrap to two
lines even when the text would have fit on one. Two coordinated bugs / UX
issues are fixed in one shot.

### The regression
`split_text_into_lines()` does a coarse char-based pre-split (`max_chars=30`)
before handing the result to `create_caption_overlay()`. After the `\n`
support landed, `create_caption_overlay` was joining those pre-split lines
with `\n` and `_wrap_px()` was treating ALL `\n` as forced hard breaks —
including the artificial ones the char-splitter produced. Net effect: a
short caption that should have fit on one line (e.g. after the user shrunk
the font with the resize handle) was permanently glued to two lines.

### The fix — bypass the char-pre-split for the caption render path
The three callers that feed `create_caption_overlay` now pass the raw
caption (with user-typed `\n` intact) as a single-element list instead of
pre-splitting it:
- `video_service.py` × 2 (the main TikTok preview + the split-screen path)
- `export_service.py` × 1 (final export)

`create_caption_overlay`'s `_wrap_px` already does its own pixel-perfect
wrap and respects `\n` as forced breaks. Without the char pre-split feeding
it spurious breaks, the two behaviours now coexist cleanly:

- **Caption without `\n`** → pixel-wrap picks 1 / 2 / 3 lines based on
  font_size and width. Shrink with the corner handle → fits on 1 line.
- **Caption with user `\n`** (Enter in the modal) → manual break is
  respected verbatim, regardless of font size.

### Smoke-tested cases

| Caption | font_size | Output |
|---|---|---|
| `"He is owning the screen right now"` | 70 | 2 lines (didn't fit) |
| `"He is owning the screen right now"` | 40 | **1 line** ✓ |
| `"He really came through\nwith the energy"` | 70 | 2 lines (user break) ✓ |

`split_text_into_lines()` is still used by the IG-frame path
(`create_instagram_frame_bg`, `max_chars=28`) which has its own renderer —
unrelated to the white caption box.

## 🔧 Visual Editor — tighter caption hit area

The invisible drag/resize hit area was sized with fixed pixel multipliers
(`font_size * 5` wide), which left a giant dashed rectangle extending well
past the real white-box caption in the preview.

Replaced with an estimate computed from the actual caption text + font_size,
expressed as **% of the 1080×1920 canvas** (not absolute pixels) so it
scales with the preview container:

```js
charW         = font_size * 0.55                    // avg Arial Bold char width
maxLineChars  = (1080 - 80 - 32) / charW            // chars per line at canvas scale
totalLines    = sum(ceil(chars_block / maxLineChars))   // walks each \n block
widestChars   = max(min(chars_block, maxLineChars))     // widest line
boxW          = min(canvas_w - 80, widestChars*charW + pad_x*2)
boxH          = totalLines * font_size * 1.3 + pad_y*2
hitW%, hitH%  = (box / canvas) * 100
```

Also walks `\n`-separated blocks in the caption so a multi-line caption
(user pressed Enter) is sized accordingly. The dashed outline now hugs the
real white box across the full range of font sizes and caption lengths.

## ✏️ Caption editing — inline text editor + manual line breaks

Faster path to edit a caption from the Visual Editor (Paso 3), plus support for
user-controlled line breaks so the wrap inside the white box can be tuned.

- **"Editar texto" button** added to the Visual Editor preview action row
  (next to *Editar encuadre*, *Guías*). Disabled when no clip is selected.
- **Inline modal** with a 4-row `<textarea>` pre-loaded with the selected
  clip's `viral_caption`. **Enter** inserts a hard line break (`\n`); **Esc**
  / click-outside cancels; **Guardar** commits.
- On save: `api.editCaption()` → updates the local clip → clears preview URLs
  (`setPreviewUrl(null)`, `setVideoPreviewUrl(null)`) so the next preview
  fetch re-renders with the new text.
- **Backend `\n` support** (`video_service.py`):
  - `split_text_into_lines()` now splits on `\n` first, then auto-wraps each
    block independently — manual breaks are never crossed by the wrapper.
  - `create_caption_overlay()`'s internal `_wrap_px()` does the same on the
    re-joined string (joined with `\n` instead of spaces).
  - Backwards-compatible: captions without `\n` render exactly as before.
- The existing pencil ✏️ in the Clips screen already used a `<textarea>`,
  so it picks up the new `\n` support for free.

## 📝 Subtitles — new "standard" style (Netflix / documentary look)

- New value `standard` joins the catalogue (now **27 styles**). ALL CAPS, white
  text, thin black outline (~2px), no shadow, slight letter spacing — the
  classic streaming / documentary / iPhone-caption look. Distinct from `clean`
  (which uses chunky Arial Black with a thick outline).
- `_ass_header()` parametrised: `Fontname` and `Spacing` are no longer
  hardcoded. `standard` uses `Arial` (not `Arial Black`) — the actual Bold
  weight, not the ultra-black variant — with `outline=2`, `shadow=0`,
  `spacing=3`. All other styles unchanged.
- Frontend `SubThumb` mini-preview uses Arial 700 + thin text-shadow outline +
  uppercase + letter-spacing so the picker preview matches the rendered look.

## 🔧 Visual Editor preview — direct manipulation

Replaced the static "T caption" placeholder badge with an invisible hit area
positioned to match where the real white box is rendered.

- **Move** still works (drag the area to update `text_x` / `text_y`).
- **Resize via mouse**: a gold corner-dot at the bottom-right scales the
  caption. New drag mode `text_resize` captures the initial cursor distance
  from the caption center, then computes a ratio against `font_size` on each
  mouseMove. Result: text + white box grow together (the box's PIL dimensions
  derive from font_size + padding, so the box scales with the text for free).
- The hit area is **transparent by default** (no text, no background),
  positioned so its top aligns with PIL's anchor
  (`top = text_y * H − caption_box_pad_y`, `transform: translate(-50%, 0)`).
- Dashed outline only appears on hover or while dragging (via the existing
  `.draggable-text:hover` and `.dragging` CSS rules); stays gold when the
  caption is horizontally centered.

## 👤 Creator name — authoritative & race-fixed

The "Creador" input on the Clips screen now actually produces captions that
include the typed name — fixing two bugs that masked it before.

- **Race condition fix**: `handleReanalyze` and `handleReanalyzeBatch` now
  `await flushCreatorBeforeReanalyze()` (a fresh PATCH to
  `/api/projects/{id}/creator`) **before** firing the reanalyze. Previously
  `onBlur` started the PATCH async and the reanalyze hit the backend before
  the new name was stored.
- **Prompt fix #1 — `creator_section`**: rewritten to be MANDATORY ("include
  this exact name in EVERY caption · ignore on-screen names"). The old "60-70%
  of captions" + "identify from video, on-screen text, audio" rules told
  Gemini to override the provided name with whatever it recognised — exactly
  the opposite of what the user wants.
- **Prompt fix #2 — `reanalyze_clip`**: the per-clip Re-analizar button
  used a prompt that DID NOT mention the creator at all. Added a
  `{{CREATOR_LINE}}` token: when `project.creator_name` is set,
  `clips.py: reanalyze_clip` injects a MANDATORY line ("Include the name X
  in this caption naturally · Do NOT use any other name") into the prompt
  before sending. Empty when no creator is set (prompt unchanged).
- `restore_name_casing()` called on the rewritten caption so the lowercase
  rule doesn't turn `Jawis` → `jawis` after the re-analyze.

## 🎬 Editor — xfade transitions between segments

Transitions can now be configured at every cut point in the timeline editor and
are rendered for real by FFmpeg `xfade` on export, plus simulated live in the
preview so the user can see them without exporting.

### Model & save path
- `Segment` (`backend/app/models/clip.py`) gained `transition_in: str = "cut"`
  and `transition_duration: float = 0.4`. `"cut"` / `""` / `"none"` mean no
  transition (default, hard cut). Any other value is an FFmpeg xfade name from
  the whitelist (`fade`, `fadeblack`, `fadewhite`, `dissolve`, `pixelize`,
  `radial`, `slide{left,right,up,down}`, `wipe{left,right,up,down}`,
  `circleopen`, `circleclose`, `smoothleft`, `smoothright`, `zoomin`).
- `SegmentInput` in `routes/editor.py` carries the new fields and the
  `PUT /api/editor/{id}/segments` endpoint persists them. `_norm_segments` in
  `video_service.py` propagates them through all internal paths.
- `transition_duration` is clamped at render time to half of each adjacent
  segment's duration so a transition never exceeds the clip length.

### Rendering — pairwise xfade chain
- New `_has_xfade()` helper picks the render path: cut-only segment lists still
  use the fast `concat` filter (and the stream-copy single-segment shortcut);
  any non-cut transition switches the whole chain to a pairwise xfade graph.
- xfade chain: every segment is first normalised to canvas `W×H`, `yuv420p`,
  30 fps, audio 44.1 kHz so xfade accepts it. Then segments are crossed
  pairwise: `xfade=transition=…:duration=T:offset=O` for video and
  `acrossfade=d=T:c1=tri:c2=tri` for audio, with the cumulative offset
  tracked by the new `_segment_offsets()` helper.
- `total_output_duration()` exposed for callers (used by `routes/editor.py`'s
  `clip.duration` so the saved duration reflects the real xfade overlap).
- `remap_transcript_to_segments` rewritten on top of `_segment_offsets` so
  subtitle word timestamps line up with the actual output time after overlap.

### UI — picker + live preview overlay
- New `TRANSITIONS` catalog (16 effects + "cut") and `TransitionPicker`
  popover: 4-column grid + duration slider (0.10–2.00s).
- In `TimelineEditor`, a small circular handle is rendered at every segment
  boundary: `+` when no transition is set, `✦` in the accent color when one is.
  Click opens the picker; saving is automatic via the existing debounced
  `useEffect` on segments → `api.saveEditorSegments`.
- Live preview overlay (`buildTransitionFx`): CSS approximation of every xfade
  for the in-editor `<video>` preview so the user sees something happening
  during the transition window. Fades use opacity tints, dissolve uses backdrop
  blur, slides/wipes use animated `clip-path`, iris uses `circle()`, radial
  uses `conic-gradient`, zoomin uses `transform: scale`. A gold badge
  `▸ {type} · {dur}s` shows in the top-right of the preview while a transition
  is active. The FFmpeg xfade on export is pixel-accurate; the CSS preview is
  an approximation (single `<video>` element can't actually crossfade two
  streams) — same trade-off CapCut makes.

## 👤 Creator name editable from the Clips screen

The creator name set at upload time is now editable from the Clips screen so
the user can adjust it before clicking Re-analizar without going back to step 1.

- New `PATCH /api/projects/{id}/creator` (in `routes/upload.py`) updates
  `project.creator_name` in the in-memory store. `routes/clips.py` already
  passes `creator_name` to Gemini on both analyze and reanalyze, so the new
  value is picked up automatically on the next Re-analizar click.
- API client (`services/api.js`): new `getProject()` (used to load the current
  value on mount) and `updateProjectCreator()`.
- `ClipsStep` (`App.jsx`): `creatorName` state loaded from the project on
  mount, rendered inside the batch action bar (the strip that appears when one
  or more clips are selected — same row as Re-analizar). Saves on blur or
  Enter; flashes `guardando…` → `✓ guardado` for 1.5s after success.

## 📝 Subtitle catalog — 26 styles total

Three rounds of additions on top of the original clean / karaoke / popup /
highlight / big_center / twoword / bounce / typewriter set (`subtitle_service.py`
+ `SubThumb` grid in `App.jsx`):

- **Karaoke color variants** (active word highlighted in colour):
  `karaoke_green`, `karaoke_blue`, `karaoke_pink`, `karaoke_red`,
  `karaoke_orange`, `karaoke_purple`.
- **Highlight-box color variants** (single active word in a coloured pill):
  `box_green`, `box_blue`, `box_pink`, `box_red`.
- **Effects** (different formats, not just different colors): `neon` (cyan
  glow), `underline` (active word underlined + scaled), `line_box` (solid
  black pill behind the whole line via `BorderStyle=3`), `bubble` (black text
  in a white pill), `reveal` (words appear one by one and accumulate with
  pop), `stack` (words stacked vertically, active in yellow), `hollow`
  (transparent fill + thick white outline), `retro` (magenta offset shadow).
- `_ass_header` parametrised with `border_style` / `shadow` to support
  filled-box vs outline styles from the same builder.
- Visual picker uses CSS-faithful `SubThumb` mini-previews (Arial Black,
  outline via `text-shadow`, mapped colour palettes for the karaoke / box
  families).

## 🎵 Editor — background music with waveform + mix-on-export

A real second audio track in the timeline editor, mirroring CapCut's audio row.

- Backend: `StyleConfig.music_path / music_volume(0.8) / original_volume(1.0)`.
  `video_service.mix_music_track()` is a post-export step: copies the video
  stream (`-c:v copy`) and re-mixes the audio with `volume → amix` (handles
  videos with no audio stream via the `_has_audio_stream()` probe).
  `export_clip_with_style` calls it automatically when `style.music_path` is
  set. New routes: `POST /api/editor/{id}/music` (upload) and
  `GET /api/editor/{id}/music/{file}` (preview playback).
- Waveform: `video_service.get_audio_peaks()` decodes the upload to PCM mono
  8 kHz via FFmpeg and returns 320 normalised peaks. The upload response
  ships the peaks so the UI can draw the wave immediately.
- UI: the audio row is rendered **inside the `TimelineEditor`**, full-width
  underneath the thumbnail row (not a separate floating strip), with the
  waveform, file name, **Música** and **Original** volume sliders (0–2x),
  and an X to remove. An `<audio>` element is kept in sync with the
  playhead. Preview is capped at 1x by browser policy; the >1x boost only
  takes effect on export.

## 🍿 Meme Generator — per-item Retry + per-batch model picker

- **Retry**: `_process_batch` refactored into a per-item function
  `_process_one_item(...)`; the batch now stores `params + video_paths +
  filenames` so a single failed item can be relaunched in isolation. New
  endpoint `POST /api/meme/retry/{batch_id}/{index}`. UI: "Reintentar"
  button on every item card (in the error block, the ready row, and the
  processing row in case it hangs).
- **Model picker**: MemeStep now hosts the same `ModelSelector` as Upload /
  Analyzer, with Check-modelos health. The chosen model is sent on
  `POST /api/meme/process` as `gemini_model` (FormData). Backend uses a
  thread-local override (`_current_model[thread_id]`) resolved via
  `_resolve_model()` so each batch threads its own model through the five
  `client.models.generate_content` call sites without changing the global
  default.

## 🛠 Editor — backgrounds, visual filter, undo/redo, transcript shortcuts

- **Background style** (`bgStyle`): `blur` (default, current) / `black` /
  `white`. Wired through `_bg()` in `video_service` + `export_service` so
  the canvas behind the foreground video can be a solid colour instead of
  blur. UI selector lives in the editor's "Encuadre" panel.
- **Visual filter** UI: the cinematic / warm / vivid / moody / bw chain
  already existed in the backend (`get_visual_filter_chain`); the editor
  now exposes it as a "Filtro" selector with a live CSS approximation
  (`VF_CSS`) so the preview reflects the export look.
- **Undo / redo**: snapshots the entire editable document (segments,
  bgStyle, visualFilter, aspectRatio, music, subs, overlays, per-clip
  transform + keyframes) into a `past / future` stack with a 450 ms
  debounce. Toolbar buttons (Undo2 / Redo2) + keyboard shortcuts
  (Ctrl/Cmd+Z, Ctrl+Shift+Z, Ctrl+Y); ignored when typing in inputs.

## 💬 CapCut-style caption box + longer captions

Reworked `video_service.create_caption_overlay` from a plain rounded rectangle
into the real **CapCut "Basic" caption look** — a per-line contour that hugs the
text and grows with the editor sliders — and raised the caption length so longer
hooks fit. All rendering stays 100% PIL/Pilmoji (no FFmpeg drawtext).

### Per-line contour (not a plain rectangle)
- Each line's white background **hugs its own text width** (a short line like
  `undeniable! ✨` is narrower than a long one), all merged into **one connected
  shape**. The sides step in/out to follow the text.
- Corners are rounded with **exact circular arcs** via the new `_round_polygon`
  helper — both the outer (convex) corners and the step (concave) corners, with
  the per-corner radius clamped to half the step so arcs never overlap. No blur,
  no "organic"/soft edges.
- Text is **re-wrapped by measured pixel width** (not character count), so it
  never overflows or gets cut off; the font auto-shrinks only if a single word
  is too wide. Near-identical line widths are snapped so tiny steps don't leave
  slivers.

### Grows with Width / Height — without moving the text
- **Width** (`caption_box_pad_x`, slider "Ancho de caja", 0–250) widens every
  line's hug. The same effective padding is applied to all lines and capped by
  the widest line, so the **step between lines stays constant** as the box grows
  (it no longer deforms when the wide line hits the frame edge).
- **Height** (`caption_box_pad_y`, slider "Alto de caja", 0–200) adds per-line
  vertical padding; the per-line boxes grow and **overlap** (rendered as a union
  polygon) so the step/overhang zone gets taller. The **text never moves** —
  callers overlay at `box_y = base_y - pad_y`, cancelling the `+pad_y` canvas
  offset, so only the boxes grow around the fixed text.
- **Corner radius** (`caption_box_radius`, slider "Redondeo de esquinas").
- New defaults: `pad_x=30`, `pad_y=6`, `radius=0.40` (backend `StyleConfig` +
  frontend initial state). Preview routes (`clips.py`) now forward all
  `caption_box_*` params so preview and export match.

### Longer captions — all words visible
- Gemini prompts raised from **15 → 20 words** for the main analysis, alternate
  captions and per-clip reanalyze (`prompts.py`). Meme/music prompts unchanged.
- `split_text_into_lines` gained a `max_lines` param; the caption path passes
  `max_lines=10` (was hard-capped at 4) so a full 20-word caption renders **all
  its words** instead of silently dropping the tail. A long caption just makes a
  taller box.

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
