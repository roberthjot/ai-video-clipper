"""
live_clips_service.py — "Pescar clips en vivo" sessions.

For an ongoing stream, polls the platform's clips API every ~60s and
accumulates every NEW clip (deduped by id) into a session. The user opens
the Pescar tab → sees the list grow → multi-selects → batch-processes via
the existing kick/twitch project flows.

Sessions are in-memory (consistent with the rest of the project's
data layer — wipes on backend restart, by design).

Polling delay caveat: both Twitch and Kick process clips for 1-5 min before
they appear in their APIs. So "live" really means "5 min behind live".
This is a platform limitation, not a bug.
"""
import threading
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from . import twitch_service, kick_service


# ─── In-memory session store ──────────────────────────────────────────────────

# session_id → dict of session state. See _new_session() for the shape.
_sessions: dict[str, dict] = {}
_sessions_lock = threading.Lock()


# ─── Polling cadence + backoff ───────────────────────────────────────────────

# Normal poll every 60s. On a 429/Cloudflare hit, back off: 90s → 120s → 180s.
# Resets to 60s after a successful poll.
_BASE_INTERVAL_S = 60.0
_BACKOFF_LADDER = [90.0, 120.0, 180.0]


def _new_session(platform: str, channel: str) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "session_id": uuid.uuid4().hex[:8],
        "platform": platform,
        "channel": channel,
        "status": "starting",       # starting | running | stopped | error
        "error": "",
        "started_at": now.isoformat(),
        "last_poll_at": "",
        "next_poll_in_s": _BASE_INTERVAL_S,
        "polls_done": 0,
        "found_clips": [],          # list of clip dicts in arrival order
        "seen_ids": set(),          # dedup set
        "_stop_event": threading.Event(),
        "_thread": None,
        "_backoff_idx": -1,         # -1 = no backoff, 0..N = ladder index
        # Live-stream anchor: populated at start_session if channel is live.
        # If populated, _do_one_poll uses stream_started_at as baseline so
        # the first poll catches the entire ongoing stream. If not, we fall
        # back to session.started_at (forward-only behavior).
        "is_live": False,
        "stream_id": "",
        "stream_started_at": "",
        "stream_title": "",
        "stream_viewer_count": 0,
    }


def list_sessions() -> list[dict]:
    """Return a JSON-safe summary of all live sessions (for debugging /
    a future overview UI)."""
    with _sessions_lock:
        out = []
        for s in _sessions.values():
            out.append({
                "session_id": s["session_id"],
                "platform": s["platform"],
                "channel": s["channel"],
                "status": s["status"],
                "started_at": s["started_at"],
                "polls_done": s["polls_done"],
                "clip_count": len(s["found_clips"]),
            })
        return out


def get_session_public(session_id: str) -> Optional[dict]:
    """JSON-serializable snapshot of a session for the frontend status poll."""
    with _sessions_lock:
        s = _sessions.get(session_id)
        if not s:
            return None
        # Don't ship the internals (Event, Thread, set). seen_ids excluded
        # because the frontend doesn't need it — found_clips is the truth.
        return {
            "session_id": s["session_id"],
            "platform": s["platform"],
            "channel": s["channel"],
            "status": s["status"],
            "error": s["error"],
            "started_at": s["started_at"],
            "last_poll_at": s["last_poll_at"],
            "next_poll_in_s": s["next_poll_in_s"],
            "polls_done": s["polls_done"],
            "found_clips": list(s["found_clips"]),    # snapshot
            # Live-stream anchor (populated if channel was live at start):
            "is_live": s.get("is_live", False),
            "stream_id": s.get("stream_id", ""),
            "stream_started_at": s.get("stream_started_at", ""),
            "stream_title": s.get("stream_title", ""),
            "stream_viewer_count": s.get("stream_viewer_count", 0),
        }


# ─── Polling loop (one per session, lives in its own thread) ─────────────────

