# AI Video Clipper — Changelog

## ⚡ Auto-encuadre masivo y optimización de clips

- **⚡ Aplicar este encuadre a todos los videos**:
  - Implementado endpoint `POST /api/clips/{project_id}/analyze-all-faces` para procesar en lote las caras y trayectorias de todos los clips que aún no cuenten con análisis de MediaPipe.
  - Actualizado el botón en la interfaz (`App.jsx`) con estado de carga y procesamiento reactivo (`⏳ Analizando y aplicando a todos los videos...`), sincronizando las caras y asegurando que todos los clips reciban el badge 🎯 y el encuadre activo sin pasos manuales.
  - Persistencia y rehidratación de `face_track_{id}.json` mejorada en backend al consultar proyectos.
- **🌐 Ingesta de clips y audios**:
  - Manejo de pistas de audio originales en inglés evitando selecciones de doblajes no deseados en descargas de YouTube.
  - Formateo estricto de textos y hooks en tercera persona para optimización de contenido viral.

## ✨ Nuevo modelo Gemini 3.8 Flash

- Agregado `gemini-3.8-flash` (GA Sep 2026) a la whitelist del backend
  (`VIDEO_ANALYSIS_MODELS`) y al selector del frontend.
- Disponible en todos lados: análisis inicial, cambio de modelo,
  health-check, re-análisis y retry de memes.
- No cambia el default (sigue `gemini-2.5-flash`); se elige a mano.

## 🐛 Kick VOD UUIDv7 lookup

- Kick now returns a 404 from its legacy `/api/v1/video/<id>` endpoint for
  newer UUIDv7 VOD IDs. The VOD-clip search now falls back to Kick's current
  channel-scoped endpoint when given a canonical
  `kick.com/<channel>/videos/<id>` URL. URLs without the channel now explain
  how to paste a usable link instead of exposing Kick's raw Laravel error.

A running log of all the improvements added on top of v9.5 base.

## 🔄 Selector de modelo para reintentar memes

- Cuando un meme falla (ej: 503 UNAVAILABLE), ahora aparece un **dropdown
  de modelo Gemini** encima del botón "Reintentar este meme".
- Opciones: "Mantener modelo original" (default) + todos los modelos de
  la lista `GEMINI_VIDEO_MODELS`.
- El modelo elegido se envía al backend y sobreescribe el modelo original
  solo para ese retry.
- Si no elegís ninguno, se usa el modelo con el que se generó el batch.
- `retry_meme_item()` (backend) ahora acepta param `model: str = None`.
- `POST /meme/retry/{batch_id}/{index}` ahora acepta JSON body
  `{ "model": "gemini-2.5-pro" }` opcional.

## ⏹ Botón "Detener" en re-análisis batch

- Nuevo botón **⏹ Detener** al lado de "Analizando X/Y.." en el Paso 2
  (Clips). Cancela **inmediatamente** el request de Gemini en vuelo
  (`AbortController`) y el loop no arranca el siguiente clip.
- `api.reanalyzeClip` ahora acepta un `signal` para soportar abort.
- La espera de 20 segundos entre clips también se interrumpe al toque.

## ▶⬇ Botones Play + Download en clips virales del VOD

- En el modal **"Momentos virales del VOD"** (Twitch/Kick), cada clip ahora
  tiene dos botones a la derecha:
  - **▶** — abre el clip en Twitch/Kick en nueva pestaña (reproducir).
  - **⬇** — descarga el MP4 del clip a la compu (usa `downloadPescClipBlob`
    → `POST /api/stream/clip-download` → yt-dlp).
- Los botones no rompen la selección ni el "Enviar a Clips".

## 🔧 Fix: watermark no se aplicaba en export TikTok

- Bug: `handleExport` no pasaba `useWatermark: true` al backend, y el
  endpoint `render_clips` tiene `use_watermark: bool = Query(default=False)`.
  Resultado: el watermark **nunca** aparecía en el archivo exportado.
- Fix: ahora se pasa `useWatermark: !!watermarkPreview` (truthy cuando el
  usuario subió un PNG). Instagram ya lo aplicaba directo del style.

## 🎯 Auto-encuadre: sin temblor + modo Manual estable + zoom de encuadre

- **Fin del temblor**: la trayectoria de caras ahora se **interpola a ~30 FPS**
  (`interpolate_trajectory` con smoothstep) antes de escribir el `sendcmd` de
  FFmpeg. Antes `sendcmd` sostenía cada valor a 5 FPS → la cámara se movía a
  escalones de 200 ms (percibido como temblor). Ahora panea continuo.
- **Modo Manual (follow) ya no se desencuadra**:
  - Si el ID de la persona elegida "parpadea" (el matching greedy IoU puede
    cambiar IDs cuando las caras se cruzan), la cámara cae a **la cara más
    cercana al centro actual** en vez de saltar.
  - Si la persona desaparece del frame sin otras caras, la cámara **mantiene
    el último encuadre** (antes derivaba hacia el centro y "perdía" a la
    persona).
- **Encuadre fijo inteligente**: el tamaño fijo del recorte se calcula solo
  sobre muestras con cara presente. Antes, una caída breve de detección metía
  un recorte tamaño-frame-completo en el `max()` y dejaba a la persona
  diminuta todo el clip.
- **Zoom de encuadre manual** (`StyleConfig.auto_reframe_zoom`, 0.8–1.6):
  nuevo slider "Zoom de encuadre" en el panel 🎯 Auto-encuadre (100–160%).
  >1 acerca el recorte a la persona. Seguro porque el tamaño del recorte se
  mantiene constante todo el clip. Persistido vía `persistStyle` y también
  aceptado por `POST /editor/{id}/reframe-style`.

## 🛡 Anti-detect 4K HDR + Nitidez: look más marcado y visible en preview

- El look HDR ahora es **más intenso** para que se note el efecto:
  `eq=contrast=1.18:saturation=1.28:gamma=1.04:brightness=0.02` +
  `colorbalance=rs=-0.05:bs=0.06:rh=0.05:bh=0.03` + `vibrance=0.15`
  (antes era sutil: contrast=1.08/sat=1.12).
- **El efecto ahora también se ve en el preview del editor** (Play Clip, frame
  y previews de Instagram): se aplica el look HDR + nitidez en vivo al tocar
  los toggles, sin el upscale 4K (el preview sigue en 720×1280 para ser
  rápido). El upscale 4K queda solo en el export final.
- Fuente única de verdad: `video_service.build_hdr_sharpen_vf(hdr_4k,
  sharpness_pct, scale_dim)` + `HDR_LOOK_FILTER` + `unsharp_vf(pct)`; los 4
  previews (`generate_preview_clip`, `generate_preview_frame`,
  `generate_instagram_preview_clip`, `generate_instagram_preview_frame`) y el
  export (`build_hdr_4k_sharpness_chain` → delega al helper compartido) usan
  los mismos valores.
- Se pasan `hdr_4k` / `sharpness_pct` desde todos los endpoints de preview de
  `clips.py` (7 call sites) usando `getattr` para compatibilidad con styles
  viejos.

## 🛡 Anti-detect: 4K HDR + Nitidez (truco CapCut anti shadowban)

Basado en el formato anti "unoriginal content" de TikTok. Los cambios
obligatorios ya existían (Flip = espejar, fill_mode = fullscreen sin barras,
Zoom +2% y sway/mirror_cyclic/auto_reframe = movimiento, text_x/text_y =
posición del caption). Se agregó el **Pro Tip 4K HDR**:

