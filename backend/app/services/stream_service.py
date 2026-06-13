"""
stream_service.py — Live stream recorder.

Flow per session:
  1. streamlink resolves the HLS URL from Twitch/Kick
  2. FFmpeg records a segment of N minutes to disk
  3. Segment is marked "ready" — user downloads it and uploads to Video Clipper
  4. FFmpeg immediately starts recording the next segment
"""

import os
import uuid
import threading
import subprocess
import time
from datetime import datetime, timezone

import streamlink as sl

from ..config import settings
from ..models.clip import StreamSession, StreamSegment
from .export_service import FFMPEG_EXE

# ─── In-memory session store ──────────────────────────────────────────────────
_sessions: dict[str, StreamSession] = {}
_stop_flags: dict[str, threading.Event] = {}


def get_session(session_id: str) -> StreamSession | None:
    return _sessions.get(session_id)


def list_sessions() -> list[StreamSession]:
    return list(_sessions.values())


def get_segment_path(session_id: str, segment_index: int) -> str | None:
    """Return file path for a segment if it exists on disk."""
    session = _sessions.get(session_id)
    if not session:
        return None
    for seg in session.segments:
        if seg.index == segment_index and os.path.exists(seg.file_path):
            return seg.file_path
    return None


# ─── Platform detection ───────────────────────────────────────────────────────

def detect_platform(url: str) -> str:
    url = url.lower()
    if "twitch.tv" in url:
        return "twitch"
    if "kick.com" in url:
        return "kick"
    return "other"


def is_vod_url(url: str) -> bool:
    """True if the URL looks like a VOD (recorded past stream) rather than live.
    Twitch VODs: twitch.tv/videos/123456789
    Kick VODs:   kick.com/video/xxxxx (varies; treat /video/ as VOD too)"""
    u = url.lower()
    return ("/videos/" in u) or ("/video/" in u)


# ─── Resolve HLS stream URL via streamlink ────────────────────────────────────

RESOLUTION_SCALE = {
    "480p":  "854:480",
    "720p":  "1280:720",
    "1080p": "1920:1080",
}

RESOLUTION_QUALITY = {
    "480p":  ["480p", "480p60", "360p", "best"],
    "720p":  ["720p", "720p60", "480p", "best"],
    "1080p": ["1080p", "1080p60", "720p", "720p60", "best"],
}


def resolve_stream_url(url: str, resolution: str = "720p",
                       start_offset_minutes: int = 0,
                       start_offset_seconds: int = 0) -> str:
    """Use streamlink to get the direct HLS URL for recording.
    start_offset_seconds takes precedence over start_offset_minutes when both
    are set (used by VOD / single-shot mode to seek with second-level precision).
    """
    session = sl.Streamlink()
    offset_s = int(start_offset_seconds) if start_offset_seconds > 0 else int(start_offset_minutes) * 60
    if offset_s > 0:
        # hls-start-offset accepts seconds as int. For VODs this seeks into
        # the video timeline; for live it rewinds the DVR buffer.
        session.set_option("hls-start-offset", offset_s)
        hh = offset_s // 3600; mm = (offset_s % 3600) // 60; ss = offset_s % 60
        print(f"[Stream] Start offset: {hh:02d}:{mm:02d}:{ss:02d} ({offset_s}s)")
    streams = session.streams(url)
    if not streams:
        raise ValueError(f"No streams found for URL: {url}")

    quality_list = RESOLUTION_QUALITY.get(resolution, RESOLUTION_QUALITY["720p"])
    for q in quality_list:
        if q in streams:
            stream = streams[q]
            if hasattr(stream, 'url'):
                return stream.url
            fd = stream.open()
            fd.close()
            return stream.url

    raise ValueError(f"Resolution '{resolution}' not available. Available: {list(streams.keys())}")


# ─── Record one segment with FFmpeg ──────────────────────────────────────────

def record_segment(hls_url: str, output_path: str, duration_seconds: int,
                   stop_event: threading.Event, resolution: str = "720p",
                   copy_mode: bool = False, start_offset_seconds: int = 0) -> tuple:
    """Record duration_seconds of a stream to output_path.

    start_offset_seconds: passed to FFmpeg as `-ss N` BEFORE `-i` so the seek
    happens at the input level (HLS playlist), not at the output. This is the
    only way to actually start downloading from a specific point in a VOD —
    streamlink's hls-start-offset only affects piped reads, not the playlist
    URL we hand to FFmpeg.

    Returns (elapsed_seconds, exit_code, stderr_tail).

    copy_mode=True uses `-c copy` (no re-encode, no scale). With -c copy, the
    seek snaps to the nearest keyframe (typically 2 sec granularity in HLS).
    copy_mode=False re-encodes with libx264 + scaling for live capture.
    """
    base = [FFMPEG_EXE]
    if start_offset_seconds and start_offset_seconds > 0:
        base += ["-ss", str(int(start_offset_seconds))]

    if copy_mode:
        cmd = base + [
            "-i", hls_url,
            "-t", str(duration_seconds),
            "-c", "copy",
            "-y",
            "-loglevel", "warning",
            output_path,
        ]
    else:
        scale = RESOLUTION_SCALE.get(resolution, RESOLUTION_SCALE["720p"])
        cmd = base + [
            "-i", hls_url,
            "-t", str(duration_seconds),
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-vf", f"scale={scale}",
            "-c:a", "aac",
            "-y",
            "-loglevel", "warning",
            output_path,
        ]

    # Capture stderr so we can surface FFmpeg errors instead of guessing
    proc = subprocess.Popen(cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL,
                            text=True, encoding="utf-8", errors="replace")
    start = time.time()
    while proc.poll() is None:
        if stop_event.is_set():
            proc.terminate()
            proc.wait()
            break
        time.sleep(1)
    elapsed = time.time() - start
    # Drain stderr (won't block — process already exited)
    try:
        err_output = proc.stderr.read() if proc.stderr else ""
    except Exception:
        err_output = ""
    err_tail = err_output[-600:] if err_output else ""
    return elapsed, proc.returncode, err_tail


