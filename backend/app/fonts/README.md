# Caption fonts

This folder holds optional Google Fonts used by the caption renderer. They
are NOT included in the repo (Google Fonts licensing is permissive but we
don't redistribute them). Download each TTF and drop it here using the
EXACT filename shown below — `video_service.FONT_MAP` looks them up by name.

If a file is missing the renderer silently falls back to Calibri Bold, so
nothing breaks if you skip the download — those font options just won't look
different until you add them.

## Required files (use these exact filenames)

| Font in UI | File to drop here | Direct download |
|---|---|---|
| Montserrat Black | `Montserrat-Black.ttf` | https://fonts.google.com/specimen/Montserrat → click "Get font" → unzip → keep only the `Black 900` (`Montserrat-Black.ttf`) file |
| Poppins Bold | `Poppins-Bold.ttf` | https://fonts.google.com/specimen/Poppins → "Get font" → unzip → `Poppins-Bold.ttf` |
| Bebas Neue | `BebasNeue-Regular.ttf` | https://fonts.google.com/specimen/Bebas+Neue → "Get font" → unzip → `BebasNeue-Regular.ttf` |
| Anton | `Anton-Regular.ttf` | https://fonts.google.com/specimen/Anton → "Get font" → unzip → `Anton-Regular.ttf` |
| Oswald Bold | `Oswald-Bold.ttf` | https://fonts.google.com/specimen/Oswald → "Get font" → unzip → `Oswald-Bold.ttf` |

## Always available (no download needed)

These come pre-installed on Windows and are loaded from `C:/Windows/Fonts/`:

- Calibri Bold (default)
- Arial Black
- Impact
- Verdana Bold
- Segoe UI Black
- Trebuchet MS Bold
