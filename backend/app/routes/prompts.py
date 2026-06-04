"""Routes to view/edit the app's Gemini prompts from the UI."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import prompts as prompt_registry

router = APIRouter(prefix="/api/prompts", tags=["prompts"])


class PromptUpdate(BaseModel):
    text: str


@router.get("")
async def list_prompts():
    """All prompts with their default + current (override) text and token hints."""
    return {"prompts": prompt_registry.list_all()}


@router.put("/{key}")
async def update_prompt(key: str, body: PromptUpdate):
    """Override one prompt. Empty text = reset to default."""
    try:
        if body.text is None or not body.text.strip():
            prompt_registry.reset(key)
        else:
            prompt_registry.set_override(key, body.text)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown prompt key")
    return {"status": "ok", "key": key}


@router.post("/{key}/reset")
async def reset_prompt(key: str):
    """Reset one prompt to its default."""
    prompt_registry.reset(key)
    return {"status": "reset", "key": key}


@router.post("/reset")
async def reset_all_prompts():
    """Reset every prompt to its default."""
    prompt_registry.reset(None)
    return {"status": "reset-all"}
