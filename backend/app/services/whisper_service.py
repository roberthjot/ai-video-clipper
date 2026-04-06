"""
Whisper transcription service using faster-whisper (local, free, no API).
Extracts audio from video and returns word-level timestamps.
"""
import os
import subprocess
import imageio_ffmpeg

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()


def extract_audio(video_path: str, output_path: str) -> str:
    """Extract audio from video to a WAV file for Whisper."""
    cmd = [
        FFMPEG_EXE, "-y",
        "-i", video_path,
        "-vn",                    # no video
        "-ar", "16000",           # 16kHz sample rate (Whisper requirement)
        "-ac", "1",               # mono
        "-c:a", "pcm_s16le",      # WAV format
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"Audio extraction failed: {result.stderr.decode()}")
    return output_path


def transcribe(video_path: str) -> dict:
    """
    Transcribe video audio using faster-whisper.
    Returns dict with 'text', 'language', 'words' (list of {word, start, end}).
    Downloads model on first use (~150MB for 'base' model).
    """
    from faster_whisper import WhisperModel

    import uuid
    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    audio_path = os.path.join(temp_dir, f"audio_{uuid.uuid4().hex}.wav")

    try:
        print(f"[Whisper] Extracting audio from: {video_path}")
        extract_audio(video_path, audio_path)

        print("[Whisper] Loading model (base, CPU int8)...")
        model = WhisperModel("base", device="cpu", compute_type="int8")

        print("[Whisper] Transcribing...")
        segments, info = model.transcribe(audio_path, word_timestamps=True)

        words = []
        full_text = []
        for segment in segments:
            full_text.append(segment.text.strip())
            for word in (segment.words or []):
                words.append({
                    "word": word.word.strip(),
                    "start": round(word.start, 3),
                    "end": round(word.end, 3),
                })

        print(f"[Whisper] Done. Language: {info.language}, Words: {len(words)}")
        return {
            "text": " ".join(full_text),
            "language": info.language,
            "words": words,
        }

    finally:
        if os.path.exists(audio_path):
            try:
                os.remove(audio_path)
            except:
                pass
