import os
import shutil
import uuid
from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
from ..models.clip import StyleConfig
from ..services import export_service, gemini_service, video_service
from .upload import get_project_store
from ..config import settings

router = APIRouter(prefix="/api/export", tags=["export"])


@router.post("/watermark/{project_id}")
async def upload_watermark(project_id: str, watermark: UploadFile = File(...)):
    """Upload a watermark PNG for a project."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    os.makedirs(project.output_dir, exist_ok=True)

    wm_path = os.path.join(project.output_dir, "watermark.png")
    with open(wm_path, "wb") as f:
        content = await watermark.read()
        f.write(content)

    project.style.watermark_path = wm_path
    return {"status": "uploaded", "path": wm_path}


@router.post("/music/{project_id}")
async def upload_project_music(project_id: str, audio: UploadFile = File(...)):
    """Upload a background-music track for the clip-export flow (Visual Editor
    / Paso 3). The path goes onto StyleConfig.music_path (project-wide) or
    a clip's style_override (per-clip), depending on the user's "Aplicar a"
    scope on the frontend. Returns the path, a serve URL, the probed duration
    (so the trim sliders can clamp), and a waveform peak list."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]

    music_dir = os.path.join(project.output_dir, "music")
    os.makedirs(music_dir, exist_ok=True)
    ext = os.path.splitext(audio.filename or "")[1].lower()
    if ext not in (".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus", ".flac"):
        ext = ".mp3"
    fname = f"music_{uuid.uuid4().hex[:8]}{ext}"
    fpath = os.path.join(music_dir, fname)
    with open(fpath, "wb") as f:
        shutil.copyfileobj(audio.file, f)

    # Best-effort duration + peaks. Failing here shouldn't kill the upload.
    try:
        duration = video_service.get_video_duration(fpath)
    except Exception:
        duration = 0.0
    try:
        peaks = video_service.get_audio_peaks(fpath, buckets=320)
    except Exception:
        peaks = []

    return {
        "path": fpath,
        "url": f"/api/export/music/{project_id}/{fname}",
        "filename": audio.filename or fname,
        "duration": round(float(duration or 0.0), 3),
        "peaks": peaks,
    }


@router.get("/music/{project_id}/{filename}")
async def project_music_file(project_id: str, filename: str):
    """Serve an uploaded music track for the frontend's <audio> preview."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = os.path.join(projects[project_id].output_dir, "music", filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Music not found")
    return FileResponse(path)


@router.post("/split-image/{project_id}")
async def upload_split_image(project_id: str, image: UploadFile = File(...)):
    """Upload a static image for split-screen bottom panel."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    os.makedirs(project.output_dir, exist_ok=True)

    img_path = os.path.join(project.output_dir, "split_image.png")
    with open(img_path, "wb") as f:
        content = await image.read()
        f.write(content)

    project.style.split_image_path = img_path
    project.style.split_screen_enabled = True
    return {"status": "uploaded", "path": img_path}


@router.put("/style/{project_id}")
async def update_style(project_id: str, style: StyleConfig):
    """Update visual style configuration."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    if style.watermark_path is None and project.style.watermark_path:
        style.watermark_path = project.style.watermark_path
    if style.split_image_path is None and project.style.split_image_path:
        style.split_image_path = project.style.split_image_path

    project.style = style
    return {"status": "updated", "style": style.model_dump()}


@router.put("/style/{project_id}/{clip_id}")
async def update_clip_style(project_id: str, clip_id: int, style: StyleConfig):
    """Set a per-clip style override (editor 'Aplicar a: Este clip / Varios').
    Pass clear=true to remove the override and inherit the project style again."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    clip = next((c for c in project.clips if c.id == clip_id), None)
    if clip is None:
        raise HTTPException(status_code=404, detail="Clip not found")

    # Inherit project-level asset paths if the override didn't carry them.
    if style.watermark_path is None and project.style.watermark_path:
        style.watermark_path = project.style.watermark_path
    if style.split_image_path is None and project.style.split_image_path:
        style.split_image_path = project.style.split_image_path

    clip.style_override = style
    return {"status": "updated", "clip_id": clip_id}


