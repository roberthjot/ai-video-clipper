"""Auto-reframe / face-tracking service.

Extracts time-stamped face bounding boxes from a video using MediaPipe's
BlazeFace short-range detector, assigns persistent IDs across frames via
greedy IoU matching, and produces a smoothed crop trajectory the FFmpeg
pipeline can drive via `sendcmd`.

The expensive part is the per-frame detection (CPU bound); we sample at
~5 FPS by default (every Nth source frame). The shorter the clip, the more
useful the per-frame detail — for >5 min clips this stays well under 1
minute of analysis on a modest CPU.

Coordinate system: bounding boxes are in SOURCE-pixel coordinates relative
to the full frame at native resolution. The export pipeline scales them as
needed for the active aspect-ratio canvas.
"""
from __future__ import annotations

import math
import os
import threading
import urllib.request
from typing import Optional

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

# ── Model file management ────────────────────────────────────────────────────
# We use BlazeFace short-range (faces up to ~2m, typical podcast distance).
# The float16 weights are ~225 KB — downloaded once and cached next to the
# service module so reinstalls don't redownload.
_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
)
_MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_blaze_face.tflite")
_detector_lock = threading.Lock()
_detector: Optional[vision.FaceDetector] = None


def _ensure_model() -> str:
    """Download the BlazeFace weights on first use (~225 KB)."""
    if not os.path.exists(_MODEL_PATH):
        print(f"[face_track] downloading BlazeFace model to {_MODEL_PATH}")
        urllib.request.urlretrieve(_MODEL_URL, _MODEL_PATH)
        print(f"[face_track] model saved ({os.path.getsize(_MODEL_PATH)} bytes)")
    return _MODEL_PATH


def _get_detector() -> vision.FaceDetector:
    """Lazy-init a process-wide detector. Reusing one detector across analyses
    avoids the ~150ms startup per call."""
    global _detector
    if _detector is None:
        with _detector_lock:
            if _detector is None:
                model_path = _ensure_model()
                opts = vision.FaceDetectorOptions(
                    base_options=mp_tasks.BaseOptions(model_asset_path=model_path),
                    running_mode=vision.RunningMode.IMAGE,
                    min_detection_confidence=0.35,
                )
                _detector = vision.FaceDetector.create_from_options(opts)
                print("[face_track] detector initialized")
    return _detector


_detector_quad: Optional[vision.FaceDetector] = None


def _get_detector_quad() -> vision.FaceDetector:
    """Lazy-init a sensitive detector for small faces in wide shots (confidence 0.28)."""
    global _detector_quad
    if _detector_quad is None:
        with _detector_lock:
            if _detector_quad is None:
                model_path = _ensure_model()
                opts = vision.FaceDetectorOptions(
                    base_options=mp_tasks.BaseOptions(model_asset_path=model_path),
                    running_mode=vision.RunningMode.IMAGE,
                    min_detection_confidence=0.28,
                )
                _detector_quad = vision.FaceDetector.create_from_options(opts)
    return _detector_quad


# ── Detection over a video range ─────────────────────────────────────────────
def _iou(a: dict, b: dict) -> float:
    """Intersection-over-union of two bboxes given as {x, y, w, h}."""
    ax2, ay2 = a["x"] + a["w"], a["y"] + a["h"]
    bx2, by2 = b["x"] + b["w"], b["y"] + b["h"]
    ix1, iy1 = max(a["x"], b["x"]), max(a["y"], b["y"])
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / max(1, union)


def analyze_clip(
    video_path: str,
    start_time: float = 0.0,
    end_time: Optional[float] = None,
    sample_fps: float = 5.0,
    progress_callback=None,
) -> dict:
    """Detect faces over [start_time, end_time] at sample_fps. Returns:
        {
          "fps": <video_fps>,
          "width": <native_width>,
          "height": <native_height>,
          "start_time": <s>,
          "end_time": <s>,
          "samples": [{"t": <s>, "faces": [{"id": int, "x", "y", "w", "h", "confidence"}]}, ...],
          "people":  [{"id": int, "thumb_t": <s>, "thumb_box": {x,y,w,h}, "appearance_count": int}, ...],
        }

    Face IDs are assigned via greedy IoU matching: at each sample, every new
    face is matched to its most-overlapping face from the previous sample
    (threshold 0.25). Unmatched faces get a fresh ID — these become the
    "people" list the UI uses for the manual-pick grid.

    progress_callback(done, total) is called periodically so the HTTP layer
    can report progress to the frontend.
    """
    detector = _get_detector()

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration_s = total_frames / fps if fps else 0
    if end_time is None or end_time <= 0 or end_time > duration_s:
        end_time = duration_s

    # Frame stride so we sample at sample_fps Hz over the source's native fps.
    stride = max(1, int(round(fps / max(0.5, sample_fps))))
    start_frame = max(0, int(round(start_time * fps)))
    end_frame = min(total_frames, int(round(end_time * fps)))
    sample_frames = list(range(start_frame, end_frame, stride))

    samples: list[dict] = []
    next_id = 0
    # Persistent state: the previous sample's faces, with their IDs, used to
    # assign IDs to the next sample via IoU matching.
    prev_faces: list[dict] = []
    people: dict[int, dict] = {}   # id -> {first_t, thumb_t, thumb_box, appearance_count}

    total = len(sample_frames)
    last_pct = -1
    print(f"[face_track] analyzing {os.path.basename(video_path)}: "
          f"{total} samples over {end_time - start_time:.1f}s at {sample_fps:.1f} FPS")

    for i, fn in enumerate(sample_frames):
        cap.set(cv2.CAP_PROP_POS_FRAMES, fn)
        ok, frame = cap.read()
        if not ok:
            continue
        t = fn / fps
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        try:
            result = detector.detect(mp_img)
        except Exception as e:
            print(f"[face_track] detect failed at t={t:.2f}s: {e}")
            continue

        # Convert raw detections into our bbox dict (clamped to frame bounds).
        raw_faces = []
        for det in result.detections:
            bb = det.bounding_box
            x = max(0, int(bb.origin_x))
            y = max(0, int(bb.origin_y))
            w = min(width - x, int(bb.width))
            h = min(height - y, int(bb.height))
            if w < 20 or h < 20:        # filter tiny / spurious detections
                continue
            conf = float(det.categories[0].score) if det.categories else 0.0
            raw_faces.append({"x": x, "y": y, "w": w, "h": h, "confidence": round(conf, 3)})

        # Multi-scale check for wide two-shots (e.g. podcast wide angles):
        # BlazeFace on 1080p frame resizes to 128x128, losing small distant faces.
        # Checking left and right upper quadrants recovers subjects sitting in their chairs.
        if len(raw_faces) <= 1:
            quads = [
                (0, int(height * 0.72), 0, int(width * 0.55)),      # Left chair (guest)
                (0, int(height * 0.72), int(width * 0.45), width),  # Right chair (host)
            ]
            det_q = _get_detector_quad()
            for y0, y1, x0, x1 in quads:
                sub = frame[y0:y1, x0:x1]
                sub_rgb = cv2.cvtColor(sub, cv2.COLOR_BGR2RGB)
                sub_mp = mp.Image(image_format=mp.ImageFormat.SRGB, data=sub_rgb)
                try:
                    res_sub = det_q.detect(sub_mp)
                except Exception:
                    continue
                for det in res_sub.detections:
                    conf = float(det.categories[0].score) if det.categories else 0.0
                    bb = det.bounding_box
                    fx = max(0, int(bb.origin_x + x0))
                    fy = max(0, int(bb.origin_y + y0))
                    fw = min(width - fx, int(bb.width))
                    fh = min(height - fy, int(bb.height))
                    if fw < 20 or fh < 20:
                        continue
                    fcx, fcy = fx + fw / 2.0, fy + fh / 2.0
                    if not any(math.hypot(fcx - (rf["x"] + rf["w"] / 2.0), fcy - (rf["y"] + rf["h"] / 2.0)) < 150 for rf in raw_faces):
                        raw_faces.append({"x": fx, "y": fy, "w": fw, "h": fh, "confidence": round(conf, 3)})

        # Greedy IoU matching to previous sample's faces, plus appearance histogram
        # matching across camera cuts to keep persistent person IDs.
        used_prev: set[int] = set()
        for face in raw_faces:
            best_iou, best_idx = 0.0, -1
            for j, prev in enumerate(prev_faces):
                if j in used_prev:
                    continue
                ov = _iou(face, prev)
                if ov > best_iou:
                    best_iou, best_idx = ov, j
            if best_iou >= 0.25 and best_idx >= 0:
                face["id"] = prev_faces[best_idx]["id"]
                used_prev.add(best_idx)
            else:
                # Camera cut / no IoU match: check appearance similarity via color histogram
                matched_id = None
                crop = frame[face["y"]:face["y"]+face["h"], face["x"]:face["x"]+face["w"]]
                if crop is not None and crop.size > 0 and people:
                    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
                    hist = cv2.calcHist([hsv], [0, 1], None, [16, 16], [0, 180, 0, 256])
                    cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
                    best_sim, best_pid = 0.0, None
                    for pid, pdata in people.items():
                        if pdata.get("hist") is not None:
                            sim = cv2.compareHist(hist, pdata["hist"], cv2.HISTCMP_CORREL)
                            if sim > best_sim:
                                best_sim, best_pid = sim, pid
                    if best_sim >= 0.86:
                        matched_id = best_pid

                if matched_id is not None:
                    face["id"] = matched_id
                else:
                    face["id"] = next_id
                    next_id += 1

            # Update or create the person record. We keep the most-confident
            # bbox/timestamp as the thumbnail anchor for the UI.
            p = people.get(face["id"])
            if p is None:
                crop = frame[face["y"]:face["y"]+face["h"], face["x"]:face["x"]+face["w"]]
                hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV) if (crop is not None and crop.size > 0) else None
                hist = cv2.calcHist([hsv], [0, 1], None, [16, 16], [0, 180, 0, 256]) if hsv is not None else None
                if hist is not None:
                    cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
                people[face["id"]] = {
                    "id": face["id"],
                    "first_t": round(t, 3),
                    "thumb_t": round(t, 3),
                    "thumb_box": {k: face[k] for k in ("x", "y", "w", "h")},
                    "thumb_conf": face["confidence"],
                    "appearance_count": 1,
                    "hist": hist,
                }
            else:
                p["appearance_count"] += 1
                if face["confidence"] > p["thumb_conf"]:
                    p["thumb_t"] = round(t, 3)
                    p["thumb_box"] = {k: face[k] for k in ("x", "y", "w", "h")}
                    p["thumb_conf"] = face["confidence"]

        prev_faces = raw_faces
        samples.append({
            "t": round(t, 3),
            "faces": [{"id": f["id"], "x": f["x"], "y": f["y"], "w": f["w"], "h": f["h"],
                       "confidence": f["confidence"]} for f in raw_faces],
        })

        if progress_callback is not None:
            pct = int((i + 1) / total * 100)
            if pct != last_pct:
                last_pct = pct
                try:
                    progress_callback(i + 1, total)
                except Exception:
                    pass

    cap.release()

    # Sort people by appearance_count desc so the most-prominent person is
    # index 0 in the UI grid (better default for the "Cara grande" auto pick).
    people_list = sorted(people.values(), key=lambda p: -p["appearance_count"])
    # Drop temporary fields not needed by UI or JSON
    for p in people_list:
        p.pop("thumb_conf", None)
        p.pop("hist", None)

    print(f"[face_track] done: {len(samples)} samples, {len(people_list)} unique people")
    return {
        "fps": round(fps, 3),
        "width": width,
        "height": height,
        "start_time": round(start_time, 3),
        "end_time": round(end_time, 3),
        "samples": samples,
        "people": people_list,
    }


