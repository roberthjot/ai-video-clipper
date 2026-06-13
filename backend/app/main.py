import webbrowser
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse as FastFileResponse
import os
from .config import settings
from .routes import upload, clips, export, stream, meme, editor, prompts, settings as settings_routes, downloader
from .routes.upload import get_project_store

# Validate settings on startup
settings.validate()

app = FastAPI(
    title="AI Video Clipper",
    description="AI-powered viral clip extraction tool",
    version="9.0.0",
)

# CORS for local development (allow all localhost ports)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(upload.router)
app.include_router(clips.router)
app.include_router(export.router)
app.include_router(stream.router, prefix="/api/stream", tags=["stream"])
app.include_router(meme.router, prefix="/api/meme", tags=["meme"])
app.include_router(editor.router)
app.include_router(prompts.router)
app.include_router(settings_routes.router)
app.include_router(downloader.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "9.0.0"}


@app.get("/api/export-info/{project_id}")
async def download_export_info(project_id: str):
    """Download clips_info.txt for a project."""
    from fastapi import HTTPException
    # Search directly on disk, no need for in-memory project
    info_path = os.path.join(settings.PROJECTS_DIR, project_id, "exported", "clips_info.txt")
    if not os.path.exists(info_path):
        raise HTTPException(status_code=404, detail="Export clips first to generate the info file.")
    return FastFileResponse(info_path, media_type="text/plain", filename="clips_info.txt")


@app.on_event("startup")
async def startup():
    print("=" * 50)
    print("  AI Video Clipper v2.0")
    print("  Open http://localhost:8000 in your browser")
    print("=" * 50)
