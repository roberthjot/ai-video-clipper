"""
kick_service.py — Kick.com unofficial API client.

Mirror of twitch_service.py but for kick.com. Kick doesn't have a stable
public API like Twitch's Helix, so we use the internal /api/v1 + /api/v2
endpoints that kick.com's own web frontend hits. They're protected by
Cloudflare, so we send realistic browser headers — that's been enough for
the read-only endpoints we need (video info + clips list). No OAuth, no
client credentials.

Endpoints used (kick.com/api/...):
  /api/v1/video/{video_uuid}                — VOD metadata
  /api/v2/channels/{slug}/clips             — clips list (filterable by sort/time)
  /api/v2/clips/{clip_id}                   — single clip details

For actual MP4 downloads we delegate to `yt-dlp`, which already supports
Kick clips and VODs.
"""
import os
import re
import json
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Optional


# ─── URL / ID parsing ────────────────────────────────────────────────────────

# Kick VOD URLs come in a few shapes:
#   https://kick.com/video/<uuid>                          (modern)
#   https://kick.com/<channel>/videos/<uuid>               (legacy)
# IDs are usually UUID v4, but we accept any hex-ish slug.
_VIDEO_ID_RE = re.compile(
    r"/video[s]?/([A-Fa-f0-9\-]{6,})", re.IGNORECASE,
)
_CLIP_ID_RE = re.compile(
    r"/clips?/(clip_[A-Za-z0-9]+|[A-Za-z0-9_\-]{6,})", re.IGNORECASE,
)
_CHANNEL_RE = re.compile(
    r"kick\.com/([A-Za-z0-9_\-]{2,})(?:/|$)", re.IGNORECASE,
)


def extract_video_id(url: str) -> Optional[str]:
    """Pull the VOD UUID out of a Kick URL."""
    if not url:
        return None
    m = _VIDEO_ID_RE.search(url.strip())
    return m.group(1) if m else None


def extract_clip_id(url: str) -> Optional[str]:
    """Pull the clip id out of a Kick clip URL."""
    if not url:
        return None
    m = _CLIP_ID_RE.search(url.strip())
    return m.group(1) if m else None


def extract_channel(url: str) -> Optional[str]:
    """Pull the channel slug out of any Kick URL we recognise."""
    if not url:
        return None
    m = _CHANNEL_RE.search(url.strip())
    if not m:
        return None
    seg = m.group(1).lower()
    # Skip URLs like kick.com/video/<id> where the first segment isn't a
    # channel name.
    if seg in ("video", "videos", "clips", "clip", "api", "search", "browse"):
        return None
    return seg


# ─── HTTP layer (fake-browser headers for Cloudflare) ────────────────────────

_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://kick.com/",
    "Origin": "https://kick.com",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Cache-Control": "no-cache",
}