- `StyleConfig.hdr_4k` (bool) + `StyleConfig.sharpness_pct` (0–100).
- `build_hdr_4k_sharpness_chain(style, W, H)` en `export_service.py`: si
  `hdr_4k` → `scale={W*2}:{H*2}:flags=lanczos` (4K) + look HDR
  (`eq=contrast=1.08:saturation=1.12:gamma=1.03` + `colorbalance`). Si
  `sharpness_pct > 0` → `unsharp=5:5:{amt}` con 40% → 0.54, 50% → 0.65,
  100% → 1.20. Sin blur ni glow (como pide el truco).
- Se aplica en ambos exports finales (TikTok `export_clip_with_style` e
  Instagram `export_instagram_clip`), solo en export — no toca el preview.
- UI Editor (EditorStep → Anti-Detect): chip **4K HDR** + caja **"✨ 4K HDR +
  Nitidez"** con slider de nitidez 0–100% y nota "Recomendado 40–60%".
- El contador de "N activos" y el auto-refresh del preview incluyen los campos
  nuevos. `updateStyle` ya envía el style completo → no hizo falta tocar la API.

## ✂️ Meme: recorte de blancos/bordes POR video en la subida

- Nueva sección **"Quitar blancos / bordes — por video"** en la vista de subida
  del Meme Generator: cada video tiene sus propios sliders de recorte
  (arriba/abajo/izquierda/derecha) con **video real reproducible**, badges de
  recorte por lado y chip de estado. El botón **"Previsualizar recorte (sin
  Gemini)"** (`POST /meme/crop-preview`, FFmpeg local) renderiza un mp4 corto
  ya recortado y lo **guarda en la carpeta de renders** (`_meme_exports/`, como
  `recortado_<nombre>_<uid>.mp4`) además de reproducirlo y permitir descargarlo.
- **Guías de corte precisas**: las 4 líneas rojas de guía se posicionan sobre
  el **área real del video** (no sobre el contenedor con barras negras), usando
  `videoWidth/videoHeight` reales para calcular el rectángulo de contenido en
  videos verticales (9:16) que se centran con letterbox. Cada línea tiene su
  etiqueta con el porcentaje visible.
- **URLs memoizadas**: el `<video>` del thumbnail no se recrea en cada
  movimiento del slider (evita parpadeo y recarga de metadata).
- **Panel ampliado**: contenedor scrollable más alto (480px), video más grande
  (420px), fuentes y botones más grandes, padding más generoso.
- El recorte se aplica con FFmpeg (`crop_video_pct`, `-vf crop`) ANTES de
  arrancar el batch: Gemini analiza (y el export usa) el video ya recortado.
  Los retries reutilizan el archivo recortado, así el recorte se conserva.
- Backend: `POST /meme/process` acepta `crops` (JSON array `[{top,bottom,left,right}]`
  en %, uno por video). Frontend: `api.processMemes(..., crops)` + `renderCropPreview`
  + estado/UI por video en `MemeStep` (reset al cambiar archivos, badge dorado).

## 🎬 Meme caption style + Arial + music_vibe

### Caption style "Meme" (clips → mismo look que el Meme Generator)
- Nuevo chip **Meme** en el panel "Caption style" del Editor (`App.jsx`). Fuerza
  Arial regular (`arial.ttf`), texto blanco, contorno negro fino nativo de PIL,
  sin caja y sin sombra — idéntico a `create_meme_bg_png`.
- Se aplica en preview (`generate_preview_frame` + `generate_preview_clip`) y en
  export final (`export_service.export_clip_with_style`) vía
  `create_text_caption_overlay(variant='meme', font_key='arial')`.
- **Arial agregada a `FONT_MAP` de `video_service.py`** (`"arial":
  "C:/Windows/Fonts/arial.ttf`) — antes el botón "Arial (meme)" de la zona de
  captions caía en fallback a Calibri porque la fuente no existía en el mapa.
  También se añadió la opción "Arial (como memes)" al `<select>` de fuente de
  captions del Editor.
- **Contorno con stroke nativo de PIL** en `create_tiktok_caption_overlay` y
  `create_text_caption_overlay`: se eliminó el loop manual que imprimía el texto
  en ~20 offsets (letras gordas/chunky). Ahora usa `stroke_width/stroke_fill`
  en una sola pasada = contorno fino que se pega al glifo (como memes).

### Música sugerida por clip (`music_vibe`)
- Gemini ahora sugiere la vibe musical de cada clip (prompt `analysis_system`):
  lista cerrada `tense | hype | emotional | comedy | sad | motivational |
  calm | romantic`.
- `ClipData.music_vibe`, normalizado por `_clean_music_vibe()` contra
  `ALLOWED_MUSIC_VIBES` (module-level de `gemini_service.py`).
- UI: chip 🎵 en la lista de clips (ClipsStep) y "🎵 sugerido: X" en la sección
  Música del Editor para el clip seleccionado.

## 🖼 Meme/Música: preview WYSIWYG real (sin texto viejo atrás)

El preview de cada tarjeta usaba el video final horneado (con el texto viejo
incrustado) y encima el overlay arrastrable → se veían DOS textos. Ahora el
preview carga un **video de fondo sin texto** (`GET /meme/preview-bg/{id}/{i}`)
que reproduce exactamente el último export (`last_export`: bg, video scale/pos,
crop, filtro, blur, trim, esquinas) pero sin la caption, y encima se dibuja el
texto WYSIWYG arrastrable. Mover/redimensionar el texto NO re-exporta; el fondo
se regenera solo ante cambios estructurales (crop/bg/video).
- `export_meme_video` acepta `with_text=False` (PNG de texto vacío).
- `_process_batch` y el reexport guardan el snapshot `item["last_export"]`.
- `api.getMemeBackgroundUrl(batchId, index, bust)` es el `<video>` del preview.

## 🎯 Meme/Música: texto arrastrable WYSIWYG en vivo + más modelos Gemini free

### Draggable live text overlay (sin re-exportar)
En la tarjeta de item (Memes y Música — mismo `MemeItemCard`), al abrir
"Preview" ahora hay un overlay del texto REAL (mismo texto, color, borde,
fuente, alineación y escala `cqw` que el export hornea en 1080×1920) que se
arrastra con el mouse y actualiza `textX`/`textY` en vivo, sin re-exportar.
- Se mueve en X e Y según la alineación (left ancla en textX, center/right
  centran como el backend `create_meme_bg_png`).
- Borde dorado punteado + título con % para saber que es arrastrable.
- El texto que se ve durante el drag es el mismo que queda horneado: WYSIWYG.

### Modelos Gemini free faltantes
- `gemini_service.VIDEO_ANALYSIS_MODELS` suma: `gemini-3.6-flash`
  (free tier, último Flash), `gemini-3.5-flash-lite` (free), `gemini-3-flash`
  (alias stable free), `gemini-3.1-flash-lite` (alias stable free). Los Pro
  siguen paid-only. Coincide con la whitelist SAFE_EMOJIS (14 emojis).
- `GEMINI_VIDEO_MODELS` en App.jsx ahora incluye los nuevos (3.6/Lite/etc.)
  con sus etiquetas (antes la lista del selector estaba hardcodeada y no los
  mostraba).

## 🌐 Re-análisis en español / inglés (EN + ES)

Los botones de re-análisis ahora eligen idioma en lugar de forzar inglés
(solo en el prompt, sin depender del traductor posterior para ES):

