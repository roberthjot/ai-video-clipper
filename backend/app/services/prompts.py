"""Editable prompt registry.

Every Gemini prompt in the app lives here as a named template. Templates use
{{TOKEN}} markers that are filled in via str.replace (NOT str.format) so the
literal { } braces inside JSON examples never break rendering.

Users can override any prompt from the UI (Ajustes → Prompts). Overrides are
persisted to prompts.json next to the backend and survive restarts. "Reset"
removes an override and falls back to the DEFAULT below.

To use a prompt:  prompts.render("meme_text")  ·  prompts.render("analysis_system", TARGET_CLIPS=25, ...)
"""
import json
import os

_OVERRIDES_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "prompts.json")

# ── Defaults ────────────────────────────────────────────────────────────────
# Each entry: label (UI), description (UI), tokens (list shown as hints), text.
DEFAULTS = {
    "default_instruction": {
        "label": "Instrucción por defecto (sin prompt propio)",
        "description": "Qué momentos buscar cuando el usuario no escribe instrucciones propias.",
        "tokens": [],
        "text": (
            "Scan the ENTIRE video from start to finish — every second. Pick the moments that will make someone stop scrolling instantly. "
            "Prioritize: shocking reveals, explosive arguments, emotional breakdowns, unexpected plot twists, "
            "hilarious reactions, jaw-dropping confessions, and intense confrontations. "
            "Skip boring transitions, slow dialogue, or anything that wouldn't hook someone in the first 2 seconds. "
            "Each clip must start at the PEAK of the moment — not before it builds up."
        ),
    },
    "analysis_system": {
        "label": "Análisis principal (clips + captions)",
        "description": "El prompt grande que detecta los clips virales, escribe el caption, el score y la descripción de Instagram. El más importante.",
        "tokens": ["{{TARGET_CLIPS}}", "{{MIN_DURATION}}", "{{VIDEO_DURATION}}", "{{DUR_MIN}}", "{{THIRD1}}", "{{THIRD2}}", "{{VIDEO_DURATION_INT}}", "{{START_MAX}}", "{{INSTRUCTION}}", "{{CREATOR_SECTION}}", "{{TRANSCRIPT_SECTION}}"],
        "text": (
            "\n"
            "    You are the #1 viral video editor on TikTok with 10 years of experience creating content that gets hundreds of millions of views.\n"
            "    Your job is to watch this video and extract the {{TARGET_CLIPS}} most explosive, attention-grabbing clips that will go viral on TikTok, Reels, and Shorts.\n"
            "\n"
            "    Target Audience: USA (English speakers).\n"
            "    Platform: TikTok / Instagram Reels / YouTube Shorts.\n"
            "\n"
            "    YOUR GOAL: Find exactly {{TARGET_CLIPS}} clips. Each clip MUST be at least {{MIN_DURATION}} seconds long.\n"
            "    Scan the ENTIRE video from start to finish — do not miss moments in the second half.\n"
            "\n"
            "    DISTRIBUTION RULE (CRITICAL): Your {{TARGET_CLIPS}} clips MUST be spread across the full {{DUR_MIN}} minutes.\n"
            "    - First third (0s to {{THIRD1}}s): find clips here\n"
            "    - Middle third ({{THIRD1}}s to {{THIRD2}}s): find clips here\n"
            "    - Last third ({{THIRD2}}s to {{VIDEO_DURATION_INT}}s): find clips here\n"
            "    Do NOT return more than 40% of clips from the first third alone.\n"
            "\n"
            "    WHAT MAKES A CLIP GO VIRAL:\n"
            "    - Hooks viewers in the first 2 seconds — starts at the peak of the action\n"
            "    - Creates an emotional reaction: shock, laughter, tears, anger, or disbelief\n"
            "    - Has a clear story arc even in a short clip\n"
            "    - Makes people want to comment, share, or watch again\n"
            "    - Feels like something people have never seen before\n"
            "\n"
            "    WHAT TO AVOID:\n"
            "    - Slow build-ups or boring introductions\n"
            "    - Clips that need context from earlier in the video\n"
            "    - Dead air, silence, or transitions\n"
            "\n"
            "    INSTRUCTION: {{INSTRUCTION}}\n"
            "    {{CREATOR_SECTION}}\n"
            "    CAPTION RULES (CRITICAL):\n"
            "    - Write in THIRD PERSON only (e.g. \"She finally told the truth\" not \"I told the truth\")\n"
            "    - NO first person: no \"I\", \"me\", \"my\", \"we\"\n"
            "    - Maximum 15 words — short, punchy, scroll-stopping\n"
            "    - Write like a fan account teasing the drama\n"
            "    - NO punctuation of any kind: no periods, no commas, no exclamation marks, no question marks\n"
            "    - Apostrophes in contractions ARE allowed: he's, she's, don't, can't, won't, it's, that's, they're — use them naturally\n"
            "    - All lowercase EXCEPT the very first letter of the caption\n"
            "    - END with EXACTLY ONE emoji that matches the emotion of the moment (TikTok style).\n"
            "      You MUST pick the emoji from THIS EXACT LIST — no other emojis are allowed:\n"
            "        💀 😂 🥺 ✨ 🔥 ❤️ 💪 👀 🤔 ❤️‍🩹 😱 😭 💔 🤯\n"
            "      Match the emoji to the moment's emotion:\n"
            "        * Drama / shock / mind-blown → 😱 🤯 💀 👀\n"
            "        * Funny / \"I'm dead\" → 😂 💀\n"
            "        * Motivational / \"fire\" / strong → 🔥 💪 ✨\n"
            "        * Sad / crying / heartbreak → 😭 💔 🥺 ❤️‍🩹\n"
            "        * Love / wholesome → ❤️ ✨\n"
            "        * Suspicious / thinking / watching → 👀 🤔\n"
            "      Place the emoji at the very end after a space. ONLY ONE emoji per caption.\n"
            "      DO NOT use any emoji that is not in the list above.\n"
            "\n"
            "    Output Format:\n"
            "    Return ONLY a raw JSON list. No markdown, no ```json, no explanation — just the JSON array.\n"
            "    Each object must have:\n"
            "    - \"start_time\": (float) Start time in seconds.\n"
            "    - \"end_time\": (float) End time in seconds.\n"
            "    - \"description\": (string) 3-5 word label for the clip (English).\n"
            "    - \"viral_caption\": (string) Short punchy overlay text. MAX 15 words. No punctuation.\n"
            "    - \"viral_reason\": (string) One sentence explaining the viral potential.\n"
            "    - \"viral_score\": (int) A score from 1 to 10 rating the viral potential of this clip. 10 = guaranteed viral, 1 = boring. Be honest and vary the scores.\n"
            "    - \"viral_score_reason\": (string) One short phrase (max 6 words) explaining the score. Examples: \"Strong emotional hook\", \"Slow build-up\", \"Unexpected twist ending\", \"Weak payoff\".\n"
            "    - \"ig_description\": (string) A long Instagram post caption for this clip. Follow these rules:\n"
            "        * First, try to identify the creator's name from audio, text on screen, or context in the video. If identified, use their real name naturally throughout.\n"
            "        * Write 3-4 paragraphs in English. Start with a hook sentence about this specific moment.\n"
            "        * Paragraph 1: Describe what happens in this clip and why it's a standout moment.\n"
            "        * Paragraph 2: Provide context about the creator — who they are, what they're known for, what makes them interesting.\n"
            "        * Paragraph 3: Why this moment resonates with fans / what the audience reaction will be.\n"
            "        * End with 12-15 highly relevant hashtags on a new line (mix of niche and broad tags).\n"
            "        * Tone: enthusiastic fan account, third person, admiring but not over-the-top. No emojis.\n"
            "\n"
            "    TIMESTAMP RULES (CRITICAL):\n"
            "    1. Use simple decimal numbers only (e.g. 10.5). NO leading zeros.\n"
            "    2. Clip duration MUST be between {{MIN_DURATION}} and 60 seconds. Vary the durations — not all clips the same length.\n"
            "    3. The video is EXACTLY {{VIDEO_DURATION}} seconds long ({{DUR_MIN}} minutes).\n"
            "       - \"start_time\" MUST be less than {{START_MAX}}.\n"
            "       - \"end_time\" MUST be less than or equal to {{VIDEO_DURATION}}.\n"
            "       - Clips beyond {{VIDEO_DURATION}} seconds DO NOT EXIST and will be rejected.\n"
            "\n"
            "    TIMESTAMP ACCURACY (EXTREMELY IMPORTANT):\n"
            "    Before writing each clip's start_time and end_time, STOP and ask yourself:\n"
            "    - \"If I seek to exactly this second in the video, will I see THIS specific moment?\"\n"
            "    - \"Am I 100% sure this timestamp is NOT from a different topic or segment?\"\n"
            "    - \"Does the viral_caption describe EXACTLY what happens at these seconds — not what happens elsewhere?\"\n"
            "    A caption about person X MUST have timestamps where person X actually appears.\n"
            "    A caption about topic Y MUST have timestamps where topic Y is actually discussed.\n"
            "    NEVER assign a caption from one moment to the timestamps of a different moment.\n"
            "    When in doubt about a timestamp, skip that clip entirely.\n"
            "    {{TRANSCRIPT_SECTION}}\n"
            "    "
        ),
    },
    "creator_section": {
        "label": "Bloque de nombre del creador",
        "description": "Se inserta en el prompt principal cuando el usuario indica el nombre del creador/persona.",
        "tokens": ["{{NAMES_LIST}}"],
        "text": (
            "\n"
            "    CREATOR NAME RULES (IMPORTANT):\n"
            "    The person(s) featured in this video: {{NAMES_LIST}}.\n"
            "    - Weave the name into the caption where it flows MOST naturally — it can be\n"
            "      at the start, middle, or end, whatever sounds best. Do NOT force it the\n"
            "      same way every time.\n"
            "    - If MULTIPLE names are listed, identify who appears in THIS specific clip\n"
            "      using on-screen text, spoken names, usernames, or context. Use the name\n"
            "      of the person actually featured in that clip. If you genuinely cannot tell\n"
            "      who it is, use the most prominent / first-listed name.\n"
            "    - Use the name in roughly 60-70% of captions, not every single one — variety\n"
            "      keeps it from looking auto-generated.\n"
            "    - ALWAYS use the name naturally in the \"description\" field too.\n"
            "    - Keep the name's exact capitalization as given (e.g. \"Sophie Rain\").\n"
            "    "
        ),
    },
    "transcript_section": {
        "label": "Bloque de transcript (Whisper)",
        "description": "Se inserta en el prompt principal cuando hay transcripción de Whisper, con los timestamps por palabra.",
        "tokens": ["{{LANGUAGE}}", "{{FULL_TEXT}}", "{{WORDS_SUMMARY}}"],
        "text": (
            "\n"
            "    AUDIO TRANSCRIPT WITH EXACT TIMESTAMPS (USE THESE FOR ACCURACY):\n"
            "    Language detected: {{LANGUAGE}}\n"
            "    Full text: {{FULL_TEXT}}\n"
            "    Word-level timestamps: {{WORDS_SUMMARY}}\n"
            "\n"
            "    CRITICAL: The word timestamps above are 100% accurate. When you identify a viral moment,\n"
            "    use the word timestamps to set start_time and end_time precisely.\n"
            "    Start the clip 0.2s BEFORE the first relevant word. End it 0.3s AFTER the last relevant word.\n"
            "    "
        ),
    },
    "verify_timestamps": {
        "label": "Verificación de timestamps",
        "description": "Segunda pasada: revisa que cada clip coincida con su caption y corrige/descarta. (Reduce el 'caption que no coincide'.)",
        "tokens": ["{{CLIPS_INFO}}", "{{VIDEO_DURATION}}"],
        "text": (
            "You previously identified these clips from this video:\n[\n{{CLIPS_INFO}}\n]\n\n"
            "For EACH clip, seek to its start_time and verify:\n"
            "1. Does the video content at that timestamp actually match the caption and description?\n"
            "2. If NOT, find the CORRECT start_time and end_time where that caption/description actually occurs.\n"
            "3. If the content described in the caption does NOT exist anywhere in the video, mark it invalid.\n\n"
            "Return ONLY a raw JSON array. Each object must have:\n"
            "- \"id\": (int) the clip id\n"
            "- \"valid\": (bool) true if content matches OR was corrected, false if content doesn't exist in video\n"
            "- \"start_time\": (float) correct start time in seconds\n"
            "- \"end_time\": (float) correct end time in seconds\n"
            "- \"corrected\": (bool) true if you changed the timestamps\n"
            "The video is {{VIDEO_DURATION}} seconds long. All timestamps must be within this range."
        ),
    },
    "alternate_captions": {
        "label": "Captions alternativos (rellenar cupos)",
        "description": "Cuando faltan clips para llegar al número pedido, genera captions alternativos para reusar los mejores momentos.",
        "tokens": ["{{CLIPS_INFO}}", "{{NEEDED}}"],
        "text": (
            "For each clip listed below, write ONE alternative viral caption that approaches "
            "the moment from a DIFFERENT angle than the current caption.\n"
            "Each new caption must feel fresh — different wording, different emotion, different hook.\n\n"
            "{{CLIPS_INFO}}\n\n"
            "Return ONLY a raw JSON array where each object has:\n"
            "- \"start_time\": (float) same start time as the clip\n"
            "- \"viral_caption\": (string) NEW caption, max 10 words, no punctuation except apostrophes, "
            "all lowercase except first letter\n"
            "Return exactly {{NEEDED}} objects."
        ),
    },
    "reanalyze_clip": {
        "label": "Reanalizar un clip (botón 🔄)",
        "description": "Genera un caption nuevo mirando SOLO ese clip. Lo mejor cuando un caption quedó incompatible con el video.",
        "tokens": [],
        "text": (
            "Watch this short video clip carefully. "
            "Write a new viral caption that accurately describes what is ACTUALLY happening in this clip. "
            "Rules: English only. Maximum 10 words. Third person only (no I/me/my). "
            "No punctuation except apostrophes. All lowercase except first letter. "
            "End with EXACTLY ONE emoji from this list (and no other): "
            "💀 😂 🥺 ✨ 🔥 ❤️ 💪 👀 🤔 ❤️‍🩹 😱 😭 💔 🤯. "
            "Return ONLY the caption text — nothing else."
        ),
    },
    "meme_crop": {
        "label": "Meme · detectar recorte",
        "description": "Detecta los bordes/marco de un meme de Instagram para recortarlo.",
        "tokens": [],
        "text": (
            "This is a frame from an Instagram meme video. "
            "The actual video content is displayed INSIDE a rectangular frame or box. "
            "Around this box there are borders/padding on all four sides (top, bottom, left, right) "
            "that may be white, black, or a solid color. "
            "Your job: detect the percentage to crop from each side to remove the border/frame "
            "and keep only the inner video content. "
            "Return ONLY this format, no explanation:\n"
            "TOP:X BOTTOM:Y LEFT:Z RIGHT:W\n"
            "X, Y, Z, W are integers 0-50. Use 0 if there is no border on that side."
        ),
    },
    "meme_text": {
        "label": "Meme · texto",
        "description": "Genera el texto del meme (Gen Z) que matchea el video.",
        "tokens": [],
        "text": (
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
        ),
    },
    "music_artist": {
        "label": "Música · detectar artista",
        "description": "Identifica al artista del video musical (solo si está muy seguro).",
        "tokens": [],
        "text": (
            "Listen and watch this music video carefully. "
            "Try to identify the music artist or singer. "
            "Only answer if you are highly confident — do NOT guess or make up names. "
            "If you recognize the artist, respond in this exact format:\n"
            "ARTIST: [full artist name]\n"
            "INSTAGRAM: [@instagram_handle]\n\n"
            "If you cannot identify the artist with high confidence, respond exactly:\n"
            "ARTIST: NONE\n"
            "Return ONLY these lines, nothing else."
        ),
    },
    "music_vibe": {
        "label": "Música · frase de vibe",
        "description": "Frase de ambiente para un clip musical, según la emoción detectada.",
        "tokens": [],
        "text": (
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
        ),
    },
    "ig_description_meme": {
        "label": "Meme · descripción de Instagram",
        "description": "Caption largo de Instagram para un meme.",
        "tokens": ["{{MEME_TEXT}}"],
        "text": (
            "This video's meme caption is: \"{{MEME_TEXT}}\"\n\n"
            "Write a long Instagram post caption for this meme video. "
            "Write it as a funny, relatable Gen Z meme account post in English. "
            "Use 3-4 short paragraphs (1-3 sentences each). "
            "Max 2 emojis total. "
            "At the very end, after all the text, include EXACTLY 3 relevant hashtags. "
            "The hashtags must be the absolute last thing in the caption, on their own line. "
            "Return ONLY the caption — no labels, no extra words."
        ),
    },
    "ig_description_music": {
        "label": "Música · descripción de Instagram",
        "description": "Caption largo de Instagram para un clip musical.",
        "tokens": ["{{MEME_TEXT}}"],
        "text": (
            "This music clip's vibe phrase is: \"{{MEME_TEXT}}\"\n\n"
            "Write a long Instagram post caption for this music clip. "
            "Write it as an engaging music fan account post in English. "
            "Talk about the feeling, energy, and mood of the song. "
            "Use 3-4 short paragraphs (1-3 sentences each). "
            "Max 2 emojis total. "
            "At the very end, after all the text, include EXACTLY 3 relevant music hashtags. "
            "The hashtags must be the absolute last thing in the caption, on their own line. "
            "Return ONLY the caption — no labels, no extra words."
        ),
    },
}