def _kick_get(path: str, params: Optional[dict] = None, timeout: int = 20) -> dict:
    """Authenticated-ish GET to kick.com/api/<path>. Returns parsed JSON.

    Cloudflare is the failure surface — if it serves the JS challenge instead
    of JSON, the body starts with HTML and we raise RuntimeError. Caller can
    surface that to the UI; user can retry (often works on the second hit)
    or wait a few minutes.
    """
    qs = ("?" + urllib.parse.urlencode(params, doseq=True)) if params else ""
    full = f"https://kick.com/api/{path.lstrip('/')}{qs}"
    req = urllib.request.Request(full, headers=_DEFAULT_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        body = ""
        try: body = e.read().decode("utf-8", errors="replace")[:500]
        except Exception: pass
        raise RuntimeError(f"Kick API {e.code} on {path}: {body or e.reason}")
    text = raw.decode("utf-8", errors="replace").lstrip()
    # Cloudflare JS challenge returns HTML — bail with a useful message.
    if text.startswith("<"):
        raise RuntimeError(
            "Kick API returned an HTML page (likely Cloudflare). Retry in "
            "a few minutes; if it keeps failing the API may have changed."
        )
    try:
        return json.loads(text)
    except Exception as e:
        raise RuntimeError(f"Kick API gave bad JSON on {path}: {e}")


# ─── Video info ──────────────────────────────────────────────────────────────

def _safe_dict(v) -> dict:
    """Kick's response shapes drift — sometimes a nested field is a dict, other
    times the API returns a bare string (or null). Coerce to {} so `.get()`
    calls downstream never explode."""
    return v if isinstance(v, dict) else {}


def _pick_url(v) -> str:
    """A Kick "thumbnail"/"image" field can be either:
      - a string URL,
      - a dict like {url: "...", src: "..."},
      - None.
    Return the URL string or "" — never raise."""
    if not v:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return v.get("url") or v.get("src") or v.get("href") or ""
    return ""


def get_video_info(video_id: str) -> dict:
    """Fetch VOD metadata. Returns:
        {video_id, channel_slug, channel_name, title, started_at,
         duration_seconds, thumbnail_url, livestream_id}
    """
    data = _kick_get(f"v1/video/{video_id}")
    if not isinstance(data, dict) or not data:
        raise RuntimeError(f"Kick VOD {video_id}: empty response")

    livestream = _safe_dict(data.get("livestream"))
    channel = _safe_dict(livestream.get("channel") or data.get("channel"))
    # Kick stores duration in MILLISECONDS on the video object — keep the
    # heuristic so we don't divide a real-seconds value.
    dur_raw = data.get("duration") or livestream.get("duration") or 0
    try:
        dur_n = float(dur_raw or 0)
    except (TypeError, ValueError):
        dur_n = 0.0
    duration_s = dur_n / 1000.0 if dur_n > 1000 else dur_n
    return {
        "video_id": data.get("id") or video_id,
        "video_uuid": data.get("uuid") or video_id,
        "livestream_id": livestream.get("id"),
        "channel_slug": (channel.get("slug") or "").lower(),
        "channel_name": channel.get("name") or channel.get("username") or "",
        "title": (livestream.get("session_title") or data.get("title") or "").strip(),
        "started_at": livestream.get("start_time") or data.get("created_at") or "",
        "duration_seconds": int(duration_s),
        "thumbnail_url": _pick_url(livestream.get("thumbnail")) or _pick_url(data.get("thumbnail")),
        "url": f"https://kick.com/video/{data.get('uuid') or video_id}",
    }


# ─── Clip listing ────────────────────────────────────────────────────────────

def get_clips_for_video(video_id: str, max_clips: int = 500) -> list[dict]:
    """List clips that were made FROM this specific VOD, sorted by views desc.

    Approach:
      1. /v1/video/{uuid} → channel slug + livestream id + started_at + dur.
      2. /v2/channels/{slug}/clips?sort=view&time=all paginated → filter to
         the ones whose video.id matches OR (fallback) whose created_at falls
         inside [started_at .. started_at + dur*1.5].
    """
    if not video_id:
        return []
    vod = get_video_info(video_id)
    channel = vod.get("channel_slug")
    if not channel:
        raise RuntimeError(f"Kick VOD {video_id}: missing channel slug")

    # Normalize livestream_id to string so the comparison with the clip's
    # livestream_id (which the v2 API returns as a quoted string) works
    # regardless of which type each side happens to be.
    target_livestream_id = vod.get("livestream_id")
    target_ls_str = str(target_livestream_id) if target_livestream_id is not None else None
    started_at = vod.get("started_at") or ""
    duration_s = max(1, int(vod.get("duration_seconds") or 0))

    # Parse the start time so we can stop paginating once we've walked past
    # the VOD's date — clips older than the VOD can't belong to it.
    from datetime import datetime, timezone, timedelta
    start_dt = None
    try:
        s = started_at.replace(" ", "T").replace("Z", "+00:00")
        start_dt = datetime.fromisoformat(s)
        if start_dt.tzinfo is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)
    except Exception:
        pass
    # Wider window for the time-window fallback (VODs sometimes have clips
    # added in the days following the stream).
    end_dt = (start_dt + timedelta(seconds=int(duration_s * 1.5))) if start_dt else None
    # If we paginate past this cutoff, stop — older clips can't be from our VOD.
    paginate_cutoff = (start_dt - timedelta(days=2)) if start_dt else None

    print(f"[Kick] get_clips_for_video: channel={channel} target_livestream={target_ls_str} "
          f"vod_started={started_at}")

    out: list[dict] = []
    cursor: Optional[str] = None
    seen_ids: set = set()
    MAX_PAGES = 50   # 50 * 20 = up to 1000 clips searched per VOD
    # Sort by date — clips of recent VODs land on the first pages, so we
    # find them fast and stop once we cross the VOD's date.
    for page in range(MAX_PAGES):
        params = {"sort": "date", "time": "all"}
        if cursor:
            params["cursor"] = cursor
        data = _kick_get(f"v2/channels/{channel}/clips", params)
        # Response shape: {clips: [...], nextCursor: "..."}. Some versions
        # nest under data → defensive.
        if isinstance(data, list):
            clips = data
            cursor = None
        else:
            clips = data.get("clips") or data.get("data") or []
            cursor = data.get("nextCursor") or data.get("cursor")
        if not clips:
            break
        # Track the OLDEST clip date on this page so we know when to stop
        # paginating — once we're past the VOD's start date there's no point
        # going further back in time.
        oldest_dt_on_page = None

        for c in clips:
            cid = c.get("id") or c.get("clip_id") or c.get("livestream_id")
            if cid in seen_ids:
                continue
            seen_ids.add(cid)

            # Parse this clip's created_at once — used for both filtering and
            # the pagination cutoff.
            created = c.get("created_at") or ""
            cdt = None
            try:
                cs = created.replace(" ", "T").replace("Z", "+00:00")
                cdt = datetime.fromisoformat(cs)
                if cdt.tzinfo is None:
                    cdt = cdt.replace(tzinfo=timezone.utc)
                if oldest_dt_on_page is None or cdt < oldest_dt_on_page:
                    oldest_dt_on_page = cdt
            except Exception:
                pass

            # 1) Direct match by livestream id (most reliable on Kick).
            # Compare AS STRINGS — Kick mixes int/str representations across
            # endpoints (vod returns int, clip returns quoted string).
            video_obj = _safe_dict(c.get("video"))
            c_livestream = video_obj.get("id") or c.get("livestream_id")
            c_ls_str = str(c_livestream) if c_livestream is not None else None
            in_vod = (target_ls_str is not None and c_ls_str == target_ls_str)

            # 2) Time-window fallback if no direct match — clips sometimes
            # don't carry a livestream_id (older VODs, edge cases).
            if not in_vod and start_dt and end_dt and cdt is not None:
                if start_dt <= cdt <= end_dt:
                    in_vod = True

            if not in_vod:
                continue

            creator = _safe_dict(c.get("creator"))
            broadcaster = _safe_dict(c.get("channel"))
            try: view_count = int(c.get("view_count") or c.get("views") or 0)
            except (TypeError, ValueError): view_count = 0
            try: dur_v = float(c.get("duration") or 0)
            except (TypeError, ValueError): dur_v = 0.0
            try: off_v = float(c.get("start") or 0)
            except (TypeError, ValueError): off_v = 0.0
            out.append({
                "id": cid,                                                  # Kick clip id (clip_xxxx)
                "slug": cid,                                                # alias for the route layer
                "url": (
                    c.get("clip_url") or
                    f"https://kick.com/{(broadcaster.get('slug') or channel)}/clips/{cid}"
                ),
                "title": (c.get("title") or "").strip() or "(sin título)",
                "creator_name": (creator.get("username") or creator.get("slug") or ""),
                "broadcaster_name": broadcaster.get("name") or broadcaster.get("username") or channel,
                "view_count": view_count,
                "duration": dur_v,
                "vod_offset_seconds": off_v,                                # seconds into the VOD
                "created_at": c.get("created_at") or "",
                "thumbnail_url": _pick_url(c.get("thumbnail_url")) or _pick_url(c.get("thumbnail")),
            })
        # Stop if we've walked past the VOD's date — older clips can't belong
        # to it. Saves dozens of API calls for popular channels.
        if paginate_cutoff and oldest_dt_on_page and oldest_dt_on_page < paginate_cutoff:
            print(f"[Kick] page {page}: oldest clip is {oldest_dt_on_page.isoformat()} "
                  f"(past VOD cutoff) — stopping. Found {len(out)} clips.")
            break
        if not cursor:
            print(f"[Kick] page {page}: no cursor, end of channel clips. Found {len(out)}.")
            break
        if len(out) >= max_clips * 2:
            break
        # Be polite — Cloudflare can rate-limit page-N requests.
        time.sleep(0.3)
    else:
        print(f"[Kick] reached MAX_PAGES={MAX_PAGES}. Found {len(out)} clips for livestream {target_ls_str}.")

    out.sort(key=lambda c: c["view_count"], reverse=True)
    return out[:max_clips]


