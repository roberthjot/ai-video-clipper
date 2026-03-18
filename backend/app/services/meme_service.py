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
                "Rules: English only. Maximum 3 short lines. "
                "No hashtags. No emojis. No punctuation except apostrophes. "
                "Each line should be short — no more than 8 words per line. "
                "Make it punchy, funny, and instantly shareable. "
                "Return ONLY the meme text — nothing else, no explanations, no labels, no extra words."
            )),
        ])],
        config=types.GenerateContentConfig(temperature=1.0),
    )
    return response.text.strip()


def _wrap_text(text: str, max_chars: int = 26) -> list:
    """Wrap text into lines of max_chars."""
    lines_raw = text.replace('\\n', '\n').split('\n')
    result = []
    for line in lines_raw:
        words = line.split()
        cur = ""
        for w in words:
            if len(cur) + len(w) + (1 if cur else 0) <= max_chars:
                cur = (cur + " " + w).strip() if cur else w
            else:
                if cur:
                    result.append(cur)
                cur = w
        if cur:
            result.append(cur)
    return result[:4]  # max 4 lines


def create_meme_bg_png(text: str, bg_color: str = "black", W: int = 1080, H: int = 1920, text_y_ratio: float = 0.08) -> tuple:
    """Create meme background PNG: solid color + meme text at given Y ratio.
    Returns (png_path, text_bottom_y)."""
    bg_rgb = (0, 0, 0) if bg_color == "black" else (255, 255, 255)
    text_rgb = (255, 255, 255) if bg_color == "black" else (20, 20, 20)

    font_path = "C:/Windows/Fonts/calibrib.ttf"
    font_size = 80
    try:
        font = ImageFont.truetype(font_path, font_size)
    except Exception:
        font = ImageFont.load_default()

    lines = _wrap_text(text, max_chars=26)
    line_h = int(font_size * 1.35)

    img = Image.new("RGB", (W, H), bg_rgb)
    draw = ImageDraw.Draw(img)

    y = int(H * text_y_ratio)
    for line in lines:
        try:
            tw = int(font.getlength(line))
        except Exception:
            tw = int(len(line) * font_size * 0.6)
        x = (W - tw) // 2
        draw.text((x, y), line, font=font, fill=text_rgb)
        y += line_h

    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    png_path = os.path.join(temp_dir, f"meme_bg_{int(time.time() * 1000)}.png")
    img.save(png_path)
    return png_path, y  # y = bottom of last text line


def export_meme_video(video_path: str, meme_text: str, output_path: str,
                      bg_color: str = "black", text_y: float = 0.08, video_scale: float = 0.9) -> None:
    """Export full video (no cuts) overlaid on meme background."""
    W, H = 1080, 1920

    bg_png, _text_bottom = create_meme_bg_png(meme_text, bg_color, W, H, text_y_ratio=text_y)

    # Scale video to video_scale% of canvas width, center in canvas
    scale_w = int(W * video_scale)
    fg_filter = f"scale={scale_w}:-2"

    filter_complex = (
        f"[0:v]setpts=PTS-STARTPTS,{fg_filter}[fg];"
        f"[1:v][fg]overlay=(W-w)/2:(H-h)/2[out]"
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


def _process_batch(batch_id: str, video_paths: list, bg_color: str, text_y: float, video_scale: float) -> None:
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

            # 3. Generate meme text
            meme_text = generate_meme_text(file_obj)
            item["meme_text"] = meme_text
            delete_file(file_obj)
            print(f"[Meme] Batch {batch_id} item {i}: text = {meme_text[:60]!r}")

            # 4. Export video
            item["status"] = "exporting"
            output_filename = f"meme_{batch_id}_{i}.mp4"
            output_path = os.path.join(MEME_OUTPUT_DIR, output_filename)
            export_meme_video(video_path, meme_text, output_path, bg_color, text_y=text_y, video_scale=video_scale)

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
                     text_y: float = 0.08, video_scale: float = 0.9) -> str:
    """Start a meme batch. Returns batch_id."""
    batch_id = uuid.uuid4().hex[:12]
    meme_batches[batch_id] = {
        "batch_id": batch_id,
        "status": "processing",
        "bg_color": bg_color,
        "items": [
            {
                "index": i,
                "filename": filenames[i],
                "status": "pending",
                "meme_text": "",
                "output_path": "",
                "error": "",
            }
            for i in range(len(video_paths))
        ],
    }
    threading.Thread(
        target=_process_batch,
        args=(batch_id, video_paths, bg_color, text_y, video_scale),
        daemon=True,
    ).start()
    return batch_id


def get_batch(batch_id: str) -> dict | None:
    return meme_batches.get(batch_id)