- Backend `POST /clips/{pid}/{cid}/reanalyze?lang=en|es`: nuevo parámetro
  `lang`. Con `es` usa el prompt `reanalyze_clip_es` (español neutro
  latinoamericano) y además guarda el resultado en `clip.caption_es`, para que
  el export ES / guión traducido salga sin paso extra de traducción; `en`
  es el comportamiento clásico (`reanalyze_clip`).
- Frontend: dos íconos por clip (↻ EN / 🇪🇸 ES), dos botones en la barra de
  lote ("Re-analizar EN" / "Re-analizar ES") y el modal "Guión" ahora ofrece
  "Reanalizar EN" / "Reanalizar ES". `handleReanalyze(clip, lang)` y
  `handleReanalyzeBatch(lang)` pasan el idioma a la API.
- El prompt ES emoji sigue la misma whitelist `SAFE_EMOJIS` (14 emojis) para
  no romper el filtro `filter_emojis_to_whitelist`.

## 🎣 Clips from Pescar / Viral modal → ClipsStep WITHOUT Gemini

Previously "Pescar clips en vivo" and the VOD "Momentos virales" modal sent
the selected clips through the `*_clips_batch_to_project` flow, which concat-
downloads → runs Whisper → spawns a Gemini caption thread → only jumps to
Clips after everything finishes ("Procesar N con Gemini").

Now both buttons call the batch with `analyze_with_gemini=false`:
- `process_clips_batch_to_project` (Twitch + Kick) accepts the flag; when
  false it downloads + concatenates, creates the project with empty captions /
  score (`ready` immediately) and skips Whisper + the Gemini thread.
- The route (`/twitch-clips-batch-to-project`, `/kick-clips-batch-to-project`)
  picks `analyze_with_gemini` from the payload.