# ─── Current live stream detection ───────────────────────────────────────────

def get_current_live_stream(channel_slug: str) -> Optional[dict]:
    """If the channel is broadcasting right now, return
    {id, started_at, title, viewer_count}. Otherwise None.

    Used by the live-clip pescador to anchor polling to the stream's true
    start so clips made earlier in the stream are included on the first
    poll. `id` round-trips as a string (Kick returns it as int, but we
    compare against clip.livestream_id which v2 returns as quoted string).
    """
    if not channel_slug:
        return None
    slug = channel_slug.strip().lower()
    try:
        data = _kick_get(f"v1/channels/{slug}")
    except RuntimeError:
        return None
    if not isinstance(data, dict):
        return None
    livestream = _safe_dict(data.get("livestream"))
    if not livestream:
        return None
    ls_id = livestream.get("id")
    return {
        "id": str(ls_id) if ls_id is not None else "",
        "started_at": livestream.get("start_time") or livestream.get("created_at") or "",
        "title": (livestream.get("session_title") or "").strip(),
        "viewer_count": int(livestream.get("viewers") or livestream.get("viewer_count") or 0),
    }


# ─── Recent clips for a channel (live polling) ───────────────────────────────

def get_recent_clips_for_channel(channel_slug: str, since_dt, max_pages: int = 8) -> list[dict]:
    """List clips of `channel_slug` created at or after `since_dt`.

    Used by the live-clip pescador to find clips made during an ongoing
    stream. Paginates `/v2/channels/<slug>/clips?sort=date` (most recent
    first) and stops once it sees a clip older than `since_dt`.

    Returns clip dicts in the same shape as `get_clips_for_video` so the
    rest of the pipeline (frontend list, batch download) handles them
    identically.
    """
    if not channel_slug:
        return []
    from datetime import datetime, timezone

    # Coerce since_dt to a UTC-aware datetime for safe comparison.
    if isinstance(since_dt, str):
        try:
            s = since_dt.replace(" ", "T").replace("Z", "+00:00")
            since_dt = datetime.fromisoformat(s)
        except Exception:
            since_dt = None
    if since_dt and since_dt.tzinfo is None:
        since_dt = since_dt.replace(tzinfo=timezone.utc)

    out: list[dict] = []
    cursor: Optional[str] = None
    seen_ids: set = set()

    for page in range(max_pages):
        params = {"sort": "date", "time": "all"}
        if cursor:
            params["cursor"] = cursor
        data = _kick_get(f"v2/channels/{channel_slug}/clips", params)
        if isinstance(data, list):
            clips = data
            cursor = None
        else:
            clips = data.get("clips") or data.get("data") or []
            cursor = data.get("nextCursor") or data.get("cursor")
        if not clips:
            break

        # Walk this page; stop as soon as we hit a clip older than the cutoff.
        stop = False
        for c in clips:
            cid = c.get("id") or c.get("clip_id")
            if not cid or cid in seen_ids:
                continue
            seen_ids.add(cid)
            created = c.get("created_at") or ""
            cdt = None
            try:
                cs = created.replace(" ", "T").replace("Z", "+00:00")
                cdt = datetime.fromisoformat(cs)
                if cdt.tzinfo is None:
                    cdt = cdt.replace(tzinfo=timezone.utc)
            except Exception:
                pass
            if since_dt and cdt and cdt < since_dt:
                stop = True
                break

            creator = _safe_dict(c.get("creator"))
            broadcaster = _safe_dict(c.get("channel"))
            try: view_count = int(c.get("view_count") or c.get("views") or 0)
            except (TypeError, ValueError): view_count = 0
            try: dur_v = float(c.get("duration") or 0)
            except (TypeError, ValueError): dur_v = 0.0
            try: off_v = float(c.get("start") or 0)
            except (TypeError, ValueError): off_v = 0.0
            out.append({
                "id": cid,
                "slug": cid,
                "url": (
                    c.get("clip_url") or
                    f"https://kick.com/{(broadcaster.get('slug') or channel_slug)}/clips/{cid}"
                ),
                "title": (c.get("title") or "").strip() or "(sin título)",
                "creator_name": creator.get("username") or creator.get("slug") or "",
                "broadcaster_name": broadcaster.get("name") or broadcaster.get("username") or channel_slug,
                "view_count": view_count,
                "duration": dur_v,
                "vod_offset_seconds": off_v,
                "created_at": c.get("created_at") or "",
                "thumbnail_url": _pick_url(c.get("thumbnail_url")) or _pick_url(c.get("thumbnail")),
                "platform": "kick",
            })

        if stop:
            break
        if not cursor:
            break
        time.sleep(0.3)

    return out


