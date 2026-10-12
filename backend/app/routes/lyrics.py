import os
import uuid
import shutil
from typing import List, Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Body
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..services import lyrics_service

router = APIRouter(prefix="/api/lyrics", tags=["lyrics"])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "temp_lyrics")
os.makedirs(UPLOAD_DIR, exist_ok=True)

AUDIO_STORE = {
    "beele_demo": {
        "raw_path": os.path.join(UPLOAD_DIR, "audio_beele_demo.mp3"),
        "wav_path": os.path.join(UPLOAD_DIR, "audio_beele_demo.mp3"),
        "filename": "Beéle - La Plena (W Sound 05).mp3",
        "duration": 24.5
    }
}
CLIP_STORE = {}


class TranscribeRequest(BaseModel):
    audio_id: str
    style: str = "impact"
    custom_lyrics: Optional[str] = None


class LyricCard(BaseModel):
    text: str
    start: float
    end: float


class RenderRequest(BaseModel):
    audio_id: str
    clip_ids: Optional[List[str]] = None
    cards: List[LyricCard]
    font_style: str = "karaoke"
    font_size: int = 80
    subtitle_y: Optional[float] = 0.0
    size_scale: Optional[float] = 1.0
    start_trim: float = 0.0
    end_trim: float = 0.0


@router.get("/stock-clips")
async def get_stock_clips():
    """Returns available dark aesthetic stock clips."""
    return lyrics_service.list_stock_clips()


@router.get("/demo")
async def get_lyrics_demo():
    """Returns pre-loaded demo of Beéle - La Plena (W Sound 05)."""
    cards = [
        {"text": "OYE LO QUE PASA ES QUE", "start": 1.71, "end": 2.61},
        {"text": "DESDE QUE VI TU CARA", "start": 2.61, "end": 3.57},
        {"text": "ME ENAMORÉ", "start": 3.57, "end": 4.19},
        {"text": "DE TI", "start": 4.19, "end": 4.51},
        {"text": "TODO LO QUE TE HE DICHO", "start": 4.51, "end": 6.31},
        {"text": "SIENTO QUE TE PASA LO MISMO", "start": 6.31, "end": 7.65},
        {"text": "CUANDO TE MIRO", "start": 7.65, "end": 8.39},
        {"text": "QUÉ DICES SI NOS VAMOS", "start": 8.39, "end": 10.39},
        {"text": "QUIERO HACERTE DE TODO", "start": 10.81, "end": 12.03},
        {"text": "QUIERO QUE TÚ ME DIGAS", "start": 12.17, "end": 13.17},
        {"text": "TE DIGO SOBELOVE", "start": 13.17, "end": 14.13},
        {"text": "Y LUEGO VIENE ME DICE", "start": 14.45, "end": 16.29},
        {"text": "QUE NO QUIERE QUE LA FRENE", "start": 16.29, "end": 17.25},
        {"text": "SI A TI TE GUSTA EL INFIERNO", "start": 21.54, "end": 23.20},
        {"text": "PA' QUE VAMOS A APAGARLO", "start": 23.20, "end": 24.60},
    ]
    raw_path = os.path.join(UPLOAD_DIR, "audio_beele_demo.mp3")
    AUDIO_STORE["beele_demo"] = {
        "raw_path": raw_path,
        "wav_path": raw_path,
        "filename": "Beéle - La Plena (W Sound 05).mp3",
        "duration": 24.5
    }
    return {
        "audio_id": "beele_demo",
        "audio_name": "Beéle - La Plena (W Sound 05).mp3",
        "duration": 24.5,
        "cards": cards,
        "video_url": "/api/lyrics/video/beele_plena_edit.mp4",
        "filename": "beele_plena_edit.mp4"
    }



@router.post("/upload-audio")
async def upload_audio(file: UploadFile = File(...)):
    """Upload song audio or video, extract WAV, get duration."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if not ext:
        ext = ".mp3"
    audio_id = uuid.uuid4().hex[:10]
    raw_path = os.path.join(UPLOAD_DIR, f"audio_{audio_id}{ext}")
    wav_path = os.path.join(UPLOAD_DIR, f"audio_{audio_id}.wav")

    with open(raw_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    lyrics_service.extract_wav(raw_path, wav_path)
    dur = lyrics_service.get_media_duration(raw_path)

    AUDIO_STORE[audio_id] = {
        "raw_path": raw_path,
        "wav_path": wav_path,
        "filename": file.filename,
        "duration": round(dur, 2)
    }

    return {
        "audio_id": audio_id,
        "filename": file.filename,
        "duration": round(dur, 2)
    }


@router.post("/upload-clip")
async def upload_user_clip(file: UploadFile = File(...)):
    """Upload custom background video clip."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if not ext:
        ext = ".mp4"
    clip_id = uuid.uuid4().hex[:10]
    clip_path = os.path.join(UPLOAD_DIR, f"userclip_{clip_id}{ext}")

    with open(clip_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    CLIP_STORE[clip_id] = {
        "path": clip_path,
        "filename": file.filename
    }

    return {
        "clip_id": clip_id,
        "filename": file.filename
    }


@router.post("/transcribe")
async def transcribe_song(req: TranscribeRequest):
    """Run Whisper to get word timings and build Saturn-style cards."""
    if req.audio_id not in AUDIO_STORE:
        raise HTTPException(status_code=404, detail="Audio file not found")

    item = AUDIO_STORE[req.audio_id]
    result = lyrics_service.transcribe_audio(
        item["wav_path"],
        style=req.style,
        custom_lyrics=req.custom_lyrics
    )
    return result


@router.post("/render")
async def render_edit(req: RenderRequest):
    """Render the final 1080x1920 video with multi-clip montage & subtitles."""
    if req.audio_id not in AUDIO_STORE:
        raise HTTPException(status_code=404, detail="Audio file not found")

    item = AUDIO_STORE[req.audio_id]
    audio_path = item["raw_path"]

    clip_paths = []
    if req.clip_ids:
        for cid in req.clip_ids:
            if cid in CLIP_STORE:
                clip_paths.append(CLIP_STORE[cid]["path"])
            else:
                # Check if it matches a stock clip ID
                for sc in lyrics_service.list_stock_clips():
                    if sc["id"] == cid and sc.get("exists"):
                        clip_paths.append(sc["path"])

    cards_dicts = [c.dict() for c in req.cards]

    try:
        out_mp4 = lyrics_service.render_lyric_video(
            audio_path=audio_path,
            clip_paths=clip_paths,
            cards=cards_dicts,
            font_style=req.font_style,
            font_size=req.font_size,
            subtitle_y=req.subtitle_y or 0.0,
            size_scale=req.size_scale or 1.0,
            start_trim=req.start_trim,
            end_trim=req.end_trim
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    fname = os.path.basename(out_mp4)
    return {
        "filename": fname,
        "url": f"/api/lyrics/video/{fname}"
    }


@router.get("/video/{filename}")
async def serve_lyric_video(filename: str):
    """Serve the exported video."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(path, media_type="video/mp4", filename=filename)
