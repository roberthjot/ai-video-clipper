"""
stream_service.py — Live stream clipping service.

Flow per session:
  1. streamlink resolves the HLS URL from Twitch/Kick
  2. FFmpeg records a segment of N minutes to disk
  3. segment is sent to Gemini for analysis (reuses gemini_service)
  4. clips are stored in the session; frontend polls for updates
  5. while Gemini analyzes segment N, FFmpeg records segment N+1
"""

import os
import uuid
import threading
import subprocess
import time
from datetime import datetime

import streamlink as sl

from ..config import settings
from ..models.clip import StreamSession, StreamSegment
from . import gemini_service
from .export_service import FFMPEG_EXE

# ─── In-memory session store ──────────────────────────────────────────────────
_sessions: dict[str, StreamSession] = {}
_stop_flags: dict[str, threading.Event] = {}   # session_id → stop event


def get_session(session_id: str) -> StreamSession | None:
    return _sessions.get(session_id)


def list_sessions() -> list[StreamSession]:
    return list(_sessions.values())


# ─── Platform detection ───────────────────────────────────────────────────────

def detect_platform(url: str) -> str:
    url = url.lower()
    if "twitch.tv" in url:
        return "twitch"
    if "kick.com" in url:
        return "kick"
    return "other"


# ─── Resolve HLS stream URL via streamlink ────────────────────────────────────

def resolve_stream_url(url: str, quality: str = "720p") -> str:
    """Use streamlink to get the direct HLS URL for recording."""
    session = sl.Streamlink()
    streams = session.streams(url)
    if not streams:
        raise ValueError(f"No streams found for URL: {url}")

    # Try requested quality, fall back through common options
    for q in [quality, "720p60", "720p", "480p", "best"]:
        if q in streams:
            stream = streams[q]
            # Get the underlying URL from the HLS stream
            if hasattr(stream, 'url'):
                return stream.url
            # For HLS streams, open and get URL
            fd = stream.open()
            fd.close()
            return stream.url

    raise ValueError(f"Quality '{quality}' not available. Available: {list(streams.keys())}")


# ─── Record one segment with FFmpeg ──────────────────────────────────────────

def record_segment(hls_url: str, output_path: str, duration_seconds: int,
                   stop_event: threading.Event) -> float:
    """
    Record `duration_seconds` of a live stream to output_path using FFmpeg.
    Returns actual recorded duration in seconds.
    """
    cmd = [
        FFMPEG_EXE,
        "-i", hls_url,
        "-t", str(duration_seconds),
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "28",          # slightly lower quality to keep file size under Gemini limit
        "-vf", "scale=1280:720",   # force 720p to stay well under Gemini 2GB limit
        "-c:a", "aac",
        "-y",
        "-loglevel", "warning",
        output_path,
    ]

    proc = subprocess.Popen(cmd)

    # Poll process while checking stop flag
    start = time.time()
    while proc.poll() is None:
        if stop_event.is_set():
            proc.terminate()
            proc.wait()
            break
        time.sleep(1)

    elapsed = time.time() - start
    return elapsed


# ─── Analyze one segment with Gemini ─────────────────────────────────────────

def analyze_segment(segment: StreamSegment, clips_per_segment: int,
                    session_id: str) -> None:
    """Upload segment to Gemini and extract clips. Mutates segment in place."""
    try:
        segment.status = "analyzing"

        # Create a project_id for this segment
        project_id = f"stream_{session_id}_seg{segment.index:03d}"
        segment.project_id = project_id

        # Reuse gemini_service — same pipeline as normal video upload
        file_obj = gemini_service.upload_video(segment.file_path)
        file_obj = gemini_service.wait_for_processing(file_obj)

        clips = gemini_service.analyze_video(
            file_obj=file_obj,
            clip_count=clips_per_segment,
            min_duration=15,
            video_duration=segment.duration_recorded,
            custom_prompt="",
        )

        # Clean up Gemini file
        try:
            gemini_service.client.files.delete(name=file_obj.name)
        except Exception:
            pass

        # Store clips as dicts for JSON serialisation
        segment.clips = [c.model_dump() for c in clips]
        segment.status = "done"
        print(f"[Stream] Segment {segment.index}: {len(clips)} clips found")

    except Exception as e:
        segment.status = "failed"
        segment.error = str(e)
        print(f"[Stream] Segment {segment.index} analysis FAILED: {e}")


# ─── Main recording loop ──────────────────────────────────────────────────────

def _recording_loop(session: StreamSession, stop_event: threading.Event) -> None:
    """Background thread: record segments and analyze them."""
    streams_dir = os.path.join(settings.PROJECTS_DIR, f"stream_{session.session_id}")
    os.makedirs(streams_dir, exist_ok=True)

    try:
        hls_url = resolve_stream_url(session.url)
        print(f"[Stream] Resolved HLS URL for {session.url}")
    except Exception as e:
        session.status = "error"
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
        )
        session.segments.append(segment)
        print(f"[Stream] Recording segment {segment_index} ({session.segment_minutes} min)...")

        recorded = record_segment(hls_url, seg_path, duration_s, stop_event)
        segment.duration_recorded = recorded

        if stop_event.is_set():
            # Don't analyze incomplete final segment if less than 30s was recorded
            if recorded < 30:
                segment.status = "skipped"
                print(f"[Stream] Segment {segment_index} skipped (only {recorded:.0f}s recorded)")
            else:
                segment.status = "pending_analysis"
                analyze_segment(segment, session.clips_per_segment, session.session_id)
            break

        # Analyze in a separate thread so recording can continue immediately
        analysis_thread = threading.Thread(
            target=analyze_segment,
            args=(segment, session.clips_per_segment, session.session_id),
            daemon=True,
        )
        analysis_thread.start()

        segment_index += 1

    session.status = "stopped"
    print(f"[Stream] Session {session.session_id} stopped after {segment_index + 1} segments")


# ─── Public API ───────────────────────────────────────────────────────────────

def start_session(url: str, segment_minutes: int = 10,
                  clips_per_segment: int = 5) -> StreamSession:
    session_id = uuid.uuid4().hex[:8]
    session = StreamSession(
        session_id=session_id,
        url=url,
        platform=detect_platform(url),
        segment_minutes=segment_minutes,
        clips_per_segment=clips_per_segment,
        status="starting",
        created_at=datetime.now().isoformat(),
    )
    _sessions[session_id] = session

    stop_event = threading.Event()
    _stop_flags[session_id] = stop_event

    thread = threading.Thread(
        target=_recording_loop,
        args=(session, stop_event),
        daemon=True,
    )
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
