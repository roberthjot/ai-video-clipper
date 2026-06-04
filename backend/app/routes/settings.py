"""Runtime app settings (currently the editable Gemini API key)."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import gemini_service

router = APIRouter(prefix="/api/settings", tags=["settings"])


class ApiKeyUpdate(BaseModel):
    api_key: str


@router.get("/api-key")
async def get_api_key():
    """Masked preview of the active key (never returns the full key)."""
    return {
        "masked": gemini_service.masked_api_key(),
        "has_key": bool(gemini_service.current_api_key),
    }


@router.put("/api-key")
async def set_api_key(body: ApiKeyUpdate):
    """Swap the Gemini API key at runtime (recreates the client + persists it)."""
    try:
        gemini_service.set_api_key(body.api_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok", "masked": gemini_service.masked_api_key()}
