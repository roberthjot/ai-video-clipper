"""
downloader_service.py — Universal video downloader using yt-dlp.

Supports YouTube, Instagram (public), TikTok (no watermark), Twitter/X,
Twitch (VODs + clips), Reddit, and ~1000 other sites that yt-dlp recognises.

Each download is a background job. The frontend polls /status/{job_id} to
get progress percentage + ETA + bytes downloaded. The finished MP4 lives in
`projects/_downloads/` and is served via a download endpoint.

For TikTok specifically we set a mobile User-Agent so yt-dlp gets the
no-watermark MP4 stream (TikTok serves a clean version to its own mobile
player). For YouTube we use `bestvideo+bestaudio/best` which merges the
highest-quality video and audio streams via FFmpeg (4K+ if available).
"""
import os
import re
import json
import time
import uuid
import threading
import urllib.parse
import urllib.request
import urllib.error
from collections import defaultdict

import imageio_ffmpeg

from ..config import settings


# Where finished downloads live
DOWNLOADS_DIR = os.path.join(settings.PROJECTS_DIR, "_downloads")
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

# Mobile UA used for TikTok to get the no-watermark stream
_TIKTOK_MOBILE_UA = (
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Mobile Safari/537.36"
)
_DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

# In-memory job store: job_id -> { status, progress, ... }
_jobs: dict = {}
_jobs_lock = threading.Lock()


# ─── TikTok via tikwm.com (avoids the IP-block / TLS fingerprint issues) ──────
#
# yt-dlp talks directly to TikTok and gets blocked because TikTok aggressively
# fights scrapers (IP blocks, TLS fingerprinting, captchas). tikwm.com is a
# free third-party scraper service that runs from rotating residential IPs —
# the same backend that powers SnapTik, SaveFrom, SSSTik, etc. POST a TikTok
# URL, get back the direct no-watermark MP4 URL + metadata. No auth needed.

def _download_tiktok_via_tikwm(url: str, job: dict, output_base: str) -> str:
    """Download a TikTok video using tikwm.com's free public API.

    Returns the final file path. Raises RuntimeError if the API rejects the
    URL or the download fails — caller catches and falls back to yt-dlp.
    """
    api_url = "https://www.tikwm.com/api/"
    body = urllib.parse.urlencode({"url": url, "hd": "1"}).encode("utf-8")
    req = urllib.request.Request(
        api_url, data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": _DESKTOP_UA,
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            resp = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"tikwm API HTTP {e.code}")
    except Exception as e:
        raise RuntimeError(f"tikwm API unreachable: {e}")

    if resp.get("code") != 0:
        raise RuntimeError(f"tikwm: {resp.get('msg') or 'unknown error'}")

    data = resp.get("data") or {}
    # Prefer HD (no watermark) → fall back to standard (no watermark) → wmplay (with)
    mp4_url = data.get("hdplay") or data.get("play") or data.get("wmplay")
    if not mp4_url:
        raise RuntimeError("tikwm: no playback URL in response")
    if mp4_url.startswith("/"):
        mp4_url = "https://www.tikwm.com" + mp4_url

    # Capture metadata for the UI
    job["title"] = (data.get("title") or "").strip()
    job["uploader"] = ((data.get("author") or {}).get("nickname") or "").strip()
    job["duration_seconds"] = int(data.get("duration") or 0)
    job["thumbnail"] = data.get("cover") or ""

    total = int(data.get("hd_size") or data.get("size") or 0)
    job["total_bytes"] = total
    job["status"] = "downloading"
    job["progress"] = 0.0

    # Download MP4 in chunks, updating progress
    output_path = output_base + ".mp4"
    dl_req = urllib.request.Request(mp4_url, headers={"User-Agent": _DESKTOP_UA})
    start_time = time.time()
    last_tick = start_time
    downloaded = 0
    with urllib.request.urlopen(dl_req, timeout=60) as resp, open(output_path, "wb") as f:
        while True:
            chunk = resp.read(64 * 1024)
            if not chunk:
                break
            f.write(chunk)
            downloaded += len(chunk)
            job["downloaded_bytes"] = downloaded
            if total > 0:
                job["progress"] = round(downloaded * 100 / total, 1)
            now = time.time()
            elapsed = max(0.05, now - start_time)
            job["speed_bps"] = int(downloaded / elapsed)
            if total > 0 and job["speed_bps"] > 0:
                job["eta_seconds"] = int((total - downloaded) / job["speed_bps"])
            last_tick = now
    return output_path


