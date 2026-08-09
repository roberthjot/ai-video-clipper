"""
twitch_service.py — Twitch Helix API client.

Fetches viral clips from a Twitch VOD so the user can see "what viewers
already clipped" before downloading anything. Uses the public OAuth 2.0
client_credentials flow (free, no user login required).

Setup:
  1. Register an app at https://dev.twitch.tv/console
  2. Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to .env
  3. The first request fetches an app access token; we cache it in memory
     and refresh ~5 min before its 60-day expiry.
"""
import os
import re
import time
import uuid
import shutil
import threading
import urllib.parse
import urllib.request
import json
from typing import Optional

from ..config import settings


# ─── App access token (cached) ────────────────────────────────────────────────

_token_cache: dict = {"token": None, "expires_at": 0.0}
_token_lock = threading.Lock()


def _fetch_app_token() -> str:
    """Get an app access token via client_credentials flow. Cached for ~60 days."""
    if not settings.TWITCH_CLIENT_ID or not settings.TWITCH_CLIENT_SECRET:
        raise RuntimeError(
            "Twitch API credentials missing. Set TWITCH_CLIENT_ID and "
            "TWITCH_CLIENT_SECRET in .env (get them at dev.twitch.tv/console)."
        )
    body = urllib.parse.urlencode({
        "client_id": settings.TWITCH_CLIENT_ID,
        "client_secret": settings.TWITCH_CLIENT_SECRET,
        "grant_type": "client_credentials",
    }).encode("utf-8")
    req = urllib.request.Request("https://id.twitch.tv/oauth2/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["access_token"], int(data.get("expires_in", 5184000))


def get_app_token() -> str:
    with _token_lock:
        now = time.time()
        if _token_cache["token"] and _token_cache["expires_at"] - 300 > now:
            return _token_cache["token"]
        token, expires_in = _fetch_app_token()
        _token_cache["token"] = token
        _token_cache["expires_at"] = now + expires_in
        return token


# ─── URL / ID helpers ─────────────────────────────────────────────────────────

_VIDEO_ID_RE = re.compile(r"/videos?/(\w+)", re.IGNORECASE)


def extract_video_id(url: str) -> Optional[str]:
    """Pull the video id out of a Twitch VOD URL.
    Examples:
      https://www.twitch.tv/videos/2456789012  →  2456789012
      twitch.tv/videos/123                    →  123
    """
    if not url:
        return None
    m = _VIDEO_ID_RE.search(url.strip())
    return m.group(1) if m else None


# ─── Helix API calls ──────────────────────────────────────────────────────────

def _helix_get(path: str, params: dict) -> dict:
    """Authenticated GET to api.twitch.tv/helix/<path>. Returns parsed JSON.

    Raises RuntimeError with the API's error message on non-2xx so the
    caller can surface a useful message to the UI.
    """
    token = get_app_token()
    qs = urllib.parse.urlencode(params, doseq=True)
    url = f"https://api.twitch.tv/helix/{path.lstrip('/')}?{qs}"
    req = urllib.request.Request(url, headers={
        "Client-Id": settings.TWITCH_CLIENT_ID,
        "Authorization": f"Bearer {token}",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode("utf-8"))
            msg = err.get("message") or err.get("error") or str(e)
        except Exception:
            msg = str(e)
        raise RuntimeError(f"Twitch API error ({e.code}): {msg}")


_DUR_RE = re.compile(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?", re.IGNORECASE)


def _parse_twitch_duration(s: str) -> int:
    """Twitch duration format is '5h27m32s' or similar. Returns total seconds."""
    if not s:
        return 0
    m = _DUR_RE.fullmatch(s.strip())
    if not m:
        return 0
    h, mn, sc = m.groups()
    return int(h or 0) * 3600 + int(mn or 0) * 60 + int(sc or 0)


def get_video_info(video_id: str) -> dict:
    """Fetch VOD metadata from /helix/videos?id=X.

    Returns the broadcaster_id (a.k.a. user_id), the stream's created_at
    (ISO 8601) and the duration in seconds — used to scope the /clips
    search to a manageable time window.
    """
    data = _helix_get("videos", {"id": video_id})
    items = data.get("data", [])
    if not items:
        raise RuntimeError(f"VOD {video_id} not found (private, deleted, or invalid id)")
    v = items[0]
    return {
        "video_id": v.get("id"),
        "user_id": v.get("user_id"),                 # broadcaster_id for /clips
        "user_name": v.get("user_name") or v.get("user_login") or "",
        "title": v.get("title") or "",
        "created_at": v.get("created_at") or "",
        "duration_seconds": _parse_twitch_duration(v.get("duration") or ""),
        "thumbnail_url": v.get("thumbnail_url") or "",
        "url": v.get("url") or "",
    }


# ─── Clip MP4 download (direct, no VOD slicing) ──────────────────────────────

_GQL_URL = "https://gql.twitch.tv/gql"
_WEB_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"
# Full GraphQL document for the public clip access-token query (gives a signed
# direct MP4 URL — same call twitch.tv makes when you press play on a clip).
# We send the FULL query instead of a persisted-query SHA hash: Twitch rotates
# those hashes periodically and a stale hash returns "PersistedQueryNotFound",
# which broke clip downloads. Sending the document inline is rotation-proof.
_CLIP_TOKEN_QUERY = (
    "query VideoAccessToken_Clip($slug: ID!) {"
    "  clip(slug: $slug) {"
    "    playbackAccessToken(params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: \"site\"}) {"
    "      signature value"
    "    }"
    "    videoQualities { frameRate quality sourceURL }"
    "  }"
    "}"
)


def get_clip_download_url(clip_slug: str, preferred_quality: str = "720") -> tuple:
    """Resolve a Twitch clip slug to a direct signed MP4 URL.

    Twitch serves clip videos as standalone MP4s (not HLS), so this is much
    faster than slicing a VOD: 30-second clip = ~5-10 second download.

    Returns (mp4_url, picked_quality). Raises RuntimeError on failure.
    """
    import urllib.parse
    body = json.dumps([{
        "operationName": "VideoAccessToken_Clip",
        "query": _CLIP_TOKEN_QUERY,
        "variables": {"slug": clip_slug},
    }]).encode("utf-8")
    req = urllib.request.Request(
        _GQL_URL, data=body,
        headers={"Content-Type": "application/json", "Client-Id": _WEB_CLIENT_ID},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            resp = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        raise RuntimeError(f"Failed to resolve clip {clip_slug}: {e}")
    if isinstance(resp, list):
        resp = resp[0] if resp else {}
    if resp.get("errors"):
        msg = (resp["errors"][0] or {}).get("message", "unknown")
        raise RuntimeError(f"Clip {clip_slug}: {msg}")
    clip = (resp.get("data") or {}).get("clip") or {}
    qualities = clip.get("videoQualities") or []
    token = (clip.get("playbackAccessToken") or {})
    if not qualities or not token.get("value") or not token.get("signature"):
        raise RuntimeError(f"Clip {clip_slug}: no playback URL available (sub-only / deleted?)")
    # Pick preferred quality, else fall back to first
    picked = None
    for q in qualities:
        if (q.get("quality") or "").startswith(str(preferred_quality)):
            picked = q
            break
    if not picked:
        picked = qualities[0]
    source = picked.get("sourceURL")
    if not source:
        raise RuntimeError(f"Clip {clip_slug}: missing sourceURL")
    sig = token["signature"]
    val = token["value"]
    signed = f"{source}?sig={urllib.parse.quote(sig)}&token={urllib.parse.quote(val)}"
    return signed, picked.get("quality") or "?"


def download_clip_to_disk(clip_slug: str, dest_path: str, preferred_quality: str = "720") -> str:
    """Resolve and download a Twitch clip MP4 to disk. Returns the path."""
    url, q = get_clip_download_url(clip_slug, preferred_quality)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest_path, "wb") as f:
        shutil.copyfileobj(r, f, length=64 * 1024)
    return dest_path


def process_clip_to_project(clip_slug: str, clip_title: str,
                            broadcaster_name: str = "",
                            gemini_model: str = "") -> str:
    """One-click flow: clip slug → project ready for the editor.

    Downloads the clip MP4 from Twitch directly (skips VOD slicing — much
    faster), creates an in-memory Project with a single ClipData spanning
    the whole clip, and spawns a background thread that calls Gemini to
    write the caption + IG description + viral score.

    Returns the project_id immediately. The frontend polls the existing
    /api/status/{id} endpoint for progress.
    """
    from .. import config as _cfg
    from ..models.project import Project
    from ..models.clip import ClipData, StyleConfig
    from ..routes.upload import get_project_store
    from . import video_service

    project_id = uuid.uuid4().hex[:8]
    # Sanitize clip title for filename
    safe_title = re.sub(r"[^\w\-]+", "_", clip_title or "twitch_clip")[:40] or "clip"
    filename = f"{safe_title}.mp4"
    upload_path = os.path.join(_cfg.settings.UPLOAD_DIR, f"{project_id}_{filename}")
    os.makedirs(_cfg.settings.UPLOAD_DIR, exist_ok=True)

    # Download synchronously (5-10 sec for a typical 30s clip)
    download_clip_to_disk(clip_slug, upload_path)
    duration = video_service.get_video_duration(upload_path)

    # Create project with ONE clip spanning the whole download. No clip
    # detection needed — Twitch viewers already curated this moment.
    clip = ClipData(
        id=1,
        start_time=0.0,
        end_time=duration,
        description=clip_title or "Twitch clip",
        viral_caption="",          # filled in by Gemini below
        viral_reason="Twitch viewer-clipped viral moment",
        viral_score=8,             # high default — it WAS clipped after all
        duration=duration,
    )
    project = Project(
        id=project_id,
        video_filename=filename,
        video_path=upload_path,
        clip_count=1,
        min_duration=1,
        custom_prompt="",
        status="analyzing",        # skip "uploaded" — we go straight to Gemini
        video_duration=duration,
        output_dir=os.path.join(_cfg.settings.PROJECTS_DIR, project_id),
        gemini_model=gemini_model or _cfg.settings.GEMINI_MODEL,
        creator_name=broadcaster_name.strip(),
        clips=[clip],
    )
    os.makedirs(project.output_dir, exist_ok=True)

    projects = get_project_store()
    projects[project_id] = project

    # Whisper transcription — runs serially BEFORE Gemini caption thread so
    # the editor can burn-in word-level subtitles. Failure is non-fatal: the
    # project stays "analyzing" and the caption job continues; only the
    # subtitle option in the editor becomes unavailable.
    _run_whisper(project_id, upload_path)

    # Background: caption + IG description via Gemini, then mark "ready"
    t = threading.Thread(target=_caption_with_gemini,
                          args=(project_id,), daemon=True)
    t.start()
    print(f"[TwitchClip] project={project_id} file={filename} dur={duration:.1f}s — analyzing in background")
    return project_id


def _run_whisper(project_id: str, video_path: str) -> None:
    """Transcribe a video via Whisper and store on project.transcript.
    Non-fatal — logs and continues if Whisper crashes or the lib is missing."""
    from ..routes.upload import get_project_store
    from . import whisper_service
    projects = get_project_store()
    project = projects.get(project_id)
    if not project:
        return
    try:
        print(f"[TwitchClip] {project_id}: starting Whisper on {os.path.basename(video_path)}…")
        transcript = whisper_service.transcribe(video_path)
        project.transcript = transcript
        n_words = len((transcript or {}).get("words", []))
        print(f"[TwitchClip] {project_id}: Whisper done — {n_words} words")
    except Exception as e:
        print(f"[TwitchClip] {project_id}: Whisper failed (subtitles unavailable): {e}")


def process_clips_batch_to_project(clips: list[dict], broadcaster_name: str = "",
                                   gemini_model: str = "", analyze_with_gemini: bool = True) -> str:
    """Batch flow: N Twitch clip slugs → ONE project with N ClipData entries.

    Each input dict needs `slug` and `title`. We download every clip MP4 at
    720p (same format so the concat demuxer doesn't choke), concat them via
    `ffmpeg -f concat -c copy` into one file, and create a project where
    each ClipData covers the time range of its source clip in the combined
    output.

    When `analyze_with_gemini=True` (default): Gemini writes captions for
    each clip in a background thread and Whisper transcribes the combined
    file. The project starts `analyzing` → `ready` (or `error`), with
    `analyze_progress` like "3/10" shown in the UI.

    When `analyze_with_gemini=False`: clips land in the project ready to edit
    immediately with empty captions — no Gemini, no Whisper. The user then
    runs "Re-analizar" per clip/batch to caption them at their own pace.
    Returns the project_id immediately (status already `ready`).
    """
    from .. import config as _cfg
    from ..models.project import Project
    from ..models.clip import ClipData
    from ..routes.upload import get_project_store
    from . import video_service
    import subprocess

    if not clips:
        raise RuntimeError("No clips supplied")

    project_id = uuid.uuid4().hex[:8]
    work_dir = os.path.join(_cfg.settings.PROJECTS_DIR, project_id, "_dl")
    os.makedirs(work_dir, exist_ok=True)
    os.makedirs(_cfg.settings.UPLOAD_DIR, exist_ok=True)

    # 1) Download every clip MP4 (serial — Twitch rate-limits parallel hard)
    downloaded = []
    for i, c in enumerate(clips):
        slug = c.get("slug") or c.get("id")
        if not slug:
            continue
        path = os.path.join(work_dir, f"in_{i:03d}.mp4")
        try:
            download_clip_to_disk(slug, path, preferred_quality="720")
            dur = video_service.get_video_duration(path)
            downloaded.append({
                "slug": slug,
                "title": c.get("title") or f"Clip {i+1}",
                "path": path,
                "duration": float(dur),
            })
        except Exception as e:
            print(f"[TwitchBatch] download failed for {slug}: {e}")
            continue
    if not downloaded:
        raise RuntimeError("None of the clips could be downloaded")

    # 2) Concat into one MP4 (concat demuxer — stream-copy, fast)
    list_file = os.path.join(work_dir, "concat.txt")
    with open(list_file, "w", encoding="utf-8") as f:
        for d in downloaded:
            # FFmpeg concat demuxer needs forward slashes + escaped quotes
            safe = d["path"].replace("\\", "/").replace("'", "'\\''")
            f.write(f"file '{safe}'\n")
    combined_path = os.path.join(_cfg.settings.UPLOAD_DIR, f"{project_id}_combined.mp4")
    cmd = [
        video_service.FFMPEG_EXE,
        "-f", "concat", "-safe", "0", "-i", list_file,
        "-c", "copy", "-y", "-loglevel", "error",
        combined_path,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=600)
    if r.returncode != 0 or not os.path.exists(combined_path):
        # Fall back to concat filter (re-encodes; handles format mismatches)
        print(f"[TwitchBatch] concat demuxer failed, re-encoding: {r.stderr[-300:]}")
        inputs = []
        for d in downloaded:
            inputs += ["-i", d["path"]]
        n = len(downloaded)
        filtergraph = "".join(f"[{i}:v:0][{i}:a:0]" for i in range(n)) + f"concat=n={n}:v=1:a=1[v][a]"
        cmd2 = [
            video_service.FFMPEG_EXE, *inputs,
            "-filter_complex", filtergraph,
            "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-y", "-loglevel", "error",
            combined_path,
        ]
        r = subprocess.run(cmd2, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=900)
        if r.returncode != 0:
            raise RuntimeError(f"Failed to concat clips: {r.stderr[-300:]}")

    total_dur = video_service.get_video_duration(combined_path)

    # 3) Build ClipData per source clip with offsets in the combined output
    clip_records = []
    cursor = 0.0
    for i, d in enumerate(downloaded):
        # Re-probe the actual concat'd boundaries by using durations cumulatively
        start = cursor
        end = cursor + d["duration"]
        # Clamp the last end to the real total in case of tiny drift
        if i == len(downloaded) - 1:
            end = min(end, total_dur)
        clip_records.append(ClipData(
            id=i + 1,
            start_time=round(start, 3),
            end_time=round(end, 3),
            description=d["title"][:60],
            viral_caption="",
            viral_reason="Twitch viewer-clipped viral moment",
            viral_score=8,
            duration=round(end - start, 3),
        ))
        cursor = end

    project = Project(
        id=project_id,
        video_filename=f"{project_id}_combined.mp4",
        video_path=combined_path,
        clip_count=len(clip_records),
        min_duration=1,
        custom_prompt="",
        status="analyzing" if analyze_with_gemini else "ready",
        video_duration=total_dur,
        output_dir=os.path.join(_cfg.settings.PROJECTS_DIR, project_id),
        gemini_model=gemini_model or _cfg.settings.GEMINI_MODEL,
        creator_name=broadcaster_name.strip(),
        clips=clip_records,
    )
    # No-Gemini mode: captions/score start empty so the user re-analyses them
    # at their own pace from ClipsStep.
    if not analyze_with_gemini:
        for clip in project.clips:
            clip.viral_caption = ""
            clip.viral_score = 0
            clip.match_confidence = "unverified"
    project.analyze_progress = f"0/{len(clip_records)}" if analyze_with_gemini else ""
    os.makedirs(project.output_dir, exist_ok=True)
    projects = get_project_store()
    projects[project_id] = project

    if not analyze_with_gemini:
        print(f"[TwitchBatch] project={project_id} clips={len(clip_records)} "
              f"total_dur={total_dur:.1f}s — SKIPPING Gemini (user re-analyzes manually)")
        return project_id

    # Whisper transcribes the WHOLE concatenated MP4 in a single pass. Each
    # ClipData's start/end already points at the right time-range inside this
    # file, so per-clip subtitle rendering picks the right words for free.
    # Failure is non-fatal — only the subtitle option in the editor becomes
    # unavailable, the rest of the project still works.
    _run_whisper(project_id, combined_path)

    print(f"[TwitchBatch] project={project_id} clips={len(clip_records)} "
          f"total_dur={total_dur:.1f}s — captioning in background")
    threading.Thread(target=_caption_clips_batch_with_gemini,
                     args=(project_id,), daemon=True).start()
    return project_id


def _caption_clips_batch_with_gemini(project_id: str):
    """Background: write caption for each ClipData via Gemini. Updates
    project.analyze_progress so the UI can show 'analyzing 3/10'."""
    from .. import config as _cfg
    from ..routes.upload import get_project_store
    from . import gemini_service, prompts, video_service
    from google.genai import types as _types
    import re as _re

    projects = get_project_store()
    project = projects.get(project_id)
    if not project or not project.clips:
        return

    creator_line = ""
    if project.creator_name:
        creator_line = (f'MANDATORY: Include the name "{project.creator_name}" '
                        f'in the caption naturally. Do NOT use any other name. ')
    prompt_text = prompts.render("reanalyze_clip", CREATOR_LINE=creator_line)
    active_model = project.gemini_model or _cfg.settings.GEMINI_MODEL

    total = len(project.clips)
    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)

    for idx, clip in enumerate(project.clips):
        project.analyze_progress = f"{idx}/{total}"
        # Extract just this clip's segment so Gemini analyzes only it
        seg_path = os.path.join(temp_dir, f"twb_{project_id}_{idx}.mp4")
        try:
            dur = clip.end_time - clip.start_time
            r = __import__("subprocess").run([
                video_service.FFMPEG_EXE,
                "-ss", str(clip.start_time), "-i", project.video_path,
                "-t", str(dur), "-c", "copy", "-y", "-loglevel", "error", seg_path,
            ], capture_output=True, timeout=120)
            if not os.path.exists(seg_path):
                continue
            active_file = gemini_service.upload_video(seg_path)
            active_file = gemini_service.wait_for_processing(active_file)
            response = gemini_service.client.models.generate_content(
                model=active_model,
                contents=[_types.Content(role="user", parts=[
                    _types.Part.from_uri(file_uri=active_file.uri, mime_type=active_file.mime_type),
                    _types.Part.from_text(text=prompt_text),
                ])],
                config=_types.GenerateContentConfig(temperature=0.5),
            )
            new_cap = (response.text or "").strip().rstrip(".")
            new_cap = _re.sub(r"[^\w\s'\U0001F300-\U0001FAFF\U00002600-\U000027BF✀-➿☀-⛿]", '', new_cap).strip()
            new_cap = _re.sub(r"\s+", " ", new_cap).strip()
            new_cap = gemini_service.filter_emojis_to_whitelist(new_cap)
            if new_cap:
                m = _re.match(r"^(.*?)(\s*[\U0001F300-\U0001FAFF\U00002600-\U000027BF]+)?\s*$", new_cap)
                if m:
                    tp = (m.group(1) or "")
                    ep = (m.group(2) or "")
                    tp = tp[:1].upper() + tp[1:].lower()
                    if project.creator_name:
                        tp = gemini_service.restore_name_casing(tp, project.creator_name)
                    new_cap = (tp + ep).strip()
            clip.viral_caption = new_cap or clip.description
            print(f"[TwitchBatch] {project_id} {idx+1}/{total} done: {clip.viral_caption!r}")
        except Exception as e:
            print(f"[TwitchBatch] {project_id} clip {idx+1} failed: {e}")
            clip.viral_caption = clip.description    # fallback
        finally:
            try: os.remove(seg_path)
            except Exception: pass

    project.analyze_progress = f"{total}/{total}"
    project.status = "ready"
    print(f"[TwitchBatch] project={project_id} all done.")


def _caption_with_gemini(project_id: str):
    """Background worker: call Gemini on the clip to write caption + IG desc."""
    from .. import config as _cfg
    from ..routes.upload import get_project_store
    from . import gemini_service, prompts
    from google.genai import types as _types
    import re as _re

    projects = get_project_store()
    project = projects.get(project_id)
    if not project or not project.clips:
        return
    clip = project.clips[0]
    active_file = None
    try:
        active_file = gemini_service.upload_video(project.video_path)
        active_file = gemini_service.wait_for_processing(active_file)

        creator_line = ""
        if project.creator_name:
            creator_line = (f'MANDATORY: Include the name "{project.creator_name}" '
                            f'in the caption naturally. Do NOT use any other name. ')

        # Use the existing single-clip prompt (it's already tuned for short clips)
        prompt_text = prompts.render("reanalyze_clip", CREATOR_LINE=creator_line)

        active_model = project.gemini_model or _cfg.settings.GEMINI_MODEL
        response = gemini_service.client.models.generate_content(
            model=active_model,
            contents=[_types.Content(role="user", parts=[
                _types.Part.from_uri(file_uri=active_file.uri, mime_type=active_file.mime_type),
                _types.Part.from_text(text=prompt_text),
            ])],
            config=_types.GenerateContentConfig(temperature=0.5),
        )
        new_caption = (response.text or "").strip().rstrip(".")
        new_caption = _re.sub(
            r"[^\w\s'\U0001F300-\U0001FAFF\U00002600-\U000027BF✀-➿☀-⛿]",
            '', new_caption,
        ).strip()
        new_caption = _re.sub(r"\s+", " ", new_caption).strip()
        new_caption = gemini_service.filter_emojis_to_whitelist(new_caption)
        # Lower-case rule, preserve trailing emoji + creator capitalization
        if new_caption:
            m = _re.match(r"^(.*?)(\s*[\U0001F300-\U0001FAFF\U00002600-\U000027BF]+)?\s*$", new_caption)
            if m:
                text_part = (m.group(1) or "")
                emoji_part = (m.group(2) or "")
                text_part = text_part[:1].upper() + text_part[1:].lower()
                if project.creator_name:
                    text_part = gemini_service.restore_name_casing(text_part, project.creator_name)
                new_caption = (text_part + emoji_part).strip()
        clip.viral_caption = new_caption or clip.viral_caption or "Twitch viral moment"
        project.status = "ready"
        print(f"[TwitchClip] project={project_id} caption={clip.viral_caption!r}")
    except Exception as e:
        project.status = "error"
        print(f"[TwitchClip] project={project_id} FAILED: {e}")


def get_clips_for_video(video_id: str, max_clips: int = 500) -> list[dict]:
    """Return clips from the given VOD, sorted by view count desc.

    Twitch's Helix /clips endpoint does NOT accept video_id as a filter — it
    requires broadcaster_id, game_id, or clip id. So we do it in two steps:
      1) /helix/videos?id=X → get broadcaster_id + created_at + duration
      2) /helix/clips?broadcaster_id=X&started_at=...&ended_at=... → fetch
         clips made around when the stream aired, then keep only the ones
         whose `video_id` matches the VOD (since the time window can also
         include clips from other streams by the same broadcaster).
    """
    if not video_id:
        return []
    vod = get_video_info(video_id)
    if not vod.get("user_id"):
        raise RuntimeError(f"VOD {video_id}: missing broadcaster_id")

    from datetime import datetime, timedelta, timezone
    started_at = vod["created_at"]
    # Clips can be created days after the stream — give a 30-day window so we
    # catch late ones. Helix will paginate within the broadcaster's clips.
    try:
        start_dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    except Exception:
        start_dt = datetime.now(timezone.utc) - timedelta(days=60)
    # Twitch wants RFC3339 with Z suffix
    ended_dt = start_dt + timedelta(days=30)
    started_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    ended_iso = ended_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    out = []
    cursor = None
    pages = 0
    MAX_PAGES = 30  # at 100/page that's 3000 clips searched — covers anything
    while pages < MAX_PAGES:
        params = {
            "broadcaster_id": vod["user_id"],
            "first": 100,
            "started_at": started_iso,
            "ended_at": ended_iso,
        }
        if cursor:
            params["after"] = cursor
        data = _helix_get("clips", params)
        for c in data.get("data", []):
            # Keep only clips that are FROM this specific VOD and have a vod_offset
            if c.get("video_id") != video_id:
                continue
            if c.get("vod_offset") is None:
                continue
            out.append({
                "id": c.get("id"),
                "url": c.get("url"),
                "title": (c.get("title") or "").strip() or "(sin título)",
                "creator_name": c.get("creator_name") or "",
                "broadcaster_name": c.get("broadcaster_name") or "",  # the streamer
                "view_count": int(c.get("view_count") or 0),
                "duration": float(c.get("duration") or 0),
                "vod_offset_seconds": c.get("vod_offset"),
                "created_at": c.get("created_at") or "",
                "thumbnail_url": c.get("thumbnail_url") or "",
            })
        cursor = (data.get("pagination") or {}).get("cursor")
        pages += 1
        if not cursor or not data.get("data"):
            break
        if len(out) >= max_clips * 2:
            break  # have plenty already

    # Sort by views desc (the viral signal) and cap
    out.sort(key=lambda c: c["view_count"], reverse=True)
    return out[:max_clips]


# ─── Recent clips for a channel (live-clip pescador polling) ────────────────

def _get_user_id_by_login(login: str) -> Optional[str]:
    """Resolve a Twitch channel login (e.g. "adinross") to its user_id."""
    if not login:
        return None
    data = _helix_get("users", {"login": login.lower()})
    items = data.get("data", []) or []
    return items[0].get("id") if items else None


def get_current_live_stream(channel_login: str) -> Optional[dict]:
    """If the channel is broadcasting right now, return {id, started_at,
    title, game_name, user_id}. Otherwise None. Used by the live-clip
    pescador to anchor polling to the stream's true start so clips made
    earlier in the stream get caught on the first poll.

    `started_at` is returned as an ISO 8601 UTC string (Helix's native
    format), so it round-trips cleanly through JSON + datetime.fromisoformat.
    """
    if not channel_login:
        return None
    data = _helix_get("streams", {"user_login": channel_login.lower()})
    items = data.get("data", []) or []
    if not items:
        return None
    s = items[0]
    return {
        "id": s.get("id", ""),
        "user_id": s.get("user_id", ""),
        "started_at": s.get("started_at", ""),
        "title": s.get("title", ""),
        "game_name": s.get("game_name", ""),
        "viewer_count": s.get("viewer_count", 0),
    }


def get_recent_clips_for_channel(channel_login: str, since_dt) -> list[dict]:
    """List clips made for `channel_login` (e.g. 'adinross') AT OR AFTER
    `since_dt` (datetime, UTC-aware). Used by the live-clip pescador every
    poll tick — pass `since_dt` slightly behind your last poll to catch
    clips that appeared during the gap.

    Returns clip dicts in the same shape as `get_clips_for_video` (+
    'platform' = 'twitch') so the live pescador can treat both platforms
    uniformly.
    """
    if not channel_login:
        return []
    from datetime import datetime, timezone

    if isinstance(since_dt, str):
        try:
            s = since_dt.replace(" ", "T").replace("Z", "+00:00")
            since_dt = datetime.fromisoformat(s)
        except Exception:
            since_dt = None
    if since_dt and since_dt.tzinfo is None:
        since_dt = since_dt.replace(tzinfo=timezone.utc)

    user_id = _get_user_id_by_login(channel_login)
    if not user_id:
        return []

    # Helix requires started_at — use since_dt (or "10 minutes ago" as floor).
    from datetime import timedelta
    floor_dt = (since_dt or (datetime.now(timezone.utc) - timedelta(minutes=10)))
    started_iso = floor_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    out = []
    cursor = None
    pages = 0
    MAX_PAGES = 5     # 5 * 100 = 500 candidate clips per poll — plenty
    while pages < MAX_PAGES:
        params = {
            "broadcaster_id": user_id,
            "first": 100,
            "started_at": started_iso,
        }
        if cursor:
            params["after"] = cursor
        data = _helix_get("clips", params)
        clips = data.get("data", []) or []
        if not clips:
            break
        for c in clips:
            created = c.get("created_at") or ""
            try:
                cs = created.replace(" ", "T").replace("Z", "+00:00")
                cdt = datetime.fromisoformat(cs)
                if cdt.tzinfo is None:
                    cdt = cdt.replace(tzinfo=timezone.utc)
            except Exception:
                cdt = None
            if since_dt and cdt and cdt < since_dt:
                continue
            out.append({
                "id": c.get("id"),
                "slug": c.get("id"),
                "url": c.get("url"),
                "title": (c.get("title") or "").strip() or "(sin título)",
                "creator_name": c.get("creator_name") or "",
                "broadcaster_name": c.get("broadcaster_name") or channel_login,
                "view_count": int(c.get("view_count") or 0),
                "duration": float(c.get("duration") or 0),
                "vod_offset_seconds": c.get("vod_offset") or 0,
                "created_at": created,
                "thumbnail_url": c.get("thumbnail_url") or "",
                "platform": "twitch",
            })
        cursor = (data.get("pagination") or {}).get("cursor")
        pages += 1
        if not cursor:
            break
    return out
