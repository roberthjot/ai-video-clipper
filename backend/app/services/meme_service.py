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


def generate_meme_text(file_obj) -> str:
    """Ask Gemini to generate meme text for this video."""
    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=[types.Content(role="user", parts=[
            types.Part.from_uri(file_uri=file_obj.uri, mime_type=file_obj.mime_type),
            types.Part.from_text(text=(
                "Watch this short video carefully. "
                "Write the funniest, most relatable meme caption for it. "
                "Rules: English only. Maximum 12 words total across all lines. "
                "No hashtags. No emojis. No punctuation except apostrophes. "
                "Split into 2-3 short lines. "
                "Make it punchy, funny, and instantly shareable. "
                "Return ONLY the meme text — nothing else, no explanations, no labels, no extra words."
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
    """Ask Gemini to generate a vibe phrase for a music video."""
    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=[types.Content(role="user", parts=[
            types.Part.from_uri(file_uri=file_obj.uri, mime_type=file_obj.mime_type),
            types.Part.from_text(text=(
                "Watch this music video or audio clip carefully. "
                "Write a short, punchy phrase that perfectly captures the VIBE and FEELING of this music. "
                "Rules: English only. Maximum 10 words. No hashtags. No emojis. No punctuation except apostrophes and commas. "
                "Make it feel like a mood that people instantly relate to. "
                "Examples of the style: 'That one song you replay 10 times', 'Late night drives only', 'Pure serotonin', 'This hits different at 2am', 'The song that lives rent free in your head'. "
                "Return ONLY the vibe phrase — nothing else, no explanations, no labels."
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
            "Include 12-15 relevant music hashtags at the end (e.g. #music #vibes #nowplaying). "
            "Max 2 emojis total. "
            "Return ONLY the caption — no labels, no extra words."
        )
    else:
        prompt = (
            f'This video\'s meme caption is: "{meme_text}"\n\n'
            "Write a long Instagram post caption for this meme video. "
            "Write it as a funny, relatable fan account post in English. "
            "Use 3-4 short paragraphs (1-3 sentences each). "
            "Include 12-15 relevant hashtags at the end. "
            "Make it engaging and shareable. Max 2 emojis total. "
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
                        text_y_ratio: float = 0.08, font_size: int = 80, text_x_ratio: float = 0.05) -> tuple:
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
    png_path = os.path.join(temp_dir, f"meme_bg_{int(time.time() * 1000)}.png")
    img.save(png_path)
    return png_path, y  # y = bottom of last text line


def export_meme_video(video_path: str, meme_text: str, output_path: str,
                      bg_color: str = "black", text_y: float = 0.08,
                      video_scale: float = 0.9, video_y: float = 0.6,
                      font_size: int = 80, text_x: float = 0.05) -> None:
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

    filter_complex = (
        f"[1:v]scale={W}:{H},setsar=1[bg];"
        f"[0:v]setpts=PTS-STARTPTS,{fg_filter}[fg];"
        f"[bg][fg]overlay={overlay_x}:{overlay_y}[out]"
    )

    cmd = [
        FFMPEG_EXE,
        "-i", video_path,
        "-loop", "1", "-i", bg_png,
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

    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        os.remove(bg_png)
    except Exception:
        pass
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {result.stderr[-600:]}")


def _process_batch(batch_id: str, video_paths: list, bg_color: str, text_y: float, video_scale: float, video_y: float, font_size: int = 80, text_x: float = 0.05, content_type: str = "meme") -> None:
    """Background thread: process each video in the batch sequentially."""
    batch = meme_batches[batch_id]
    os.makedirs(MEME_OUTPUT_DIR, exist_ok=True)

    for i, video_path in enumerate(video_paths):
        item = batch["items"][i]
        try:
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
                f.write(f"Instagram Description:\n{ig_description}\n")
                if content_type == "music":
                    ai = item.get("artist_info", {})
                    if ai.get("artist") or ai.get("instagram"):
                        f.write("\n")
                    if ai.get("artist"):
                        f.write(f"Artist: {ai['artist']}\n")
                    if ai.get("instagram"):
                        f.write(f"Instagram: {ai['instagram']}\n")
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
                     font_size: int = 80, text_x: float = 0.05, content_type: str = "meme") -> str:
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
        args=(batch_id, video_paths, bg_color, text_y, video_scale, video_y, font_size, text_x, content_type),
        daemon=True,
    ).start()
    return batch_id


def get_batch(batch_id: str) -> dict | None:
    return meme_batches.get(batch_id)