# ─── Clip MP4 download (via the yt-dlp Python module) ────────────────────────
#
# The project's existing downloader_service imports yt_dlp as a Python module —
# no PATH lookup, no CLI binary, no subprocess overhead. Same approach here so
# we don't depend on the user having `yt-dlp` installed system-wide.

def download_clip_to_disk(clip_id_or_url: str, dest_path: str) -> str:
    """Download a Kick clip MP4 to dest_path using yt-dlp (Python module).

    Accepts either a raw clip id (clip_xxxx) or a full kick.com URL.
    Uses imageio_ffmpeg's bundled FFmpeg path so HLS segments concatenate
    correctly without a system FFmpeg.
    """
    import yt_dlp
    import imageio_ffmpeg

    url = clip_id_or_url
    if not url.startswith("http"):
        url = f"https://kick.com/clips/{clip_id_or_url}"

    os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)

    # `outtmpl` MUST be the final mp4 (yt-dlp picks it as the output path).
    # `merge_output_format=mp4` ensures the HLS pieces are remuxed to mp4.
    #
    # CAP at 720p: source-quality Kick clips can be ~100MB and Kick's CDN often
    # throttles yt-dlp to ~130 KiB/s, so "best" took 15-20 min for ONE clip.
    # 720p is plenty for a 1080x1920 vertical export and downloads in seconds.
    # concurrent_fragment_downloads pulls the HLS pieces in parallel — big speed
    # win on throttled connections.
    opts = {
        "format": "best[height<=720]/bestvideo[height<=720]+bestaudio/best",
        "outtmpl": dest_path,
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "concurrent_fragment_downloads": 5,
        "ffmpeg_location": imageio_ffmpeg.get_ffmpeg_exe(),
        "retries": 3,
        "fragment_retries": 3,
        "http_headers": {
            # Same UA Cloudflare lets through for /api/v2 — keeps yt-dlp's
            # HLS fetch from getting a 403 on the m3u8.
            "User-Agent": _DEFAULT_HEADERS["User-Agent"],
            "Referer": "https://kick.com/",
        },
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except Exception as e:
        raise RuntimeError(f"yt-dlp failed for {url}: {e}")

    if not os.path.exists(dest_path):
        # yt-dlp sometimes writes to a slightly different filename when it
        # merges audio+video; look for the basename pattern in the dir.
        d = os.path.dirname(dest_path)
        stem = os.path.splitext(os.path.basename(dest_path))[0]
        for f in os.listdir(d):
            if f.startswith(stem):
                actual = os.path.join(d, f)
                if actual != dest_path:
                    os.replace(actual, dest_path)
                break
    if not os.path.exists(dest_path):
        raise RuntimeError(f"yt-dlp ran but {dest_path} wasn't created")
    return dest_path


# ─── Project flow (mirrors twitch_service) ───────────────────────────────────

def _run_whisper(project_id: str, video_path: str) -> None:
    """Same pattern as twitch_service._run_whisper — non-fatal on failure."""
    from ..routes.upload import get_project_store
    from . import whisper_service
    projects = get_project_store()
    project = projects.get(project_id)
    if not project:
        return
    try:
        print(f"[KickClip] {project_id}: starting Whisper on {os.path.basename(video_path)}…")
        transcript = whisper_service.transcribe(video_path)
        project.transcript = transcript
        n_words = len((transcript or {}).get("words", []))
        print(f"[KickClip] {project_id}: Whisper done — {n_words} words")
    except Exception as e:
        print(f"[KickClip] {project_id}: Whisper failed (subtitles unavailable): {e}")


def _caption_with_gemini(project_id: str) -> None:
    """Background: ask Gemini to write a viral caption + IG description for
    every ClipData in the project, then flip status to 'ready'."""
    from ..routes.upload import get_project_store
    from . import gemini_service
    projects = get_project_store()
    project = projects.get(project_id)
    if not project:
        return
    try:
        for clip in project.clips:
            try:
                gemini_service.generate_caption_for_existing_clip(project, clip)
            except Exception as e:
                print(f"[KickClip] {project_id}: caption for clip {clip.id} failed: {e}")
        project.status = "ready"
        print(f"[KickClip] project={project_id} ready")
    except Exception as e:
        print(f"[KickClip] {project_id}: caption job blew up: {e}")
        project.status = "ready"     # still let the user open it


def process_clip_to_project(clip_slug: str, clip_title: str,
                            broadcaster_name: str = "",
                            gemini_model: str = "") -> str:
    """One-click flow: Kick clip → ready-to-edit project.

    Downloads via yt-dlp, creates an in-memory Project with one ClipData,
    runs Whisper synchronously, then spawns the Gemini caption thread.
    Returns project_id immediately so the frontend can poll /api/status/{id}.
    """
    from .. import config as _cfg
    from ..models.project import Project
    from ..models.clip import ClipData
    from ..routes.upload import get_project_store
    from . import video_service

    project_id = uuid.uuid4().hex[:8]
    safe_title = re.sub(r"[^\w\-]+", "_", clip_title or "kick_clip")[:40] or "clip"
    filename = f"{safe_title}.mp4"
    upload_path = os.path.join(_cfg.settings.UPLOAD_DIR, f"{project_id}_{filename}")
    os.makedirs(_cfg.settings.UPLOAD_DIR, exist_ok=True)

    download_clip_to_disk(clip_slug, upload_path)
    duration = video_service.get_video_duration(upload_path)

    clip = ClipData(
        id=1,
        start_time=0.0,
        end_time=duration,
        description=clip_title or "Kick clip",
        viral_caption="",
        viral_reason="Kick viewer-clipped viral moment",
        viral_score=8,
        duration=duration,
    )
    project = Project(
        id=project_id,
        video_filename=filename,
        video_path=upload_path,
        clip_count=1,
        min_duration=1,
        custom_prompt="",
        status="analyzing",
        video_duration=duration,
        output_dir=os.path.join(_cfg.settings.PROJECTS_DIR, project_id),
        gemini_model=gemini_model or _cfg.settings.GEMINI_MODEL,
        creator_name=broadcaster_name.strip(),
        clips=[clip],
    )
    os.makedirs(project.output_dir, exist_ok=True)

    projects = get_project_store()
    projects[project_id] = project

    _run_whisper(project_id, upload_path)

    t = threading.Thread(target=_caption_with_gemini, args=(project_id,), daemon=True)
    t.start()
    print(f"[KickClip] project={project_id} file={filename} dur={duration:.1f}s — analyzing in background")
    return project_id


def process_clips_batch_to_project(clips: list[dict], broadcaster_name: str = "",
                                   gemini_model: str = "") -> str:
    """Batch flow: N Kick clip ids → ONE project with N ClipData entries.

    Downloads every clip MP4 with yt-dlp, concatenates them via FFmpeg
    (`-f concat -c copy`) into a single mp4, then creates a project whose
    clips[] covers each source clip's time range in the combined output.
    Background thread captions every clip via Gemini.
    """
    from .. import config as _cfg
    from ..models.project import Project
    from ..models.clip import ClipData
    from ..routes.upload import get_project_store
    from . import video_service

    if not clips:
        raise RuntimeError("No clips provided")

    project_id = uuid.uuid4().hex[:8]
    work_dir = os.path.join(_cfg.settings.UPLOAD_DIR, f"_kickbatch_{project_id}")
    os.makedirs(work_dir, exist_ok=True)

    downloaded = []   # list of (path, duration, title, slug)
    try:
        for i, item in enumerate(clips):
            slug = (item.get("slug") or item.get("id") or "").strip()
            # Prefer the full URL sent by the frontend (channel-prefixed:
            # kick.com/<channel>/clips/<id>) — yt-dlp's Kick extractor
            # mis-routes the unprefixed kick.com/clips/<id> form as a live
            # stream and 403s.
            url_full = (item.get("url") or "").strip()
            title = (item.get("title") or "clip").strip()
            if not slug and not url_full:
                continue
            safe_title = re.sub(r"[^\w\-]+", "_", title)[:40] or f"clip_{i}"
            piece_path = os.path.join(work_dir, f"{i:02d}_{safe_title}.mp4")
            try:
                download_clip_to_disk(url_full or slug, piece_path)
            except Exception as e:
                print(f"[KickBatch] clip {slug} failed to download: {e}")
                continue
            try:
                dur = video_service.get_video_duration(piece_path)
            except Exception:
                dur = 0.0
            if dur <= 0:
                continue
            downloaded.append((piece_path, dur, title, slug))

        if not downloaded:
            raise RuntimeError("None of the Kick clips downloaded successfully")

        # Concat list for FFmpeg's concat demuxer
        concat_list = os.path.join(work_dir, "concat.txt")
        with open(concat_list, "w", encoding="utf-8") as f:
            for path, *_ in downloaded:
                # FFmpeg's concat demuxer wants `file 'path'` with single quotes
                # escaped — Windows backslashes need normalising.
                p = path.replace("\\", "/").replace("'", r"'\''")
                f.write(f"file '{p}'\n")
        combined_filename = "kick_batch.mp4"
        combined_path = os.path.join(_cfg.settings.UPLOAD_DIR, f"{project_id}_{combined_filename}")
        cmd = [
            video_service.FFMPEG_EXE,
            "-f", "concat", "-safe", "0", "-i", concat_list,
            "-c", "copy", "-movflags", "+faststart",
            "-y", "-loglevel", "error", combined_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=600)
        if result.returncode != 0 or not os.path.exists(combined_path):
            raise RuntimeError(f"FFmpeg concat failed: {(result.stderr or '')[-300:]}")
        total_duration = video_service.get_video_duration(combined_path)

        # Build per-clip ClipData with offsets into the combined output
        clip_objs = []
        t_cur = 0.0
        for i, (_path, dur, title, slug) in enumerate(downloaded, start=1):
            clip_objs.append(ClipData(
                id=i,
                start_time=t_cur,
                end_time=t_cur + dur,
                description=title or f"Kick clip {i}",
                viral_caption="",
                viral_reason="Kick viewer-clipped viral moment",
                viral_score=8,
                duration=dur,
            ))
            t_cur += dur

        project = Project(
            id=project_id,
            video_filename=combined_filename,
            video_path=combined_path,
            clip_count=len(clip_objs),
            min_duration=1,
            custom_prompt="",
            status="analyzing",
            video_duration=total_duration,
            output_dir=os.path.join(_cfg.settings.PROJECTS_DIR, project_id),
            gemini_model=gemini_model or _cfg.settings.GEMINI_MODEL,
            creator_name=broadcaster_name.strip(),
            clips=clip_objs,
        )
        os.makedirs(project.output_dir, exist_ok=True)
        projects = get_project_store()
        projects[project_id] = project

        _run_whisper(project_id, combined_path)
        t = threading.Thread(target=_caption_with_gemini, args=(project_id,), daemon=True)
        t.start()
        print(f"[KickBatch] project={project_id} {len(clip_objs)} clips, total {total_duration:.1f}s")
        return project_id
    finally:
        # Clean up the work dir — keep only the combined MP4 (in UPLOAD_DIR).
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass
