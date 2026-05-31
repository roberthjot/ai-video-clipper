import os
import uuid
import time
import threading
import subprocess
from PIL import Image, ImageDraw, ImageFont

from ..config import settings
from .gemini_service import upload_video, wait_for_processing, delete_file, client
from google.genai import types

FFMPEG_EXE = "ffmpeg"
try:
    import imageio_ffmpeg
    FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    pass

MEME_OUTPUT_DIR = os.path.join(settings.PROJECTS_DIR, "_meme_exports")
MEME_UPLOAD_DIR = os.path.join(settings.PROJECTS_DIR, "_meme_uploads")

# In-memory batch store
meme_batches: dict = {}


TEMP_DIR = os.path.join(os.path.dirname(__file__), "temp")


def extract_video_frame(video_path: str, output_path: str) -> None:
    """Extract a single frame from a video (tries at 1s, fallback 0s)."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    for seek in ("1", "0"):
        cmd = [FFMPEG_EXE, "-ss", seek, "-i", video_path,
               "-frames:v", "1", "-q:v", "3", "-y", output_path]
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode == 0 and os.path.exists(output_path):
            return
    raise RuntimeError("No se pudo extraer frame del video")


def detect_crop_boundaries(frame_path: str) -> dict:
    """Ask Gemini to detect tweet-card vs video boundaries in an Instagram meme frame.
    Returns { crop_top_pct: float, crop_bottom_pct: float } (0.0-1.0)."""
    with open(frame_path, "rb") as f:
        img_bytes = f.read()

    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=[types.Content(role="user", parts=[
            types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
            types.Part.from_text(text=(
                "This is a frame from an Instagram meme video. "
                "The actual video content is displayed INSIDE a rectangular frame or box. "
                "Around this box there are borders/padding on all four sides (top, bottom, left, right) "
                "that may be white, black, or a solid color. "
                "Your job: detect the percentage to crop from each side to remove the border/frame "
                "and keep only the inner video content. "
                "Return ONLY this format, no explanation:\n"
                "TOP:X BOTTOM:Y LEFT:Z RIGHT:W\n"
                "X, Y, Z, W are integers 0-50. Use 0 if there is no border on that side."
            )),
        ])],
        config=types.GenerateContentConfig(temperature=0.0),
    )
    raw = response.text.strip().upper()
    crop_top = 0.0
    crop_bottom = 0.0
    crop_left = 0.0
    crop_right = 0.0
    for token in raw.split():
        if token.startswith("TOP:"):
            try:
                crop_top = min(50, max(0, int(token[4:]))) / 100.0
            except Exception:
                pass
        elif token.startswith("BOTTOM:"):
            try:
                crop_bottom = min(50, max(0, int(token[7:]))) / 100.0
            except Exception:
                pass
        elif token.startswith("LEFT:"):
            try:
                crop_left = min(50, max(0, int(token[5:]))) / 100.0
            except Exception:
                pass
        elif token.startswith("RIGHT:"):
            try:
                crop_right = min(50, max(0, int(token[6:]))) / 100.0
            except Exception:
                pass
    return {
        "crop_top_pct": round(crop_top, 4),
        "crop_bottom_pct": round(crop_bottom, 4),
        "crop_left_pct": round(crop_left, 4),
        "crop_right_pct": round(crop_right, 4),
    }


def crop_video_pct(video_path: str, output_path: str,
                   crop_top_pct: float, crop_bottom_pct: float,
                   crop_left_pct: float = 0.0, crop_right_pct: float = 0.0) -> str:
    """Crop video by removing top/bottom/left/right percentages. Returns output_path."""
    # Ensure even pixel counts required by libx264
    left_expr = f"trunc(iw*{crop_left_pct:.6f}/2)*2"
    w_expr    = f"trunc(iw*(1-{crop_left_pct:.6f}-{crop_right_pct:.6f})/2)*2"
    top_expr  = f"trunc(ih*{crop_top_pct:.6f}/2)*2"
    h_expr    = f"trunc(ih*(1-{crop_top_pct:.6f}-{crop_bottom_pct:.6f})/2)*2"
    cmd = [
        FFMPEG_EXE, "-i", video_path,
        "-vf", f"crop={w_expr}:{h_expr}:{left_expr}:{top_expr}",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-c:a", "copy", "-y", output_path,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"Crop failed: {r.stderr[-500:]}")
    return output_path


def generate_meme_text(file_obj) -> str:
    """Ask Gemini to generate meme text for this video."""
    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=[types.Content(role="user", parts=[
            types.Part.from_uri(file_uri=file_obj.uri, mime_type=file_obj.mime_type),
            types.Part.from_text(text=(
                "Watch this short video carefully. "
                "Write a Gen Z meme caption that perfectly matches what's happening. "
                "Use any format that fits naturally — for example: "
                "'When [situation]', 'POV: [scenario]', 'Me [doing something]', "
                "'Nobody: / Me:', 'That one [thing]', '[setup line] / [punchline]', "
                "'The [thing]: [reaction]', 'Us [doing X] vs [reality]', or any other "
                "meme format that makes it instantly funny and relatable. "
                "Rules: English only. Maximum 15 words total. No hashtags. No emojis. "
                "No punctuation except apostrophes and colons. "
                "Use a newline to separate setup from punchline when needed. "
                "Make it feel natural, punchy, and shareable for a young audience. "
                "Return ONLY the meme text — nothing else, no explanations, no labels."
            )),
        ])],
        config=types.GenerateContentConfig(temperature=1.0),
    )
    raw = response.text.strip().rstrip(".")
    raw = raw.lower().rstrip(".")
    raw = raw[:1].upper() + raw[1:] if raw else raw
    return raw


def detect_music_artist(file_obj) -> dict:
    """Ask Gemini to identify the artist in the music video. Returns dict with artist/instagram or empty strings."""
    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=[types.Content(role="user", parts=[
            types.Part.from_uri(file_uri=file_obj.uri, mime_type=file_obj.mime_type),
            types.Part.from_text(text=(
                "Listen and watch this music video carefully. "
                "Try to identify the music artist or singer. "
                "Only answer if you are highly confident — do NOT guess or make up names. "
                "If you recognize the artist, respond in this exact format:\n"
                "ARTIST: [full artist name]\n"
                "INSTAGRAM: [@instagram_handle]\n\n"
                "If you cannot identify the artist with high confidence, respond exactly:\n"
                "ARTIST: NONE\n"
                "Return ONLY these lines, nothing else."
            )),
        ])],
        config=types.GenerateContentConfig(temperature=0.1),
    )
    raw = response.text.strip()
    artist = ""
    instagram = ""
    for line in raw.splitlines():
        line = line.strip()
        if line.upper().startswith("ARTIST:"):
            val = line[7:].strip()
            if val.upper() != "NONE":
                artist = val
        elif line.upper().startswith("INSTAGRAM:"):
            val = line[10:].strip()
            if val and val.upper() != "NONE":
                instagram = val if val.startswith("@") else f"@{val}"
    return {"artist": artist, "instagram": instagram}


def generate_music_vibe(file_obj) -> str:
    """Ask Gemini to generate an emotion-driven vibe phrase for a music video."""
    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=[types.Content(role="user", parts=[
            types.Part.from_uri(file_uri=file_obj.uri, mime_type=file_obj.mime_type),
            types.Part.from_text(text=(
                "Watch this music clip carefully and identify the PRIMARY emotion it triggers in the listener. "
                "Then write a short, punchy phrase designed to make people on Instagram stop scrolling, "
                "comment, tag a friend, or repost it. "
                "Base the phrase on the emotion you detected:\n"
                "- Nostalgia → make them think of a person or memory ('That song that takes you right back')\n"
                "- Awe/talent → make them feel they witnessed something rare ('I was NOT ready for those vocals')\n"
                "- Cultural pride → celebrate the sound or roots ('This is what [genre] is supposed to sound like')\n"
                "- Euphoria/energy → capture the electricity ('The energy in this room is unreal')\n"
                "- Sadness/longing → make them feel understood ('The song that hits when you least expect it')\n"
                "- Discovery → make them feel like insiders ('How does this artist not have millions of followers')\n"
                "Rules: English only. Maximum 12 words. No hashtags. No emojis. "
                "No punctuation except apostrophes and commas. "
                "Return ONLY the phrase — nothing else."
            )),
        ])],
        config=types.GenerateContentConfig(temperature=1.0),
    )
    raw = response.text.strip().rstrip(".")
    raw = raw.lower().rstrip(".")
    raw = raw[:1].upper() + raw[1:] if raw else raw
    return raw


def generate_ig_description(file_obj, meme_text: str, content_type: str = "meme") -> str:
    """Ask Gemini to generate a long Instagram caption for the video."""
    if content_type == "music":
        prompt = (
            f'This music clip\'s vibe phrase is: "{meme_text}"\n\n'
            "Write a long Instagram post caption for this music clip. "
            "Write it as an engaging music fan account post in English. "
            "Talk about the feeling, energy, and mood of the song. "
            "Use 3-4 short paragraphs (1-3 sentences each). "
            "Max 2 emojis total. "
            "At the very end, after all the text, include EXACTLY 3 relevant music hashtags. "
            "The hashtags must be the absolute last thing in the caption, on their own line. "
            "Return ONLY the caption — no labels, no extra words."
        )
    else:
        prompt = (
            f'This video\'s meme caption is: "{meme_text}"\n\n'
            "Write a long Instagram post caption for this meme video. "
            "Write it as a funny, relatable Gen Z meme account post in English. "
            "Use 3-4 short paragraphs (1-3 sentences each). "
            "Max 2 emojis total. "
            "At the very end, after all the text, include EXACTLY 3 relevant hashtags. "
            "The hashtags must be the absolute last thing in the caption, on their own line. "
            "Return ONLY the caption — no labels, no extra words."
        )
    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=[types.Content(role="user", parts=[
            types.Part.from_uri(file_uri=file_obj.uri, mime_type=file_obj.mime_type),
            types.Part.from_text(text=prompt),
        ])],
        config=types.GenerateContentConfig(temperature=0.9),
    )
    return response.text.strip()


def _wrap_text_px(text: str, font, max_width: int) -> list:
    """Wrap text to fit within max_width pixels using real font measurement."""
    lines_raw = text.replace('\\n', '\n').split('\n')
    result = []
    for line in lines_raw:
        words = line.split()
        cur = ""
        for w in words:
            test = (cur + " " + w).strip() if cur else w
            try:
                tw = int(font.getlength(test))
            except Exception:
                tw = len(test) * int(font.size * 0.6)
            if tw <= max_width:
                cur = test
            else:
                if cur:
                    result.append(cur)
                cur = w
        if cur:
            result.append(cur)
    return result[:4]  # max 4 lines


def create_meme_bg_png(text: str, bg_color: str = "black", W: int = 1080, H: int = 1920,
                        text_y_ratio: float = 0.08, font_size: int = 60, text_x_ratio: float = 0.05) -> tuple:
    """Create meme background PNG: solid color + meme text at given Y ratio.
    Returns (png_path, text_bottom_y)."""
    bg_rgb = (0, 0, 0) if bg_color == "black" else (255, 255, 255)
    text_rgb = (255, 255, 255) if bg_color == "black" else (20, 20, 20)

    font_path = "C:/Windows/Fonts/calibrib.ttf"
    try:
        font = ImageFont.truetype(font_path, font_size)
    except Exception:
        font = ImageFont.load_default()

    line_h = int(font_size * 1.35)

    img = Image.new("RGB", (W, H), bg_rgb)
    draw = ImageDraw.Draw(img)

    x_start = int(W * text_x_ratio)
    right_margin = int(W * 0.05)  # 5% padding from right edge
    available_width = W - x_start - right_margin
    lines = _wrap_text_px(text, font, max(available_width, 200))

    y = int(H * text_y_ratio)
    for line in lines:
        draw.text((x_start, y), line, font=font, fill=text_rgb)
        y += line_h

    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    import uuid as _uuid
    png_path = os.path.join(temp_dir, f"meme_bg_{_uuid.uuid4().hex}.png")
    img.save(png_path)
    return png_path, y  # y = bottom of last text line


def create_rounded_corner_blocker(W: int, H: int, radius: int, bg_color: str, output_path: str) -> str:
    """Create a PNG: background color only at the 4 corners (to round the canvas edges).
    Transparent everywhere else, so it can be overlaid as the final layer."""
    bg_rgb = (0, 0, 0) if bg_color == "black" else (255, 255, 255)
    # Full-size rounded rectangle mask: 255 inside, 0 in corners
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([(0, 0), (W - 1, H - 1)], radius=radius, fill=255)
    # Invert: corners = 255, inside = 0
    corners_alpha = mask.point(lambda x: 255 - x)
    # Create background-colored image and apply alpha so only corners are opaque
    blocker = Image.new("RGBA", (W, H), (*bg_rgb, 255))
    blocker.putalpha(corners_alpha)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    blocker.save(output_path)
    return output_path


def export_meme_video(video_path: str, meme_text: str, output_path: str,
                      bg_color: str = "black", text_y: float = 0.08,
                      video_scale: float = 0.9, video_y: float = 0.6,
                      font_size: int = 60, text_x: float = 0.05,
                      corner_radius: int = 0) -> None:
    """Export full video (no cuts) overlaid on meme background."""
    W, H = 1080, 1920

    bg_png, _text_bottom = create_meme_bg_png(meme_text, bg_color, W, H,
                                               text_y_ratio=text_y, font_size=font_size,
                                               text_x_ratio=text_x)

    # Scale video to video_scale% of canvas width (maintain aspect ratio)
    scale_w = int(W * video_scale)
    fg_filter = f"scale={scale_w}:-2"

    # Center video horizontally; video_y controls where the video center sits (0.0=top, 1.0=bottom)
    overlay_x = "(W-w)/2"
    overlay_y = f"{int(H * video_y)}-h/2"

    extra_inputs = []
    corner_png = None

    if corner_radius > 0:
        corner_png = os.path.join(TEMP_DIR, f"corners_{_uuid.uuid4().hex}.png")
        create_rounded_corner_blocker(W, H, corner_radius, bg_color, corner_png)
        extra_inputs = ["-loop", "1", "-i", corner_png]
        filter_complex = (
            f"[1:v]scale={W}:{H},setsar=1[bg];"
            f"[0:v]setpts=PTS-STARTPTS,{fg_filter}[fg];"
            f"[bg][fg]overlay={overlay_x}:{overlay_y}[comp];"
            f"[comp][2:v]overlay=0:0[out]"
        )
    else:
        filter_complex = (
            f"[1:v]scale={W}:{H},setsar=1[bg];"
            f"[0:v]setpts=PTS-STARTPTS,{fg_filter}[fg];"
            f"[bg][fg]overlay={overlay_x}:{overlay_y}[out]"
        )

    cmd = [
        FFMPEG_EXE,
        "-i", video_path,
        "-loop", "1", "-i", bg_png,
        *extra_inputs,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-shortest",
        "-y", output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    for p in (bg_png, corner_png):
        try:
            if p:
                os.remove(p)
        except Exception:
            pass
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {result.stderr[-600:]}")


def _process_batch(batch_id: str, video_paths: list, bg_color: str, text_y: float, video_scale: float, video_y: float, font_size: int = 60, text_x: float = 0.05, content_type: str = "meme", crop_top_pct: float = 0.0, crop_bottom_pct: float = 0.0, crop_left_pct: float = 0.0, crop_right_pct: float = 0.0) -> None:
    """Background thread: process each video in the batch sequentially."""
    batch = meme_batches[batch_id]
    os.makedirs(MEME_OUTPUT_DIR, exist_ok=True)
    do_crop = crop_top_pct > 0.001 or crop_bottom_pct > 0.001 or crop_left_pct > 0.001 or crop_right_pct > 0.001

    for i, video_path in enumerate(video_paths):
        item = batch["items"][i]
        cropped_path = None
        try:
            # 0. Crop if needed
            if do_crop:
                item["status"] = "cropping"
                cropped_path = video_path.replace(".mp4", "_cropped.mp4").replace(".mov", "_cropped.mp4")
                video_path = crop_video_pct(video_path, cropped_path, crop_top_pct, crop_bottom_pct, crop_left_pct, crop_right_pct)
                print(f"[Meme] Batch {batch_id} item {i}: cropped (top={crop_top_pct:.1%} bot={crop_bottom_pct:.1%} left={crop_left_pct:.1%} right={crop_right_pct:.1%})")

            # 1. Upload to Gemini
            item["status"] = "uploading"
            print(f"[Meme] Batch {batch_id} item {i}: uploading to Gemini")
            file_obj = upload_video(video_path)

            # 2. Wait for Gemini processing
            item["status"] = "analyzing"
            file_obj = wait_for_processing(file_obj)

            # 3. Generate text based on content type
            if content_type == "music":
                meme_text = generate_music_vibe(file_obj)
            else:
                meme_text = generate_meme_text(file_obj)
            item["meme_text"] = meme_text

            # 3b. Detect artist (music mode only, while file is still uploaded)
            if content_type == "music":
                try:
                    artist_info = detect_music_artist(file_obj)
                except Exception:
                    artist_info = {"artist": "", "instagram": ""}
                item["artist_info"] = artist_info
                print(f"[Meme] Batch {batch_id} item {i}: artist = {artist_info}")

            # 3c. Generate IG description (while file is still uploaded)
            try:
                ig_description = generate_ig_description(file_obj, meme_text, content_type)
            except Exception:
                ig_description = ""
            item["ig_description"] = ig_description

            delete_file(file_obj)
            print(f"[Meme] Batch {batch_id} item {i}: [{content_type}] text = {meme_text[:60]!r}")

            # 4. Export video
            item["status"] = "exporting"
            output_filename = f"meme_{batch_id}_{i}.mp4"
            output_path = os.path.join(MEME_OUTPUT_DIR, output_filename)
            export_meme_video(video_path, meme_text, output_path, bg_color, text_y=text_y, video_scale=video_scale, video_y=video_y, font_size=font_size, text_x=text_x)

            # Save IG description as .txt
            txt_filename = f"meme_{batch_id}_{i}.txt"
            txt_path = os.path.join(MEME_OUTPUT_DIR, txt_filename)
            label = "Vibe text" if content_type == "music" else "Meme text"
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(f"{label}:\n{meme_text}\n\n")
                if content_type == "music":
                    # Separate hashtag lines from body text so artist goes before hashtags
                    desc_lines = ig_description.splitlines()
                    hashtag_lines = [l for l in desc_lines if l.strip().startswith("#")]
                    body_lines = [l for l in desc_lines if not l.strip().startswith("#")]
                    body_text = "\n".join(body_lines).strip()
                    hashtags_text = "\n".join(hashtag_lines).strip()

                    f.write(f"Instagram Description:\n{body_text}\n")
                    ai = item.get("artist_info", {})
                    if ai.get("artist") or ai.get("instagram"):
                        f.write("\n")
                    if ai.get("artist"):
                        f.write(f"Artist: {ai['artist']}\n")
                    if ai.get("instagram"):
                        f.write(f"Instagram: {ai['instagram']}\n")
                    if hashtags_text:
                        f.write(f"\n{hashtags_text}\n")
                else:
                    # Separate hashtags to end for memes too
                    desc_lines = ig_description.splitlines()
                    hashtag_lines = [l for l in desc_lines if l.strip().startswith("#")]
                    body_lines = [l for l in desc_lines if not l.strip().startswith("#")]
                    body_text = "\n".join(body_lines).strip()
                    hashtags_text = "\n".join(hashtag_lines).strip()
                    f.write(f"Instagram Description:\n{body_text}\n")
                    if hashtags_text:
                        f.write(f"\n{hashtags_text}\n")
            item["txt_path"] = txt_path

            item["video_path"] = video_path
            item["output_path"] = output_path
            item["status"] = "ready"
            print(f"[Meme] Batch {batch_id} item {i}: done")

        except Exception as e:
            item["status"] = "error"
            item["error"] = str(e)
            print(f"[Meme] Batch {batch_id} item {i}: ERROR — {e}")

    batch["status"] = "completed"
    print(f"[Meme] Batch {batch_id} all done")


def start_meme_batch(video_paths: list, filenames: list, bg_color: str = "black",
                     text_y: float = 0.08, video_scale: float = 0.9, video_y: float = 0.6,
                     font_size: int = 60, text_x: float = 0.05, content_type: str = "meme",
                     crop_top_pct: float = 0.0, crop_bottom_pct: float = 0.0,
                     crop_left_pct: float = 0.0, crop_right_pct: float = 0.0) -> str:
    """Start a meme batch. Returns batch_id."""
    batch_id = uuid.uuid4().hex[:12]
    meme_batches[batch_id] = {
        "batch_id": batch_id,
        "status": "processing",
        "bg_color": bg_color,
        "content_type": content_type,
        "items": [
            {
                "index": i,
                "filename": filenames[i],
                "status": "pending",
                "meme_text": "",
                "output_path": "",
                "error": "",
                "ig_description": "",
                "txt_path": "",
                "artist_info": None,
            }
            for i in range(len(video_paths))
        ],
    }
    threading.Thread(
        target=_process_batch,
        args=(batch_id, video_paths, bg_color, text_y, video_scale, video_y, font_size, text_x, content_type, crop_top_pct, crop_bottom_pct, crop_left_pct, crop_right_pct),
        daemon=True,
    ).start()
    return batch_id


def get_batch(batch_id: str) -> dict | None:
    return meme_batches.get(batch_id)