# ─── Main recording loop ──────────────────────────────────────────────────────

def _recording_loop(session: StreamSession, stop_event: threading.Event) -> None:
    streams_dir = os.path.join(settings.PROJECTS_DIR, f"stream_{session.session_id}")
    os.makedirs(streams_dir, exist_ok=True)

    try:
        hls_url = resolve_stream_url(
            session.url, session.resolution,
            start_offset_minutes=session.start_offset_minutes,
            start_offset_seconds=session.start_offset_seconds,
        )
        print(f"[Stream] Resolved HLS URL for {session.url} ({session.resolution})"
              f"{' [VOD]' if session.is_vod else ''}"
              f"{' [single-shot]' if session.single_shot else ''}")
    except Exception as e:
        session.status = "error"
        session.error = str(e)
        print(f"[Stream] Failed to resolve stream URL: {e}")
        return

    segment_index = 0
    session.status = "recording"
    # VOD / single-shot uses -c copy (no re-encode, fast). Live re-encodes.
    copy_mode = bool(session.is_vod or session.single_shot)
    # Seek into the HLS playlist via FFmpeg `-ss`. streamlink's hls-start-offset
    # doesn't propagate into the playlist URL we hand to FFmpeg, so without this
    # every download starts at second 0 of the VOD.
    seek_seconds = int(session.start_offset_seconds or 0)
    if seek_seconds == 0 and session.start_offset_minutes:
        seek_seconds = int(session.start_offset_minutes) * 60

    while not stop_event.is_set():
        seg_path = os.path.join(streams_dir, f"segment_{segment_index:03d}.mp4")
        # Override duration when caller asked for a precise HH:MM:SS slice.
        if session.duration_seconds and session.duration_seconds > 0:
            duration_s = int(session.duration_seconds)
        else:
            duration_s = session.segment_minutes * 60

        segment = StreamSegment(
            index=segment_index,
            file_path=seg_path,
            status="recording",
            started_at=datetime.now(timezone.utc).isoformat(),
        )
        session.segments.append(segment)
        mode_tag = "copy" if copy_mode else "re-encode"
        print(f"[Stream] Recording segment {segment_index} ({duration_s}s, {mode_tag})...")

        elapsed, exit_code, err_tail = record_segment(
            hls_url, seg_path, duration_s, stop_event,
            session.resolution, copy_mode=copy_mode,
            start_offset_seconds=seek_seconds,
        )
        segment.duration_recorded = elapsed

        # Decide success/failure based on exit code + file existence + size.
        file_size = os.path.getsize(seg_path) if os.path.exists(seg_path) else 0
        file_ok = exit_code == 0 and file_size > 100_000  # > 100 KB

        if file_ok:
            segment.status = "ready"
            print(f"[Stream] Segment {segment_index} ready "
                  f"(elapsed={elapsed:.0f}s, {file_size/1024/1024:.1f}MB) → {seg_path}")
        elif exit_code != 0:
            segment.status = "failed"
            # Pull the most useful line from the stderr tail
            err_msg = (err_tail.strip().splitlines()[-1] if err_tail.strip() else
                       f"FFmpeg exited with code {exit_code}")
            segment.error = err_msg
            print(f"[Stream] Segment {segment_index} FAILED (exit={exit_code}):\n{err_tail}")
        else:
            # Exited cleanly but file is tiny — interrupted or no data
            segment.status = "skipped"
            segment.error = f"Archivo muy chico ({file_size} bytes). Probablemente el stream se cortó."
            print(f"[Stream] Segment {segment_index} skipped ({file_size} bytes)")

        if stop_event.is_set():
            break

        # Single-shot mode: one segment then stop.
        if session.single_shot:
            print(f"[Stream] Single-shot complete — stopping session")
            break

        segment_index += 1

    session.status = "stopped"
    print(f"[Stream] Session {session.session_id} stopped after {segment_index + 1} segment(s)")


# ─── Public API ───────────────────────────────────────────────────────────────

def start_session(url: str, segment_minutes: int = 10,
                  clips_per_segment: int = 5,
                  resolution: str = "720p",
                  start_offset_minutes: int = 0,
                  single_shot: bool = False,
                  start_offset_seconds: int = 0,
                  duration_seconds: int = 0) -> StreamSession:
    session_id = uuid.uuid4().hex[:8]
    vod = is_vod_url(url)
    # VOD implies single-shot (downloading a finite past slice, not looping live).
    if vod:
        single_shot = True
    session = StreamSession(
        session_id=session_id,
        url=url,
        platform=detect_platform(url),
        segment_minutes=segment_minutes,
        clips_per_segment=clips_per_segment,
        resolution=resolution,
        start_offset_minutes=start_offset_minutes,
        is_vod=vod,
        single_shot=single_shot,
        start_offset_seconds=start_offset_seconds,
        duration_seconds=duration_seconds,
        status="starting",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    _sessions[session_id] = session

    stop_event = threading.Event()
    _stop_flags[session_id] = stop_event

    thread = threading.Thread(target=_recording_loop, args=(session, stop_event), daemon=True)
    thread.start()
    print(f"[Stream] Session {session_id} started for {url}")
    return session


def stop_session(session_id: str) -> StreamSession | None:
    session = _sessions.get(session_id)
    if not session:
        return None
    stop_event = _stop_flags.get(session_id)
    if stop_event:
        stop_event.set()
    session.status = "stopping"
    return session