# ─── Platform detection ───────────────────────────────────────────────────────

def detect_platform(url: str) -> str:
    """Return a short tag for the source site, used by the UI for the badge."""
    u = (url or "").lower()
    if "youtube.com" in u or "youtu.be" in u:
        return "youtube"
    if "tiktok.com" in u:
        return "tiktok"
    if "instagram.com" in u:
        return "instagram"
    if "twitter.com" in u or "x.com" in u:
        return "twitter"
    if "twitch.tv" in u:
        return "twitch"
    if "reddit.com" in u or "redd.it" in u:
        return "reddit"
    if "vimeo.com" in u:
        return "vimeo"
    return "other"


# ─── yt-dlp options builder ───────────────────────────────────────────────────

def _format_for_quality(quality: str, audio_only: bool) -> str:
    """Translate the UI's quality choice into a yt-dlp format selector."""
    if audio_only:
        return "bestaudio/best"
    q = (quality or "max").lower()
    if q == "1080" or q == "1080p":
        return "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best"
    if q == "720" or q == "720p":
        return "bestvideo[height<=720]+bestaudio/best[height<=720]/best"
    # Default — absolute max quality available, regardless of container
    return "bestvideo+bestaudio/best"


def _ydl_opts(url: str, quality: str, audio_only: bool, output_template: str,
              progress_hook) -> dict:
    """Build the yt-dlp options dict for a given URL + quality choice."""
    platform = detect_platform(url)
    # imageio_ffmpeg ships a versioned binary name (ffmpeg-win-x86_64-vX.Y.exe)
    # so yt-dlp's directory-based lookup for "ffmpeg.exe" fails. Pass the full
    # file path — yt-dlp accepts a binary path here and uses it directly.
    ffmpeg_loc = imageio_ffmpeg.get_ffmpeg_exe()

    fmt = _format_for_quality(quality, audio_only)

    opts = {
        "format": fmt,
        "outtmpl": output_template,
        "noplaylist": True,                 # always treat URL as a single video
        "quiet": True,                       # silence yt-dlp's own logs
        "no_warnings": True,
        "progress_hooks": [progress_hook],
        "ffmpeg_location": ffmpeg_loc,
        # Be polite — retry transient errors instead of failing immediately
        "retries": 5,
        "fragment_retries": 5,
        "socket_timeout": 30,
    }

    if audio_only:
        opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }]
    else:
        # Force MP4 container so the file is uniformly playable
        opts["merge_output_format"] = "mp4"

    # Site-specific tweaks
    if platform == "tiktok":
        # Mobile UA → TikTok serves the no-watermark MP4 to its own player.
        opts["http_headers"] = {"User-Agent": _TIKTOK_MOBILE_UA}
    else:
        opts["http_headers"] = {"User-Agent": _DESKTOP_UA}

    return opts


# ─── Job lifecycle ────────────────────────────────────────────────────────────

def _make_job(url: str, quality: str, audio_only: bool) -> dict:
    job_id = uuid.uuid4().hex[:10]
    job = {
        "id": job_id,
        "url": url,
        "platform": detect_platform(url),
        "quality": quality,
        "audio_only": bool(audio_only),
        "status": "queued",          # queued | downloading | merging | ready | error
        "progress": 0.0,             # 0..100
        "downloaded_bytes": 0,
        "total_bytes": 0,
        "speed_bps": 0,
        "eta_seconds": 0,
        "title": "",
        "uploader": "",
        "duration_seconds": 0,
        "thumbnail": "",
        "filename": "",              # final file basename
        "filepath": "",              # absolute path
        "filesize_mb": 0,
        "error": "",
        "created_at": time.time(),
    }
    with _jobs_lock:
        _jobs[job_id] = job
    return job


def _progress_hook(job: dict):
    """Returns a closure that yt-dlp calls on every progress event."""
    def hook(d):
        status = d.get("status")
        if status == "downloading":
            job["status"] = "downloading"
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            job["downloaded_bytes"] = int(downloaded)
            job["total_bytes"] = int(total)
            if total > 0:
                job["progress"] = round(downloaded * 100 / total, 1)
            job["speed_bps"] = int(d.get("speed") or 0)
            job["eta_seconds"] = int(d.get("eta") or 0)
        elif status == "finished":
            # yt-dlp may still need to merge — mark merging until the worker
            # confirms the file landed at the expected path.
            job["status"] = "merging"
            job["progress"] = 100.0
    return hook