- Frontend sends the selected clips and jumps straight to ClipsStep ("Enviar a
  Clips (sin Gemini)"), where each clip shows "Sin analizar" and the user
  re-analyzes them one-by-one (↻ icon) or as a small batch (bar button) via the
  existing reanalyze flow — Gemini runs at their own pace.
- Whisper is deferred to reanalyze: `reanalyze_clip` calls a new
  `_ensure_project_transcript` helper that transcribes the project video in a
  background thread on first re-analyze (guarded so it never runs twice), so
  subtitles still become available.

## 🐛 Fix: previews now respect clips with cuts (segments)

`▶ Play clip` (backend `video-preview`) used `generate_preview_clip` which
only honors `start_time`/`end_time`, so after cutting a middle the preview
kept showing the uncut clip. It now routes through the full export pipeline
(`export_clip_with_style`, concat-first) whenever the clip has segments —
same as the auto-reframe path. Also fixed the clip editor save: deleting
pieces down to a SINGLE kept range was treated as "no cuts" and sent `[]`,
restoring the full clip; `hasCuts` is now `!pristineSingle` so a lone
trimmed piece is still persisted as a segment.

## 📝 Subtitle text correction + pescador clip download

### Subtitle text correction (fix Whisper words)

Whisper mis-hears names / slang / Spanish and those errors get burned into
the subtitles. New per-clip "📄 Corregir subtítulos" editor fixes the WORDS
while keeping each word's timestamp, so the corrected text shows in every
subtitle style without re-running Whisper. Editing the shared
`project.transcript` fixes it everywhere (both editors, all styles).

- Backend (clips.py): `GET /{pid}/{cid}/subtitle-words` (words in the clip
  range + global index), `PUT /{pid}/subtitle-words` (apply `{i,word}` edits,
  timestamps untouched), `POST /{pid}/subtitle-replace` (global whole-word,
  case-insensitive find/replace — great for a name Whisper always gets wrong).
- `api.js`: getSubtitleWords / updateSubtitleWords / replaceSubtitleWord.
- ClipsStep modal: a find→replace bar (global) + editable word chips (changed
  ones get a gold border) + save. Handles no-transcript / no-dialogue.

### Pescador per-clip download (⬇ MP4)

The "Pescar clips en vivo" list got a per-clip MP4 download button — grabs
the raw clip with no Gemini, no render. Reuses the same per-platform download
the batch flow uses (Twitch = direct signed MP4, Kick = yt-dlp).

- Backend (stream.py): `POST /api/stream/clip-download` `{platform, slug,
  url, title}` → downloads + returns the MP4 as an attachment.
- `api.js` downloadPescClipBlob + a per-clip button with spinner.

### Kick download speed cap

Source-quality Kick clips can be ~100MB and Kick's CDN throttles yt-dlp
(~130 KiB/s), so a single clip took 15-20 min and blocked the request.
`kick_service.download_clip_to_disk` now caps format to **720p** and pulls
HLS fragments in parallel (`concurrent_fragment_downloads=5`) — much smaller
+ faster. (Known limitation: Kick still throttles + the download endpoint is
synchronous; a background queue with progress is the next step.)

## ✂️ Manual re-trim in the instant clip preview

Building on the instant raw-video preview: the clips-list ▶ player modal now
lets you adjust the clip's in/out points by hand — for when Gemini's
auto-cut isn't quite where you want it. Instant, no render.

- Backend: `PUT /api/clips/{project_id}/{clip_id}/trim` `{start_time,
  end_time}` updates the clip's `start_time` / `end_time` / `duration`
  (clamped to the video, min 0.5s). No re-render — the editor reads the new
  times on demand.
- `api.js`: `trimClip(projectId, clipId, start, end)`.
- ClipsStep player modal: trim state (`trimStart`/`trimEnd`) + a `playerRef`.
  Controls: "⏮ Inicio aquí" / "Fin aquí ⏭" (set the in/out to the current
  playhead), ±0.5s fine nudges, a live range/duration readout. The `<video>`
  loops within the (live-edited) `[trimStart, trimEnd]` so you see the cut
  instantly. "Guardar recorte" + "Deshacer" appear only when changed; saving
  persists via the trim endpoint and updates the list through `onUpdateClip`.

## ⚡ Instant clip preview + meme SEO/font + Instagram cookies

### Instant "Reproducir" in the clips list (no render)

Clicking ▶ Reproducir on a clip used to call `/video-preview`, which
re-rendered a styled MP4 with FFmpeg every time (~2-15s wait, no cache).
But at that stage the user only wants to judge if the MOMENT is good, not
the styling. Now `handlePlayClip` plays the RAW source (`getRawVideoUrl`)
seeked to the clip range — **zero render, instant**. The `<video>` seeks to
`start_time` on `loadedMetadata` and loops within `[start, end]`. The
styled render (captions/crop/blur) stays in the editor where it matters.
The `/raw-video` endpoint already supported arbitrary-timestamp seeking
(the editor uses it), so this reused proven plumbing.

### Meme IG description → third person + SEO

`prompts.py` `ig_description_meme`: now forbids first person ("I/me/my/we/
us/our"), writes from an outside narrator voice, and is SEO-optimized
(weaves in searchable keywords, most important one in the first sentence).

### Meme font: Arial + Segoe UI

Added the clean Helvetica-like meme font (the classic "[group] after
[thing]" caption look). `meme_service._FONT_MAP_MEME` gained `arial`
(arial.ttf — labeled "Arial (meme)") and `segoe` (segoeui.ttf); both meme
font pickers (per-meme + global) list them.

### Instagram downloader: cookies support

Instagram now requires a logged-in session for most content (the
downloader hit "rate-limit reached or login required"). `downloader_
service.py` now passes login cookies to yt-dlp when available: drop a
Netscape `instagram_cookies.txt` in the backend folder (or set
`IG_COOKIES_FILE`), or set `DOWNLOADER_COOKIES_BROWSER=firefox`. Cookies
are sent to all downloads but yt-dlp only forwards them to matching
domains, so YouTube/TikTok are unaffected. (Chrome/Edge live cookie
reading is broken by App-Bound Encryption — the file is the reliable path.)

## 🔤 14 one-word subtitle styles + configurable max clip duration

### One-word-at-a-time subtitle styles (×14)

The subtitle catalog gained 14 styles that show ONE word at a time (each
Whisper word = its own ASS event, visible from its start to the next
word's start). All in `subtitle_service.py`.

First batch (6), via the shared `_one_word_events(words, render)` helper:
- `word_zoom` (hard zoom punch), `word_yellow` (bright yellow pop),
  `word_box` (word in a solid white box), `word_neon` (cyan glow),
  `word_3d` (offset magenta 3D shadow), `word_rotate` (spin/wobble in).

Second batch (8), some needing multiple layers per word, via a new
`_one_word_multi(words, build, upper=)` helper:
- `word_glitch` — RGB chromatic split (red/cyan). The horizontal offset
  between the 3 layers uses **asymmetric MarginL/MarginR**, NOT `\pos`, so
  the style's vertical position + the y-offset slider keep working.
- `word_outline` — double outline (black outer + yellow inner), 2 layers.
- `word_gold` — gold fill + dark thin outline (premium/finance look).
- `word_comic` — thick red outline + white fill.
- `word_italic` — slanted bold italic (`_ass_header` now has an `italic`
  field, wired into the Style line).
- `word_strip` — word on a semi-transparent black bar (BorderStyle=3 +
  `\3a` alpha).
- `word_minimal` — lowercase, thin Arial, modern aesthetic (the only
  non-caps style; `upper=False`).
- `word_longshadow` — long diagonal dark shadow (`\xshad`/`\yshad`).

Each got an `_ass_header` branch (size/outline/position/special fields), a
dispatch branch in `generate_ass_for_clip`, and a frontend entry: both
subtitle selectors (Visual Editor Paso 3 + EditorMode) plus a `SubThumb`
CSS preview. Catalog total: 41 styles (+ none), 14 of them one-word.
Verified with real FFmpeg/libass burn-ins.

### Configurable max clip duration (podcast support)

The hard 60-second clip cap is now a configurable maximum (default 90,
range 20-180) so good-but-long moments survive intact — important for
podcasts.

- `Project.max_duration` (default 90); `upload.py` accepts a `max_duration`
  Form field (clamped to `min_duration + 5`).
- `gemini_service.analyze_video` + `build_clips` take `max_duration`; the
  truncation `end = start + 60` became `end = start + max_duration`, so
  Gemini's chosen end is respected when within the cap and only runaway
  clips get trimmed. Both `clips.py` call sites pass `project.max_duration`.
- Prompt (`prompts.py` analysis_system): the 60s rule is now
  `{{MAX_DURATION}}`, plus guidance to keep most clips punchy but let a
  clip run long when the moment is a complete self-contained story — and a
  new "COMPLETE THOUGHTS" block telling Gemini to start/end on a complete
  idea and never cut mid-sentence (boundaries are Gemini's job, no Whisper
  snapping).
- Frontend: a "Duración máx. (seg)" field next to mín. in `UploadStep`
  (default 90, clamp 20-180), passed through `api.uploadVideo`.

## 🐛 Fix: Twitch clip downloads (PersistedQueryNotFound)

All Twitch clip downloads started failing with `PersistedQueryNotFound`
(batch returned 502, "None of the clips could be downloaded"). Twitch
rotated the SHA256 hash of its `VideoAccessToken_Clip` persisted GraphQL
query, so the hard-coded `_CLIP_TOKEN_HASH` we sent was no longer
recognized.

Fix: `twitch_service.get_clip_download_url` now sends the **full GraphQL
query document** inline (`_CLIP_TOKEN_QUERY`) instead of a persisted-query
hash. This is rotation-proof — Twitch can change its hashes without
breaking us again. Verified end-to-end against live clips (returns signed
MP4 URLs + video qualities). Not a key/app issue — purely Twitch-side.

## 🎨 New caption styles (clean / highlight / yellow) + color markers

The main Gemini caption (the big overlay text) had only 2 styles — "Caja
blanca" (box) and "TikTok". Added 3 modern text-only looks plus a
color-marker system for keyword highlighting.

### TikTok caption overflow fix (prerequisite)

`create_tiktok_caption_overlay` never pixel-wrapped its input — it got the
whole caption as one string, clamped `box_w` but painted text at natural
width, so long captions ran off both frame edges (negative start-x). Added
the same pixel-wrap engine the box style already had: long text now grows
the box **vertically** (more lines) and always fits. `box_h` uses the
wrapped line count.

### New renderer (`video_service.create_text_caption_overlay`)

One PIL renderer, three `variant`s, no background box:

- **clean** — white bold, thin outline (3px) + soft Gaussian drop shadow.
  Smart headline Title Case (stopwords like *to / on / the* stay lowercase
  unless first word). Matches the "white headline" reference look.
- **highlight** — parses inline color markers into colored word spans
  (`*word*` → yellow `#FFD93D`, `**word**` → red `#FF3B5C`), rest white.
- **yellow** — white text with the last significant word auto-colored
  yellow.

Shares the pixel-wrap + Pilmoji emoji engine (emojis painted in color
after the outline pass). `_smart_title_words` + a stopword set drive Title
Case. Returns `(png, box_w, box_h)` with shadow margin folded in so the
caller's centering math is unchanged.

### Color markers — Gemini-marked + hand-marked (hybrid)

Inline markup embedded in the caption text:

- `*word*` → **yellow** (names / hooks), `**word**` → **red** (emotional
  payoff). `**` parsed before `*` (markdown precedence).
- **Gemini auto-marks**: the main analysis prompt now instructs Gemini to
  wrap 1-2 keywords (at most 2 spans, 1-3 words each, never the first
  word). The cleaning regexes in `gemini_service.py` preserve `*` so the
  markers survive caption normalization.
- **Manual**: type the markers in the "Editar texto" modal.
- `video_service.strip_caption_markers()` removes markers; every caption
  style EXCEPT highlight strips them at the dispatch sites, so box / tiktok
  / clean / yellow never show literal asterisks. (clean/yellow parse them
  out internally too.)

### Dispatch (3 sites)

`export_service.py` + the two `video_service.py` preview paths route
`clean|highlight|yellow` → `create_text_caption_overlay`, `tiktok` → its
own renderer, else `box`. Each strips markers unless the style is
highlight.

### Frontend

- Visual Editor (Paso 3) caption-style selector gained 3 chips: **Blanco
  limpio**, **Acento amarillo**, **Palabras de color**. Selecting
  "Palabras de color" shows a hint with the `*amarillo*` / `**rojo**`
  syntax.
- `stripCaptionMarkers()` helper strips markers in read-only displays
  (clip card overlay, analyzer quote, script modals, Visual Editor live
  caption) — the edit fields keep raw markers so they stay editable.

### Caveats

- The Visual Editor live caption overlay (CSS) shows highlight text in
  plain white (markers stripped); the real colors render in the
  server-side Play preview and the export. Minor preview/export mismatch
  by design.
- ES translation track doesn't carry markers through yet — ES highlight
  renders white. (Not requested this round.)

## 🟢 Kick.com integration

Mirror of the Twitch VOD-clips flow for Kick: paste a Kick VOD URL → list
viewer-made clips → multi-select → batch process with Gemini.

### Backend (`services/kick_service.py`)

- Unofficial Kick API client (`_kick_get`) hitting `/api/v1` and `/api/v2`
  with realistic Chrome headers — Cloudflare is the failure surface, so
  HTML responses raise a friendly RuntimeError instead of crashing JSON
  decode.
- `get_video_info(uuid)` reads `/v1/video/{uuid}` and tolerates shape drift
  via `_safe_dict()` / `_pick_url()` helpers (thumbnail/channel fields are
  sometimes dicts, sometimes bare strings, sometimes null).
- `get_clips_for_video(video_id)` paginates `/v2/channels/<slug>/clips`
  with `sort=date`, normalizes `livestream_id` to string on both sides for
  comparison, and stops when the oldest clip drops past `vod.started_at -
  2 days` so it doesn't deep-paginate channel history.
- `download_clip_to_disk` uses `yt_dlp` as a Python module (not
  subprocess) and passes the **channel-prefixed URL** (`kick.com/<chan>/
  clips/<id>`) instead of the bare clip slug — yt-dlp's `[kick:live]`
  extractor 403s on the slug-only form.
- Same `process_clip_to_project` / `process_clips_batch_to_project`
  surface as Twitch so the rest of the pipeline doesn't care which
  platform a clip came from.

### Frontend

- `services/api.js`: `getKickClips`, `processKickClip`,
  `processKickClipsBatch`.
- `LiveStreamStep` (Grabar tab) detects Kick VOD URLs (`isKickVod`,
  `vodPlatform`) and branches `loadViralClips` / `processSelectedClips` /
  `useViralClip` accordingly. The "Hype del chat" tab is hidden on Kick
  (no chat replay endpoint).

### Caveats

- Kick API is unofficial; Cloudflare occasionally serves a JS challenge.
  Retries usually fix it. If it persists, the API shape may have shifted.

## 🎣 Live-clip pescador (Twitch + Kick)

Watch an ongoing stream and accumulate every viewer-made clip as they
appear. Multi-select → batch process with Gemini, same as the VOD flow.

### Backend (`services/live_clips_service.py`)

- In-memory session store. Each session has its own thread polling the
  platform's clips API every **60s**, with an exponential backoff ladder
  (90s / 120s / 180s) on Cloudflare or rate-limit hits.
- Dedupe via `seen_ids` set; new clips are tagged with `discovered_at` so
  the frontend can sort by "newest pescado" instead of platform
  `created_at`.
- 1-second sleep slices in the polling thread → stop is responsive.
- **Live-stream anchor:** at `start_session`, calls
  `get_current_live_stream(channel)` on the platform service. If the
  channel is live, stores `stream_id`, `stream_started_at`, `stream_title`
  in the session and uses `stream_started_at` (with -30s overlap) as the
  baseline for every poll — so the **first poll catches clips made
  earlier in the stream**, not just from session start onward.
- If offline / undetectable: falls back to forward-only (`since_dt =
  session.started_at`) without raising — `is_live=false` lets the
  frontend show the right banner.
- `_normalize_channel(platform, raw)` defensively strips
  `https://`, `www.`, `twitch.tv/`, `kick.com/` (+ mobile variants),
  trailing path/query, and rejects VOD/clip URLs with a clear message
  instead of letting them hit Helix as "Bad Identifiers".

### Platform helpers

- `twitch_service.get_current_live_stream(login)` → Helix `/streams?
  user_login=X`. Returns `{id, started_at, title, game_name,
  viewer_count}` or `None`.
- `twitch_service.get_recent_clips_for_channel(login, since_dt)` →
  resolves login → `user_id` via `/users`, then paginates `/clips?
  broadcaster_id=X&started_at=ISO` (5 pages × 100 = 500 clips/poll cap).
- `kick_service.get_current_live_stream(slug)` → `/v1/channels/<slug>`.
  Reads the `livestream` field, returns the same shape (`id` coerced to
  string so it round-trips with v2 clip's `livestream_id`).
- `kick_service.get_recent_clips_for_channel(slug, since_dt, max_pages=
  8)` → paginates `/v2/channels/<slug>/clips?sort=date`, stops on first
  clip older than `since_dt` (8 pages × 24 ≈ 192 clips/poll cap).
- **Kick safety filter:** if `session.stream_id` is set, drops clips
  whose `livestream_id != stream_id` so we never include clips from a
  previous stream that happen to share the time window.

### Routes (`routes/stream.py`)

- `POST /api/stream/live-clips/start` `{platform, channel}` → public
  session snapshot.
- `GET  /api/stream/live-clips/status/{id}` → snapshot incl. `found_
  clips`, `polls_done`, `is_live`, `stream_*`.
- `POST /api/stream/live-clips/stop/{id}` → signals the thread; returns
  immediately (thread finishes after its current sleep).
- `POST /api/stream/live-clips/clear/{id}` → empties `found_clips` but
  keeps polling and keeps `seen_ids` (avoids re-pescando the same clips
  you just processed).
- `GET  /api/stream/live-clips` → list all sessions (debug / overview).

### Frontend

- `services/api.js`: `startLiveClipsSession`, `getLiveClipsStatus`,
  `stopLiveClipsSession`, `clearLiveClipsSession`.
- `LiveStreamStep` gained a tab bar: **🔴 Grabar stream** (existing flow)
  and **👀 Pescar clips en vivo** (new). The "Grabar" content is wrapped
  in `{liveTab === "record" && <>…</>}` so the file stays one component.
- Pescar empty state: platform picker (Kick / Twitch), channel input that
  strips URL prefixes / trailing path on the fly via `onChange`, "🎣
  Empezar a pescar" button.
- Pescar running state:
  - Header: pulsing status dot, channel, poll/clip counts, Detener +
    Nueva sesión buttons.
  - **Live-stream banner:** green "🔴 En vivo desde hace 1h 23m ·
    pescando del stream completo" + the stream title in italics; or gray
    "⚪ Canal offline o no detectable · solo pescaré clips creados de
    ahora en adelante" when `is_live=false`.
  - Sort (Recientes / Más vistos) + search.
  - Clip list: checkbox + thumbnail + title + stats (views / duration /
    creator).
  - Sticky bottom: "🤖 Procesar X con Gemini" → reuses the existing batch
    project flow (Twitch or Kick service `process_clips_batch_to_project`).
- Status auto-refresh every 5s while session is running (cleared on stop).

### Caveats

- Both platforms process clips for 1–5 minutes before they appear in
  their APIs. So "live" really means "≈5 min behind live" — known
  platform limitation, not a bug. UI explains this on the empty state.
- Per-poll caps (500 Twitch / 192 Kick) only matter for hyper-popular
  streamers with thousands of clips per stream; bump `MAX_PAGES` if that
  becomes a real ceiling.

## 🎵 Background music in Visual Editor + ClipsStep

Music mixing already worked in the standalone Editor (EditorMode); brought
it to the AI clip flow with two access points.

### Backend

- `StyleConfig` gained `music_start: float` and `music_end: float` (end=0
  means "play to the natural end of the source file"). `music_path`,
  `music_volume`, `original_volume` were already there.
- `video_service.mix_music_track(..., music_start=0.0, music_end=0.0)` now
  prepends `atrim=start={start}[:end={end}],asetpts=PTS-STARTPTS` to the
  music branch when either trim value is set. amix is unchanged. The video
  stream is still stream-copied so the post-mix is fast.
- `export_clip_with_style` passes the new trim values through.
- New endpoints in `routes/export.py` (parallel to editor's):
  - `POST /api/export/music/{project_id}` — accepts `audio` UploadFile,
    saves to `projects/{id}/music/music_<uuid>.<ext>`, returns
    `{path, url, filename, duration, peaks}`. Duration and peaks are best-
    effort — they don't fail the upload if probing breaks.
  - `GET /api/export/music/{project_id}/{filename}` — `FileResponse` for the
    frontend's `<audio>` preview.

### Frontend

- `services/api.js`: `uploadProjectMusic(projectId, file, onProgress)` (XHR
  with progress events), `getProjectMusicUrl(projectId, filename)`.
- **Visual Editor (Paso 3)**: new "🎵 Música" section in the right inspector
  between Subtítulos and Auto-encuadre. Empty state shows a "Subir música"
  button; filled state shows a track card (name + duration + Trash2 button),
  embedded `<audio controls>`, 2 volume sliders (música 0–2, original 0–2),
  and a "↳ ¿Qué parte de la pista querés que suene?" sub-card with start +
  end sliders. The music_* fields live on the central `style` state, so they
  follow the existing "Aplicar a" scope (Todos / Este clip / Varios).
- **ClipsStep (Paso 2)**: collapsible "🎵 Música del proyecto" section
  between the model selector and the batch toolbar. Project-wide only
  (per-clip overrides stay in Paso 3). Loads existing music_path from
  `project.style` on mount, and persists changes via a debounced
  fetch-merge-put (350 ms) so the music save never clobbers other style
  fields the user might have set in Paso 3.
- Both panels' `<audio onLoadedMetadata>` fills in the duration if the
  backend probe came back empty (handles backend restarts cleanly).
- Hidden `<input type=file accept="audio/*">` next to the existing hidden
  inputs in each component.

## 📺 B-roll picture-in-picture (EditorMode)

Lay a second video on top of the main one for a time range — reaction
overlays, gameplay corners, etc. Uses the same drag / resize / position UX
as the existing image overlays.

### Backend

- New `VideoOverlay` model mirroring `ImageOverlay` plus three video-only
  fields: `broll_in`, `broll_out` (which slice of the source plays) and
  `audio_mode` (`"mute"|"mix"|"replace"`). Default position is top-right
  (x=0.80, y=0.18) at 30% width.
- `StyleConfig.video_overlays: list[VideoOverlay]`.
- `POST /api/editor/{id}/broll` accepts the upload, saves to
  `projects/{id}/broll/broll_<uuid>.mp4`, probes duration, returns
  `{path, url, filename, duration}`.
- `GET /api/editor/{id}/broll/{filename}` serves the file Range-friendly via
  FastAPI `FileResponse`.
- `export_service` per VideoOverlay:
  - Adds a plain `-i <path>` (no `-loop`).
  - Video filter:
    `[N:v]trim=start={broll_in}:end={broll_out},setpts=PTS-STARTPTS+{ov_start}/TB,scale={ov_w}:-2,format=rgba,colorchannelmixer=aa={opacity}[brollN]`
    then overlay with `enable='between(t,ov_start,ov_end)'`.
  - Audio (mix/replace): `atrim+asetpts+volume:enable` per broll, then `amix`
    with the main audio. Mix uses 0.5 vol; replace falls back to 0.9 vol in
    v1 (true ducking is a v2 task). When any broll wants mix/replace, the
    `-map 0:a?` is replaced with `-map [outaudio]`.

### Frontend

- `api.js`: `uploadEditorBroll(projectId, file, onProgress)` (XHR).
- `EditorMode`: new B-roll subsection inside the Imágenes inspector (after
  the image-overlay block, separator + 📺 header). Upload button with live
  percent. Per-broll: 6 timing sliders (start/end in output, broll_in/out in
  source), Tamaño + Opacidad, 4-corner position presets, 3-button audio
  mode picker (Mute/Mix/Replace), borrar.
- Live HTML preview: each broll is rendered as a `<video>` element at its
  position/scale, with dashed-gold outline when selected. Drag/resize uses
  the existing `overlayDragRef` extended with `moveBroll`/`resizeBroll`.
- Playback sync (`useEffect on [outputTime, playing, brolls]`): when
  outputTime is inside `[start..end]`, broll's currentTime is set to
  `broll_in + (outputTime - start)`. Drift > 0.3 s = hard-reseek. Outside
  the window the broll is paused.
- `Trash2` icon import added.

## 😂 Meme Generator — extended editor

The Meme Generator's per-meme Ajustes panel + the global Ajustes panel
gained the same kind of fine-grained controls as the Visual Editor, kept in
an inline flat layout (memes are iterate-fast, not full modal).

### Backend (`backend/app/services/meme_service.py`)

- `_FONT_MAP_MEME` table maps font keys (`calibri / arial_black / trebuchet
  / comic / impact`) to Windows TTF paths. Calibri Bold remains the default.
- `_hex_to_rgb` + `_MEME_VISUAL_FILTERS` local table mirroring the main
  pipeline's filters (cinematic/warm/vivid/moody/bw).
- `create_meme_bg_png(...)` gained `font_family`, `text_color`,
  `stroke_color`, `stroke_width`, `transparent`, `text_align`. With
  `transparent=True` it returns an RGBA PNG used by the blur background.
  Stroke uses PIL's `stroke_width` + `stroke_fill`. `text_align="center"`
  computes each wrapped line's width via `font.getlength` and centers it on
  the canvas; `"right"` anchors to the 5%-from-right margin.
- `export_meme_video(...)` gained 11 optional params (bg_mode color/blur,
  font_family, text_color, stroke_color, stroke_width, visual_filter,
  trim_start, trim_end, mirror_cyclic_enabled+interval, boost_contrast,
  text_align). All defaults preserve the pre-existing meme look.
  - `bg_mode="blur"`: filter chain
    `[0:v]split=2[fg_in][bg_in]; [bg_in]scale=...,crop=...,boxblur=14:2[bg]; [fg_in]<fg_filter>[fg]; [bg][fg]overlay=...[comp]; [comp][1:v]overlay=0:0[out]`
    so the source video itself becomes the background and the text PNG
    overlays as a transparent layer.
  - Visual filter + mirror_cyclic + boost_contrast fold into the FG chain
    via comma-concat.
  - Trim: `-ss start` before the first `-i`; `-to (end-start)` after the
    inputs.
- `routes/meme.py POST /reexport/{batch_id}/{index}` accepts all 12 new
  Form params with safe defaults. Successful re-exports cache the settings
  on `item.style_meta`.

### Frontend

- `api.js`: `reexportMeme(...)` gained an optional `extras = null` final
  argument. New keys only get appended to the FormData when present, so old
  callers keep working untouched.
- `MemeItemCard`: new state for the 12 extra controls + `showGuides` +
  `memePreviewRef` + `memeDragRef`. `handleReexport` packs everything into
  `extras`.
  - 4 new bordered sections in the existing Ajustes panel: **Texto** (font
    picker, alignment picker ⬅/↔/➡, text + stroke color pickers, stroke
    width), **Fondo y filtro** (color / blur background, 6 visual-filter
    chips), **Trim** (start + end sliders, end=0 = natural end), **🛡
    Anti-detect** (mirror cíclico + boost contraste checkboxes).
- **Drag-to-position + center guides** on the baked video preview:
  - Wrapper has `aspectRatio: "9 / 16"` + `containerType: "inline-size"` +
    `width: min(100%, 220px)` + `margin: 0 auto` — locks the preview to the
    canvas shape so `cqw` math lines up with the video pixels.
  - Center cross-hair (dashed gold + "centro" pill), toggled by a 🎯 Guías
    button above the preview.
  - Horizontal "altura del texto" handle: a thin dashed gold line at the
    current text_y. Drag up/down only (the X is locked because the new
    Alineación picker handles horizontal position semantically).
  - Drag handler uses an `axis` flag on `memeDragRef` so the same window-
    level pointermove listener serves both X+Y drags and Y-only drags.
- **MemeStep** (global panel): same Texto / Fondo y filtro / Anti-detect
  sections in the "Ajustes globales — aplica a todos" collapsible.
  `handleReexportAll` packs the same `extras` object and fans out to each
  ready meme.

## ⏱ + ❤️ Earlier fixes shipped in this batch

- **Export timeout** (`export_clip_with_style`,
  `export_instagram_clip`): the fixed `subprocess.run(..., timeout=600)`
  killed 1 h+ Editor exports at 10 min. Now
  `max(600, int(duration * 5))` — 5× realtime safety margin (a 60 min
  export gets 5 h) and the chosen value is printed at start.
- **ES sub-row segments fix**: when the user cut segments in the editor,
  the cached `words_es` was NOT remapped through
  `video_service.remap_transcript_to_segments` before the recursive
  `export_clip_with_style` call. Spanish subs were off by the cumulative
  cut length. Adding the `clip_copy.words_es` remap right after the EN
  transcript remap fixes it.

## 🇪🇸 Spanish translation track (separate EN / ES exports)

Captions and burned-in subtitles can now be exported in Spanish as a parallel
track alongside the original English. The English flow stays untouched —
Spanish is opt-in via a button.

### Backend

- `gemini_service.translate_clip_to_spanish(caption, words, model=None)` — one
  Gemini call (JSON response) returns `{caption_es, words_es}`.
  - Caption follows the same rules as English (≤20 words, ≤1 emoji from
    SAFE_EMOJIS whitelist, first letter capital).
  - Whisper word list translated **phrase-by-phrase**: `_split_words_into_phrases`
    cuts at silence gaps (≥0.4s) or every 10 words; Gemini gets the EN
    phrases as a parallel JSON array and returns ES phrases in the same
    shape; each ES phrase is time-aligned WITHIN its EN phrase's window via
    `_redistribute_phrase_timing` (char-length weighted, last word snapped to
    phrase end). Brings drift from ~5–15s (whole-clip alignment) down to
    ~0.3–1s. If Gemini ignores the parallel-array structure, falls back to
    whole-clip alignment so we never return zero subs.
- `ClipData.caption_es: str + words_es: list[dict]` cache so re-exports skip
  the Gemini call.
- `export_service.export_clip_with_style(..., language="en")` and
  `export_all_clips_background(..., language="en")` — when `"es"`, the export
  swaps `clip.viral_caption → clip.caption_es` for the PIL caption overlay
  and uses `{"words": clip.words_es}` as the transcript for ASS subtitle
  generation. Filenames get an `_es` suffix so EN and ES co-exist in the
  same `exported/` folder. Zero changes to the 26 subtitle styles — the ASS
  generator only reads word strings + timestamps.
- **Segments remap fix for ES**: when the user has cut segments in the
  editor, the export concatenates the kept pieces and remaps the EN
  transcript via `remap_transcript_to_segments` so subs land at the right
  output time. The cached `words_es` now goes through the SAME remap before
  the recursive call (`{"words": clip.words_es}`) — without it the ES subs
  were off by the cumulative cut length.
- New endpoints:
  - `POST /api/export/render-spanish/{id}?clip_ids=...` — translates
    uncached clips then runs background export with `language="es"`.
  - `GET /api/export/translation-status/{id}` — returns
    `{translated: {clip_id: bool}, data: {clip_id: {caption_es, transcript_es, transcript_en}}}`
    so the UI knows which clips have ES + shows the translated text inline.
  - `POST /api/clips/{pid}/{cid}/translate-only` — per-clip Gemini call that
    caches without exporting (used by the Visual Editor's "Traducir este
    clip" CTA).
  - `GET /api/clips/{pid}/{cid}/video-preview-es` + `preview-es` +
    `instagram-preview-es` — ES variants of the existing previews; clone the
    same logic with caption + transcript swap.
  - `POST /api/editor/{pid}/translate-spanish` — translates the editor's
    Whisper transcript to Spanish and caches `words_es` on `clip[0]`.

### Frontend

- **ClipsStep batch bar**: "🇪🇸 Generar versión en español" button next to
  "Re-analizar". Selects the same clip set the existing batch controls work
  with; while running, shows "Traduciendo + exportando N/M…" with a polling
  progress bar. ES sub-row appears under each translated clip with the
  translated caption inline (italics, gold "🌐 ES" badge), a ▶ Play ES
  button (opens a 10s baked-in preview modal), and a 📄 Guión ES button
  (modal with side-by-side EN/ES caption + EN/ES Whisper transcript).
- **Visual Editor (Paso 3)**: EN / ES toggle pill in the action bar (next to
  Preview/Play clip). When ES is selected and the clip has a translation,
  Preview / Play clip / IG buttons route to the `_es` variants. Inline
  "🇪🇸 Traducir este clip" CTA appears when ES is picked on an untranslated
  clip — calls `/translate-only` and refreshes any open preview.
- **EditorMode (advanced timeline editor)**: EN | ES pill in the Subtítulos
  inspector panel. Derived `activeWords = subLanguage === "es" &&
  transcriptWordsEs.length ? transcriptWordsEs : transcriptWords` feeds
  the live `SubtitleOverlay`. Dashed-border "🇪🇸 Traducir subtítulos al
  español" CTA when ES isn't cached yet. `handleExport` chooses
  `startSpanishExport` vs `startExport` based on the active language.
  Re-transcribing wipes the ES cache + flips back to EN (Whisper word
  boundaries change).
- **Drag-to-position subtitles** (free improvement during this work):
  `SubtitleOverlay` gained optional `onYOffsetChange` + `containerRef`
  props. When both are set, the outer text span of every style becomes
  draggable; pointerdown captures Δy/containerHeight and writes back to
  the position state in real time. Wired in EditorMode so the "Posición"
  slider stays in sync. Visual Editor stays slider-only (its preview is
  a baked MP4 — drag would need a separate CSS overlay layer).

## 🎯 Auto-encuadre (face-tracking dynamic crop)

MediaPipe detects faces; FFmpeg `sendcmd` drives a dynamic crop window that
follows them over time. Available in both the EditorMode (standalone manual
editor, in its own inspector tab) and the Visual Editor / Paso 3 (per-clip,
in the right inspector). Off by default; user clicks "🎯 Analizar caras"
first, then toggles "Aplicar al export".

### Backend

- `services/face_track_service.py` (new module):
  - **MediaPipe Tasks API** (`mp.solutions.*` was removed in MediaPipe
    0.10.35 for Python 3.14 — only the Tasks API works).
  - `_ensure_model()` downloads `blaze_face_short_range.tflite` (~225KB) on
    first use; cached next to the module (gitignored — auto-downloads on
    fresh checkouts).
  - `analyze_clip(video_path, start, end, sample_fps=5.0)` — OpenCV reads
    frames at 5 FPS, MediaPipe detects faces, IDs assigned by greedy IoU
    matching (threshold 0.25) against the previous sample. Returns
    `{fps, width, height, start_time, end_time, samples[], people[]}` —
    `people[]` sorted by appearance_count desc.
  - `compute_crop_trajectory(face_track, mode, follow_id, target_aspect,
    padding, smoothing)` — per sample picks faces by mode (`all` /
    `biggest` / `follow`), computes union bbox, adds padding, expands to
    target aspect (always GROW so we never crop into the faces), clamps to
    source frame, EMA-smooths across samples. Returns
    `[{t, cx, cy, cw, ch}]` in source-pixel coords.
  - `build_sendcmd_file(trajectory, path, label="rfm")` — writes FFmpeg
    sendcmd lines: `<t> crop@rfm x <x1>, crop@rfm y <y1>;`. Only `x` and
    `y` are updated; `w` and `h` are NOT touched (see OOM fix below).
  - `remap_face_track_to_segments` — mirrors the transcript remap for
    the segment-cut case.
- `ClipData.face_track: dict` and `StyleConfig.auto_reframe_enabled / mode /
  follow_id / padding / smoothing`.
- `export_service.export_clip_with_style` integration:
  - `auto_reframe_active = enabled && face_track.samples && !use_split &&
    !use_keyframes`. Split-screen and keyframes both win; reframe is silently
    skipped with a log when either is active.
  - The fg_filter becomes
    `sendcmd=f={basename},crop@rfm={W0}:{H0}:{X0}:{Y0},scale={W}:{target_h}`.
  - The trajectory's `t` values are shifted by `-fast_seek` (the input -ss
    makes filter t=0 correspond to fast_seek source time, not source t=0).
  - **Windows path fix**: the `sendcmd=f=` filename CAN'T be an absolute
    path because the drive-letter colon (`C:`) is interpreted as a filter
    option separator. Same workaround as the `subtitles=` filter: write the
    real `.cmd` in `services/temp/`, copy to cwd, pass only the basename.
    Both files cleaned up in `finally`.
  - **OOM fix #1 (bypass parallel pipeline)**: when auto-reframe is on, the
    dynamic crop already fills the 9:16 canvas (the trajectory expands to
    target_aspect every sample). Running the source through both a blurred
    bg branch AND a sendcmd-driven fg branch — then overlaying — caused
    FFmpeg to renegotiate buffers every tick and crash with "Cannot
    allocate memory". Now reframe mode emits a single linear chain:
    `[0:v] sendcmd, crop@rfm, scale -> [v]`. No bg/fg/overlay.
  - **OOM fix #2 (fixed crop dimensions)**: changing the crop filter's
    output size mid-stream also caused libavfilter to renegotiate downstream
    buffers. Now the export picks `max(cw)/max(ch)` across the whole
    trajectory and uses that as a FIXED crop size; only `cx/cy` vary per
    sample. The camera "pans" but never "zooms". Trade-off: loses the
    close-up effect when only one person is in frame, but the export
    actually finishes.
  - In the segments branch, `clip_copy.face_track` is also remapped through
    `remap_face_track_to_segments` before recursing.
- New endpoints (separate per editor mode):
  - `POST /api/editor/{pid}/analyze-faces` — analyzes the editor's current
    trim, caches on `clip[0]`. Returns the people list (for the manual-pick
    grid) and the full samples list (for the live HTML viewfinder overlay).
  - `POST /api/editor/{pid}/reframe-style` — updates the StyleConfig knobs.
    Turning reframe ON force-disables split-screen.
  - `POST /api/clips/{pid}/{cid}/analyze-faces` — per-AI-clip analysis
    (only the clip's start_time..end_time range). Used by Visual Editor.
  - `GET /api/editor/.../preview-reframe` and
    `GET /api/clips/.../preview-reframe?seconds=10` — 10s sample MP4
    anchored on the busiest moment of the trajectory.
- `routes/clips.py` — `/video-preview` and `/video-preview-es` detect
  `style.auto_reframe_enabled && clip.face_track.samples` and route through
  `export_clip_with_style` (which knows about reframe) instead of the fast
  `generate_preview_clip` path. Slower (preset=fast vs ultrafast) but the
  only way to render the dynamic crop here.

### Frontend

- **EditorMode** (`Crosshair` icon tab in the rail + inspector):
  - Empty state: "🎯 Analizar caras · M:SS" button with duration estimate.
  - After analysis: pill toggle "Aplicar al export" (mutually exclusive
    with split-screen), mode picker (🫂 Todos / 🔍 Cara grande / 👤 Manual),
    Manual-pick grid showing up to 9 face thumbnails (CSS-positioned crops
    of the raw video element seeked to each person's `thumb_t`), Suavidad +
    Aire sliders, "▶ Ver muestra (10s)" + "Re-analizar".
  - **Live viewfinder overlay** (`ReframeViewfinder` component): gold
    rectangle painted over the live HTML video preview, animated by the
    same math as the backend trajectory (minus the EMA smoothing). Outside
    the rectangle is dimmed with `box-shadow: 0 0 0 9999px rgba(0,0,0,.35)`.
    Faint gold rects on each detected face. Only renders while the user is
    in the Reframe tab (keeps the normal preview uncluttered).
- **Visual Editor (Paso 3)**: same panel UI added under the Subtítulos
  section, per-clip via `clipFaceTracks` state keyed by clip id. Auto-reframe
  knobs live on the central `style` state and follow the existing "Aplicar a"
  scope (Todos / Este clip / Varios) so each AI clip can have its own settings.
  - The "Muestra 10s" button was removed — the regular Play clip button now
    renders the actual reframed result (because the backend `/video-preview`
    endpoint routes through `export_clip_with_style` when reframe is on).
    A gold 🎯 badge appears on the Play clip button when this is active to
    hint that the preview will take longer than usual.
- `frontend/src/services/api.js` gained `editorAnalyzeFaces`,
  `editorUpdateReframeStyle`, `getReframePreviewUrl`, `clipAnalyzeFaces`.

### Known limits (documented for v2)

- "All" mode + 2 people on opposite sides produces a very wide crop that
  persists for the whole clip (because of the fixed-dimension OOM fix). A
  split-screen auto-fallback was discussed but not implemented.
- IoU-based ID tracking swaps identities when two people are close or one
  moves fast. Face embeddings would fix this.
- 5 FPS sampling is fine for talking heads but choppy for fast gestures.
- No shot-cut detection (PySceneDetect would help) — the trajectory smooths
  across hard cuts which looks like camera wobble.
- Active-speaker detection (audio-based) is the obvious v2 improvement for
  podcasts. Not implemented.
- Strict-profile face detections are weak with BlazeFace short-range; a
  full-range or different model would help but costs CPU.

## ⏱ Long-video export timeout fix

`export_clip_with_style` and `export_instagram_clip` had a hardcoded
`timeout=600` on the subprocess call. For 30–90s TikTok clips that's fine;
for 1h+ podcast exports from the Editor (with blur + burned-in subs +
caption) the encode legitimately takes 30–60 min and the call timed out
after 10. Now: `_export_timeout = max(600, int(duration * 5))` — 5× realtime
safety margin (a 60-min export gets a 5h timeout). Logged on start so the
user can see it: `duration=3739.1s, timeout=18695s`.

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