def _parse_iso(s: str) -> Optional[datetime]:
    """Tolerant ISO 8601 → UTC-aware datetime. Returns None on failure."""
    if not s:
        return None
    try:
        s2 = s.replace(" ", "T").replace("Z", "+00:00")
        dt = datetime.fromisoformat(s2)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _do_one_poll(session: dict) -> None:
    """Fetch clips for the session's channel created since the baseline (with
    a small overlap to be safe), dedupe against seen_ids, append the new
    ones.

    Baseline = stream.started_at if the channel was live at session start
    (so the first poll catches the entire ongoing broadcast), else
    session.started_at (forward-only)."""
    platform = session["platform"]
    channel = session["channel"]
    # Anchor: prefer stream start when known, else session start.
    base_dt = _parse_iso(session.get("stream_started_at")) \
        or _parse_iso(session.get("started_at")) \
        or datetime.now(timezone.utc)
    # Pull a small overlap window — backends can be slightly slow updating
    # created_at, and we don't want to miss a clip that lands right on the
    # boundary. Worst case it gets deduped.
    since_dt = base_dt - timedelta(seconds=30)

    if platform == "twitch":
        clips = twitch_service.get_recent_clips_for_channel(channel, since_dt)
    elif platform == "kick":
        clips = kick_service.get_recent_clips_for_channel(channel, since_dt)
    else:
        raise RuntimeError(f"Unknown platform: {platform}")

    # If we anchored to a specific Kick livestream_id, drop clips from
    # OTHER broadcasts that may share the time window (rare, but cheap to
    # guard against). Twitch doesn't expose a comparable per-stream id on
    # the clip — we rely on time filtering alone there.
    stream_id = (session.get("stream_id") or "").strip()
    if platform == "kick" and stream_id:
        before = len(clips)
        clips = [
            c for c in clips
            if not c.get("livestream_id")
            or str(c.get("livestream_id")) == stream_id
        ]
        if before != len(clips):
            print(f"[LiveClips] session={session['session_id']} kick "
                  f"livestream_id filter dropped {before - len(clips)} clips")

    # Dedupe + accumulate.
    with _sessions_lock:
        new_count = 0
        for c in clips:
            cid = c.get("id")
            if not cid or cid in session["seen_ids"]:
                continue
            session["seen_ids"].add(cid)
            # Stamp when WE saw it for the first time so the frontend can
            # sort by "newest pescado" instead of platform's created_at.
            c = {**c, "discovered_at": datetime.now(timezone.utc).isoformat()}
            session["found_clips"].append(c)
            new_count += 1
        session["polls_done"] += 1
        session["last_poll_at"] = datetime.now(timezone.utc).isoformat()
    print(f"[LiveClips] session={session['session_id']} platform={platform} "
          f"channel={channel} poll#{session['polls_done']} +{new_count} new "
          f"(total {len(session['found_clips'])}) anchored={'stream' if session.get('stream_started_at') else 'session'}")


def _poll_loop(session_id: str) -> None:
    """Background thread: poll, sleep, repeat until stop is requested."""
    with _sessions_lock:
        s = _sessions.get(session_id)
    if not s:
        return
    s["status"] = "running"

    while not s["_stop_event"].is_set():
        try:
            _do_one_poll(s)
            # Reset backoff on success.
            s["_backoff_idx"] = -1
            s["next_poll_in_s"] = _BASE_INTERVAL_S
        except Exception as e:
            msg = str(e)
            print(f"[LiveClips] session={session_id} poll failed: {msg}")
            # Cloudflare / rate-limit / transient — backoff but don't kill
            # the session; user can stop manually if it keeps failing.
            s["_backoff_idx"] = min(s["_backoff_idx"] + 1, len(_BACKOFF_LADDER) - 1)
            s["next_poll_in_s"] = _BACKOFF_LADDER[s["_backoff_idx"]]
            s["error"] = msg[:200]
        # Sleep in 1-second slices so stop is responsive.
        slept = 0.0
        target = s["next_poll_in_s"]
        while slept < target and not s["_stop_event"].is_set():
            time.sleep(1)
            slept += 1
    s["status"] = "stopped"
    print(f"[LiveClips] session={session_id} stopped (total clips: {len(s['found_clips'])})")


# ─── Public API ──────────────────────────────────────────────────────────────

