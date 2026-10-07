import os
import math
import uuid
import asyncio
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from ..services import gemini_service, video_service, whisper_service, prompts
from ..models.clip import Keyframe, Segment
from .upload import get_project_store

router = APIRouter(prefix="/api/clips", tags=["clips"])


class AnalyzeRequest(BaseModel):
    project_id: str
    duration_override: float | None = None


class EditCaptionRequest(BaseModel):
    viral_caption: str


class UpdateModelRequest(BaseModel):
    gemini_model: str


class ModelHealthRequest(BaseModel):
    models: list[str] | None = None


class KeyframeInput(BaseModel):
    """Wire format for a single keyframe coming from the editor modal."""
    time: float          # seconds from clip start
    zoom: float = 1.0
    pan_x: float = 0.0
    pan_y: float = 0.0


class EditTransformRequest(BaseModel):
    """Per-clip edit set by the editor modal (zoom + pan + trim + keyframes).

    `keyframes` semantics:
      - None  → leave clip.keyframes unchanged
      - []    → clear keyframes (revert to static mode)
      - [...] → replace keyframes wholesale
    Trim (start_time/end_time) is independent of keyframes and applies in both
    static and animated modes.
    """
    edit_zoom: float = 1.0
    edit_pan_x: float = 0.0
    edit_pan_y: float = 0.0
    start_time: float | None = None
    end_time: float | None = None
    keyframes: list[KeyframeInput] | None = None
    # Timeline cuts — if non-empty, the clip exports as the concatenation of
    # these segments (in ORIGINAL-video seconds). None = unchanged, [] = clear
    # (revert to single range defined by start_time/end_time).
    segments: list[dict] | None = None


# ─── Lazily-transcribe helper ─────────────────────────────────────────────
# When clips come in WITHOUT analysis (pescador / viral-modal "enviar a clips"
# flow), the project has no Whisper transcript, so subtitles can't render.
# Re-analyze is the natural moment to transcribe; this helper kicks off a
# single background Whisper pass over the project video (guarded so we never
# run it twice) and stores the result on the project.
_whisper_started: set[str] = set()


def _ensure_project_transcript(project_id: str) -> None:
    """Transcribe the whole project video in a background thread, but only if
    the project still lacks a transcript and no pass is already running."""
    import threading
    if project_id in _whisper_started:
        return
    projects = get_project_store()
    project = projects.get(project_id)
    if not project or project.transcript is not None:
        return
    _whisper_started.add(project_id)

    def run():
        try:
            print(f"[Whisper] {project_id}: transcribing {os.path.basename(project.video_path)} "
                  f"(on-demand from re-analyze)…")
            tr = whisper_service.transcribe(project.video_path)
            p = get_project_store().get(project_id)
            if p is not None:
                p.transcript = tr
            n = len((tr or {}).get("words", []))
            print(f"[Whisper] {project_id}: done — {n} words")
        except Exception as e:
            print(f"[Whisper] {project_id}: failed: {e}")
        finally:
            _whisper_started.discard(project_id)

    threading.Thread(target=run, daemon=True).start()


