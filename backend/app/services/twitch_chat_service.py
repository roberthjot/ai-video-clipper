"""
twitch_chat_service.py — Chat velocity analyser for Twitch VODs.

Uses Twitch's own GraphQL endpoint `VideoCommentsByOffsetOrCursor` — the
same persisted query the twitch.tv chat replay player uses. To pass the
anti-bot integrity check we hit `https://gql.twitch.tv/integrity` first,
get a `Client-Integrity` JWT, and include it with every chat-page request.
Tokens last ~4 hours; we cache the (token, device_id) pair and refresh on
expiry.

Counts messages per 10-second bucket and tags emote-spam buckets (chat
going crazy = viral moment). Text is discarded during streaming so memory
stays low even for 4-hour VODs.
"""
import json
import time
import uuid
import threading
import urllib.error
import urllib.request
from collections import defaultdict


_WEB_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"
_GQL_URL = "https://gql.twitch.tv/gql"
_INTEGRITY_URL = "https://gql.twitch.tv/integrity"
_GQL_HASH = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a"

# Integrity token cache (one per process — shared across all VODs).
_integrity = {"token": None, "device_id": None, "expires_at": 0.0}
_integrity_lock = threading.Lock()


def _get_integrity() -> tuple:
    """Return (token, device_id), fetching/refreshing if expired."""
    with _integrity_lock:
        now_ms = time.time() * 1000
        if _integrity["token"] and _integrity["expires_at"] - 60_000 > now_ms:
            return _integrity["token"], _integrity["device_id"]
        device_id = uuid.uuid4().hex
        req = urllib.request.Request(
            _INTEGRITY_URL, data=b"",
            headers={
                "Client-Id": _WEB_CLIENT_ID,
                "X-Device-Id": device_id,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode("utf-8"))
        _integrity["token"] = data["token"]
        _integrity["device_id"] = device_id
        _integrity["expires_at"] = float(data.get("expiration", 0))
        return _integrity["token"], device_id

# In-memory cache so re-opening the modal for the same VOD is instant.
_velocity_cache: dict = {}
_velocity_jobs: dict = {}    # video_id -> {"status", "progress", "result", "error"}
_velocity_lock = threading.Lock()


def _is_emote_spam(fragments: list) -> bool:
    """True if >70% of the message text comes from emote fragments."""
    if not fragments:
        return False
    total_chars = 0
    emote_chars = 0
    for f in fragments:
        txt = f.get("text") or ""
        total_chars += len(txt)
        if f.get("emote"):
            emote_chars += len(txt)
    if total_chars == 0:
        return False
    return (emote_chars / total_chars) > 0.7


def _fetch_page_once(video_id: str, content_offset: int) -> dict:
    """Single attempt — no retry. Used internally by _fetch_page()."""
    token, device_id = _get_integrity()
    payload = [{
        "operationName": "VideoCommentsByOffsetOrCursor",
        "variables": {"videoID": str(video_id), "contentOffsetSeconds": int(content_offset)},
        "extensions": {"persistedQuery": {"version": 1, "sha256Hash": _GQL_HASH}},
    }]
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        _GQL_URL, data=body,
        headers={
            "Content-Type": "application/json",
            "Client-Id": _WEB_CLIENT_ID,
            "X-Device-Id": device_id,
            "Client-Integrity": token,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        resp = json.loads(r.read().decode("utf-8"))
    return resp[0] if isinstance(resp, list) else resp


# "service error" / "failed integrity check" / rate limits are transient.
# Retry with exponential backoff before giving up.
_TRANSIENT_ERRORS = ("service error", "failed integrity", "internal server", "timeout")


def _fetch_page(video_id: str, content_offset: int = 0) -> dict:
    """Fetch one chat page with retry/backoff on transient Twitch errors.

    Twitch occasionally returns `{"errors": [{"message": "service error"}]}`
    even when the API is healthy — usually rate-limiting or a flaky edge node.
    Refreshes the integrity token on the 2nd attempt in case that's the cause.
    """
    delay = 1.0
    last_err = None
    for attempt in range(5):
        try:
            resp = _fetch_page_once(video_id, content_offset)
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code in (401, 403, 429, 500, 502, 503, 504):
                # Force-refresh integrity on auth errors, otherwise just backoff
                if e.code in (401, 403):
                    with _integrity_lock:
                        _integrity["expires_at"] = 0
                time.sleep(delay); delay *= 2
                continue
            raise
        except Exception as e:
            last_err = e
            time.sleep(delay); delay *= 2
            continue

        errs = resp.get("errors") or []
        if errs:
            msg = ((errs[0] or {}).get("message") or "").lower()
            if any(t in msg for t in _TRANSIENT_ERRORS):
                # Try refreshing integrity in case Twitch tied the failure to
                # the current token, then back off and retry.
                if "integrity" in msg or attempt >= 1:
                    with _integrity_lock:
                        _integrity["expires_at"] = 0
                last_err = RuntimeError(msg)
                time.sleep(delay); delay *= 2
                continue
            # Non-transient — surface immediately
            raise RuntimeError(f"Twitch GraphQL chat error: {(errs[0] or {}).get('message','?')}")

        return resp

    # All retries exhausted
    raise RuntimeError(f"Twitch GraphQL chat error: {last_err}")


def _crawl(video_id: str, bucket_seconds: int, job: dict) -> dict:
    """Walk the chat replay by stepping `contentOffsetSeconds` forward.
    Each page returns ~50-100 messages spanning a few seconds of stream time.
    """
    counts = defaultdict(lambda: {"count": 0, "emote_count": 0})
    total = 0
    max_offset = 0
    next_offset = 0
    pages = 0
    MAX_PAGES = 10_000      # safety cap; ~500k messages = 5h chat at 30 msg/s
    stuck_count = 0          # detect when the offset stops advancing

    while pages < MAX_PAGES:
        # Small inter-request delay so we don't hammer the API and trigger
        # Twitch's rate-limit / "service error" responses. 80ms gives ~12 req/s
        # which sustains for thousands of pages in testing.
        if pages > 0:
            time.sleep(0.08)
        try:
            resp = _fetch_page(video_id, content_offset=next_offset)
        except RuntimeError as e:
            raise RuntimeError(f"Twitch GraphQL chat error: {e}")

        video = (resp.get("data") or {}).get("video")
        if not video:
            raise RuntimeError("VOD not found or chat replay not available")
        edges = ((video.get("comments") or {}).get("edges")) or []

        if not edges:
            break

        page_max_offset = next_offset
        for edge in edges:
            node = edge.get("node") or {}
            try:
                offset = int(node.get("contentOffsetSeconds", 0))
            except Exception:
                continue
            bucket = (offset // bucket_seconds) * bucket_seconds
            counts[bucket]["count"] += 1
            fragments = ((node.get("message") or {}).get("fragments")) or []
            if _is_emote_spam(fragments):
                counts[bucket]["emote_count"] += 1
            if offset > max_offset:
                max_offset = offset
            if offset > page_max_offset:
                page_max_offset = offset
            total += 1

        pages += 1
        job["progress"] = min(95, int(pages * 100 / 800))   # 800 pages ~= 80k msgs
        job["total_messages"] = total

        # Advance: jump to 1s past the last message in this page. If the
        # offset doesn't advance for 2 pages in a row we're at the end.
        new_offset = page_max_offset + 1
        if new_offset <= next_offset:
            stuck_count += 1
            if stuck_count >= 2:
                break
            new_offset = next_offset + 1
        else:
            stuck_count = 0
        next_offset = new_offset

    buckets = sorted(
        ({"time": t, "count": v["count"], "emote_count": v["emote_count"]}
         for t, v in counts.items()),
        key=lambda b: b["time"],
    )
    return {
        "video_id": video_id,
        "bucket_seconds": bucket_seconds,
        "duration_seconds": max_offset,
        "total_messages": total,
        "page_count": pages,
        "buckets": buckets,
    }


def _job_worker(video_id: str, bucket_seconds: int):
    job = _velocity_jobs[video_id]
    try:
        result = _crawl(video_id, bucket_seconds, job)
        with _velocity_lock:
            _velocity_cache[video_id] = result
            job["result"] = result
            job["progress"] = 100
            job["status"] = "ready"
    except Exception as e:
        with _velocity_lock:
            job["status"] = "error"
            job["error"] = str(e)


def start_velocity_job(video_id: str, bucket_seconds: int = 10) -> dict:
    """Kick off (or reuse) a background chat-velocity job for the VOD.
    Returns the current job dict — call get_velocity_job() to poll."""
    if not video_id:
        raise ValueError("video_id required")
    with _velocity_lock:
        if video_id in _velocity_cache:
            return {"status": "ready", "progress": 100, "result": _velocity_cache[video_id]}
        if video_id in _velocity_jobs and _velocity_jobs[video_id]["status"] in ("running", "ready"):
            return _velocity_jobs[video_id]
        _velocity_jobs[video_id] = {
            "status": "running", "progress": 0,
            "total_messages": 0, "result": None, "error": "",
        }
    t = threading.Thread(target=_job_worker, args=(video_id, bucket_seconds), daemon=True)
    t.start()
    return _velocity_jobs[video_id]


def get_velocity_job(video_id: str) -> dict | None:
    with _velocity_lock:
        if video_id in _velocity_cache:
            return {"status": "ready", "progress": 100, "result": _velocity_cache[video_id]}
        return _velocity_jobs.get(video_id)


def get_top_peaks(velocity: dict, top_n: int = 5, gap_seconds: int = 60) -> list[dict]:
    """Return the top N highest-count buckets, deduped by `gap_seconds` (so two
    peaks within 60s of each other don't both show — we keep the bigger one)."""
    buckets = (velocity or {}).get("buckets", [])
    sorted_buckets = sorted(buckets, key=lambda b: b["count"], reverse=True)
    picked = []
    used = []
    for b in sorted_buckets:
        if len(picked) >= top_n:
            break
        if any(abs(b["time"] - t) < gap_seconds for t in used):
            continue
        cnt = b["count"]
        em = b["emote_count"]
        picked.append({
            "time": b["time"],
            "count": cnt,
            "emote_count": em,
            "emote_pct": int((em / max(1, cnt)) * 100),
        })
        used.append(b["time"])
    return picked
