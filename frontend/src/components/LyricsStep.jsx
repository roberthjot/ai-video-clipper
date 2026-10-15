import { useState, useEffect, useRef } from "react";
import * as api from "../services/api";
import {
  Music2, Upload, Sparkles, Film, Check, Play, Download,
  Loader2, Trash2, Plus, Sliders, RefreshCw, CheckCircle2, AlertCircle,
  Type, RotateCcw
} from "lucide-react";

const _SUB_OUTLINE = "1.2px 1.2px 0 #000,-1.2px 1.2px 0 #000,1.2px -1.2px 0 #000,-1.2px -1.2px 0 #000,0 2px 4px rgba(0,0,0,.55)";
const _SUB_KARA = {
  karaoke: "#ffe14d",
  karaoke_green: "#37e06a",
  karaoke_blue: "#3dd6ff",
  karaoke_pink: "#ff5db1",
  karaoke_red: "#ff4d4d",
  karaoke_orange: "#ff9f3d",
  karaoke_purple: "#c77dff"
};
const _SUB_BOX = {
  highlight: ["#ffe14d", "#000"],
  box_green: ["#37e06a", "#000"],
  box_blue: ["#2f7bff", "#fff"],
  box_pink: ["#ff5db1", "#000"],
  box_red: ["#ff3b3b", "#fff"]
};

