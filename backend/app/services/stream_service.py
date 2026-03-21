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


def resolve_stream_url(url: str, resolution: str = "720p", start_offset_minutes: int = 0) -> str:
    """Use streamlink to get the direct HLS URL for recording."""
    session = sl.Streamlink()
    if start_offset_minutes > 0:
        # hls-start-offset expects seconds as int or HH:MM:SS string
        session.set_option("hls-start-offset", start_offset_minutes * 60)
        print(f"[Stream] Rewind offset: -{start_offset_minutes} min ({start_offset_minutes * 60}s)")
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
                   stop_event: threading.Event, resolution: str = "720p") -> float:
    """Record duration_seconds of a live stream to output_path. Returns actual seconds recorded."""
    scale = RESOLUTION_SCALE.get(resolution, RESOLUTION_SCALE["720p"])
    cmd = [
        FFMPEG_EXE,
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

    proc = subprocess.Popen(cmd)
    start = time.time()
    while proc.poll() is None:
        if stop_event.is_set():
            proc.terminate()
            proc.wait()
            break
        time.sleep(1)

    return time.time() - start


# ─── Main recording loop ──────────────────────────────────────────────────────

def _recording_loop(session: StreamSession, stop_event: threading.Event) -> None:
    streams_dir = os.path.join(settings.PROJECTS_DIR, f"stream_{session.session_id}")
    os.makedirs(streams_dir, exist_ok=True)

    try:
        hls_url = resolve_stream_url(session.url, session.resolution, session.start_offset_minutes)
        print(f"[Stream] Resolved HLS URL for {session.url} ({session.resolution})")
    except Exception as e:
        session.status = "error"
        session.error = str(e)
        print(f"[Stream] Failed to resolve stream URL: {e}")
        return

    segment_index = 0
    session.status = "recording"

    while not stop_event.is_set():
        seg_path = os.path.join(streams_dir, f"segment_{segment_index:03d}.mp4")
        duration_s = session.segment_minutes * 60

        segment = StreamSegment(
            index=segment_index,
            file_path=seg_path,
            status="recording",
            started_at=datetime.now(timezone.utc).isoformat(),
        )
        session.segments.append(segment)
        print(f"[Stream] Recording segment {segment_index} ({session.segment_minutes} min)...")

        recorded = record_segment(hls_url, seg_path, duration_s, stop_event, session.resolution)
        segment.duration_recorded = recorded

        if recorded < 15:
            segment.status = "skipped"
            print(f"[Stream] Segment {segment_index} skipped ({recorded:.0f}s too short)")
        else:
            segment.status = "ready"
            print(f"[Stream] Segment {segment_index} ready ({recorded:.0f}s) → {seg_path}")

        if stop_event.is_set():
            break

        segment_index += 1

    session.status = "stopped"
    print(f"[Stream] Session {session.session_id} stopped after {segment_index + 1} segments")


# ─── Public API ───────────────────────────────────────────────────────────────

def start_session(url: str, segment_minutes: int = 10,
                  clips_per_segment: int = 5,
                  resolution: str = "720p",
                  start_offset_minutes: int = 0) -> StreamSession:
    session_id = uuid.uuid4().hex[:8]
    session = StreamSession(
        session_id=session_id,
        url=url,
        platform=detect_platform(url),
        segment_minutes=segment_minutes,
        clips_per_segment=clips_per_segment,
        resolution=resolution,
        start_offset_minutes=start_offset_minutes,
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