# ── Trajectory computation (sample-aligned crop windows) ─────────────────────
def _aspect_to_ratio(aspect: str) -> float:
    """Return target aspect ratio width/height. 9:16 → 0.5625."""
    try:
        w, h = aspect.split(":")
        return float(w) / float(h)
    except Exception:
        return 9 / 16


def _faces_at_sample(sample: dict, follow_id: Optional[int]) -> list[dict]:
    """Return the faces relevant to the active mode for a single sample.
    follow_id=None means "all faces"; an int means "just that face if visible"."""
    if not sample or not sample.get("faces"):
        return []
    if follow_id is None:
        return sample["faces"]
    matched = [f for f in sample["faces"] if f.get("id") == follow_id]
    return matched   # may be empty when that person is off-camera


def _biggest_face(sample: dict) -> list[dict]:
    """Return only the largest face in this sample (by bbox area), as a 1-list."""
    if not sample or not sample.get("faces"):
        return []
    return [max(sample["faces"], key=lambda f: f["w"] * f["h"])]


def compute_crop_trajectory(
    face_track: dict,
    mode: str = "all",                  # "all" | "biggest" | "follow"
    follow_id: Optional[int] = None,
    target_aspect: str = "9:16",
    padding: float = 0.30,              # 0..1; fraction of face span added as headroom
    smoothing: float = 0.85,            # 0..0.99; EMA factor for adjacent samples
) -> list[dict]:
    """Convert a face track into a time-varying crop window.

    Returns a list of {t, cx, cy, cw, ch} entries (centers + size, source-px)
    that the FFmpeg sendcmd generator turns into per-second `crop` updates.

    Algorithm per sample:
      1. Pick relevant faces by mode (all / biggest / single-person).
      2. Compute the union bbox of those faces.
      3. Pad each side by `padding * bbox_size` (more headroom = wider crop).
      4. Expand the bbox to match target_aspect (always-include rule:
         the crop must contain the padded union, never crop it).
      5. Smooth across samples with an EMA so the camera doesn't jitter.

    When no faces are present in a sample, we hold the previous crop (so the
    camera doesn't snap back to center) and slowly drift toward a centered
    fallback if absence persists.
    """
    if not face_track or not face_track.get("samples"):
        return []

    W = int(face_track["width"])
    H = int(face_track["height"])
    target_ar = _aspect_to_ratio(target_aspect)
    fallback_cx, fallback_cy = W / 2.0, H / 2.0

    # Maximal crop that still fits source frame with target aspect (used when
    # we have no faces and want to settle on a sensible default).
    max_h = H
    max_w = max_h * target_ar
    if max_w > W:
        max_w = W
        max_h = max_w / target_ar
    fallback_cw, fallback_ch = max_w, max_h

    raw: list[dict] = []
    last_cx, last_cy, last_cw, last_ch = fallback_cx, fallback_cy, fallback_cw, fallback_ch
    miss_streak = 0

    for sample in face_track["samples"]:
        if mode in ("follow", "static", "lock"):
            faces = _faces_at_sample(sample, follow_id)
            if not faces and follow_id is not None and mode in ("static", "lock"):
                # Locked on a specific person: only use samples where THAT person is visible
                faces = []
            elif not faces and follow_id is not None:
                # In follow mode, only fall back to another face if it is genuinely close to last_cx
                # (i.e. within 250px, likely an ID flicker on the SAME person, not a cut to the other speaker)
                sf = sample.get("faces") or []
                close_faces = [f for f in sf if math.hypot((f["x"] + f["w"] / 2.0) - last_cx, (f["y"] + f["h"] / 2.0) - last_cy) < 250]
                if close_faces:
                    faces = [min(close_faces, key=lambda f: math.hypot(
                        (f["x"] + f["w"] / 2.0) - last_cx,
                        (f["y"] + f["h"] / 2.0) - last_cy,
                    ))]
                else:
                    faces = []
        elif mode == "biggest":
            faces = _biggest_face(sample)
        else:
            faces = sample.get("faces", [])

        if not faces:
            miss_streak += 1
            # Never drift toward fallback center (W/2) in podcasts/interviews.
            # Holding last valid crop preserves the human framing.
            raw.append({"t": sample["t"], "cx": last_cx, "cy": last_cy,
                        "cw": last_cw, "ch": last_ch, "miss": True})
            continue

        miss_streak = 0

        # If multiple faces are detected, check if they are too far apart to fit in a 9:16 frame.
        # If their horizontal span exceeds what a vertical crop can show, averaging them
        # will disastrously center the camera on the empty space/furniture between them.
        if len(faces) > 1:
            span_x = max(f["x"] + f["w"] for f in faces) - min(f["x"] for f in faces)
            if span_x > (H * target_ar * 1.05):
                if follow_id is not None:
                    matching = [f for f in faces if f.get("id") == follow_id]
                    faces = matching if matching else [max(faces, key=lambda f: f["w"] * f["h"])]
                elif last_cx < W * 0.45:
                    faces = [min(faces, key=lambda f: f["x"])]
                elif last_cx > W * 0.55:
                    faces = [max(faces, key=lambda f: f["x"])]
                else:
                    faces = [max(faces, key=lambda f: f["w"] * f["h"])]

        # Union bbox of selected faces.
        x1 = min(f["x"] for f in faces)
        y1 = min(f["y"] for f in faces)
        x2 = max(f["x"] + f["w"] for f in faces)
        y2 = max(f["y"] + f["h"] for f in faces)
        bw, bh = x2 - x1, y2 - y1
        # Padding (per-side fraction of the largest dimension to keep things
        # square-ish — avoids weird elongation when faces are stacked).
        pad = padding * max(bw, bh)
        x1p, y1p, x2p, y2p = x1 - pad, y1 - pad, x2 + pad, y2 + pad

        pw, ph = x2p - x1p, y2p - y1p
        # Expand to match target aspect (always GROW, never shrink — we must
        # not crop the padded union out of frame).
        cur_ar = pw / max(1, ph)
        if cur_ar < target_ar:
            # Too tall → widen
            new_w = ph * target_ar
            x_center = (x1p + x2p) / 2.0
            x1p = x_center - new_w / 2.0
            x2p = x_center + new_w / 2.0
        elif cur_ar > target_ar:
            # Too wide → tallen
            new_h = pw / target_ar
            y_center = (y1p + y2p) / 2.0
            y1p = y_center - new_h / 2.0
            y2p = y_center + new_h / 2.0

        cw = x2p - x1p
        ch = y2p - y1p
        # Clamp to source frame (slide rather than shrink — the user prefers
        # losing a bit of padding to losing the face).
        if cw > W:
            scale = W / cw
            cw, ch = cw * scale, ch * scale
        if ch > H:
            scale = H / ch
            cw, ch = cw * scale, ch * scale
        cx = (x1p + x2p) / 2.0
        cy = (y1p + y2p) / 2.0

        # Anti-Dead-Zone Rule:
        # In a horizontal 16:9 frame of a podcast/interview, the area [0.42*W, 0.58*W] is the empty space between chairs.
        # If multiple faces were detected or any face was detected on the outer chairs (x < 0.45*W or x > 0.55*W),
        # NEVER center the camera in this dead zone!
        all_s_faces = sample.get("faces", [])
        has_outer_face = any(f["x"] < 0.45 * W or (f["x"] + f["w"]) > 0.55 * W for f in all_s_faces)
        if (len(all_s_faces) > 1 or has_outer_face) and (0.42 * W < cx < 0.58 * W):
            left_f = [f for f in all_s_faces if (f["x"] + f["w"] / 2.0) < 0.48 * W]
            right_f = [f for f in all_s_faces if (f["x"] + f["w"] / 2.0) > 0.52 * W]
            if follow_id is not None and any(f.get("id") == follow_id for f in left_f):
                chosen = left_f[0]
                cx, cy = chosen["x"] + chosen["w"] / 2.0, chosen["y"] + chosen["h"] / 2.0
            elif follow_id is not None and any(f.get("id") == follow_id for f in right_f):
                chosen = right_f[0]
                cx, cy = chosen["x"] + chosen["w"] / 2.0, chosen["y"] + chosen["h"] / 2.0
            elif left_f and last_cx < 0.5 * W:
                chosen = left_f[0]
                cx, cy = chosen["x"] + chosen["w"] / 2.0, chosen["y"] + chosen["h"] / 2.0
            elif right_f and last_cx > 0.5 * W:
                chosen = right_f[0]
                cx, cy = chosen["x"] + chosen["w"] / 2.0, chosen["y"] + chosen["h"] / 2.0
            elif left_f:
                chosen = left_f[0]
                cx, cy = chosen["x"] + chosen["w"] / 2.0, chosen["y"] + chosen["h"] / 2.0
            elif right_f:
                chosen = right_f[0]
                cx, cy = chosen["x"] + chosen["w"] / 2.0, chosen["y"] + chosen["h"] / 2.0

        # Re-clamp the center so the crop doesn't poke outside the source.
        cx = max(cw / 2, min(W - cw / 2, cx))
        cy = max(ch / 2, min(H - ch / 2, cy))

        raw.append({"t": sample["t"], "cx": cx, "cy": cy, "cw": cw, "ch": ch})
        last_cx, last_cy, last_cw, last_ch = cx, cy, cw, ch

    # ── Static / Locked mode: 100% frozen camera during shots with clean cuts ──
    if mode in ("static", "lock"):
        # Shot-stable framing: partition into camera shots (cut threshold = 180px displacement).
        # Within each shot, lock coordinates to that shot's median.
        # This keeps the camera 100% frozen (no jitter/vibration) during every angle,
        # but cleanly cuts to the person's location when the camera switches angles.
        shots: list[list[dict]] = []
        cur_shot: list[dict] = []
        for r in raw:
            if not cur_shot:
                cur_shot.append(r)
            else:
                if abs(r["cx"] - cur_shot[-1]["cx"]) > 180 or abs(r["cy"] - cur_shot[-1]["cy"]) > 180:
                    shots.append(cur_shot)
                    cur_shot = [r]
                else:
                    cur_shot.append(r)
        if cur_shot:
            shots.append(cur_shot)

        out_static: list[dict] = []
        for shot in shots:
            valid = [s for s in shot if not s.get("miss")]
            src = valid if valid else shot
            med_cx = sorted(s["cx"] for s in src)[len(src) // 2]
            med_cy = sorted(s["cy"] for s in src)[len(src) // 2]
            med_cw = sorted(s["cw"] for s in src)[len(src) // 2]
            med_ch = sorted(s["ch"] for s in src)[len(src) // 2]
            for s in shot:
                out_static.append({
                    "t": s["t"],
                    "cx": int(round(med_cx)),
                    "cy": int(round(med_cy)),
                    "cw": max(2, int(round(med_cw))),
                    "ch": max(2, int(round(med_ch))),
                    "miss": False,
                })
        return out_static

    # ── Temporal smoothing (EMA) for follow / dynamic mode ──────────────────
    a = max(0.0, min(0.99, smoothing))
    smoothed: list[dict] = []
    for i, r in enumerate(raw):
        if i == 0:
            smoothed.append(dict(r))
            continue
        prev = smoothed[-1]
        # Camera cut snap: if displacement >= 180px, SNAP immediately! No panning through empty space.
        if abs(r["cx"] - prev["cx"]) >= 180 or abs(r["cy"] - prev["cy"]) >= 180:
            smoothed.append(dict(r))
            continue
        # Deadzone: if displacement < 30px, hold previous position to eliminate micro-vibrations
        if abs(r["cx"] - prev["cx"]) < 30 and abs(r["cy"] - prev["cy"]) < 30:
            smoothed.append({
                "t": r["t"],
                "cx": prev["cx"],
                "cy": prev["cy"],
                "cw": prev["cw"],
                "ch": prev["ch"],
                "miss": r.get("miss", False),
            })
            continue
        smoothed.append({
            "t":  r["t"],
            "cx": prev["cx"] * a + r["cx"] * (1 - a),
            "cy": prev["cy"] * a + r["cy"] * (1 - a),
            "cw": prev["cw"] * a + r["cw"] * (1 - a),
            "ch": prev["ch"] * a + r["ch"] * (1 - a),
            "miss": r.get("miss", False),
        })

    # Round to ints — FFmpeg sendcmd wants integer crop coords anyway.
    for s in smoothed:
        s["cx"] = int(round(s["cx"]))
        s["cy"] = int(round(s["cy"]))
        s["cw"] = max(2, int(round(s["cw"])))
        s["ch"] = max(2, int(round(s["ch"])))

    return smoothed


def remap_face_track_to_segments(face_track: dict, segments: list) -> dict:
    """Remap face_track samples from SOURCE time to CONCATENATED time.

    Mirrors `video_service.remap_transcript_to_segments` but operates on the
    face_track's `samples` list (each item has a single `t` instead of
    start/end). When segments cut out parts of the source, samples inside
    removed gaps are dropped; samples inside kept segments get their `t`
    adjusted to land at the right moment in the concatenated output.

    Used by export_service when the user has cut segments — the cached
    face_track lives in source coordinates, but after concat-first the
    pipeline sees a different timeline. Without this, the dynamic crop
    would follow faces at the wrong moments.
    """
    if not face_track or not face_track.get("samples"):
        return face_track
    segs = []
    for s in segments:
        if isinstance(s, dict):
            segs.append({"start": float(s.get("start", 0)), "end": float(s.get("end", 0)),
                         "speed": max(0.25, float(s.get("speed", 1.0))),
                         "type": s.get("type", "video")})
        else:
            segs.append({"start": float(s.start), "end": float(s.end),
                         "speed": max(0.25, float(getattr(s, "speed", 1.0))),
                         "type": getattr(s, "type", "video")})
    if not segs:
        return face_track

    # Output start time of each segment (cumulative, accounting for speed and
    # skipping image-type segments which carry their own duration).
    offs: list[float] = []
    acc = 0.0
    for seg in segs:
        offs.append(acc)
        if seg["type"] == "image":
            acc += float(seg.get("duration", 0))
        else:
            acc += (seg["end"] - seg["start"]) / seg["speed"]

    out_samples = []
    for i, seg in enumerate(segs):
        if seg["type"] == "image":
            continue
        s, e, sp = seg["start"], seg["end"], seg["speed"]
        out_start = offs[i]
        for sample in face_track["samples"]:
            t = float(sample.get("t", 0))
            if t < s or t > e:
                continue
            new_t = (t - s) / sp + out_start
            out_samples.append({**sample, "t": round(new_t, 3)})

    out = dict(face_track)
    out["samples"] = out_samples
    # end_time becomes the new total output duration
    out["start_time"] = 0.0
    out["end_time"] = round(acc, 3)
    return out


def interpolate_trajectory(trajectory: list[dict], fps: float = 30.0) -> list[dict]:
    """Resample a trajectory onto a uniform `fps` grid with smoothstep-eased
    linear interpolation between adjacent samples.

    FFmpeg's `sendcmd` HOLDS each value until the next timestamped command, so
    a raw 5 FPS track pans the camera in visible 200 ms steps (reads as the
    camera "trembling"). Resampling to ~30 FPS makes the pan continuous.
    """
    if not trajectory:
        return []
    if len(trajectory) == 1:
        return [dict(trajectory[0])]

    t0 = trajectory[0]["t"]
    t1 = trajectory[-1]["t"]
    n = max(2, int(round((t1 - t0) * fps)) + 1)
    step = (t1 - t0) / (n - 1) if n > 1 else 0.0

    out: list[dict] = []
    idx = 0
    for i in range(n):
        t = t0 + step * i
        while idx < len(trajectory) - 1 and trajectory[idx + 1]["t"] < t:
            idx += 1
        a = trajectory[idx]
        b = trajectory[min(idx + 1, len(trajectory) - 1)]
        span = max(1e-9, b["t"] - a["t"])
        f = max(0.0, min(1.0, (t - a["t"]) / span))
        if abs(b["cx"] - a["cx"]) > 160 or abs(b["cy"] - a["cy"]) > 160:
            # Camera cut / scene switch: instant snap, do not pan through empty space
            curr_cx = b["cx"] if f >= 0.5 else a["cx"]
            curr_cy = b["cy"] if f >= 0.5 else a["cy"]
            curr_cw = b["cw"] if f >= 0.5 else a["cw"]
            curr_ch = b["ch"] if f >= 0.5 else a["ch"]
        else:
            f = f * f * (3.0 - 2.0 * f)   # smoothstep — rounds the corners
            curr_cx = a["cx"] + (b["cx"] - a["cx"]) * f
            curr_cy = a["cy"] + (b["cy"] - a["cy"]) * f
            curr_cw = a["cw"] + (b["cw"] - a["cw"]) * f
            curr_ch = a["ch"] + (b["ch"] - a["ch"]) * f
        out.append({
            "t": round(t, 3),
            "cx": curr_cx,
            "cy": curr_cy,
            "cw": curr_cw,
            "ch": curr_ch,
            "miss": a.get("miss", False),
        })
    return out


def build_sendcmd_file(trajectory: list[dict], output_path: str, label: str = "rfm") -> str:
    """Write an FFmpeg `sendcmd` file from a trajectory list.

    Emits ONLY `x` and `y` updates per timestamp — crop dimensions (`w`, `h`)
    are NOT touched here, because we use a fixed crop size set at filter init
    (the export pipeline picks max(cw)/max(ch) across the trajectory). Updating
    `w/h` mid-stream forces FFmpeg to renegotiate downstream buffers every
    sample, which on Windows crashes libavfilter with "Cannot allocate memory".

    For each timestamped point we emit a line like:
        <t> crop@<label> x <x1>, crop@<label> y <y1>;
    where x1/y1 are top-left coords (FFmpeg crop wants top-left; trajectory
    stores center, so we convert here).

    The trajectory is resampled to ~30 FPS first (see interpolate_trajectory)
    so the camera pans smoothly instead of stepping between 5 FPS samples.
    """
    if not trajectory:
        raise ValueError("empty trajectory")
    trajectory = interpolate_trajectory(trajectory, fps=30.0)
    # Deadzone stabilization: kills 1-2px per-frame jitter from face detector noise.
    # If the target top-left is within deadzone_px of the current stable anchor,
    # keep the anchor rock-solid. Only update when real intentional movement occurs.
    deadzone_px = 20.0
    stable_x = None
    stable_y = None
    with open(output_path, "w", encoding="utf-8") as f:
        for p in trajectory:
            raw_x = max(0, int(round(p["cx"] - p["cw"] / 2)))
            raw_y = max(0, int(round(p["cy"] - p["ch"] / 2)))
            if stable_x is None:
                stable_x = raw_x
                stable_y = raw_y
            else:
                if math.hypot(raw_x - stable_x, raw_y - stable_y) >= deadzone_px:
                    stable_x = raw_x
                    stable_y = raw_y
            line = (
                f'{p["t"]:.3f} '
                f'crop@{label} x {stable_x}, '
                f'crop@{label} y {stable_y};\n'
            )
            f.write(line)
    return output_path