function SubThumb({ styleKey, label, selected, onClick }) {
  const base = {
    fontFamily: '"Arial Black", Impact, system-ui, sans-serif',
    fontWeight: 900,
    color: "#fff",
    lineHeight: 1.04,
    textShadow: _SUB_OUTLINE,
    letterSpacing: ".3px",
    textAlign: "center",
    whiteSpace: "nowrap",
  };
  let body;
  if (styleKey === "standard") {
    body = (
      <span style={{
        fontFamily: '"Arial", "Helvetica Neue", sans-serif',
        fontWeight: 700, fontSize: 11, color: "#fff",
        textShadow: "1px 1px 0 #000,-1px 1px 0 #000,1px -1px 0 #000,-1px -1px 0 #000",
        letterSpacing: "1px", textTransform: "uppercase"
      }}>
        NETFLIX
      </span>
    );
  } else if (styleKey === "impact") {
    body = (
      <span style={{ fontFamily: "Impact, sans-serif", fontSize: 14, color: "#fff", textShadow: _SUB_OUTLINE, letterSpacing: "0.5px" }}>
        SATURN
      </span>
    );
  } else if (styleKey === "slant") {
    body = (
      <span style={{ ...base, fontSize: 13, fontStyle: "italic" }}>
        CURSIVA
      </span>
    );
  } else if (_SUB_KARA[styleKey]) {
    body = (
      <span style={{ ...base, fontSize: 12 }}>
        LA <span style={{ color: _SUB_KARA[styleKey] }}>PLENA</span>
      </span>
    );
  } else if (_SUB_BOX[styleKey]) {
    body = (
      <span style={{ ...base, fontSize: 12 }}>
        LE <span style={{ background: _SUB_BOX[styleKey][0], color: _SUB_BOX[styleKey][1], textShadow: "none", padding: "1px 4px", borderRadius: 3 }}>DIGO</span>
      </span>
    );
  } else if (styleKey === "neon") {
    body = (
      <span style={{ ...base, fontSize: 13, textShadow: "0 0 6px #3dd6ff,0 0 11px #3dd6ff,1.2px 1.2px 0 #000,-1.2px 1.2px 0 #000" }}>
        NEÓN
      </span>
    );
  } else if (styleKey === "line_box") {
    body = (
      <span style={{ ...base, fontSize: 11, textShadow: "none", background: "#000", color: "#fff", padding: "2px 6px", borderRadius: 3 }}>
        LINE BOX
      </span>
    );
  } else if (styleKey === "underline") {
    body = (
      <span style={{ ...base, fontSize: 12 }}>
        TU <span style={{ textDecoration: "underline", textDecorationThickness: "2px", textUnderlineOffset: "2px" }}>CARA</span>
      </span>
    );
  } else if (styleKey === "bubble") {
    body = (
      <span style={{ ...base, textShadow: "none", background: "#fff", color: "#000", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>
        BUBBLE
      </span>
    );
  } else if (styleKey === "reveal") {
    body = (
      <span style={{ ...base, fontSize: 12 }}>
        UNO DOS <span style={{ display: "inline-block", fontSize: 14 }}>TRES</span>
      </span>
    );
  } else if (styleKey === "stack") {
    body = (
      <span style={{ ...base, fontSize: 9, lineHeight: 1.0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span>OYE</span><span style={{ color: "#ffe14d" }}>PASA</span><span>TODO</span>
      </span>
    );
  } else if (styleKey === "hollow") {
    body = (
      <span style={{ fontFamily: '"Arial Black", Impact, sans-serif', fontWeight: 900, fontSize: 13, color: "transparent", WebkitTextStroke: "1.4px #fff" }}>
        HOLLOW
      </span>
    );
  } else if (styleKey === "retro") {
    body = (
      <span style={{ ...base, fontSize: 13, textShadow: "3px 3px 0 #ff2db8,1px 1px 0 #000,-1px -1px 0 #000" }}>
        RETRO
      </span>
    );
  } else if (styleKey === "popup") {
    body = <span style={{ ...base, fontSize: 16 }}>BEAST</span>;
  } else if (styleKey === "big_center") {
    body = <span style={{ ...base, fontSize: 17 }}>HUGE</span>;
  } else if (styleKey === "twoword") {
    body = <span style={{ ...base, fontSize: 13 }}>DOS PALABRAS</span>;
  } else if (styleKey === "bounce") {
    body = <span style={{ ...base, fontSize: 14, display: "inline-block", transform: "rotate(-4deg)" }}>BOUNCE</span>;
  } else if (styleKey === "typewriter") {
    body = <span style={{ ...base, fontSize: 12 }}>TYPING<span style={{ opacity: 0.65 }}>|</span></span>;
  } else if (styleKey === "word_zoom") {
    body = <span style={{ ...base, fontSize: 17, letterSpacing: ".5px" }}>ZOOM</span>;
  } else if (styleKey === "word_yellow") {
    body = <span style={{ ...base, fontSize: 16, color: "#ffe14d" }}>WORD</span>;
  } else if (styleKey === "word_box") {
    body = <span style={{ ...base, textShadow: "none", background: "#fff", color: "#000", padding: "2px 6px", borderRadius: 4, fontSize: 14 }}>WORD</span>;
  } else if (styleKey === "word_neon") {
    body = <span style={{ ...base, fontSize: 15, textShadow: "0 0 7px #3dd6ff,0 0 13px #3dd6ff,1.2px 1.2px 0 #000,-1.2px 1.2px 0 #000" }}>NEÓN</span>;
  } else if (styleKey === "word_3d") {
    body = <span style={{ ...base, fontSize: 15, textShadow: "3px 3px 0 #ff2db8,1.2px 1.2px 0 #000,-1.2px 1.2px 0 #000" }}>3D</span>;
  } else if (styleKey === "word_rotate") {
    body = <span style={{ ...base, fontSize: 15, display: "inline-block", transform: "rotate(-10deg)" }}>SPIN</span>;
  } else if (styleKey === "word_glitch") {
    body = <span style={{ ...base, fontSize: 15, textShadow: "-2px 0 #ff2d2d, 2px 0 #00e5ff, 1.2px 1.2px 0 #000,-1.2px -1.2px 0 #000" }}>GLITCH</span>;
  } else if (styleKey === "word_outline") {
    body = <span style={{ fontFamily: '"Arial Black", Impact, sans-serif', fontWeight: 900, fontSize: 15, color: "#fff", WebkitTextStroke: "2.5px #ffe14d", textShadow: "0 0 3px #000" }}>BORDE</span>;
  } else if (styleKey === "word_gold") {
    body = <span style={{ ...base, fontSize: 15, color: "#e6b422", textShadow: "1.2px 1.2px 0 #3a2a08,-1.2px -1.2px 0 #3a2a08" }}>GOLD</span>;
  } else if (styleKey === "word_comic") {
    body = <span style={{ fontFamily: '"Arial Black", Impact, sans-serif', fontWeight: 900, fontSize: 15, color: "#fff", WebkitTextStroke: "2.5px #e0301f" }}>COMIC</span>;
  } else if (styleKey === "word_italic") {
    body = <span style={{ ...base, fontSize: 15, fontStyle: "italic", display: "inline-block", transform: "skewX(-9deg)" }}>ITALIC</span>;
  } else if (styleKey === "word_strip") {
    body = <span style={{ ...base, textShadow: "none", background: "rgba(0,0,0,.65)", padding: "2px 8px", fontSize: 14 }}>BARRA</span>;
  } else if (styleKey === "word_minimal") {
    body = <span style={{ fontFamily: '"Arial", sans-serif', fontWeight: 700, fontSize: 13, color: "#fff", textTransform: "lowercase" }}>minimal</span>;
  } else if (styleKey === "word_longshadow") {
    body = <span style={{ ...base, fontSize: 15, textShadow: "2px 2px 0 #111,4px 4px 0 #111,6px 6px 0 #111" }}>SHADOW</span>;
  } else {
    body = <span style={{ ...base, fontSize: 12 }}>CLEAN</span>;
  }

  return (
    <div
      onClick={onClick}
      title={label}
      style={{
        cursor: "pointer",
        borderRadius: 8,
        overflow: "hidden",
        position: "relative",
        height: 52,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 4px",
        background: selected ? "rgba(99, 102, 241, 0.18)" : "radial-gradient(120% 120% at 50% 30%, #232323, #0b0b0b)",
        border: selected ? "2px solid var(--st-accent)" : "1px solid var(--st-line)",
        boxShadow: selected ? "0 0 10px rgba(99, 102, 241, 0.35)" : "none",
        transition: "all 0.15s ease",
      }}
    >
      <div style={{ transform: "scale(0.92)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {body}
      </div>
      <span style={{
        position: "absolute",
        bottom: 2,
        left: 0,
        right: 0,
        textAlign: "center",
        fontSize: 8,
        color: selected ? "var(--st-accent)" : "rgba(255,255,255,.55)",
        fontWeight: selected ? 700 : 400,
        fontFamily: "var(--st-mono)",
        letterSpacing: ".3px",
        pointerEvents: "none",
        textOverflow: "ellipsis",
        overflow: "hidden",
        whiteSpace: "nowrap",
        padding: "0 2px"
      }}>
        {label}
      </span>
    </div>
  );
}

const SUB_CATEGORIES = [
  { id: "all", label: "Todos (42)" },
  { id: "karaoke", label: "Karaoke" },
  { id: "viral", label: "1 Palabra / Viral" },
  { id: "boxes", label: "Cajas & Colores" },
  { id: "effects", label: "Efectos & Retro" },
  { id: "clean", label: "Clásicos / Limpios" },
];

const ALL_SUB_STYLES = [
  // Karaoke
  { key: "karaoke", label: "Karaoke Amarillo", category: "karaoke" },
  { key: "karaoke_green", label: "Karaoke Verde", category: "karaoke" },
  { key: "karaoke_blue", label: "Karaoke Azul", category: "karaoke" },
  { key: "karaoke_pink", label: "Karaoke Rosa", category: "karaoke" },
  { key: "karaoke_red", label: "Karaoke Rojo", category: "karaoke" },
  { key: "karaoke_orange", label: "Karaoke Naranja", category: "karaoke" },
  { key: "karaoke_purple", label: "Karaoke Morado", category: "karaoke" },
  { key: "underline", label: "Subrayado", category: "karaoke" },

  // Viral / 1 Palabra
  { key: "popup", label: "Pop-up (MrBeast)", category: "viral" },
  { key: "word_glitch", label: "Glitch RGB", category: "viral" },
  { key: "word_neon", label: "Neón Cyan", category: "viral" },
  { key: "word_3d", label: "3D Magenta", category: "viral" },
  { key: "word_outline", label: "Doble Borde", category: "viral" },
  { key: "word_gold", label: "Gold Metálico", category: "viral" },
  { key: "word_comic", label: "Comic Pop", category: "viral" },
  { key: "word_zoom", label: "Zoom Hormozi", category: "viral" },
  { key: "word_yellow", label: "Palabra Amarilla", category: "viral" },
  { key: "word_box", label: "Palabra Caja", category: "viral" },
  { key: "word_rotate", label: "Giro Spin", category: "viral" },
  { key: "word_italic", label: "Itálica Slant", category: "viral" },
  { key: "word_strip", label: "Barra Negra", category: "viral" },
  { key: "word_longshadow", label: "Long Shadow", category: "viral" },
  { key: "word_minimal", label: "Minimal", category: "viral" },
  { key: "bounce", label: "Bounce Jump", category: "viral" },
  { key: "big_center", label: "Big Center", category: "viral" },
  { key: "twoword", label: "Two-Word", category: "viral" },

  // Cajas
  { key: "highlight", label: "Highlight Amarillo", category: "boxes" },
  { key: "box_green", label: "Caja Verde", category: "boxes" },
  { key: "box_blue", label: "Caja Azul", category: "boxes" },
  { key: "box_pink", label: "Caja Rosa", category: "boxes" },
  { key: "box_red", label: "Caja Roja", category: "boxes" },
  { key: "bubble", label: "Burbuja Blanca", category: "boxes" },
  { key: "line_box", label: "Caja Línea", category: "boxes" },

  // Efectos & Retro
  { key: "retro", label: "Retro 3D 80s", category: "effects" },
  { key: "neon", label: "Neón Frase", category: "effects" },
  { key: "typewriter", label: "Typewriter", category: "effects" },
  { key: "reveal", label: "Aparece Reveal", category: "effects" },
  { key: "stack", label: "Vertical Stack", category: "effects" },
  { key: "hollow", label: "Contorno", category: "effects" },

  // Clásicos / Limpios
  { key: "standard", label: "Estándar Netflix", category: "clean" },
  { key: "clean", label: "Limpio White", category: "clean" },
  { key: "impact", label: "Impact (Saturn)", category: "clean" },
  { key: "slant", label: "Arial Black Cursiva", category: "clean" },
];

export default function LyricsStep() {
  const [audioFile, setAudioFile] = useState(null);
  const [audioId, setAudioId] = useState(null);
  const [audioName, setAudioName] = useState("");
  const [audioDuration, setAudioDuration] = useState(0);
  const [uploadingAudio, setUploadingAudio] = useState(false);

  // Background clips
  const [stockClips, setStockClips] = useState([]);
  const [selectedClips, setSelectedClips] = useState(["clip1", "clip2", "clip3", "clip4", "clip5", "clip6", "clip7", "clip8"]);
  const [userClips, setUserClips] = useState([]);
  const [uploadingClip, setUploadingClip] = useState(false);

  // Subtitles / Styles
  const [subStyle, setSubStyle] = useState("karaoke");
  const [activeCategory, setActiveCategory] = useState("all");
  const [fontSize, setFontSize] = useState(80);
  const [subtitleY, setSubtitleY] = useState(0.16);
  const [cards, setCards] = useState([]);
  const [transcribing, setTranscribing] = useState(false);

  // Audio trim
  const [startTrim, setStartTrim] = useState(0);
  const [endTrim, setEndTrim] = useState(0);

  // Rendering
  const [rendering, setRendering] = useState(false);
  const [renderedUrl, setRenderedUrl] = useState(null);
  const [renderedFilename, setRenderedFilename] = useState(null);
  const [renderedStyle, setRenderedStyle] = useState("karaoke");
  const [error, setError] = useState("");

  const audioInputRef = useRef(null);
  const clipInputRef = useRef(null);

  // Load stock clips and pre-load Beéle demo on mount
  useEffect(() => {
    api.getStockClips()
      .then((data) => setStockClips(data))
      .catch((err) => console.error("Error loading stock clips:", err));

    api.getLyricsDemo()
      .then((demo) => {
        setAudioId(demo.audio_id);
        setAudioName(demo.audio_name);
        setAudioDuration(demo.duration);
        setStartTrim(0);
        setEndTrim(demo.duration);
        setCards(demo.cards || []);
        setRenderedUrl(demo.video_url ? `${demo.video_url}?t=${Date.now()}` : null);
        setRenderedFilename(demo.filename);
        setRenderedStyle("karaoke");
      })
      .catch((err) => console.error("Error loading demo:", err));
  }, []);

  // Handle audio upload
  const handleAudioSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioFile(file);
    setAudioName(file.name);
    setUploadingAudio(true);
    setError("");
    try {
      const res = await api.uploadLyricsAudio(file);
      setAudioId(res.audio_id);
      setAudioDuration(res.duration);
      setStartTrim(0);
      setEndTrim(res.duration);
      // Auto-transcribe upon upload
      runTranscribe(res.audio_id, subStyle);
    } catch (err) {
      setError("Error subiendo el audio: " + err.message);
    } finally {
      setUploadingAudio(false);
    }
  };

  // Run Whisper transcription
  const runTranscribe = async (targetAudioId = audioId, targetStyle = subStyle) => {
    if (!targetAudioId) return;
    setTranscribing(true);
    setError("");
    try {
      const res = await api.transcribeLyrics(targetAudioId, targetStyle);
      setCards(res.cards || []);
    } catch (err) {
      setError("Error transcribiendo: " + err.message);
    } finally {
      setTranscribing(false);
    }
  };

  // Upload user clip
  const handleUserClipUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingClip(true);
    try {
      const res = await api.uploadLyricsClip(file);
      setUserClips((prev) => [...prev, { id: res.clip_id, name: res.filename }]);
      setSelectedClips((prev) => [...prev, res.clip_id]);
    } catch (err) {
      setError("Error subiendo clip: " + err.message);
    } finally {
      setUploadingClip(false);
    }
  };

  // Toggle clip selection
  const toggleClip = (id) => {
    setSelectedClips((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  // Edit card text or times
  const updateCard = (index, field, value) => {
    setCards((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const removeCard = (index) => {
    setCards((prev) => prev.filter((_, i) => i !== index));
  };

  const addCard = () => {
    const last = cards[cards.length - 1];
    const start = last ? last.end : 0;
    setCards((prev) => [...prev, { text: "NUEVA FRASE", start, end: start + 1.5 }]);
  };

  const shiftAllCards = (delta) => {
    setCards((prev) =>
      prev.map((c) => ({
        ...c,
        start: Math.max(0, +(parseFloat(c.start) + delta).toFixed(2)),
        end: Math.max(0.2, +(parseFloat(c.end) + delta).toFixed(2)),
      }))
    );
  };

  // Render the video
  const handleRender = async () => {
    if (!audioId) {
      setError("Sube un audio antes de renderizar.");
      return;
    }
    if (cards.length === 0) {
      setError("No hay subtítulos para mostrar.");
      return;
    }
    setRendering(true);
    setError("");
    setRenderedUrl(null);
    try {
      const res = await api.renderLyricsEdit({
        audio_id: audioId,
        clip_ids: selectedClips,
        cards: cards.map((c) => ({
          text: c.text,
          start: parseFloat(c.start),
          end: parseFloat(c.end),
        })),
        font_style: subStyle,
        font_size: parseInt(fontSize, 10),
        subtitle_y: parseFloat(subtitleY),
        start_trim: parseFloat(startTrim),
        end_trim: parseFloat(endTrim),
      });
      setRenderedUrl(`${api.getLyricsVideoUrl(res.filename)}?t=${Date.now()}`);
      setRenderedFilename(res.filename);
      setRenderedStyle(subStyle);
    } catch (err) {
      setError("Error al renderizar el video: " + err.message);
    } finally {
      setRendering(false);
    }
  };

  // Filter styles by active category
  const filteredStyles = activeCategory === "all"
    ? ALL_SUB_STYLES
    : ALL_SUB_STYLES.filter((s) => s.category === activeCategory);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px 80px" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10, background: "var(--st-accent)",
            display: "grid", placeItems: "center"
          }}>
            <Music2 size={18} style={{ color: "var(--st-on-accent)" }} />
          </div>
          <h1 style={{
            fontFamily: "var(--st-display)", fontSize: 26, fontWeight: 700,
            color: "var(--st-text)", margin: 0, letterSpacing: "-.02em"
          }}>
            Lyric Edits (Estilo Saturn / Rolitas)
          </h1>
        </div>
        <p style={{
          fontFamily: "var(--st-ui)", fontSize: 14, color: "var(--st-muted)", margin: 0, maxWidth: 740
        }}>
          Crea videos musicales en formato vertical 9:16 con fondo negro, montaje de clips estéticos y cualquiera de los <strong>42 estilos de subtítulos</strong> disponibles (Karaoke, Glitch, Neón, 3D, Pop-up, Cajas, Retro y más).
        </p>
      </div>

      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
          borderRadius: 8, background: "#fee2e2", color: "#991b1b", marginBottom: 20,
          fontFamily: "var(--st-ui)", fontSize: 13
        }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 24, alignItems: "start" }}>
        {/* Left Column: Audio + Backgrounds + Full Subtitle Gallery */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* 1. Audio Section */}
          <div style={{
            background: "var(--st-surface)", border: "1px solid var(--st-border)",
            borderRadius: 14, padding: 20
          }}>
            <div style={{
              fontFamily: "var(--st-ui)", fontSize: 12, fontWeight: 700, letterSpacing: ".06em",
              textTransform: "uppercase", color: "var(--st-muted)", marginBottom: 12
            }}>
              1. Canción / Audio
            </div>

            <input
              type="file"
              ref={audioInputRef}
              accept="audio/*,video/*"
              style={{ display: "none" }}
              onChange={handleAudioSelect}
            />

            {!audioId ? (
              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                disabled={uploadingAudio}
                style={{
                  width: "100%", padding: "26px 16px", border: "2px dashed var(--st-line)",
                  borderRadius: 10, background: "var(--st-soft)", cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8
                }}
              >
                {uploadingAudio ? (
                  <>
                    <Loader2 size={24} className="animate-spin" style={{ color: "var(--st-muted)" }} />
                    <span style={{ fontFamily: "var(--st-ui)", fontSize: 13, color: "var(--st-muted)" }}>
                      Subiendo y procesando audio...
                    </span>
                  </>
                ) : (
                  <>
                    <Upload size={24} style={{ color: "var(--st-muted)" }} />
                    <span style={{ fontFamily: "var(--st-ui)", fontWeight: 600, fontSize: 14, color: "var(--st-text)" }}>
                      Seleccionar canción o video (MP3, WAV, MP4)
                    </span>
                    <span style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)" }}>
                      Whisper transcribirá la letra automáticamente
                    </span>
                  </>
                )}
              </button>
            ) : (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 14px", borderRadius: 8, background: "var(--st-soft)", border: "1px solid var(--st-line)"
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: "var(--st-ui)", fontWeight: 600, fontSize: 13, color: "var(--st-text)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                    {audioName}
                  </div>
                  <div style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-muted)" }}>
                    Duración: {audioDuration}s
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => audioInputRef.current?.click()}
                  style={{
                    background: "none", border: "1px solid var(--st-border)", borderRadius: 6,
                    padding: "4px 8px", cursor: "pointer", fontFamily: "var(--st-ui)", fontSize: 11, color: "var(--st-muted)"
                  }}
                >
                  Cambiar
                </button>
              </div>
            )}
          </div>

          {/* 2. Background Clips Montage */}
          <div style={{
            background: "var(--st-surface)", border: "1px solid var(--st-border)",
            borderRadius: 14, padding: 20
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{
                fontFamily: "var(--st-ui)", fontSize: 12, fontWeight: 700, letterSpacing: ".06em",
                textTransform: "uppercase", color: "var(--st-muted)"
              }}>
                2. Videos de Fondo (Montaje Multi-Clip)
              </div>
              <button
                type="button"
                onClick={() => clipInputRef.current?.click()}
                disabled={uploadingClip}
                style={{
                  background: "none", border: "none", color: "var(--st-accent)", cursor: "pointer",
                  fontFamily: "var(--st-ui)", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4
                }}
              >
                <Plus size={13} /> Subir tu propio clip
              </button>
              <input
                type="file"
                ref={clipInputRef}
                accept="video/*"
                style={{ display: "none" }}
                onChange={handleUserClipUpload}
              />
            </div>

            <p style={{ fontFamily: "var(--st-ui)", fontSize: 12, color: "var(--st-muted)", margin: "0 0 12px" }}>
              Selecciona los clips que se mostrarán secuencialmente en el centro de la pantalla:
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {stockClips.map((c) => {
                const active = selectedClips.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleClip(c.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                      borderRadius: 8, border: active ? "1.5px solid var(--st-accent)" : "1px solid var(--st-line)",
                      background: active ? "var(--st-soft)" : "var(--st-surface)", cursor: "pointer",
                      textAlign: "left"
                    }}
                  >
                    <div style={{
                      width: 16, height: 16, borderRadius: 4, border: "1px solid var(--st-border)",
                      background: active ? "var(--st-accent)" : "transparent",
                      display: "grid", placeItems: "center"
                    }}>
                      {active && <Check size={11} style={{ color: "var(--st-on-accent)" }} />}
                    </div>
                    <span style={{ fontFamily: "var(--st-ui)", fontSize: 12, color: "var(--st-text)", fontWeight: active ? 600 : 400 }}>
                      {c.name}
                    </span>
                  </button>
                );
              })}

              {userClips.map((c) => {
                const active = selectedClips.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleClip(c.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                      borderRadius: 8, border: active ? "1.5px solid var(--st-accent)" : "1px solid var(--st-line)",
                      background: active ? "var(--st-soft)" : "var(--st-surface)", cursor: "pointer",
                      textAlign: "left"
                    }}
                  >
                    <div style={{
                      width: 16, height: 16, borderRadius: 4, border: "1px solid var(--st-border)",
                      background: active ? "var(--st-accent)" : "transparent",
                      display: "grid", placeItems: "center"
                    }}>
                      {active && <Check size={11} style={{ color: "var(--st-on-accent)" }} />}
                    </div>
                    <span style={{ fontFamily: "var(--st-ui)", fontSize: 12, color: "var(--st-text)", fontWeight: active ? 600 : 400, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                      {c.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Subtitles Catalog (All 42 styles!) */}
          <div style={{
            background: "var(--st-surface)", border: "1px solid var(--st-border)",
            borderRadius: 14, padding: 20
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{
                fontFamily: "var(--st-ui)", fontSize: 12, fontWeight: 700, letterSpacing: ".06em",
                textTransform: "uppercase", color: "var(--st-muted)", display: "flex", alignItems: "center", gap: 6
              }}>
                <Type size={14} /> 3. Estilos de Subtítulos Disponibles ({ALL_SUB_STYLES.length})
              </div>
              <span style={{
                fontFamily: "var(--st-mono)", fontSize: 11, padding: "2px 8px", borderRadius: 99,
                background: "var(--st-soft)", border: "1px solid var(--st-line)", color: "var(--st-accent)", fontWeight: 600
              }}>
                Activo: {ALL_SUB_STYLES.find(s => s.key === subStyle)?.label || subStyle}
              </span>
            </div>

            {/* Category filter tabs */}
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 14 }}>
              {SUB_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  style={{
                    padding: "5px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                    fontSize: 11, fontWeight: 600, fontFamily: "var(--st-ui)", whiteSpace: "nowrap",
                    background: activeCategory === cat.id ? "var(--st-accent)" : "var(--st-soft)",
                    color: activeCategory === cat.id ? "var(--st-on-accent)" : "var(--st-text)",
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Styles grid */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 7,
              maxHeight: 280, overflowY: "auto", paddingRight: 4, marginBottom: 16
            }}>
              {filteredStyles.map((item) => (
                <SubThumb
                  key={item.key}
                  styleKey={item.key}
                  label={item.label}
                  selected={subStyle === item.key}
                  onClick={() => {
                    setSubStyle(item.key);
                  }}
                />
              ))}
            </div>

            {/* Adjustments: Size & Position */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 12, borderTop: "1px solid var(--st-line)" }}>
              {/* Font Size */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                <span style={{ fontFamily: "var(--st-ui)", fontSize: 12, color: "var(--st-text)" }}>
                  Tamaño del texto: <strong style={{ fontFamily: "var(--st-mono)" }}>{fontSize}px</strong>
                </span>
                <input
                  type="range"
                  min="50"
                  max="140"
                  value={fontSize}
                  onChange={(e) => setFontSize(e.target.value)}
                  style={{ flex: 1, maxWidth: 180 }}
                />
              </div>

              {/* Vertical Position */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: "var(--st-ui)", fontSize: 12, color: "var(--st-text)" }}>
                    Posición vertical:
                  </span>
                  <span style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-muted)" }}>
                    {subtitleY === 0 ? "Default" : (subtitleY > 0 ? `+${Math.round(subtitleY * 100)}%` : `${Math.round(subtitleY * 100)}%`)}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, maxWidth: 220 }}>
                  <input
                    type="range"
                    min="-0.30"
                    max="0.30"
                    step="0.02"
                    value={subtitleY}
                    onChange={(e) => setSubtitleY(parseFloat(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    title="Restablecer posición"
                    onClick={() => setSubtitleY(0.10)}
                    style={{
                      background: "none", border: "1px solid var(--st-border)", borderRadius: 4,
                      padding: "2px 4px", cursor: "pointer", color: "var(--st-muted)", display: "flex", alignItems: "center"
                    }}
                  >
                    <RotateCcw size={11} />
                  </button>
                </div>
              </div>

              {/* Quick position presets */}
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { label: "Sobre el video (Centro)", y: 0.16 },
                  { label: "Sobre el video (Abajo)", y: 0.08 },
                  { label: "Banda negra inferior", y: -0.06 },
                ].map((pos) => (
                  <button
                    key={pos.label}
                    type="button"
                    onClick={() => setSubtitleY(pos.y)}
                    style={{
                      flex: 1, padding: "4px 6px", borderRadius: 6,
                      border: Math.abs(subtitleY - pos.y) < 0.03 ? "1.5px solid var(--st-accent)" : "1px solid var(--st-line)",
                      background: Math.abs(subtitleY - pos.y) < 0.03 ? "var(--st-soft)" : "transparent",
                      color: "var(--st-text)", cursor: "pointer", fontFamily: "var(--st-ui)", fontSize: 10,
                      fontWeight: Math.abs(subtitleY - pos.y) < 0.03 ? 600 : 400
                    }}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Lyrics cards + Render Button */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{
            background: "var(--st-surface)", border: "1px solid var(--st-border)",
            borderRadius: 14, padding: 20
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{
                  fontFamily: "var(--st-ui)", fontSize: 12, fontWeight: 700, letterSpacing: ".06em",
                  textTransform: "uppercase", color: "var(--st-muted)"
                }}>
                  4. Letra sincronizada ({cards.length} frases)
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--st-border)", borderRadius: 6, overflow: "hidden" }}>
                  <button
                    type="button"
                    title="Atrasar todas las frases 0.2s"
                    onClick={() => shiftAllCards(-0.2)}
                    style={{
                      background: "none", border: "none", borderRight: "1px solid var(--st-border)",
                      padding: "4px 6px", cursor: "pointer", fontFamily: "var(--st-mono)", fontSize: 10,
                      color: "var(--st-muted)"
                    }}
                  >
                    -0.2s
                  </button>
                  <button
                    type="button"
                    title="Adelantar todas las frases 0.2s"
                    onClick={() => shiftAllCards(0.2)}
                    style={{
                      background: "none", border: "none",
                      padding: "4px 6px", cursor: "pointer", fontFamily: "var(--st-mono)", fontSize: 10,
                      color: "var(--st-muted)"
                    }}
                  >
                    +0.2s
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => runTranscribe(audioId, subStyle)}
                  disabled={!audioId || transcribing}
                  style={{
                    background: "none", border: "1px solid var(--st-border)", borderRadius: 6,
                    padding: "4px 8px", cursor: "pointer", fontFamily: "var(--st-ui)", fontSize: 11,
                    color: "var(--st-muted)", display: "flex", alignItems: "center", gap: 4
                  }}
                >
                  <RefreshCw size={11} className={transcribing ? "animate-spin" : ""} /> Re-sincronizar
                </button>
                <button
                  type="button"
                  onClick={addCard}
                  style={{
                    background: "none", border: "1px solid var(--st-border)", borderRadius: 6,
                    padding: "4px 8px", cursor: "pointer", fontFamily: "var(--st-ui)", fontSize: 11,
                    color: "var(--st-muted)", display: "flex", alignItems: "center", gap: 4
                  }}
                >
                  <Plus size={11} /> Agregar
                </button>
              </div>
            </div>

            {transcribing ? (
              <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--st-muted)" }}>
                <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} />
                <div style={{ fontFamily: "var(--st-ui)", fontSize: 13 }}>Whisper transcribiendo audio...</div>
              </div>
            ) : cards.length === 0 ? (
              <div style={{ padding: "30px 16px", textAlign: "center", color: "var(--st-faint)", fontFamily: "var(--st-ui)", fontSize: 13 }}>
                Sube un audio a la izquierda para cargar y sincronizar la letra automáticamente.
              </div>
            ) : (
              <div style={{
                maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6,
                paddingRight: 4
              }}>
                {cards.map((card, idx) => {
                  // Dynamic hint style for the card text
                  const isItalic = subStyle === "slant" || subStyle === "word_italic";
                  const isImpact = subStyle === "impact";
                  const isNeon = subStyle.includes("neon");
                  const isGlitch = subStyle.includes("glitch");
                  const isRetro = subStyle === "retro" || subStyle.includes("3d");
                  const isGold = subStyle === "word_gold";

                  return (
                    <div
                      key={idx}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
                        borderRadius: 6, background: "var(--st-soft)", border: "1px solid var(--st-line)"
                      }}
                    >
                      <input
                        type="text"
                        value={card.text}
                        onChange={(e) => updateCard(idx, "text", e.target.value.toUpperCase())}
                        style={{
                          flex: 1, border: "none", background: "transparent",
                          fontFamily: isImpact ? "Impact, sans-serif" : '"Arial Black", Impact, sans-serif',
                          fontStyle: isItalic ? "italic" : "normal",
                          fontWeight: 900,
                          fontSize: 13,
                          color: isGold ? "#e6b422" : "var(--st-text)",
                          textShadow: isNeon ? "0 0 6px #3dd6ff" : (isGlitch ? "-1px 0 #ff2d2d, 1px 0 #00e5ff" : (isRetro ? "1.5px 1.5px 0 #ff2db8" : "none")),
                          letterSpacing: ".02em"
                        }}
                      />
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input
                          type="number"
                          step="0.1"
                          value={card.start}
                          onChange={(e) => updateCard(idx, "start", e.target.value)}
                          style={{
                            width: 48, padding: "2px 4px", fontSize: 11, fontFamily: "var(--st-mono)",
                            borderRadius: 4, border: "1px solid var(--st-border)", background: "var(--st-surface)"
                          }}
                        />
                        <span style={{ fontSize: 10, color: "var(--st-faint)" }}>-</span>
                        <input
                          type="number"
                          step="0.1"
                          value={card.end}
                          onChange={(e) => updateCard(idx, "end", e.target.value)}
                          style={{
                            width: 48, padding: "2px 4px", fontSize: 11, fontFamily: "var(--st-mono)",
                            borderRadius: 4, border: "1px solid var(--st-border)", background: "var(--st-surface)"
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => removeCard(idx)}
                          style={{
                            background: "none", border: "none", padding: "2px 4px",
                            cursor: "pointer", color: "var(--st-faint)"
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Render Action Button */}
          <button
            type="button"
            onClick={handleRender}
            disabled={rendering || !audioId || cards.length === 0}
            style={{
              padding: "14px 20px", borderRadius: 10, border: "none",
              background: rendering ? "var(--st-muted)" : (subStyle !== renderedStyle ? "#4f46e5" : "var(--st-accent)"),
              color: "var(--st-on-accent)", fontFamily: "var(--st-ui)", fontSize: 14,
              fontWeight: 700, cursor: rendering ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              boxShadow: subStyle !== renderedStyle ? "0 0 14px rgba(99, 102, 241, 0.45)" : "0 2px 8px rgba(0,0,0,0.12)",
              transition: "all 0.2s ease"
            }}
          >
            {rendering ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Renderizando Edit con estilo "{ALL_SUB_STYLES.find(s => s.key === subStyle)?.label || subStyle}"...
              </>
            ) : (
              <>
                <Play size={18} fill="currentColor" /> Renderizar Edit con estilo "{ALL_SUB_STYLES.find(s => s.key === subStyle)?.label || subStyle}"
              </>
            )}
          </button>

          {/* Rendered Video Preview */}
          {renderedUrl && (
            <div style={{
              background: "var(--st-surface)", border: "1px solid var(--st-border)",
              borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 12
            }}>
              <div style={{
                fontFamily: "var(--st-ui)", fontSize: 12, fontWeight: 700, letterSpacing: ".06em",
                textTransform: "uppercase", color: "var(--st-ok)", display: "flex", alignItems: "center", gap: 6
              }}>
                <CheckCircle2 size={14} /> Video Generado (Estilo actual: {ALL_SUB_STYLES.find(s => s.key === renderedStyle)?.label || renderedStyle})
              </div>

              {subStyle !== renderedStyle && (
                <div style={{
                  padding: "10px 14px", borderRadius: 8, background: "rgba(245, 158, 11, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.5)", color: "#f59e0b", fontSize: 12,
                  display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--st-ui)"
                }}>
                  <AlertCircle size={16} style={{ flexShrink: 0 }} />
                  <div>
                    Has seleccionado <strong>{ALL_SUB_STYLES.find(s => s.key === subStyle)?.label || subStyle}</strong>. Pulsa el botón arriba para generar el video con este estilo nuevo.
                  </div>
                </div>
              )}

              <div style={{
                background: "#000", borderRadius: 8, overflow: "hidden", display: "grid", placeItems: "center"
              }}>
                <video
                  key={renderedUrl}
                  src={renderedUrl}
                  controls
                  autoPlay
                  style={{ width: "100%", maxHeight: 380, objectFit: "contain" }}
                />
              </div>

              <a
                href={renderedUrl}
                download={renderedFilename || "lyric_edit.mp4"}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  padding: "10px 16px", borderRadius: 8, background: "var(--st-soft)",
                  border: "1px solid var(--st-border)", color: "var(--st-text)",
                  fontFamily: "var(--st-ui)", fontSize: 13, fontWeight: 600, textDecoration: "none"
                }}
              >
                <Download size={15} /> Descargar Video (MP4)
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