@router.post("/analyze")
async def analyze_video(req: AnalyzeRequest):
    """Start AI analysis on a project's video."""
    projects = get_project_store()
    if req.project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[req.project_id]

    active_file = None
    extracted_range_path = None  # if user asked to analyze only a sub-range
    try:
        # If user specified an analyze range, extract just those seconds into a
        # temp file. Both Whisper and Gemini will work on this smaller file;
        # we'll shift timestamps back to the original video timeline at the end.
        analyze_start = float(getattr(project, 'analyze_start', 0.0) or 0.0)
        analyze_duration = float(getattr(project, 'analyze_duration', 0.0) or 0.0)
        needs_extraction = analyze_start > 0 or (
            analyze_duration > 0 and analyze_duration < project.video_duration
        )

        if needs_extraction:
            range_end = analyze_start + (analyze_duration or (project.video_duration - analyze_start))
            temp_dir = os.path.join(os.path.dirname(__file__), "..", "services", "temp")
            os.makedirs(temp_dir, exist_ok=True)
            extracted_range_path = os.path.join(temp_dir, f"analyze_range_{project.id}_{uuid.uuid4().hex[:8]}.mp4")
            print(f"[Analyze] Extracting accurate range {analyze_start:.0f}s — {range_end:.0f}s "
                  f"({(range_end - analyze_start)/60:.1f} min) — this re-encodes (~30s) for "
                  f"frame-accurate timestamps so subtitles align with audio.")
            # accurate=True (default) — re-encodes so Whisper word timestamps
            # match the audio exactly. Stream-copy keyframe snap would drift
            # subtitles by 0-10 seconds depending on the source's keyframe
            # interval, which is what 'subtitles don't match' bug reports trace to.
            await asyncio.to_thread(
                gemini_service.extract_video_chunk,
                project.video_path, analyze_start, range_end, extracted_range_path, True,
            )
            video_for_analysis = extracted_range_path
            effective_duration = range_end - analyze_start
        else:
            video_for_analysis = project.video_path
            effective_duration = project.video_duration
            analyze_start = 0.0  # no shift needed

        # Start Whisper transcription IN PARALLEL with Gemini upload + processing.
        # Whisper runs on local CPU; Gemini runs on Google's servers — they don't
        # compete for resources. By the time Gemini is ready, Whisper is often done.
        print("[Whisper] Starting transcription in parallel with Gemini upload...")
        whisper_task = asyncio.create_task(
            asyncio.to_thread(whisper_service.transcribe, video_for_analysis)
        )

        project.status = "uploading"
        file_obj = await asyncio.to_thread(gemini_service.upload_video, video_for_analysis)

        project.status = "processing"
        active_file = await asyncio.to_thread(gemini_service.wait_for_processing, file_obj)

        # Check token count before analyzing — fail fast with clear message
        project.status = "analyzing"
        token_count = await asyncio.to_thread(gemini_service.count_tokens, active_file)
        project.token_count = token_count
        MAX_TOKENS = 1_048_576
        if token_count > MAX_TOKENS:
            project.status = "error"
            mins = int((project.video_duration or 0) / 60)
            # Cancel the in-flight Whisper task before bailing out
            whisper_task.cancel()
            await asyncio.to_thread(gemini_service.delete_file, active_file)
            raise HTTPException(
                status_code=400,
                detail=f"Video too large for AI: {token_count:,} tokens (max {MAX_TOKENS:,}). "
                       f"Your video is {mins} min. Please use a video under 45 minutes."
            )
        duration = req.duration_override or effective_duration

        # Wait for Whisper to finish (usually done by now since it ran in parallel).
        # IMPORTANT: keep the transcript in EXTRACT-LOCAL timeline (0..duration)
        # while Gemini is analyzing — both Gemini and the transcript see the
        # same time window. We shift both to the ORIGINAL video timeline only
        # AFTER all analysis is done.
        transcript = None
        try:
            transcript = await whisper_task
            print(f"[Whisper] Transcription ready ({len(transcript.get('words', []))} words)")
        except Exception as e:
            print(f"[Whisper] Transcription failed (continuing without it): {e}")

        # If the (effective) video is long enough, switch to chunked analysis.
        # Note: we work on the EXTRACTED file, so chunking divides that, not
        # the original. _analyze_in_chunks receives video_for_analysis explicitly.
        if duration > gemini_service.CHUNK_THRESHOLD_SECONDS:
            print(f"[Analyze] Effective video is {duration/60:.1f} min — using chunked analysis")
            await asyncio.to_thread(gemini_service.delete_file, active_file)
            active_file = None
            clips = await _analyze_in_chunks(project, duration, transcript, video_for_analysis)
        else:
            # Single-shot (videos under the chunked threshold). Wrap in the
            # same retry policy as _analyze_in_chunks so a transient Gemini
            # blip ("empty response") doesn't return 0 clips and force the
            # user to re-upload — most empty-response failures clear within
            # a few seconds when Google's load shifts.
            # gemini_call_with_retry inside analyze_video handles retries and
            # fallbacks automatically — no extra wrapper needed here.
            clips = await asyncio.to_thread(
                gemini_service.analyze_video,
                active_file,
                duration,
                project.clip_count,
                project.min_duration,
                project.custom_prompt,
                0,
                transcript,
                project.gemini_model,
                getattr(project, 'creator_name', ''),
                getattr(project, 'max_duration', 90),
                getattr(project, 'analyze_lang', 'en'),
                req.project_id,
            )
            print(f"[Analyze] single-shot got {len(clips)}/{project.clip_count} clips")


        # Shift BOTH clips and transcript to the ORIGINAL video timeline if we
        # analyzed a sub-range. After this, all timestamps refer to the original
        # video file, so preview/export/validation all work without any other
        # changes.
        if analyze_start > 0:
            for c in clips:
                c.start_time = round(c.start_time + analyze_start, 2)
                c.end_time = round(c.end_time + analyze_start, 2)
            if transcript:
                for w in transcript.get("words", []):
                    w["start"] = round(w.get("start", 0) + analyze_start, 3)
                    w["end"] = round(w.get("end", 0) + analyze_start, 3)
            print(f"[Analyze] Shifted {len(clips)} clips + transcript by +{analyze_start:.0f}s")

        # Save transcript (now in original-video timeline) for subtitle generation later
        if transcript:
            project.transcript = transcript

        # Validate each clip's caption against the Whisper transcript so the
        # editor can show a confidence indicator next to each one.
        if transcript:
            for c in clips:
                snippet, conf = gemini_service.validate_caption_against_transcript(
                    c.viral_caption, c.start_time, c.end_time, transcript
                )
                c.transcript_snippet = snippet
                c.match_confidence = conf

        project.clips = clips
        project.status = "ready"

        return {
            "project_id": project.id,
            "status": "ready",
            "clips": [c.model_dump() for c in clips],
            "total": len(clips),
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        project.status = "error"
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Always clean up the Gemini file to free storage quota
        if active_file is not None:
            await asyncio.to_thread(gemini_service.delete_file, active_file)
        # Clean up the extracted range temp file (if any)
        if extracted_range_path and os.path.exists(extracted_range_path):
            try:
                os.remove(extracted_range_path)
                print(f"[Analyze] Cleaned up extracted range file")
            except Exception:
                pass


async def _analyze_in_chunks(project, duration: float, transcript: dict, video_path: str = None) -> list:
    """Split a long video into chunks of ~10 min, analyze each separately, then
    merge the results. Each chunk gives Gemini a much smaller time window so its
    timestamps stay precise. Chunk-local timestamps are shifted back to the
    extracted-file global timeline before merging. (An additional shift by
    analyze_start happens at the caller for original-video timeline.)

    `video_path` overrides project.video_path — used when analyzing a
    pre-extracted sub-range so chunking operates on the extracted file.
    """
    source_video = video_path or project.video_path
    ranges = gemini_service.build_chunk_ranges(duration, gemini_service.CHUNK_DURATION_SECONDS)
    n_chunks = len(ranges)
    # Ask for 1 extra clip per chunk to compensate for dedup at merge time.
    # Without this, asking for 9 with 2 chunks (5+5 = 10 candidates) often
    # ends up at 7-8 after dedup. With +1 per chunk (6+6 = 12 candidates) the
    # dedup hits less often leave us short of the target.
    clips_per_chunk = max(1, math.ceil(project.clip_count / n_chunks) + 1)
    print(f"[Chunked] {n_chunks} chunks, ~{clips_per_chunk} clips each (target {project.clip_count} after dedup)")

    temp_dir = os.path.join(os.path.dirname(__file__), "..", "services", "temp")
    os.makedirs(temp_dir, exist_ok=True)

    # Retry helper: most "empty response" failures from Gemini are transient
    # (server capacity, rate-limit edge cases). We retry the analyze step
    # specifically — extraction/upload rarely fails so they stay one-shot.
    async def _analyze_with_retry(chunk_file, chunk_duration, chunk_transcript, label, max_attempts=3):
        last_err = None
        for attempt in range(1, max_attempts + 1):
            try:
                return await asyncio.to_thread(
                    gemini_service.analyze_video,
                    chunk_file,
                    chunk_duration,
                    clips_per_chunk,
                    project.min_duration,
                    project.custom_prompt,
                    0,
                    chunk_transcript,
                    project.gemini_model,
                    getattr(project, 'creator_name', ''),
                    getattr(project, 'max_duration', 90),
                    getattr(project, 'analyze_lang', 'en'),
                )
            except Exception as e:
                last_err = e
                msg = str(e).lower()
                # Bail out immediately on permanent failures so we don't burn
                # quota retrying something that can't succeed.
                if any(p in msg for p in ("quota", "permission", "invalid", "not found", "400 ", "403 ", "404 ")):
                    raise
                if attempt < max_attempts:
                    # Exponential-ish backoff: 5s, 15s. Most empty-response
                    # blips clear within seconds when Google's load shifts.
                    delay = 5 if attempt == 1 else 15
                    print(f"[Chunked] {label} attempt {attempt} failed ({e}) — retrying in {delay}s")
                    await asyncio.sleep(delay)
        raise last_err

    all_clips = []
    failed_chunks = []
    for idx, (chunk_start, chunk_end) in enumerate(ranges):
        chunk_duration = chunk_end - chunk_start
        chunk_path = os.path.join(temp_dir, f"chunk_{uuid.uuid4().hex}.mp4")
        chunk_file = None
        label = f"Chunk {idx+1}/{n_chunks}"
        try:
            print(f"[Chunked] Extracting {label}: {chunk_start:.0f}s-{chunk_end:.0f}s")
            # accurate=True so chunk timestamps line up with the audio
            # (no keyframe-snap drift across chunk boundaries).
            await asyncio.to_thread(
                gemini_service.extract_video_chunk,
                source_video, chunk_start, chunk_end, chunk_path, True,
            )
            chunk_file = await asyncio.to_thread(gemini_service.upload_video, chunk_path)
            chunk_file = await asyncio.to_thread(gemini_service.wait_for_processing, chunk_file)

            chunk_transcript = gemini_service.filter_transcript_for_range(
                transcript, chunk_start, chunk_end
            ) if transcript else None

            chunk_clips = await _analyze_with_retry(chunk_file, chunk_duration, chunk_transcript, label)

            # Shift chunk-local timestamps to global video time
            for c in chunk_clips:
                c.start_time = round(c.start_time + chunk_start, 2)
                c.end_time = round(c.end_time + chunk_start, 2)
            all_clips.extend(chunk_clips)
            print(f"[Chunked] {label} done — {len(chunk_clips)} clips")
        except Exception as e:
            failed_chunks.append((idx + 1, str(e)))
            print(f"[Chunked] {label} FAILED after retries: {e}")
        finally:
            if chunk_file is not None:
                try:
                    await asyncio.to_thread(gemini_service.delete_file, chunk_file)
                except Exception:
                    pass
            try:
                if os.path.exists(chunk_path):
                    os.remove(chunk_path)
            except Exception:
                pass

    # Sort by global start_time and renumber IDs
    all_clips.sort(key=lambda c: c.start_time)
    for i, c in enumerate(all_clips):
        c.id = i + 1

    candidate_count = len(all_clips)

    # Truncate to user-requested total
    if len(all_clips) > project.clip_count:
        all_clips = all_clips[:project.clip_count]
        for i, c in enumerate(all_clips):
            c.id = i + 1

    # Loud summary so we always know whether the user got what they asked for.
    print(
        f"[Chunked] DONE — got {len(all_clips)}/{project.clip_count} clips "
        f"(candidates: {candidate_count}, failed chunks: {len(failed_chunks)}/{n_chunks})"
    )
    if failed_chunks:
        print(f"[Chunked] Failures: {failed_chunks}")
    if len(all_clips) < project.clip_count:
        deficit = project.clip_count - len(all_clips)
        print(
            f"[Chunked] WARNING: short by {deficit} clip(s). "
            f"Likely cause: {'failed chunks (Gemini empty response or rate-limit)' if failed_chunks else 'aggressive dedup'}."
        )

    return all_clips


@router.get("/{project_id}/download-info")
async def download_clips_info(project_id: str):
    """Download the clips_info.txt file for a project."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    info_path = os.path.join(project.output_dir, "clips_info.txt")

    if not os.path.exists(info_path):
        raise HTTPException(status_code=404, detail="clips_info.txt not found. Export clips first.")

    return FileResponse(info_path, media_type="text/plain", filename="clips_info.txt")


@router.get("/{project_id}")
async def get_clips(project_id: str):
    """Get all clips for a project."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    return {
        "clips": [c.model_dump() for c in project.clips],
        "total": len(project.clips),
    }


@router.put("/{project_id}/model")
async def update_project_model(project_id: str, req: UpdateModelRequest):
    """Switch the Gemini model used for re-analysis on this project."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    allowed = gemini_service.VIDEO_ANALYSIS_MODELS
    if req.gemini_model not in allowed:
        raise HTTPException(status_code=400, detail=f"Model must be one of {sorted(allowed)}")
    projects[project_id].gemini_model = req.gemini_model
    return {"status": "updated", "gemini_model": req.gemini_model}


@router.post("/model-health")
async def check_model_health(req: ModelHealthRequest):
    """Lightweight availability check for Gemini models.

    Sends a tiny text prompt ("ok"). This helps catch obvious 429/503 failures
    before uploading/analyzing a video, but video requests can still fail later.
    """
    requested = req.models or sorted(gemini_service.VIDEO_ANALYSIS_MODELS)
    models = [m for m in requested if m in gemini_service.VIDEO_ANALYSIS_MODELS]
    if not models:
        raise HTTPException(status_code=400, detail="No valid models provided")

    results = []
    for model in models:
        result = await asyncio.to_thread(gemini_service.check_model_health, model)
        results.append(result)
    return {"models": results}


@router.get("/{project_id}/raw-video")
async def stream_raw_video(project_id: str):
    """Stream the raw uploaded video (used by the in-app editor modal so the
    <video> element can play arbitrary timestamps for live preview)."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    path = projects[project_id].video_path
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Source video missing on disk")
    return FileResponse(path, media_type="video/mp4")