@router.delete("/style/{project_id}/{clip_id}")
async def clear_clip_style(project_id: str, clip_id: int):
    """Remove a clip's style override so it inherits the project style again."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    clip = next((c for c in project.clips if c.id == clip_id), None)
    if clip is None:
        raise HTTPException(status_code=404, detail="Clip not found")
    clip.style_override = None
    return {"status": "cleared", "clip_id": clip_id}


@router.post("/render/{project_id}")
async def render_clips(project_id: str, clip_ids: list[int] = Query(default=None), aspect_ratio: str = Query(default=None), no_text: bool = Query(default=False), use_watermark: bool = Query(default=False), variant: str = Query(default="")):
    """Start exporting clips in background. Optionally pass clip_ids to export only selected.
    `variant` (e.g. "16x9", "notext", "wm") is appended to filenames so
    alternate renders of the same clip don't overwrite the standard one."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    if not project.clips:
        raise HTTPException(status_code=400, detail="No clips to export.")

    # Filter clips if clip_ids provided
    if clip_ids:
        clips_to_export = [c for c in project.clips if c.id in clip_ids]
    else:
        clips_to_export = project.clips

    if not clips_to_export:
        raise HTTPException(status_code=400, detail="No matching clips found.")

    # Build a variant style on top of the saved one WITHOUT mutating it, so
    # the standard export keeps its saved look.
    eff_style = project.style.model_copy(deep=True)
    if aspect_ratio:
        eff_style.aspect_ratio = aspect_ratio
    eff_style.no_text = bool(no_text)
    if use_watermark:
        if not eff_style.watermark_path:
            raise HTTPException(status_code=400, detail="No watermark uploaded for this project.")
    else:
        eff_style.watermark_path = None

    project.status = "exporting"
    export_dir = os.path.join(project.output_dir, "exported")

    # Start background export
    export_service.export_all_clips_background(
        project_id=project_id,
        video_path=project.video_path,
        clips=clips_to_export,
        style=eff_style,
        output_dir=export_dir,
        transcript=getattr(project, 'transcript', None),
        file_suffix=f"_{variant}" if variant else "",
    )

    return {
        "status": "started",
        "total": len(clips_to_export),
        "message": "Export started in background. Poll /api/export/progress/{project_id} for updates.",
    }


@router.get("/progress/{project_id}")
async def get_export_progress(project_id: str):
    """Poll export progress."""
    progress = export_service.get_progress(project_id)
    return progress


@router.get("/translation-status/{project_id}")
async def get_translation_status(project_id: str):
    """Tells the frontend which clips already have a cached Spanish version
    AND returns the translated text so the UI can show it without further
    round-trips.

    Shape:
      {
        "translated": { clip_id: bool, ... },
        "data":       { clip_id: { "caption_es": str,
                                   "transcript_es": str,
                                   "transcript_en": str }, ... }
      }
    transcript_es / transcript_en are pre-joined word strings so the UI just
    renders them — no per-word reconstruction needed.
    """
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    transcript = getattr(project, "transcript", None) or {}
    all_words = transcript.get("words", []) if isinstance(transcript, dict) else []

    translated = {}
    data = {}
    for c in (project.clips or []):
        has_es = bool(getattr(c, "caption_es", "") and getattr(c, "words_es", []))
        translated[c.id] = has_es

        # Always populate caption_es / transcript_en even when only the caption
        # was translated (no-Whisper-words edge case) so the UI can still show
        # the user something useful.
        en_words = []
        for w in all_words:
            try:
                ws, we = float(w.get("start", 0.0)), float(w.get("end", 0.0))
            except Exception:
                continue
            if we < c.start_time:
                continue
            if ws > c.end_time:
                break
            wtxt = str(w.get("word", "")).strip()
            if wtxt:
                en_words.append(wtxt)
        transcript_en = " ".join(en_words)

        es_words = getattr(c, "words_es", None) or []
        transcript_es = " ".join(str(w.get("word", "")).strip() for w in es_words if str(w.get("word", "")).strip())

        data[c.id] = {
            "caption_es": getattr(c, "caption_es", "") or "",
            "transcript_es": transcript_es,
            "transcript_en": transcript_en,
        }

    return {"translated": translated, "data": data}


@router.post("/render-spanish/{project_id}")
async def render_spanish_clips(project_id: str, clip_ids: list[int] = Query(default=None)):
    """Translate selected clips to Spanish (caption + Whisper words) and export
    them as separate _es.mp4 files alongside the English originals.

    Translation results are cached on each clip (clip.caption_es, clip.words_es)
    so re-exports skip the Gemini call. The English versions are NEVER touched.
    """
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    if not project.clips:
        raise HTTPException(status_code=400, detail="No clips to export.")

    if clip_ids:
        clips_to_export = [c for c in project.clips if c.id in clip_ids]
    else:
        clips_to_export = project.clips

    if not clips_to_export:
        raise HTTPException(status_code=400, detail="No matching clips found.")

    # 1) Translate the clips that don't have a cached Spanish version yet.
    # We do this synchronously (per-clip) so the export thread starts with
    # populated caches and the user immediately sees progress in the existing
    # /export/progress poll. The Gemini call is cheap (<2s per clip).
    transcript = getattr(project, "transcript", None) or {}
    all_words = transcript.get("words", []) if isinstance(transcript, dict) else []
    target_model = getattr(project, "gemini_model", None) or settings.GEMINI_MODEL

    translation_errors: list[str] = []
    for clip in clips_to_export:
        if getattr(clip, "caption_es", "") and getattr(clip, "words_es", []):
            continue   # already translated, skip

        # English words inside this clip's time range — same logic as
        # subtitle_service._filter_words_for_clip but keeping ORIGINAL
        # (video-time) timestamps so the Spanish words land in the same
        # window when the ASS generator slices by clip_start/end later.
        clip_en_words = []
        for w in all_words:
            try:
                ws, we = float(w.get("start", 0.0)), float(w.get("end", 0.0))
            except Exception:
                continue
            if we < clip.start_time:
                continue
            if ws > clip.end_time:
                break
            clip_en_words.append({
                "word": str(w.get("word", "")).strip(),
                "start": ws,
                "end": we,
            })

        if not clip_en_words:
            translation_errors.append(
                f"Clip {clip.id}: no Whisper words in range — skipped (Spanish export will have no subtitles)"
            )
            # Still translate the caption alone so the white box is in Spanish.
            try:
                # Use the start of the clip as the time anchor for a placeholder
                # span so words_es stays empty (no subs) while caption_es works.
                result = gemini_service.translate_clip_to_spanish(
                    clip.viral_caption,
                    [{"word": "placeholder", "start": clip.start_time, "end": clip.end_time}],
                    model=target_model,
                )
                if result.get("caption_es"):
                    clip.caption_es = result["caption_es"]
                clip.words_es = []
            except Exception as e:
                translation_errors.append(f"Clip {clip.id}: caption-only translation failed: {e}")
            continue

        try:
            result = gemini_service.translate_clip_to_spanish(
                clip.viral_caption,
                clip_en_words,
                model=target_model,
            )
        except Exception as e:
            translation_errors.append(f"Clip {clip.id}: translation failed: {e}")
            continue

        if not result:
            translation_errors.append(f"Clip {clip.id}: translation returned empty")
            continue

        clip.caption_es = result.get("caption_es", "") or clip.viral_caption
        clip.words_es = result.get("words_es", []) or []

    # 2) Kick off the background export with language="es".
    project.status = "exporting"
    export_dir = os.path.join(project.output_dir, "exported")
    export_service.export_all_clips_background(
        project_id=project_id,
        video_path=project.video_path,
        clips=clips_to_export,
        style=project.style,
        output_dir=export_dir,
        transcript=getattr(project, 'transcript', None),
        language="es",
    )

    return {
        "status": "started",
        "total": len(clips_to_export),
        "translation_errors": translation_errors,
        "message": "Spanish export started. Poll /api/export/progress/{project_id} for updates.",
    }


@router.post("/instagram-render/{project_id}")
async def render_instagram_clips(project_id: str, clip_ids: list[int] = Query(default=None)):
    """Start instagram export in background."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    if not project.clips:
        raise HTTPException(status_code=400, detail="No clips to export.")

    if clip_ids:
        clips_to_export = [c for c in project.clips if c.id in clip_ids]
    else:
        clips_to_export = project.clips

    if not clips_to_export:
        raise HTTPException(status_code=400, detail="No matching clips found.")

    export_dir = os.path.join(project.output_dir, "instagram_exported")

    export_service.export_all_instagram_clips_background(
        project_id=project_id,
        video_path=project.video_path,
        clips=clips_to_export,
        style=project.style,
        output_dir=export_dir,
    )

    return {
        "status": "started",
        "total": len(clips_to_export),
        "message": "Instagram export started. Poll /api/export/instagram-progress/{project_id}",
    }


@router.get("/instagram-progress/{project_id}")
async def get_instagram_progress(project_id: str):
    """Poll instagram export progress."""
    return export_service.get_instagram_progress(project_id)


@router.get("/instagram-download/{project_id}/{filename}")
async def download_instagram_clip(project_id: str, filename: str):
    """Download an instagram exported clip."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    file_path = os.path.join(project.output_dir, "instagram_exported", filename)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path, media_type="video/mp4", filename=filename)


@router.get("/download/{project_id}/{filename}")
async def download_clip(project_id: str, filename: str):
    """Download an exported clip."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    file_path = os.path.join(project.output_dir, "exported", filename)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path, media_type="video/mp4", filename=filename)