# ── Override persistence ──────────────────────────────────────────────────────
_overrides: dict = {}


def _load():
    global _overrides
    try:
        if os.path.exists(_OVERRIDES_FILE):
            with open(_OVERRIDES_FILE, "r", encoding="utf-8") as f:
                _overrides = json.load(f) or {}
    except Exception as e:
        print(f"[prompts] failed to load overrides: {e}")
        _overrides = {}


def _save():
    try:
        with open(_OVERRIDES_FILE, "w", encoding="utf-8") as f:
            json.dump(_overrides, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[prompts] failed to save overrides: {e}")


_load()


# ── Public API ────────────────────────────────────────────────────────────────
def get_text(key: str) -> str:
    """The active template for a key (override if set, else default)."""
    if key in _overrides and isinstance(_overrides[key], str) and _overrides[key].strip():
        return _overrides[key]
    return DEFAULTS.get(key, {}).get("text", "")


def render(key: str, **tokens) -> str:
    """Active template with {{TOKEN}} markers replaced by the given values."""
    text = get_text(key)
    for name, val in tokens.items():
        text = text.replace("{{" + name + "}}", str(val))
    return text


def list_all() -> list:
    """All prompts for the editor UI: key, label, description, tokens, default, current."""
    out = []
    for key, meta in DEFAULTS.items():
        out.append({
            "key": key,
            "label": meta["label"],
            "description": meta["description"],
            "tokens": meta["tokens"],
            "default": meta["text"],
            "current": get_text(key),
            "overridden": key in _overrides and bool(str(_overrides.get(key, "")).strip()),
        })
    return out


def set_override(key: str, text: str):
    if key not in DEFAULTS:
        raise KeyError(key)
    _overrides[key] = text
    _save()


def reset(key: str = None):
    """Remove one override (key given) or all overrides (key=None)."""
    global _overrides
    if key is None:
        _overrides = {}
    else:
        _overrides.pop(key, None)
    _save()
