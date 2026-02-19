import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(ROOT_DIR / ".env")


class Settings:
    """Application settings loaded from environment variables."""

    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # Directories
    UPLOAD_DIR: str = str(ROOT_DIR / "uploads")
    PROJECTS_DIR: str = str(ROOT_DIR / "projects")

    # FFmpeg
    USE_QSV: bool = True  # Default to Intel QSV acceleration

    def validate(self):
        if not self.GOOGLE_API_KEY:
            raise ValueError("GOOGLE_API_KEY not set. Add it to your .env file.")
        os.makedirs(self.UPLOAD_DIR, exist_ok=True)
        os.makedirs(self.PROJECTS_DIR, exist_ok=True)


settings = Settings()
