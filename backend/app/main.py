import webbrowser
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .config import settings
from .routes import upload, clips, export

# Validate settings on startup
settings.validate()

app = FastAPI(
    title="AI Video Clipper",
    description="AI-powered viral clip extraction tool",
    version="2.0.0",
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


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "2.0.0"}


@app.on_event("startup")
async def startup():
    print("=" * 50)
    print("  AI Video Clipper v2.0")
    print("  Open http://localhost:8000 in your browser")
    print("=" * 50)