def _normalize_channel(platform: str, raw: str) -> str:
    """Accept anything the user pastes — URL, slug, with/without protocol,
    with/without trailing path — and return just the channel login/slug.
    Raises RuntimeError if it can't be coerced into a valid channel name."""
    s = (raw or "").strip()
    if not s:
        raise RuntimeError("channel name required")
    # Drop protocol + host prefixes.
    for prefix in ("https://", "http://", "www."):
        if s.lower().startswith(prefix):
            s = s[len(prefix):]
    for host in ("twitch.tv/", "kick.com/", "m.twitch.tv/", "m.kick.com/"):
        if s.lower().startswith(host):
            s = s[len(host):]
    # If the user pasted a VOD/clip URL, reject explicitly so they get a
    # better hint than "Bad Identifiers".
    if s.lower().startswith(("videos/", "video/", "clip/", "clips/")):
        raise RuntimeError(
            "Pegá el nombre del canal (ej. 'adinross'), no una URL de VOD/clip"
        )
    # Stop at first /, ?, # so trailing paths/queries get dropped.
    for sep in ("/", "?", "#"):
        i = s.find(sep)
        if i >= 0:
            s = s[:i]
    s = s.strip().lower()
    if not s:
        raise RuntimeError("channel name required")
    # Sanity: Twitch logins are 4-25 chars, alnum + underscore. Kick is
    # similar (lowercased, alnum + underscore + dash). We lean lenient.
    import re
    if not re.fullmatch(r"[a-z0-9_\-]{1,40}", s):
        raise RuntimeError(f"channel name has invalid characters: {raw!r}")
    return s


def _detect_live_stream(platform: str, channel: str) -> Optional[dict]:
    """Best-effort: ask the platform if `channel` is broadcasting right now.
    Returns the platform's stream summary dict (id, started_at, title, ...)
    or None on offline / API failure. Failures are swallowed: we don't want
    a Helix/Kick hiccup to block session start — the pescador can still
    work forward-only."""
    try:
        if platform == "twitch":
            return twitch_service.get_current_live_stream(channel)
        if platform == "kick":
            return kick_service.get_current_live_stream(channel)
    except Exception as e:
        print(f"[LiveClips] live-stream detection failed for {platform}:{channel}: {e}")
    return None


def start_session(platform: str, channel: str) -> dict:
    """Spin up a polling thread. Returns the public session snapshot."""
    platform = (platform or "").lower().strip()
    if platform not in ("twitch", "kick"):
        raise RuntimeError("platform must be 'twitch' or 'kick'")
    channel = _normalize_channel(platform, channel)

    s = _new_session(platform, channel)

    # Anchor to the current live broadcast if any — so the first poll
    # catches clips already made earlier in this same stream.
    live = _detect_live_stream(platform, channel)
    if live:
        s["is_live"] = True
        s["stream_id"] = str(live.get("id") or "")
        s["stream_started_at"] = live.get("started_at") or ""
        s["stream_title"] = live.get("title") or ""
        s["stream_viewer_count"] = int(live.get("viewer_count") or 0)
        print(f"[LiveClips] {platform}:{channel} is LIVE — anchoring to "
              f"stream {s['stream_id']} started {s['stream_started_at']}")
    else:
        print(f"[LiveClips] {platform}:{channel} offline or undetectable — "
              f"forward-only from session start")

    with _sessions_lock:
        _sessions[s["session_id"]] = s

    t = threading.Thread(target=_poll_loop, args=(s["session_id"],), daemon=True)
    s["_thread"] = t
    t.start()
    print(f"[LiveClips] started session={s['session_id']} platform={platform} channel={channel}")
    return get_session_public(s["session_id"])


def stop_session(session_id: str) -> Optional[dict]:
    with _sessions_lock:
        s = _sessions.get(session_id)
    if not s:
        return None
    s["_stop_event"].set()
    # Don't join the thread — let it finish on its own (next poll cycle).
    # The user gets immediate response.
    return get_session_public(session_id)


def clear_clips(session_id: str) -> Optional[dict]:
    """Empty the found_clips list (but keep the session running). Useful
    after the user batch-processes some clips and wants a clean list to
    keep pescando."""
    with _sessions_lock:
        s = _sessions.get(session_id)
        if not s:
            return None
        s["found_clips"] = []
        # Note: we do NOT clear seen_ids, so we don't re-pick the same
        # clips that came in before the clear.
    return get_session_public(session_id)