def _worker(job_id: str, url: str, quality: str, audio_only: bool):
    """Background worker. For TikTok videos we try tikwm.com first (gets the
    no-watermark MP4 reliably), then fall back to yt-dlp if that fails.
    Everything else goes through yt-dlp directly."""
    import yt_dlp

    job = _jobs.get(job_id)
    if not job:
        return

    target_base = os.path.join(DOWNLOADS_DIR, f"{job_id}")

    # ── TikTok-specific fast path via tikwm.com ───────────────────────────
    # Only for video mode — audio_only TikTok goes through yt-dlp + FFmpeg
    if detect_platform(url) == "tiktok" and not audio_only:
        try:
            final_path = _download_tiktok_via_tikwm(url, job, target_base)
            job["filename"] = os.path.basename(final_path)
            job["filepath"] = final_path
            job["filesize_mb"] = round(os.path.getsize(final_path) / 1024 / 1024, 1)
            job["status"] = "ready"
            job["progress"] = 100.0
            print(f"[Downloader] {job_id} tikwm OK: {job['filename']} ({job['filesize_mb']} MB)")
            return
        except Exception as e:
            print(f"[Downloader] {job_id} tikwm failed: {e} — falling back to yt-dlp")
            # Reset partial state so the yt-dlp path starts clean
            job["status"] = "queued"
            job["progress"] = 0.0
            job["downloaded_bytes"] = 0
            job["total_bytes"] = 0

    # ── Standard yt-dlp path (all other sites + TikTok fallback) ─────────
    output_template = target_base + ".%(ext)s"

    try:
        opts = _ydl_opts(url, quality, audio_only, output_template, _progress_hook(job))
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)

        # Capture metadata for the UI
        if isinstance(info, dict):
            job["title"] = (info.get("title") or "").strip()
            job["uploader"] = (info.get("uploader") or info.get("channel") or "").strip()
            job["duration_seconds"] = int(info.get("duration") or 0)
            job["thumbnail"] = info.get("thumbnail") or ""

        # Find the actual output file (extension depends on container)
        candidates = []
        for fn in os.listdir(DOWNLOADS_DIR):
            if fn.startswith(job_id + "."):
                candidates.append(fn)
        if not candidates:
            raise RuntimeError("yt-dlp finished but the output file was not found")
        # Prefer mp4 over webm if both exist (shouldn't happen with merge_output_format)
        candidates.sort(key=lambda n: 0 if n.endswith(".mp4") else 1)
        final_name = candidates[0]
        final_path = os.path.join(DOWNLOADS_DIR, final_name)

        job["filename"] = final_name
        job["filepath"] = final_path
        job["filesize_mb"] = round(os.path.getsize(final_path) / 1024 / 1024, 1)
        job["status"] = "ready"
        job["progress"] = 100.0
        print(f"[Downloader] {job_id} ready: {final_name} ({job['filesize_mb']} MB)")
    except Exception as e:
        job["status"] = "error"
        # Trim long yt-dlp tracebacks
        msg = str(e)
        if len(msg) > 300:
            msg = msg[-300:]
        job["error"] = msg
        print(f"[Downloader] {job_id} FAILED: {e}")


# ─── Public API ───────────────────────────────────────────────────────────────

def start_download(url: str, quality: str = "max", audio_only: bool = False) -> dict:
    if not url or not url.strip():
        raise ValueError("URL required")
    job = _make_job(url.strip(), quality, audio_only)
    threading.Thread(
        target=_worker, args=(job["id"], url.strip(), quality, audio_only), daemon=True,
    ).start()
    return job


def get_job(job_id: str) -> dict | None:
    return _jobs.get(job_id)


def list_jobs() -> list:
    """Return all jobs sorted newest-first."""
    return sorted(_jobs.values(), key=lambda j: -j.get("created_at", 0))


def delete_job(job_id: str) -> bool:
    job = _jobs.pop(job_id, None)
    if not job:
        return False
    # Best-effort cleanup of the file on disk
    path = job.get("filepath")
    if path and os.path.exists(path):
        try: os.remove(path)
        except Exception: pass
    return True