@router.put("/{project_id}/{clip_id}/edit")
async def edit_clip_transform(project_id: str, clip_id: int, req: EditTransformRequest):
    """Save the in-app editor's zoom/pan/trim values for a specific clip."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    for clip in project.clips:
        if clip.id == clip_id:
            clip.edit_zoom = max(0.3, min(3.0, float(req.edit_zoom)))
            clip.edit_pan_x = max(-50.0, min(50.0, float(req.edit_pan_x)))
            clip.edit_pan_y = max(-50.0, min(50.0, float(req.edit_pan_y)))
            if req.start_time is not None:
                clip.start_time = max(0.0, float(req.start_time))
            if req.end_time is not None:
                clip.end_time = max(clip.start_time + 1.0, float(req.end_time))
            clip.duration = clip.end_time - clip.start_time
            # Keyframes replace wholesale. None = no change, [] = clear.
            if req.keyframes is not None:
                clip_dur = clip.duration
                normalised: list[Keyframe] = []
                for kf in req.keyframes:
                    # Clamp time into [0, clip_duration] so keyframes can't
                    # land outside the trimmed range (would make the FFmpeg
                    # expression evaluate constants past clip end).
                    t = max(0.0, min(clip_dur, float(kf.time)))
                    # zoompan can't zoom out below 1.0, so clamp to [1, 3].
                    z = max(1.0, min(3.0, float(kf.zoom)))
                    px = max(-100.0, min(100.0, float(kf.pan_x)))
                    py = max(-100.0, min(100.0, float(kf.pan_y)))
                    normalised.append(Keyframe(time=t, zoom=z, pan_x=px, pan_y=py))
                normalised.sort(key=lambda k: k.time)
                clip.keyframes = normalised
            # Segments replace wholesale. None = unchanged, [] = clear (back to
            # single-range mode). Clamped to the source video duration; zero or
            # negative length pieces are dropped.
            if req.segments is not None:
                vid_dur = float(getattr(project, "video_duration", 0) or 0)
                clean: list[Segment] = []
                for s in req.segments:
                    a = max(0.0, float(s.get("start", 0.0)))
                    b = float(s.get("end", 0.0))
                    if vid_dur > 0:
                        b = min(b, vid_dur)
                    if b - a > 0.05:
                        clean.append(Segment(
                            start=round(a, 3), end=round(b, 3),
                            speed=max(0.25, min(4.0, float(s.get("speed", 1.0)))),
                        ))
                clip.segments = clean
                # Keep the single-range in/out in sync with the kept span so
                # callers that ignore segments still see the right window.
                if clean:
                    clip.start_time = min(seg.start for seg in clean)
                    clip.end_time = max(seg.end for seg in clean)
                    clip.duration = clip.end_time - clip.start_time
            return {"status": "updated", "clip": clip.model_dump()}
    raise HTTPException(status_code=404, detail="Clip not found")


@router.put("/{project_id}/{clip_id}")
async def edit_clip_caption(project_id: str, clip_id: int, req: EditCaptionRequest):
    """Edit the caption text for a specific clip."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    for clip in project.clips:
        if clip.id == clip_id:
            clip.viral_caption = req.viral_caption
            clip.caption_es = req.viral_caption
            if project.output_dir:
                for fname in [f"preview_clip_{clip_id}.jpg", f"preview_clip_{clip_id}_es.jpg", f"ig_preview_clip_{clip_id}.jpg", f"ig_preview_clip_{clip_id}_es.jpg"]:
                    fp = os.path.join(project.output_dir, fname)
                    if os.path.exists(fp):
                        try:
                            os.remove(fp)
                        except Exception:
                            pass
            return {"status": "updated", "clip": clip.model_dump()}

    raise HTTPException(status_code=404, detail="Clip not found")


class TrimClipRequest(BaseModel):
    start_time: float
    end_time: float


@router.put("/{project_id}/{clip_id}/trim")
async def trim_clip(project_id: str, clip_id: int, req: TrimClipRequest):
    """Adjust a clip's start/end in/out points (manual re-trim from the
    instant preview). Just updates the times — no re-render. The styled
    render in the editor reads these on demand."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    vid_dur = float(getattr(project, "video_duration", 0) or 0)
    start = max(0.0, float(req.start_time))
    end = float(req.end_time)
    if vid_dur > 0:
        end = min(end, vid_dur)
    if end - start < 0.5:
        raise HTTPException(status_code=400, detail="Clip must be at least 0.5s long")

    for clip in project.clips:
        if clip.id == clip_id:
            clip.start_time = round(start, 3)
            clip.end_time = round(end, 3)
            clip.duration = round(end - start, 3)
            return {"status": "updated", "clip": clip.model_dump()}

    raise HTTPException(status_code=404, detail="Clip not found")


# ─── Subtitle text correction (fix Whisper mistranscriptions) ────────────────
# The project's Whisper transcript drives the word-by-word subtitle styles.
# Whisper mis-hears names / slang / Spanish; these endpoints let the user fix
# the WORDS while keeping each word's timestamp, so the corrected text shows in
# every subtitle style without re-running Whisper.

class SubtitleWordsUpdate(BaseModel):
    updates: list[dict]   # [{ "i": <global word index>, "word": "<new text>" }]


class SubtitleReplaceRequest(BaseModel):
    find: str
    replace: str


@router.get("/{project_id}/{clip_id}/subtitle-words")
async def get_subtitle_words(project_id: str, clip_id: int):
    """Return the transcript words that fall inside this clip's time range,
    each with its GLOBAL index into project.transcript['words'] so the editor
    can send back targeted updates."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    clip = next((c for c in project.clips if c.id == clip_id), None)
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    transcript = getattr(project, "transcript", None)
    words = (transcript or {}).get("words") or []
    if not words:
        return {"has_transcript": False, "words": []}

    out = []
    for i, w in enumerate(words):
        try:
            ws, we = float(w.get("start", 0)), float(w.get("end", 0))
        except (TypeError, ValueError):
            continue
        # Keep words that overlap the clip range at all.
        if we >= clip.start_time and ws <= clip.end_time:
            out.append({"i": i, "word": w.get("word", ""), "start": round(ws, 3), "end": round(we, 3)})
    return {"has_transcript": True, "words": out}


@router.put("/{project_id}/subtitle-words")
async def update_subtitle_words(project_id: str, req: SubtitleWordsUpdate):
    """Apply per-word text edits (timestamps untouched)."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    transcript = getattr(project, "transcript", None)
    words = (transcript or {}).get("words") or []
    if not words:
        raise HTTPException(status_code=400, detail="This project has no transcript")

    changed = 0
    for u in (req.updates or []):
        try:
            idx = int(u.get("i"))
        except (TypeError, ValueError):
            continue
        if 0 <= idx < len(words):
            new_w = str(u.get("word", "")).strip()
            if words[idx].get("word", "") != new_w:
                words[idx]["word"] = new_w
                changed += 1
    return {"status": "updated", "changed": changed}


@router.post("/{project_id}/subtitle-replace")
async def replace_subtitle_word(project_id: str, req: SubtitleReplaceRequest):
    """Global whole-word, case-insensitive find/replace across the transcript.
    Great for a name Whisper consistently mis-hears."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    transcript = getattr(project, "transcript", None)
    words = (transcript or {}).get("words") or []
    find = (req.find or "").strip()
    if not find:
        raise HTTPException(status_code=400, detail="`find` is required")
    if not words:
        raise HTTPException(status_code=400, detail="This project has no transcript")

    repl = (req.replace or "").strip()
    find_low = find.lower()
    changed = 0
    for w in words:
        cur = w.get("word", "")
        # Compare on the trimmed/lowered core so surrounding punctuation/case
        # don't block a match; preserve nothing fancy — just swap the text.
        if cur.strip().lower() == find_low:
            if cur != repl:
                w["word"] = repl
                changed += 1
    return {"status": "ok", "changed": changed}


@router.get("/{project_id}/{clip_id}/preview")
async def preview_clip_frame(project_id: str, clip_id: int):
    """Generate and return a 9:16 preview frame for a clip."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = None
    for c in project.clips:
        if c.id == clip_id:
            clip = c
            break

    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    os.makedirs(project.output_dir, exist_ok=True)
    preview_path = os.path.join(project.output_dir, f"preview_clip_{clip_id}.jpg")
    timestamp = clip.start_time + (clip.duration / 2)

    style = clip.style_override or project.style

    # Keyframes mode: the single-frame preview can't run the full zoompan
    # animation, so we interpolate the keyframes at the clip midpoint and
    # feed those values to the static preview path. The pan ranges differ
    # slightly between overlay-shift (static) and source-crop (zoompan), but
    # for a thumbnail this is close enough — the user sees the real animation
    # via the Play button.
    _kfs = getattr(clip, 'keyframes', []) or []
    if _kfs:
        _interp = video_service.interpolate_keyframes(_kfs, clip.duration / 2)
        _ez = _interp["zoom"]
        _epx = max(-50.0, min(50.0, _interp["pan_x"] / 2))   # halve to roughly match overlay semantics
        _epy = max(-50.0, min(50.0, _interp["pan_y"] / 2))
    else:
        _ez = getattr(clip, 'edit_zoom', 1.0)
        _epx = getattr(clip, 'edit_pan_x', 0.0)
        _epy = getattr(clip, 'edit_pan_y', 0.0)

    _crop_ov = None
    if getattr(style, "auto_reframe_enabled", False):
        ft_file = os.path.join(project.output_dir, f"face_track_{clip_id}.json")
        if not getattr(clip, "face_track", None) or not clip.face_track.get("samples"):
            if os.path.exists(ft_file):
                try:
                    with open(ft_file, "r", encoding="utf-8") as f:
                        clip.face_track = json.load(f)
                except Exception:
                    pass
        if getattr(clip, "face_track", None) and clip.face_track.get("samples"):
            try:
                from ..services import face_track_service
                traj = face_track_service.compute_crop_trajectory(
                    face_track=clip.face_track,
                    mode=getattr(style, "auto_reframe_mode", "all"),
                    follow_id=getattr(style, "auto_reframe_follow_id", None),
                    target_aspect=getattr(style, "aspect_ratio", "9:16"),
                    padding=float(getattr(style, "auto_reframe_padding", 0.30)),
                    smoothing=float(getattr(style, "auto_reframe_smoothing", 0.85)),
                )
                if traj:
                    closest_p = min(traj, key=lambda p: abs(p["t"] - timestamp))
                    cw = closest_p["cw"]
                    ch = closest_p["ch"]
                    cx0 = max(0, int(closest_p["cx"] - cw / 2))
                    cy0 = max(0, int(closest_p["cy"] - ch / 2))
                    _crop_ov = (cw, ch, cx0, cy0)
            except Exception as e:
                print(f"[Preview] Error calculating reframe crop: {e}")

    try:
        await asyncio.to_thread(
            video_service.generate_preview_frame,
            video_path=project.video_path,
            timestamp=timestamp,
            output_path=preview_path,
            caption_text=clip.viral_caption,
            text_x=style.text_x,
            text_y=style.text_y,
            font_size=style.font_size,
            text_color=style.text_color,
            text_stroke_color=style.text_stroke_color,
            text_stroke_width=style.text_stroke_width,
            watermark_path=style.watermark_path,
            watermark_x=style.watermark_x,
            watermark_y=style.watermark_y,
            watermark_scale=style.watermark_scale,
            watermark_opacity=style.watermark_opacity,
            fill_mode=style.fill_mode,
            split_screen_enabled=style.split_screen_enabled,
            split_image_path=style.split_image_path,
            split_ratio=style.split_ratio,
            flip_horizontal=style.flip_horizontal,
            boost_contrast=style.boost_contrast,
            hdr_4k=getattr(style, 'hdr_4k', False),
            sharpness_pct=getattr(style, 'sharpness_pct', 0),
            caption_style=getattr(style, 'caption_style', 'box'),
            background_style=getattr(style, 'background_style', 'blur'),
            no_text=getattr(style, 'no_text', False),
            caption_font=getattr(style, 'caption_font', 'calibri'),
            caption_box_radius=getattr(style, 'caption_box_radius', 0.28),
            caption_box_opacity=getattr(style, 'caption_box_opacity', 0.95),
            caption_box_color=getattr(style, 'caption_box_color', '#FFFFFF'),
            caption_box_pad_x=getattr(style, 'caption_box_pad_x', 14),
            caption_box_pad_y=getattr(style, 'caption_box_pad_y', 14),
            no_emojis=getattr(style, 'no_emojis', False),
            edit_zoom=_ez,
            edit_pan_x=_epx,
            edit_pan_y=_epy,
            fill_mode_scale=getattr(style, 'fill_mode_scale', 1.0),
            crop_override=_crop_ov,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Preview generation failed: {str(e)}")

    if not os.path.exists(preview_path):
        raise HTTPException(status_code=500, detail="Preview file not generated")

    return FileResponse(preview_path, media_type="image/jpeg")


@router.get("/{project_id}/{clip_id}/preview-es")
async def preview_clip_frame_es(project_id: str, clip_id: int):
    """Same as /preview but renders the white caption box with caption_es text.
    The static frame has no burned-in Whisper subs, so this only differs from
    /preview in the caption text it paints."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = next((c for c in project.clips if c.id == clip_id), None)
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    caption_es = (getattr(clip, "caption_es", "") or "").strip()
    if not caption_es:
        raise HTTPException(status_code=404, detail="Clip not translated yet")

    os.makedirs(project.output_dir, exist_ok=True)
    preview_path = os.path.join(project.output_dir, f"preview_clip_{clip_id}_es.jpg")
    timestamp = clip.start_time + (clip.duration / 2)
    style = clip.style_override or project.style

    _kfs = getattr(clip, 'keyframes', []) or []
    if _kfs:
        _interp = video_service.interpolate_keyframes(_kfs, clip.duration / 2)
        _ez = _interp["zoom"]
        _epx = max(-50.0, min(50.0, _interp["pan_x"] / 2))
        _epy = max(-50.0, min(50.0, _interp["pan_y"] / 2))
    else:
        _ez = getattr(clip, 'edit_zoom', 1.0)
        _epx = getattr(clip, 'edit_pan_x', 0.0)
        _epy = getattr(clip, 'edit_pan_y', 0.0)

    _crop_ov = None
    if getattr(style, "auto_reframe_enabled", False):
        ft_file = os.path.join(project.output_dir, f"face_track_{clip_id}.json")
        if not getattr(clip, "face_track", None) or not clip.face_track.get("samples"):
            if os.path.exists(ft_file):
                try:
                    with open(ft_file, "r", encoding="utf-8") as f:
                        clip.face_track = json.load(f)
                except Exception:
                    pass
        if getattr(clip, "face_track", None) and clip.face_track.get("samples"):
            try:
                from ..services import face_track_service
                traj = face_track_service.compute_crop_trajectory(
                    face_track=clip.face_track,
                    mode=getattr(style, "auto_reframe_mode", "all"),
                    follow_id=getattr(style, "auto_reframe_follow_id", None),
                    target_aspect=getattr(style, "aspect_ratio", "9:16"),
                    padding=float(getattr(style, "auto_reframe_padding", 0.30)),
                    smoothing=float(getattr(style, "auto_reframe_smoothing", 0.85)),
                )
                if traj:
                    closest_p = min(traj, key=lambda p: abs(p["t"] - timestamp))
                    cw = closest_p["cw"]
                    ch = closest_p["ch"]
                    cx0 = max(0, int(closest_p["cx"] - cw / 2))
                    cy0 = max(0, int(closest_p["cy"] - ch / 2))
                    _crop_ov = (cw, ch, cx0, cy0)
            except Exception as e:
                print(f"[Preview] Error calculating reframe crop: {e}")

    try:
        await asyncio.to_thread(
            video_service.generate_preview_frame,
            video_path=project.video_path,
            timestamp=timestamp,
            output_path=preview_path,
            caption_text=caption_es,
            text_x=style.text_x,
            text_y=style.text_y,
            font_size=style.font_size,
            text_color=style.text_color,
            text_stroke_color=style.text_stroke_color,
            text_stroke_width=style.text_stroke_width,
            watermark_path=style.watermark_path,
            watermark_x=style.watermark_x,
            watermark_y=style.watermark_y,
            watermark_scale=style.watermark_scale,
            watermark_opacity=style.watermark_opacity,
            fill_mode=style.fill_mode,
            split_screen_enabled=style.split_screen_enabled,
            split_image_path=style.split_image_path,
            split_ratio=style.split_ratio,
            flip_horizontal=style.flip_horizontal,
            boost_contrast=style.boost_contrast,
            hdr_4k=getattr(style, 'hdr_4k', False),
            sharpness_pct=getattr(style, 'sharpness_pct', 0),
            caption_style=getattr(style, 'caption_style', 'box'),
            background_style=getattr(style, 'background_style', 'blur'),
            no_text=getattr(style, 'no_text', False),
            caption_font=getattr(style, 'caption_font', 'calibri'),
            caption_box_radius=getattr(style, 'caption_box_radius', 0.28),
            caption_box_opacity=getattr(style, 'caption_box_opacity', 0.95),
            caption_box_color=getattr(style, 'caption_box_color', '#FFFFFF'),
            caption_box_pad_x=getattr(style, 'caption_box_pad_x', 14),
            caption_box_pad_y=getattr(style, 'caption_box_pad_y', 14),
            no_emojis=getattr(style, 'no_emojis', False),
            edit_zoom=_ez,
            edit_pan_x=_epx,
            edit_pan_y=_epy,
            fill_mode_scale=getattr(style, 'fill_mode_scale', 1.0),
            crop_override=_crop_ov,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Spanish preview failed: {str(e)}")

    if not os.path.exists(preview_path):
        raise HTTPException(status_code=500, detail="Preview file not generated")

    return FileResponse(preview_path, media_type="image/jpeg")


@router.get("/{project_id}/{clip_id}/video-preview")
async def preview_clip_video(project_id: str, clip_id: int):
    """Generate and return a short video preview of a clip for playback."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = None
    for c in project.clips:
        if c.id == clip_id:
            clip = c
            break

    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    os.makedirs(project.output_dir, exist_ok=True)
    video_preview_path = os.path.join(project.output_dir, f"preview_clip_{clip_id}.mp4")

    style = clip.style_override or project.style

    # Auto-reframe routing: the fast `generate_preview_clip` path doesn't
    # know about face tracking. When the user has it enabled on this clip,
    # route through the real export pipeline instead — that's what makes
    # "Play clip" show the actual reframed output. Slower than the regular
    # preview (preset=fast vs ultrafast) but it's the only way to render
    # the dynamic crop correctly here.
    # Auto-reframe routing: when auto_reframe is enabled, ensure clip.face_track is loaded
    if getattr(style, "auto_reframe_enabled", False):
        if not getattr(clip, "face_track", None) or not clip.face_track.get("samples"):
            ft_file = os.path.join(project.output_dir, f"face_track_{clip_id}.json")
            if os.path.exists(ft_file):
                try:
                    with open(ft_file, "r", encoding="utf-8") as f:
                        clip.face_track = json.load(f)
                except Exception:
                    pass
            if not getattr(clip, "face_track", None) or not clip.face_track.get("samples"):
                print(f"[Preview] Auto-computing face_track for clip {clip_id}...")
                try:
                    clip.face_track = await asyncio.to_thread(
                        face_track_service.analyze_clip,
                        project.video_path, float(clip.start_time), float(clip.end_time), 5.0
                    )
                    with open(ft_file, "w", encoding="utf-8") as f:
                        json.dump(clip.face_track, f)
                except Exception as e:
                    print(f"[Preview] Face auto-compute failed: {e}")

    _has_cuts = bool(getattr(clip, "segments", None))
    _needs_full_pipeline = (
        _has_cuts
        or (getattr(style, "auto_reframe_enabled", False)
            and getattr(clip, "face_track", None)
            and clip.face_track.get("samples"))
    )
    if _needs_full_pipeline:
        from ..services import export_service as _ex
        try:
            await asyncio.to_thread(
                _ex.export_clip_with_style,
                project.video_path, clip, style, video_preview_path,
                getattr(project, "transcript", None), "en",
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Reframe preview failed: {str(e)}")
        if not os.path.exists(video_preview_path):
            raise HTTPException(status_code=500, detail="Video preview not generated")
        return FileResponse(video_preview_path, media_type="video/mp4")

    try:
        await asyncio.to_thread(
            video_service.generate_preview_clip,
            video_path=project.video_path,
            start_time=clip.start_time,
            duration=clip.duration,
            output_path=video_preview_path,
            caption_text=clip.viral_caption,
            text_x=style.text_x,
            text_y=style.text_y,
            font_size=style.font_size,
            text_color=style.text_color,
            text_stroke_color=style.text_stroke_color,
            text_stroke_width=style.text_stroke_width,
            watermark_path=style.watermark_path,
            watermark_x=style.watermark_x,
            watermark_y=style.watermark_y,
            watermark_scale=style.watermark_scale,
            watermark_opacity=style.watermark_opacity,
            fill_mode=style.fill_mode,
            split_screen_enabled=style.split_screen_enabled,
            split_image_path=style.split_image_path,
            split_ratio=style.split_ratio,
            flip_horizontal=style.flip_horizontal,
            boost_contrast=style.boost_contrast,
            hdr_4k=getattr(style, 'hdr_4k', False),
            sharpness_pct=getattr(style, 'sharpness_pct', 0),
            caption_style=getattr(style, 'caption_style', 'box'),
            subtitle_style=getattr(style, 'subtitle_style', 'none'),
            transcript=getattr(project, 'transcript', None),
            visual_filter=getattr(style, 'visual_filter', 'none'),
            subtitle_size_scale=getattr(style, 'subtitle_size_scale', 1.0),
            subtitle_y=getattr(style, 'subtitle_y', 0.0),
            background_style=getattr(style, 'background_style', 'blur'),
            no_text=getattr(style, 'no_text', False),
            caption_font=getattr(style, 'caption_font', 'calibri'),
            caption_box_radius=getattr(style, 'caption_box_radius', 0.28),
            caption_box_opacity=getattr(style, 'caption_box_opacity', 0.95),
            caption_box_color=getattr(style, 'caption_box_color', '#FFFFFF'),
            caption_box_pad_x=getattr(style, 'caption_box_pad_x', 14),
            caption_box_pad_y=getattr(style, 'caption_box_pad_y', 14),
            no_emojis=getattr(style, 'no_emojis', False),
            edit_zoom=getattr(clip, 'edit_zoom', 1.0),
            edit_pan_x=getattr(clip, 'edit_pan_x', 0.0),
            edit_pan_y=getattr(clip, 'edit_pan_y', 0.0),
            fill_mode_scale=getattr(style, 'fill_mode_scale', 1.0),
            keyframes=getattr(clip, 'keyframes', []) or [],
            mirror_cyclic_enabled=getattr(style, 'mirror_cyclic_enabled', False),
            mirror_cyclic_interval=getattr(style, 'mirror_cyclic_interval', 5.0),
            sway_enabled=getattr(style, 'sway_enabled', False),
            sway_period=getattr(style, 'sway_period', 3.0),
            sway_amplitude=getattr(style, 'sway_amplitude', 40),
        )
    except Exception as e:
        # Print the full traceback so the actual cause is visible in the
        # backend console (without this, the route just returns 500 and the
        # underlying Python/FFmpeg error is lost).
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Video preview failed: {str(e)}")

    if not os.path.exists(video_preview_path):
        raise HTTPException(status_code=500, detail="Video preview not generated")

    # Mix background music into the preview (same as export) so the user
    # hears exactly what the exported clip will sound like.
    music_path = getattr(style, "music_path", None)
    if music_path and os.path.exists(music_path):
        try:
            await asyncio.to_thread(
                video_service.mix_music_track,
                video_preview_path, music_path,
                music_volume=getattr(style, "music_volume", 0.8),
                original_volume=getattr(style, "original_volume", 1.0),
                music_start=float(getattr(style, "music_start", 0.0) or 0.0),
                music_end=float(getattr(style, "music_end", 0.0) or 0.0),
            )
            print(f"[Preview] Clip {clip_id}: mixed music {os.path.basename(music_path)}")
        except Exception as e:
            print(f"[Preview] Clip {clip_id}: music mix failed (preview without music): {e}")

    return FileResponse(video_preview_path, media_type="video/mp4")



@router.post("/{project_id}/{clip_id}/translate-only")
async def translate_clip_only(project_id: str, clip_id: int):
    """Translate a single clip's caption + Whisper words to Spanish and cache
    them on the clip. Does NOT trigger any export — used by the Visual Editor
    when the user wants to preview the ES version of the clip they're styling.

    Returns the translated data so the UI can show it immediately.
    """
    from ..config import settings as _settings

    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = None
    for c in project.clips:
        if c.id == clip_id:
            clip = c
            break
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    # Idempotent — if already translated, just return the cache.
    if getattr(clip, "caption_es", "") and getattr(clip, "words_es", []):
        return {
            "status": "cached",
            "caption_es": clip.caption_es,
            "words_es": clip.words_es,
        }

    transcript = getattr(project, "transcript", None) or {}
    all_words = transcript.get("words", []) if isinstance(transcript, dict) else []

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
        wtxt = str(w.get("word", "")).strip()
        if wtxt:
            clip_en_words.append({"word": wtxt, "start": ws, "end": we})

    if not clip_en_words:
        # No Whisper words in range → translate the caption only so the white
        # box shows in Spanish; subtitles will be empty in the ES preview.
        clip_en_words = [{"word": "placeholder", "start": clip.start_time, "end": clip.end_time}]

    target_model = getattr(project, "gemini_model", None) or _settings.GEMINI_MODEL
    try:
        result = gemini_service.translate_clip_to_spanish(
            clip.viral_caption, clip_en_words, model=target_model,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Translation failed: {e}")

    if not result:
        raise HTTPException(status_code=500, detail="Translation returned empty")

    clip.caption_es = result.get("caption_es", "") or clip.viral_caption
    clip.words_es = result.get("words_es", []) or []

    # Invalidate any cached ES previews so the next preview reflects the new
    # translation (e.g. user re-translated after editing the original caption).
    for fname in (f"preview_clip_{clip_id}_es.mp4", f"preview_clip_{clip_id}_es.jpg"):
        fp = os.path.join(project.output_dir, fname)
        if os.path.exists(fp):
            try:
                os.remove(fp)
            except Exception:
                pass

    return {
        "status": "translated",
        "caption_es": clip.caption_es,
        "words_es": clip.words_es,
    }


@router.get("/{project_id}/{clip_id}/video-preview-es")
async def preview_clip_video_es(project_id: str, clip_id: int):
    """Generate the same 10s preview as /video-preview but using the cached
    Spanish translation: caption_es as the white-box text + words_es as the
    burned-in subtitles. Lets the user verify the translation visually
    without exporting the full clip.

    Returns 404 if the clip hasn't been translated yet.
    """
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = None
    for c in project.clips:
        if c.id == clip_id:
            clip = c
            break

    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    caption_es = (getattr(clip, "caption_es", "") or "").strip()
    words_es = getattr(clip, "words_es", None) or []
    if not caption_es and not words_es:
        raise HTTPException(status_code=404, detail="Clip not translated yet")

    os.makedirs(project.output_dir, exist_ok=True)
    video_preview_path = os.path.join(project.output_dir, f"preview_clip_{clip_id}_es.mp4")

    style = clip.style_override or project.style

    # Auto-reframe routing: same idea as /video-preview — when the user has
    # face tracking enabled, the only way to render it correctly is through
    # the real export pipeline (which handles language="es" + reframe).
    if (getattr(style, "auto_reframe_enabled", False)
            and getattr(clip, "face_track", None)
            and clip.face_track.get("samples")):
        from ..services import export_service as _ex
        try:
            await asyncio.to_thread(
                _ex.export_clip_with_style,
                project.video_path, clip, style, video_preview_path,
                getattr(project, "transcript", None), "es",
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"ES reframe preview failed: {str(e)}")
        if not os.path.exists(video_preview_path):
            raise HTTPException(status_code=500, detail="Video preview not generated")
        return FileResponse(video_preview_path, media_type="video/mp4")

    # Build a fake transcript dict from words_es so generate_preview_clip's
    # subtitle path picks up the Spanish words (it only reads transcript["words"]).
    es_transcript = {"words": list(words_es)} if words_es else None

    # Caption text: prefer caption_es, fall back to viral_caption if the user
    # somehow asks for a preview before the caption translation landed.
    caption_text = caption_es or clip.viral_caption

    try:
        await asyncio.to_thread(
            video_service.generate_preview_clip,
            video_path=project.video_path,
            start_time=clip.start_time,
            duration=clip.duration,
            output_path=video_preview_path,
            caption_text=caption_text,
            text_x=style.text_x,
            text_y=style.text_y,
            font_size=style.font_size,
            text_color=style.text_color,
            text_stroke_color=style.text_stroke_color,
            text_stroke_width=style.text_stroke_width,
            watermark_path=style.watermark_path,
            watermark_x=style.watermark_x,
            watermark_y=style.watermark_y,
            watermark_scale=style.watermark_scale,
            watermark_opacity=style.watermark_opacity,
            fill_mode=style.fill_mode,
            split_screen_enabled=style.split_screen_enabled,
            split_image_path=style.split_image_path,
            split_ratio=style.split_ratio,
            flip_horizontal=style.flip_horizontal,
            boost_contrast=style.boost_contrast,
            hdr_4k=getattr(style, 'hdr_4k', False),
            sharpness_pct=getattr(style, 'sharpness_pct', 0),
            caption_style=getattr(style, 'caption_style', 'box'),
            subtitle_style=getattr(style, 'subtitle_style', 'none'),
            transcript=es_transcript,
            visual_filter=getattr(style, 'visual_filter', 'none'),
            subtitle_size_scale=getattr(style, 'subtitle_size_scale', 1.0),
            subtitle_y=getattr(style, 'subtitle_y', 0.0),
            background_style=getattr(style, 'background_style', 'blur'),
            no_text=getattr(style, 'no_text', False),
            caption_font=getattr(style, 'caption_font', 'calibri'),
            caption_box_radius=getattr(style, 'caption_box_radius', 0.28),
            caption_box_opacity=getattr(style, 'caption_box_opacity', 0.95),
            caption_box_color=getattr(style, 'caption_box_color', '#FFFFFF'),
            caption_box_pad_x=getattr(style, 'caption_box_pad_x', 14),
            caption_box_pad_y=getattr(style, 'caption_box_pad_y', 14),
            no_emojis=getattr(style, 'no_emojis', False),
            edit_zoom=getattr(clip, 'edit_zoom', 1.0),
            edit_pan_x=getattr(clip, 'edit_pan_x', 0.0),
            edit_pan_y=getattr(clip, 'edit_pan_y', 0.0),
            fill_mode_scale=getattr(style, 'fill_mode_scale', 1.0),
            keyframes=getattr(clip, 'keyframes', []) or [],
            mirror_cyclic_enabled=getattr(style, 'mirror_cyclic_enabled', False),
            mirror_cyclic_interval=getattr(style, 'mirror_cyclic_interval', 5.0),
            sway_enabled=getattr(style, 'sway_enabled', False),
            sway_period=getattr(style, 'sway_period', 3.0),
            sway_amplitude=getattr(style, 'sway_amplitude', 40),
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Spanish video preview failed: {str(e)}")

    if not os.path.exists(video_preview_path):
        raise HTTPException(status_code=500, detail="Spanish video preview not generated")

    return FileResponse(video_preview_path, media_type="video/mp4")


@router.get("/{project_id}/{clip_id}/instagram-preview")
async def preview_clip_instagram_frame(project_id: str, clip_id: int):
    """Generate a static JPEG in Instagram post format: white bg + caption text + video below."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = None
    for c in project.clips:
        if c.id == clip_id:
            clip = c
            break

    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    os.makedirs(project.output_dir, exist_ok=True)
    ig_frame_path = os.path.join(project.output_dir, f"ig_preview_clip_{clip_id}.jpg")
    timestamp = clip.start_time + (clip.duration / 2)
    style = clip.style_override or project.style

    try:
        await asyncio.to_thread(
            video_service.generate_instagram_preview_frame,
            video_path=project.video_path,
            timestamp=timestamp,
            output_path=ig_frame_path,
            caption_text=clip.viral_caption,
            fill_mode=style.ig_fill_mode,
            ig_top_padding=style.ig_top_padding,
            watermark_path=style.watermark_path,
            watermark_x=style.watermark_x,
            watermark_y=style.watermark_y,
            ig_watermark_y=style.ig_watermark_y,
            watermark_scale=style.watermark_scale,
            watermark_opacity=style.watermark_opacity,
            flip_horizontal=style.flip_horizontal,
            boost_contrast=style.boost_contrast,
            hdr_4k=getattr(style, 'hdr_4k', False),
            sharpness_pct=getattr(style, 'sharpness_pct', 0),
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Instagram preview failed: {str(e)}")

    if not os.path.exists(ig_frame_path):
        raise HTTPException(status_code=500, detail="Instagram preview not generated")

    return FileResponse(ig_frame_path, media_type="image/jpeg")


@router.post("/{project_id}/{clip_id}/analyze-faces")
async def clip_analyze_faces(project_id: str, clip_id: int):
    """Run MediaPipe face detection over a specific AI-detected clip's range
    and cache the result on that clip. Same idea as editor/analyze-faces
    but works per-clip from the Visual Editor / Paso 3.

    Synchronous — typical clip < 90s takes 10–30s on CPU.
    """
    from ..services import face_track_service

    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    clip = next((c for c in project.clips if c.id == clip_id), None)
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    if clip.end_time - clip.start_time < 0.5:
        raise HTTPException(status_code=400, detail="Clip range too short")

    ft_file = os.path.join(project.output_dir, f"face_track_{clip_id}.json")
    if not getattr(clip, "face_track", None) and os.path.exists(ft_file):
        try:
            with open(ft_file, "r", encoding="utf-8") as f:
                clip.face_track = json.load(f)
        except Exception:
            pass

    if getattr(clip, "face_track", None) and clip.face_track.get("samples"):
        face_track = clip.face_track
        return {
            "status": "ok",
            "sample_count": len(face_track.get("samples", [])),
            "people": face_track.get("people", []),
            "width": face_track.get("width"),
            "height": face_track.get("height"),
            "start_time": face_track.get("start_time"),
            "end_time": face_track.get("end_time"),
            "samples": face_track.get("samples", []),
        }

    try:
        face_track = await asyncio.to_thread(
            face_track_service.analyze_clip,
            project.video_path,
            float(clip.start_time),
            float(clip.end_time),
            5.0,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Face analysis failed: {str(e)}")

    clip.face_track = face_track
    try:
        ft_file = os.path.join(project.output_dir, f"face_track_{clip_id}.json")
        with open(ft_file, "w", encoding="utf-8") as f:
            json.dump(face_track, f)
    except Exception as e:
        print(f"Failed to cache face_track to disk: {e}")
    return {
        "status": "ok",
        "sample_count": len(face_track.get("samples", [])),
        "people": face_track.get("people", []),
        "width": face_track.get("width"),
        "height": face_track.get("height"),
        "start_time": face_track.get("start_time"),
        "end_time": face_track.get("end_time"),
        "samples": face_track.get("samples", []),
    }


@router.get("/{project_id}/{clip_id}/preview-reframe")
async def clip_preview_reframe(project_id: str, clip_id: int, seconds: float = 10.0):
    """10s MP4 sample with auto-reframe applied so the user can verify the
    framing before exporting all clips. Mirrors editor's preview-reframe but
    for a specific AI-detected clip."""
    from ..services import export_service as _ex

    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    clip = next((c for c in project.clips if c.id == clip_id), None)
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    ft = getattr(clip, "face_track", None) or {}
    if not ft.get("samples"):
        raise HTTPException(status_code=400, detail="Analyze faces first")

    samples = ft["samples"]
    def _score(s):
        return (len(s.get("faces", [])), sum(f.get("confidence", 0) for f in s.get("faces", [])))
    anchor = max(samples, key=_score) if samples else None
    anchor_t = float(anchor.get("t", clip.start_time)) if anchor else float(clip.start_time)
    half = max(2.0, min(30.0, seconds / 2))
    sample_start = max(float(clip.start_time), anchor_t - half)
    sample_end = min(float(clip.end_time), sample_start + seconds)
    if sample_end - sample_start < 1.0:
        sample_start = float(clip.start_time)
        sample_end = min(float(clip.end_time), sample_start + seconds)

    sample_clip = clip.model_copy(deep=True)
    sample_clip.start_time = sample_start
    sample_clip.end_time = sample_end
    sample_clip.duration = sample_end - sample_start
    sample_clip.segments = []
    # Force reframe ON regardless of saved style — this endpoint always renders
    # the auto-reframe so the user can compare. Pull the in-effect knobs from
    # the per-clip override if any, else from project style.
    base_style = clip.style_override or project.style
    sample_style = base_style.model_copy(deep=True)
    sample_style.auto_reframe_enabled = True
    sample_style.split_screen_enabled = False

    os.makedirs(project.output_dir, exist_ok=True)
    output_path = os.path.join(project.output_dir, f"preview_reframe_clip_{clip_id}_{uuid.uuid4().hex[:8]}.mp4")

    try:
        await asyncio.to_thread(
            _ex.export_clip_with_style,
            project.video_path, sample_clip, sample_style, output_path,
            getattr(project, "transcript", None), "en",
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Reframe preview failed: {str(e)}")

    if not os.path.exists(output_path):
        raise HTTPException(status_code=500, detail="Preview not generated")
    return FileResponse(output_path, media_type="video/mp4")


@router.get("/{project_id}/{clip_id}/instagram-preview-es")
async def preview_clip_instagram_frame_es(project_id: str, clip_id: int):
    """Spanish variant of /instagram-preview — same IG layout but with the
    translated caption painted on the white panel."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = next((c for c in project.clips if c.id == clip_id), None)
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    caption_es = (getattr(clip, "caption_es", "") or "").strip()
    if not caption_es:
        raise HTTPException(status_code=404, detail="Clip not translated yet")

    os.makedirs(project.output_dir, exist_ok=True)
    ig_frame_path = os.path.join(project.output_dir, f"ig_preview_clip_{clip_id}_es.jpg")
    timestamp = clip.start_time + (clip.duration / 2)
    style = clip.style_override or project.style

    try:
        await asyncio.to_thread(
            video_service.generate_instagram_preview_frame,
            video_path=project.video_path,
            timestamp=timestamp,
            output_path=ig_frame_path,
            caption_text=caption_es,
            fill_mode=style.ig_fill_mode,
            ig_top_padding=style.ig_top_padding,
            watermark_path=style.watermark_path,
            watermark_x=style.watermark_x,
            watermark_y=style.watermark_y,
            ig_watermark_y=style.ig_watermark_y,
            watermark_scale=style.watermark_scale,
            watermark_opacity=style.watermark_opacity,
            flip_horizontal=style.flip_horizontal,
            boost_contrast=style.boost_contrast,
            hdr_4k=getattr(style, 'hdr_4k', False),
            sharpness_pct=getattr(style, 'sharpness_pct', 0),
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Spanish IG preview failed: {str(e)}")

    if not os.path.exists(ig_frame_path):
        raise HTTPException(status_code=500, detail="Spanish IG preview not generated")

    return FileResponse(ig_frame_path, media_type="image/jpeg")


@router.post("/{project_id}/{clip_id}/reanalyze")
async def reanalyze_clip(project_id: str, clip_id: int, lang: str = "en"):
    """Extract this clip's exact segment and re-analyze with Gemini to fix wrong captions.

    `lang` in {"en", "es"}: controls the caption language Gemini writes
    (English by default; Spanish = neutral Latin American). When es, the
    result is also cached into clip.caption_es so a Spanish export needs no
    extra translation step.
    """
    import uuid as _uuid
    lang = (lang or "en").lower().strip()
    if lang not in ("en", "es"):
        lang = "en"
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = next((c for c in project.clips if c.id == clip_id), None)
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    # Projects created without Gemini (pescador / viral "enviar a clips")
    # have no transcript yet — transcribe lazily in the background so the
    # subtitles become available after the user's first re-analyze.
    _ensure_project_transcript(project_id)

    # Extract the exact clip segment to a temp file
    temp_dir = os.path.join(os.path.dirname(__file__), "..", "services", "temp")
    os.makedirs(temp_dir, exist_ok=True)
    segment_path = os.path.join(temp_dir, f"reanalyze_{_uuid.uuid4().hex}.mp4")

    FFMPEG_EXE = video_service.FFMPEG_EXE
    duration = clip.end_time - clip.start_time
    # Encoder selection: prefer Intel QSV when available (much faster on
    # Windows), fall back to libx264. CRF was 18 (near-lossless) — overkill
    # for a Gemini-analysis input. 23 is visually identical for this purpose
    # and ~2× faster on libx264.
    codec_args = video_service.get_video_codec_args(preset="fast", crf=23, prefer_qsv=True)
    extract_cmd = [
        FFMPEG_EXE,
        "-ss", str(clip.start_time),
        "-i", project.video_path,
        "-t", str(duration),
        *codec_args,
        "-c:a", "aac", "-y", segment_path
    ]

    # Timeout scaled to duration — the fixed 120s killed reanalyze for clips
    # > ~60s on CPU. Floor at 3 min so short clips still get plenty of room.
    _extract_timeout = max(180, int(duration * 5))

    active_file = None
    try:
        result = await asyncio.to_thread(
            __import__("subprocess").run,
            extract_cmd, capture_output=True, timeout=_extract_timeout
        )
        if not os.path.exists(segment_path):
            raise HTTPException(status_code=500, detail="Failed to extract clip segment")

        # Upload just this short segment to Gemini
        active_file = await asyncio.to_thread(gemini_service.upload_video, segment_path)
        active_file = await asyncio.to_thread(gemini_service.wait_for_processing, active_file)

        # Ask Gemini what's actually happening in this short clip
        # Use the same model the user picked when uploading (consistent quota)
        from google.genai import types as _types
        active_model = getattr(project, 'gemini_model', None) or gemini_service.settings.GEMINI_MODEL
        # Inject the creator name as MANDATORY if set on the project, so the
        # button reliably produces a caption that includes the user-typed name.
        _creator = (getattr(project, 'creator_name', '') or '').strip()
        if _creator:
            _first = _creator.split(',')[0].strip()
            creator_line = (
                f'MANDATORY: Include the name "{_first}" in this caption naturally. '
                f'Do NOT use any other name even if you recognize a different person in the video. '
                f'Keep the exact capitalization. '
            )
        else:
            creator_line = ''
        print(f"[Reanalyze] clip {clip_id} model={active_model} creator={_creator!r} lang={lang}")
        prompt_key = "reanalyze_clip_es" if lang == "es" else "reanalyze_clip"

        def _reanalyze_call(m):
            return gemini_service.client.models.generate_content(
                model=m,
                contents=[_types.Content(role="user", parts=[
                    _types.Part.from_uri(file_uri=active_file.uri, mime_type=active_file.mime_type),
                    _types.Part.from_text(text=prompts.render(prompt_key, CREATOR_LINE=creator_line)),
                ])],
                config=_types.GenerateContentConfig(temperature=0.5),
            )

        response = await asyncio.to_thread(
            gemini_service.gemini_call_with_retry,
            _reanalyze_call,
            active_model,
            project_id,
        )

        import re as _re
        new_caption = response.text.strip().rstrip(".")
        # Preserve emoji unicode while stripping other punctuation
        new_caption = _re.sub(
            r"[^\w\s'\U0001F300-\U0001FAFF\U00002600-\U000027BF✀-➿☀-⛿]",
            '', new_caption
        ).strip()
        new_caption = _re.sub(r'\s+', ' ', new_caption).strip()
        # Enforce emoji whitelist (strip any emoji not on our list)
        new_caption = gemini_service.filter_emojis_to_whitelist(new_caption)
        # Case-correct text portion without touching the trailing emoji
        if new_caption:
            m = _re.match(r"^(.*?)(\s*[\U0001F300-\U0001FAFF\U00002600-\U000027BF]+)?\s*$", new_caption)
            if m:
                text_part, emoji_part = m.group(1) or "", m.group(2) or ""
                text_part = text_part[:1].upper() + text_part[1:].lower()
                # Restore the creator name to its proper capitalization
                # (the lowercase step above would otherwise turn "Jawis" → "jawis").
                if _creator:
                    text_part = gemini_service.restore_name_casing(text_part, _creator)
                new_caption = (text_part + emoji_part).strip()

        # Update the clip in memory + re-validate against transcript.
        # When lang=es we ALSO cache the result as the Spanish version so the
        # Spanish export needs no separate translation step.
        clip.viral_caption = new_caption
        if lang == "es":
            clip.caption_es = new_caption
        transcript = getattr(project, 'transcript', None)
        if transcript:
            snippet, conf = gemini_service.validate_caption_against_transcript(
                new_caption, clip.start_time, clip.end_time, transcript
            )
            clip.transcript_snippet = snippet
            clip.match_confidence = conf
        return {"status": "updated", "clip": clip.model_dump()}

    except HTTPException:
        raise
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if active_file:
            await asyncio.to_thread(gemini_service.delete_file, active_file)
        if os.path.exists(segment_path):
            try:
                os.remove(segment_path)
            except:
                pass


@router.post("/{project_id}/{clip_id}/tweet-text")
async def generate_tweet_text(project_id: str, clip_id: int):
    """Generate a short viral Twitter/X post text (<=280 chars) for this clip.

    Like reanalyze, we extract the clip's exact segment, feed it to Gemini
    together with the current caption, and save the result as clip.tweet_text.
    """
    import uuid as _uuid
    import re as _re
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = next((c for c in project.clips if c.id == clip_id), None)
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    # Extract the exact clip segment like reanalyze so Gemini sees the moment.
    temp_dir = os.path.join(os.path.dirname(__file__), "..", "services", "temp")
    os.makedirs(temp_dir, exist_ok=True)
    segment_path = os.path.join(temp_dir, f"tweettext_{_uuid.uuid4().hex}.mp4")

    duration = clip.end_time - clip.start_time
    codec_args = video_service.get_video_codec_args(preset="fast", crf=23, prefer_qsv=True)
    extract_cmd = [
        video_service.FFMPEG_EXE,
        "-ss", str(clip.start_time),
        "-i", project.video_path,
        "-t", str(duration),
        *codec_args,
        "-c:a", "aac", "-y", segment_path
    ]
    _extract_timeout = max(180, int(duration * 5))

    active_file = None
    try:
        await asyncio.to_thread(
            __import__("subprocess").run,
            extract_cmd, capture_output=True, timeout=_extract_timeout
        )
        if not os.path.exists(segment_path):
            raise HTTPException(status_code=500, detail="Failed to extract clip segment")

        active_file = await asyncio.to_thread(gemini_service.upload_video, segment_path)
        active_file = await asyncio.to_thread(gemini_service.wait_for_processing, active_file)

        from google.genai import types as _types
        active_model = getattr(project, 'gemini_model', None) or gemini_service.settings.GEMINI_MODEL
        _creator = (getattr(project, 'creator_name', '') or '').strip()
        creator_text = clip.viral_caption or clip.description or ""
        if _creator:
            _first = _creator.split(',')[0].strip()
            creator_text = f"{creator_text}\nCreator/person name (use exactly, keep capitalization): {_first}"
        print(f"[TweetText] clip {clip_id} model={active_model}")

        def _tweet_call(m):
            return gemini_service.client.models.generate_content(
                model=m,
                contents=[_types.Content(role="user", parts=[
                    _types.Part.from_uri(file_uri=active_file.uri, mime_type=active_file.mime_type),
                    _types.Part.from_text(text=prompts.render("tweet_text", CREATOR_TEXT=creator_text)),
                ])],
                config=_types.GenerateContentConfig(temperature=0.7),
            )

        response = await asyncio.to_thread(
            gemini_service.gemini_call_with_retry,
            _tweet_call,
            active_model,
            project_id,
        )

        tweet = (response.text or "").strip()
        tweet = _re.sub(r'\s+', ' ', tweet).strip()
        # Strip surrounding quotes the model sometimes adds.
        tweet = tweet.strip('"').strip("'").strip()
        # Hard cap at 280 chars.
        if len(tweet) > 280:
            tweet = tweet[:280].rsplit(' ', 1)[0]

        # Retry up to 2 times to reach >=280 chars (short tweets get expanded).
        retry_prompt = (
            "The previous tweet was only {cur} characters. Rewrite and EXPAND it "
            "to reach 270-280 characters (more detail, more hashtags). "
            "NEVER go over 280. Only output the tweet, nothing else."
        )
        for _retry in range(2):
            if len(tweet) >= 280:
                break
            def _tweet_expand_call(m):
                return gemini_service.client.models.generate_content(
                    model=m,
                    contents=[_types.Content(role="user", parts=[
                        _types.Part.from_text(text=retry_prompt.format(cur=len(tweet)) + "\n\n" + tweet),
                    ])],
                    config=_types.GenerateContentConfig(temperature=0.7),
                )
            response2 = await asyncio.to_thread(
                gemini_service.gemini_call_with_retry,
                _tweet_expand_call,
                active_model,
                project_id,
            )
            t2 = (response2.text or "").strip()
            t2 = _re.sub(r'\s+', ' ', t2).strip().strip('"').strip("'").strip()
            if len(t2) > 280:
                t2 = t2[:280].rsplit(' ', 1)[0]
            if len(t2) > len(tweet):
                tweet = t2

        clip.tweet_text = tweet
        return {"status": "updated", "tweet_text": tweet}

    except HTTPException:
        raise
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if active_file:
            await asyncio.to_thread(gemini_service.delete_file, active_file)
        if os.path.exists(segment_path):
            try:
                os.remove(segment_path)
            except:
                pass


@router.get("/{project_id}/{clip_id}/instagram-video-preview")
async def preview_clip_instagram(project_id: str, clip_id: int):
    """Generate and return a short Instagram-format video preview of a clip."""
    projects = get_project_store()
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    clip = None
    for c in project.clips:
        if c.id == clip_id:
            clip = c
            break

    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    os.makedirs(project.output_dir, exist_ok=True)
    ig_preview_path = os.path.join(project.output_dir, f"ig_preview_clip_{clip_id}.mp4")

    style = clip.style_override or project.style

    try:
        await asyncio.to_thread(
            video_service.generate_instagram_preview_clip,
            video_path=project.video_path,
            start_time=clip.start_time,
            duration=clip.duration,
            output_path=ig_preview_path,
            caption_text=clip.viral_caption,
            fill_mode=style.fill_mode,
            watermark_path=style.watermark_path,
            watermark_x=style.watermark_x,
            watermark_y=style.watermark_y,
            watermark_scale=style.watermark_scale,
            watermark_opacity=style.watermark_opacity,
            flip_horizontal=style.flip_horizontal,
            boost_contrast=style.boost_contrast,
            hdr_4k=getattr(style, 'hdr_4k', False),
            sharpness_pct=getattr(style, 'sharpness_pct', 0),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Instagram preview failed: {str(e)}")

    if not os.path.exists(ig_preview_path):
        raise HTTPException(status_code=500, detail="Instagram preview not generated")

    return FileResponse(ig_preview_path, media_type="video/mp4")
