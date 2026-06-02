import { useState, useRef, useCallback, useEffect } from "react";
import "./App.css";
import * as api from "./services/api";
import { useTheme } from "./ThemeContext.jsx";
import { Sun, Moon } from "lucide-react";

// Small light/dark toggle for the header (Studio redesign)
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      className="st-iconbtn"
      style={{ marginLeft: 4 }}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

const GEMINI_VIDEO_MODELS = [
  { val: "gemini-2.5-flash",              label: "⚡ 2.5 Flash",       sub: "1500/día · recomendado" },
  { val: "gemini-2.5-flash-lite",         label: "💡 2.5 Flash Lite",  sub: "1000/día · liviano" },
  { val: "gemini-3.1-flash-lite-preview", label: "🆕 3.1 Flash Lite",  sub: "preview · free" },
  { val: "gemini-3.5-flash",              label: "🚀 3.5 Flash",       sub: "💰 pago · nuevo I/O 26" },
  { val: "gemini-3-flash-preview",        label: "🧪 3 Flash",         sub: "20/día · preview" },
  { val: "gemini-2.5-pro",                label: "🥇 2.5 Pro",         sub: "50/día · mejor calidad" },
  { val: "gemini-3.1-pro-preview",        label: "💎 3.1 Pro",         sub: "💰 pago · top calidad" },
];

function healthColor(status) {
  if (status === "ok") return "#22c55e";
  if (status === "quota") return "#f59e0b";
  if (status === "unavailable") return "#ef4444";
  if (status === "error") return "#a855f7";
  return "#666";
}

function healthLabel(status) {
  if (status === "ok") return "OK";
  if (status === "quota") return "Sin cuota";
  if (status === "unavailable") return "Saturado";
  if (status === "error") return "Error";
  return "Sin check";
}

function ModelSelector({ value, onChange, health = {}, checking = false, onCheck, disabled = false }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: 8 }}>
        {GEMINI_VIDEO_MODELS.map(({ val, label, sub }) => {
          const status = health[val]?.status;
          const color = healthColor(status);
          return (
            <button
              key={val}
              type="button"
              disabled={disabled}
              onClick={() => onChange(val)}
              title={health[val]?.message || val}
              style={{
                padding: "9px 8px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                cursor: disabled ? "wait" : "pointer", transition: "all 0.15s",
                fontFamily: "var(--st-ui)",
                background: value === val ? "var(--st-accent)" : "var(--st-surface)",
                border: value === val ? "1px solid var(--st-accent)" : "1px solid var(--st-border)",
                color: value === val ? "var(--st-on-accent)" : "var(--st-muted)",
                opacity: disabled ? 0.6 : 1,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 10, opacity: 0.7, marginTop: 1 }}>{sub}</div>
              <div style={{ fontSize: 9.5, fontFamily: "var(--st-mono)", color: value === val ? "var(--st-on-accent)" : (status ? color : "var(--st-faint)"), opacity: value === val ? 0.7 : 1, marginTop: 3 }}>
                {healthLabel(status)}
              </div>
            </button>
          );
        })}
      </div>
      {onCheck && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={checking}
          onClick={onCheck}
          style={{ marginTop: 8, padding: "6px 12px", fontSize: 12 }}
        >
          {checking ? "Chequeando..." : "Check modelos"}
        </button>
      )}
    </>
  );
}

// ================================================
// STEP 1: Upload & Config
// ================================================
function UploadStep({ onComplete }) {
  const [file, setFile] = useState(null);
  const [clipCount, setClipCount] = useState(25);
  const [minDuration, setMinDuration] = useState(15);
  const [customPrompt, setCustomPrompt] = useState("");
  const [contentType, setContentType] = useState("drama"); // "drama" | "motivational"
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash"); // which API model
  const [creatorName, setCreatorName] = useState(""); // creator name(s) for captions
  // Analyze a sub-range only (mm:ss format, blank = whole video)
  const [analyzeStartStr, setAnalyzeStartStr] = useState("");
  const [analyzeEndStr, setAnalyzeEndStr] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(""); // upload, analyzing
  const [statusMsg, setStatusMsg] = useState("");
  const [percent, setPercent] = useState(0);
  const [dragover, setDragover] = useState(false);
  const [modelHealth, setModelHealth] = useState({});
  const [checkingModels, setCheckingModels] = useState(false);

  const handleCheckModels = async () => {
    setCheckingModels(true);
    try {
      const result = await api.checkModelHealth(GEMINI_VIDEO_MODELS.map((m) => m.val));
      const next = {};
      for (const item of result.models || []) next[item.model] = item;
      setModelHealth(next);
    } catch (e) {
      alert(`No se pudo chequear modelos: ${e.message}`);
    } finally {
      setCheckingModels(false);
    }
  };
  const [projectIdRef, setProjectIdRef] = useState(null);
  const inputRef = useRef();
  const pollingRef = useRef(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragover(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.type.startsWith("video/")) setFile(dropped);
  }, []);

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);

    // Request notification permission early
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }

    try {
      // Phase 1: Upload to server (with progress)
      setPhase("upload");
      setStatusMsg("Uploading video to server...");
      setPercent(0);

      // Parse mm:ss strings into seconds. Blank = 0 (use full video).
      const parseTime = (s) => {
        if (!s || !s.trim()) return 0;
        const parts = s.trim().split(":").map((p) => parseInt(p, 10) || 0);
        if (parts.length === 1) return parts[0] * 60;       // "10" → 10 min
        if (parts.length === 2) return parts[0] * 60 + parts[1]; // "10:30"
        return parts[0] * 3600 + parts[1] * 60 + parts[2];  // "1:00:00"
      };
      const startSec = parseTime(analyzeStartStr);
      const endSec = parseTime(analyzeEndStr);
      const analyzeDuration = endSec > startSec ? endSec - startSec : 0;

      const uploadRes = await api.uploadVideo(
        file, clipCount, minDuration, customPrompt,
        (pct) => {
          setPercent(pct);
          setStatusMsg(`Uploading video to server... ${pct}%`);
        },
        geminiModel,
        creatorName,
        startSec,
        analyzeDuration
      );

      setProjectIdRef(uploadRes.project_id);

      // Phase 2: Analysis (start + poll status)
      setPhase("analyzing");
      setPercent(10);
      setStatusMsg("Starting AI analysis...");

      // Start analysis (don't await - we'll poll)
      const analyzePromise = api.analyzeVideo(uploadRes.project_id);

      // Poll status while analyzing
      pollingRef.current = setInterval(async () => {
        try {
          const status = await api.getAnalysisStatus(uploadRes.project_id);
          setStatusMsg(status.message);
          setPercent(status.percent);

          if (status.status === "ready" || status.status === "error") {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        } catch {
          // ignore polling errors
        }
      }, 2000);

      // Wait for analysis to complete
      const analyzeRes = await analyzePromise;

      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }

      // Browser notification
      try {
        if (Notification.permission === "granted") {
          new Notification("✅ Análisis listo", {
            body: `${analyzeRes.clips.length} clips encontrados en "${file.name}"`,
            icon: "/favicon.ico",
          });
        }
      } catch {}

      onComplete({
        projectId: uploadRes.project_id,
        clips: analyzeRes.clips,
        filename: uploadRes.filename,
        duration: uploadRes.duration,
      });
    } catch (err) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      setStatusMsg(`Error: ${err.message}`);
      setPercent(0);
      setPhase("error");
      setLoading(false);
    }
  };

  if (loading) {
    const phases = [
      { key: "upload",    icon: "📤", label: "Subiendo video",       desc: "Enviando el archivo al servidor local..." },
      { key: "analyzing", icon: "🧠", label: "Analizando con IA",    desc: "Gemini está viendo tu video completo. No cierres esta ventana." },
    ];
    const currentPhaseIdx = phases.findIndex(p => p.key === phase);
    const currentPhase = phases[currentPhaseIdx] || phases[0];

    return (
      <div style={{ maxWidth: 500, margin: "60px auto", padding: "0 20px" }}>
        {/* Phase steps */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, marginBottom: 36 }}>
          {phases.map((p, idx) => {
            const isDone = idx < currentPhaseIdx;
            const isActive = idx === currentPhaseIdx;
            return (
              <div key={p.key} style={{ display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18,
                    background: isDone ? "var(--st-accent)" : isActive ? "var(--st-accent)" : "var(--st-alt)",
                    color: (isDone || isActive) ? "var(--st-on-accent)" : "var(--st-faint)",
                    border: isActive ? "1px solid var(--st-accent)" : isDone ? "1px solid var(--st-accent)" : "1px solid var(--st-border)",
                    transition: "all 0.2s",
                  }}>
                    {isDone ? "✓" : p.icon}
                  </div>
                  <span style={{ fontSize: 11, color: isActive ? "var(--st-text)" : "var(--st-faint)", fontWeight: isActive ? 600 : 400 }}>
                    {p.label}
                  </span>
                </div>
                {idx < phases.length - 1 && (
                  <div style={{ width: 56, height: 1, background: isDone ? "var(--st-accent)" : "var(--st-border)", margin: "0 8px", marginBottom: 20, transition: "background 0.3s" }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Main card */}
        <div className="st-card" style={{ padding: "32px 28px", textAlign: "center", boxShadow: "var(--st-shadow)" }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>{currentPhase.icon}</div>
          <h3 style={{ margin: "0 0 6px", fontFamily: "var(--st-display)", fontSize: 20, fontWeight: 600 }}>{currentPhase.label}</h3>
          <p style={{ color: "var(--st-muted)", fontSize: 14, margin: "0 0 4px" }}>
            {currentPhase.desc}
          </p>
          {statusMsg && (
            <p style={{ color: "var(--st-muted)", fontSize: 12.5, margin: "0 0 20px", fontFamily: "var(--st-mono)" }}>
              {statusMsg}
            </p>
          )}

          {/* Progress bar */}
          <div style={{ background: "var(--st-alt)", borderRadius: 99, height: 8, overflow: "hidden", marginBottom: 8 }}>
            <div style={{
              height: "100%", borderRadius: 99, background: "var(--st-accent)",
              width: `${percent}%`, transition: "width 0.4s ease",
            }} />
          </div>
          <p style={{ color: "var(--st-faint)", fontFamily: "var(--st-mono)", fontSize: 12.5, margin: 0 }}>{percent}%</p>

          {phase === "analyzing" && (
            <div style={{ marginTop: 20, padding: "12px 16px", background: "var(--st-soft)", borderRadius: 10, border: "1px solid var(--st-line)" }}>
              <p style={{ fontSize: 12, color: "var(--st-muted)", margin: 0, lineHeight: 1.6 }}>
                💡 Mientras esperas, Gemini identifica los momentos más virales, analiza las reacciones y genera los captions automáticamente.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 660, margin: "0 auto" }}>
      {/* Header */}
      <div style={{
        background: "var(--st-surface)",
        borderRadius: 14, padding: "20px 24px", marginBottom: 18,
        border: "1px solid var(--st-line)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 26 }}>🎬</div>
          <div>
            <h2 style={{ margin: 0, fontFamily: "var(--st-display)", fontSize: 19, fontWeight: 600, color: "var(--st-text)", letterSpacing: "-0.02em" }}>Subir video</h2>
            <p style={{ margin: 0, color: "var(--st-muted)", fontSize: 13 }}>
              Gemini mira tu video y encuentra los momentos más virales automáticamente
            </p>
          </div>
        </div>
      </div>

      {/* Upload zone */}
      <div
        className={`upload-zone ${dragover ? "dragover" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
        onDragLeave={() => setDragover(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          borderRadius: 14, marginBottom: 18,
          background: file ? "var(--st-soft)" : "var(--st-soft)",
          border: file ? "1.5px solid var(--st-ok)" : "1.5px dashed var(--st-border)",
          transition: "all 0.15s",
        }}
      >
        <input ref={inputRef} type="file" accept="video/*" hidden
          onChange={(e) => setFile(e.target.files[0])} />
        <div className="icon">{file ? "✅" : "📁"}</div>
        {file ? (
          <div>
            <p style={{ fontWeight: 700, fontSize: 15, color: "var(--st-ok)", margin: "0 0 4px" }}>{file.name}</p>
            <p style={{ color: "var(--st-faint)", fontFamily: "var(--st-mono)", fontSize: 12, margin: 0 }}>{(file.size / 1024 / 1024).toFixed(1)} MB · click para cambiar</p>
          </div>
        ) : (
          <>
            <h3 style={{ margin: "0 0 6px", color: "var(--st-text)" }}>Arrastra tu video aquí</h3>
            <p style={{ color: "var(--st-faint)", fontFamily: "var(--st-mono)", fontSize: 12, margin: 0 }}>o clic para elegir (MP4, MOV, AVI)</p>
          </>
        )}
      </div>

      {/* Config */}
      <div style={{
        background: "var(--st-surface)", borderRadius: 14, padding: "20px 24px",
        border: "1px solid var(--st-line)", marginBottom: 18,
      }}>
        <div className="st-eyebrow" style={{ marginBottom: 16 }}>Configuración</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 6 }}>
              Número de clips
            </label>
            <input
              type="number" value={clipCount}
              onChange={(e) => setClipCount(Math.max(1, parseInt(e.target.value) || 1))}
              min={1} max={50}
              className="st-input" style={{ fontFamily: "var(--st-mono)" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 6 }}>
              Duración mínima (seg)
            </label>
            <input
              type="number" value={minDuration}
              onChange={(e) => setMinDuration(parseInt(e.target.value) || 10)}
              min={5} max={120}
              className="st-input" style={{ fontFamily: "var(--st-mono)" }}
            />
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 6 }}>
            Formato de salida
          </label>
          <div style={{
            background: "var(--st-alt)", border: "1px solid var(--st-border)", borderRadius: 9,
            padding: "9px 12px", color: "var(--st-text)", fontSize: 13.5, fontWeight: 600,
          }}>
            9:16 — TikTok / Reels / Shorts
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 8 }}>
            Modelo de IA
          </label>
          <ModelSelector
            value={geminiModel}
            onChange={setGeminiModel}
            health={modelHealth}
            checking={checkingModels}
            onCheck={handleCheckModels}
          />
          <p style={{ fontSize: 11.5, color: "var(--st-faint)", marginTop: 6, marginBottom: 0 }}>
            Si un modelo da 429 (cuota) o 503 (saturado), cambia a otro. El botón
            <b> Check modelos</b> hace un ping rápido a cada uno y pinta su estado.
          </p>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 8 }}>
            Tipo de contenido
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { val: "drama", label: "🎭 Drama / Entretenimiento" },
              { val: "motivational", label: "💪 Motivacional" },
            ].map(({ val, label }) => (
              <button
                key={val}
                type="button"
                onClick={() => {
                  setContentType(val);
                  setCustomPrompt(val === "motivational"
                    ? "Find the most powerful, inspiring, and motivational moments. Prioritize: life-changing quotes, transformation stories, breakthrough realizations, words of wisdom, advice that hits hard, success principles, mindset shifts, and statements that make viewers want to take action. Skip drama, conflict, complaints, or negative emotions. Each clip MUST leave the viewer feeling inspired, motivated, or with a powerful insight. Start at the PEAK of the impactful statement — not before it builds up."
                    : "");
                }}
                style={{
                  padding: "12px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                  cursor: "pointer", transition: "all 0.15s", fontFamily: "var(--st-ui)",
                  background: contentType === val ? "var(--st-accent)" : "var(--st-surface)",
                  border: contentType === val ? "1px solid var(--st-accent)" : "1px solid var(--st-border)",
                  color: contentType === val ? "var(--st-on-accent)" : "var(--st-muted)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 6 }}>
            🏷️ Nombre del creador / persona (opcional)
          </label>
          <input
            type="text"
            value={creatorName}
            onChange={(e) => setCreatorName(e.target.value)}
            placeholder="e.g. Sophie Rain   ·   varios: Sophie, Piper, Julia, Aishah"
            className="st-input"
          />
          <p style={{ fontSize: 11.5, color: "var(--st-faint)", margin: "6px 0 0" }}>
            Gemini incluye el nombre en captions y títulos donde fluya natural.
            Varios nombres separados por coma — intenta identificar quién sale en cada clip.
          </p>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 6 }}>
            ✂️ Analizar solo un rango (opcional)
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input
              type="text" value={analyzeStartStr}
              onChange={(e) => setAnalyzeStartStr(e.target.value)}
              placeholder="Desde (ej. 5:00)"
              className="st-input" style={{ fontFamily: "var(--st-mono)" }}
            />
            <input
              type="text" value={analyzeEndStr}
              onChange={(e) => setAnalyzeEndStr(e.target.value)}
              placeholder="Hasta (ej. 15:00)"
              className="st-input" style={{ fontFamily: "var(--st-mono)" }}
            />
          </div>
          <p style={{ fontSize: 11.5, color: "var(--st-faint)", margin: "6px 0 0" }}>
            Formato mm:ss (ej. 10:30) o solo minutos (ej. 10). Vacío = analizar todo el video.
            Recomendado: rangos de 10-15 min para mejor precisión de Gemini.
          </p>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 6 }}>
            🧠 Instrucciones para la IA (opcional)
          </label>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="e.g. Find the most dramatic moments. Prioritize funny reactions and confessions..."
            className="st-textarea" style={{ resize: "vertical", minHeight: 80 }}
          />
        </div>
      </div>

      <button
        className="btn btn-primary"
        style={{ width: "100%", fontSize: 14, padding: "13px 0", borderRadius: 11 }}
        disabled={!file}
        onClick={handleSubmit}
      >
        Analizar video
      </button>
    </div>
  );
}

// ================================================
// Clip Editor Modal (zoom / pan / trim with live preview)
// ================================================
// Linear interpolation between keyframes (mirror of the Python helper in
// backend/services/video_service.interpolate_keyframes). t is clip-relative
// seconds. Hold first/last value outside the range.
function interpolateKeyframes(kfs, t) {
  if (!kfs || kfs.length === 0) return { zoom: 1, pan_x: 0, pan_y: 0 };
  const sorted = [...kfs].sort((a, b) => a.time - b.time);
  if (t <= sorted[0].time) return { zoom: sorted[0].zoom, pan_x: sorted[0].pan_x, pan_y: sorted[0].pan_y };
  const last = sorted[sorted.length - 1];
  if (t >= last.time) return { zoom: last.zoom, pan_x: last.pan_x, pan_y: last.pan_y };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (a.time <= t && t < b.time) {
      const u = b.time > a.time ? (t - a.time) / (b.time - a.time) : 0;
      return {
        zoom:  a.zoom  + (b.zoom  - a.zoom)  * u,
        pan_x: a.pan_x + (b.pan_x - a.pan_x) * u,
        pan_y: a.pan_y + (b.pan_y - a.pan_y) * u,
      };
    }
  }
  return { zoom: last.zoom, pan_x: last.pan_x, pan_y: last.pan_y };
}

function ClipEditorModal({ projectId, clip, fillMode = "fit", backgroundStyle = "blur", onClose, onSaved }) {
  const videoRef = useRef(null);
  // Static transform (used when keyframes is empty — backward compat)
  const [zoom, setZoom] = useState(clip.edit_zoom ?? 1.0);
  const [panX, setPanX] = useState(clip.edit_pan_x ?? 0);
  const [panY, setPanY] = useState(clip.edit_pan_y ?? 0);
  // Animated transform — non-empty array switches modal into keyframes mode.
  // Each kf is { time (seconds from clip start), zoom, pan_x, pan_y }.
  const [keyframes, setKeyframes] = useState(() => (clip.keyframes || []).map(k => ({
    time: Number(k.time) || 0,
    zoom: Number(k.zoom) || 1,
    pan_x: Number(k.pan_x) || 0,
    pan_y: Number(k.pan_y) || 0,
  })));
  // Index of the keyframe whose values the sliders edit (null = none, edits
  // static state in non-keyframes mode; auto-defaults to first kf on open).
  const [selectedKfIndex, setSelectedKfIndex] = useState(
    (clip.keyframes && clip.keyframes.length > 0) ? 0 : null
  );
  const [startTime, setStartTime] = useState(clip.start_time);
  const [endTime, setEndTime] = useState(clip.end_time);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingVideo, setLoadingVideo] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Single raw video URL — composition built live with HTML/CSS so the box
  // can be scaled/moved without hiding the surrounding caption/background.
  // Setter exposed so the Retry button can force-reload the source.
  const [videoUrl, setVideoUrl] = useState(() => api.getRawVideoUrl(projectId));
  const bgVideoRef = useRef(null);  // blur background — synced with main video

  // We seek on the video's onLoadedMetadata instead of in a useEffect —
  // videoRef.current exists at mount but the video data isn't ready yet,
  // so currentTime would silently fail. onLoadedMetadata fires when seeking
  // is actually possible. See the <video> element below.

  // Sync the bg blur video's time/play state with the main editable video
  // so pausing/seeking the main also pauses/seeks the bg.
  const syncBg = () => {
    const v = videoRef.current;
    const bg = bgVideoRef.current;
    if (!v || !bg) return;
    if (Math.abs(bg.currentTime - v.currentTime) > 0.3) {
      try { bg.currentTime = v.currentTime; } catch {}
    }
    if (v.paused && !bg.paused) bg.pause();
    else if (!v.paused && bg.paused) bg.play().catch(() => {});
  };

  // Loop within the trim range — when video reaches endTime, jump back to startTime
  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    if (v.currentTime >= endTime) {
      v.currentTime = startTime;
    }
    if (v.currentTime < startTime - 0.5) {
      v.currentTime = startTime;
    }
    syncBg();
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
    // sync immediately
    setTimeout(syncBg, 0);
  };

  const seekTo = (t) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(startTime, Math.min(endTime, t));
    setCurrentTime(v.currentTime);
    setTimeout(syncBg, 0);
  };

  // ─── Keyframes plumbing ─────────────────────────────────────────────────
  // Keyframes mode is "active" whenever the keyframes array has any entries.
  const kfMode = keyframes.length > 0;
  const editingKf = (kfMode && selectedKfIndex !== null && selectedKfIndex < keyframes.length)
    ? keyframes[selectedKfIndex]
    : null;

  // What the sliders SHOW (and edit). In static mode = the static state.
  // In keyframes mode with a selected kf = that kf's values. Without a
  // selected kf, we still show the static state so the sliders aren't blank.
  const sliderZoom = editingKf ? editingKf.zoom : zoom;
  const sliderPanX = editingKf ? editingKf.pan_x : panX;
  const sliderPanY = editingKf ? editingKf.pan_y : panY;

  // Live VISUAL values for the preview box: in static mode = slider values,
  // in keyframes mode = interpolated at the current playhead position so the
  // user sees the animation while scrubbing/playing.
  const tRelative = currentTime - clip.start_time;
  const liveValues = kfMode
    ? interpolateKeyframes(keyframes, tRelative)
    : { zoom: sliderZoom, pan_x: sliderPanX, pan_y: sliderPanY };

  // Smoother preview while playing — RAF polls video.currentTime at 60 Hz
  // (timeupdate fires only ~4 Hz which is too coarse for animated zooms).
  useEffect(() => {
    if (!playing || !kfMode) return;
    let raf;
    const tick = () => {
      if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, kfMode]);

  // Slider onChange dispatch: edit the selected kf if any, else the static.
  const setSliderZoom = (v) => {
    if (editingKf) {
      setKeyframes(prev => prev.map((k, i) => i === selectedKfIndex ? { ...k, zoom: v } : k));
    } else { setZoom(v); }
  };
  const setSliderPanX = (v) => {
    if (editingKf) {
      setKeyframes(prev => prev.map((k, i) => i === selectedKfIndex ? { ...k, pan_x: v } : k));
    } else { setPanX(v); }
  };
  const setSliderPanY = (v) => {
    if (editingKf) {
      setKeyframes(prev => prev.map((k, i) => i === selectedKfIndex ? { ...k, pan_y: v } : k));
    } else { setPanY(v); }
  };

  // Add a keyframe at the current playhead with current visible values.
  // Snapshot interpolated values when keyframes already exist (so the new
  // keyframe doesn't introduce a discontinuity).
  const addKeyframeHere = () => {
    const t = Math.max(0, Math.min(clip.end_time - clip.start_time, tRelative));
    const snap = kfMode ? interpolateKeyframes(keyframes, t) : { zoom, pan_x: panX, pan_y: panY };
    const newKf = { time: t, zoom: snap.zoom, pan_x: snap.pan_x, pan_y: snap.pan_y };
    const next = [...keyframes, newKf].sort((a, b) => a.time - b.time);
    setKeyframes(next);
    setSelectedKfIndex(next.indexOf(newKf));
  };

  const deleteSelectedKf = () => {
    if (selectedKfIndex === null) return;
    setKeyframes(prev => prev.filter((_, i) => i !== selectedKfIndex));
    setSelectedKfIndex(null);
  };

  const selectKfAndSeek = (i) => {
    setSelectedKfIndex(i);
    const kf = keyframes[i];
    if (kf) seekTo(clip.start_time + kf.time);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.editClipTransform(projectId, clip.id, {
        edit_zoom: zoom,
        edit_pan_x: panX,
        edit_pan_y: panY,
        start_time: startTime,
        end_time: endTime,
        keyframes: keyframes,  // wire format already (snake_case)
      });
      onSaved(res.clip);
    } catch (e) {
      alert(`Error guardando: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setZoom(1.0); setPanX(0); setPanY(0);
    setKeyframes([]); setSelectedKfIndex(null);
    setStartTime(clip.start_time); setEndTime(clip.end_time);
    if (videoRef.current) videoRef.current.currentTime = clip.start_time;
  };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const cs = Math.floor((sec % 1) * 10);
    return `${m}:${s.toString().padStart(2, "0")}.${cs}`;
  };

  const clipDur = endTime - startTime;
  const progress = clipDur > 0 ? ((currentTime - startTime) / clipDur) * 100 : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}
           style={{ maxWidth: 1100, width: "92vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>🎬 Editor · Clip {clip.id}: {clip.description}</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#999", fontSize: 24, cursor: "pointer" }}>✕</button>
        </div>

        {/* Box height % matches fill_mode percentages in export_service.py */}
        {(() => null)()}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16 }}>
          {/* Preview — 9:16 canvas with composition built in HTML/CSS:
              - Background: blur of raw video (or solid black)
              - Inner box: editable raw video, sized by fill_mode × zoom
              - Caption overlay: HTML approximation of the caption text */}
          <div>
            <div style={{
              background: "#000", borderRadius: 12, overflow: "hidden",
              aspectRatio: "9 / 16", maxHeight: 540, margin: "0 auto",
              position: "relative",
              containerType: "size",
            }}>
              {/* BACKGROUND — blur of the raw video (cheap CSS) or solid black */}
              {backgroundStyle === "black" ? (
                <div style={{ position: "absolute", inset: 0, background: "#000" }} />
              ) : (
                <video
                  ref={bgVideoRef}
                  src={videoUrl}
                  loop
                  muted
                  playsInline
                  style={{
                    position: "absolute", inset: 0,
                    width: "100%", height: "100%", objectFit: "cover",
                    filter: "blur(24px) brightness(0.55)",
                    transform: "scale(1.1)",  // hide blur edges
                    pointerEvents: "none",
                  }}
                />
              )}
              {/* INNER VIDEO BOX — scaled by fill_mode × zoom, moved by pan.
                  In keyframes mode the size/position come from interpolated
                  liveValues so the user sees the animation in real time. */}
              {(() => {
                const baseHeightPct =
                  fillMode === "fill"   ? 100 :
                  fillMode === "zoom"   ? 90 :
                  fillMode === "small"  ? 78 :
                  fillMode === "medium" ? 65 :
                  fillMode === "mini"   ? 50 :
                  100;  // fit
                // In keyframes mode the pan range is [-100, +100] (full source-
                // crop range). Halve it to match the static overlay-shift feel
                // so the HTML preview ≈ what FFmpeg's zoompan outputs.
                const _z = liveValues.zoom;
                const _px = kfMode ? liveValues.pan_x / 2 : liveValues.pan_x;
                const _py = kfMode ? liveValues.pan_y / 2 : liveValues.pan_y;
                const boxH = baseHeightPct * _z;
                const boxW = 100 * _z;
                return (
                  <div style={{
                    position: "absolute",
                    width: `${boxW}%`,
                    height: `${boxH}%`,
                    left: `${50 + _px}%`,
                    top: `${50 + _py}%`,
                    transform: "translate(-50%, -50%)",
                    overflow: "hidden",
                    transition: kfMode ? "none" : "all 0.05s linear",
                    zIndex: 1,
                  }}>
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={() => {
                        // Seek to the clip's start_time once metadata is ready
                        try {
                          if (videoRef.current) videoRef.current.currentTime = startTime;
                          if (bgVideoRef.current) bgVideoRef.current.currentTime = startTime;
                        } catch {}
                      }}
                      onLoadedData={() => { setLoadingVideo(false); setLoadError(false); }}
                      onError={() => { setLoadingVideo(false); setLoadError(true); }}
                      loop
                      style={{
                        width: "100%", height: "100%",
                        objectFit: fillMode === "fit" ? "contain" : "cover",
                        display: loadError ? "none" : "block",
                      }}
                    />
                  </div>
                );
              })()}
              {/* CAPTION OVERLAY — HTML approximation of the burned-in caption.
                  Splits the text the same way as PIL (max 30 chars per line)
                  so the box width matches what Play Clip will show. */}
              {clip.viral_caption && (() => {
                // Mirror split_text_into_lines (max 30 chars, up to 4 lines)
                const words = clip.viral_caption.split(/\s+/);
                const lines = [];
                let current = [];
                for (const w of words) {
                  if (lines.length === 4) break;
                  const test = [...current, w].join(" ");
                  if (test.length <= 30) current.push(w);
                  else {
                    if (current.length) lines.push(current.join(" "));
                    if (lines.length === 4) break;
                    current = [w];
                  }
                }
                if (current.length && lines.length < 4) lines.push(current.join(" "));
                return (
                  <div style={{
                    position: "absolute",
                    top: `${(clip.text_y ?? 0.15) * 100}%`,
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 2,
                    textAlign: "center",
                    pointerEvents: "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    alignItems: "center",
                  }}>
                    {lines.map((line, i) => (
                      <div key={i} style={{
                        background: "rgba(255,255,255,0.95)",
                        color: "#000",
                        padding: "0 8px",
                        borderRadius: i === 0 ? "6px 6px 0 0" :
                                      i === lines.length - 1 ? "0 0 6px 6px" : "0",
                        fontFamily: "'Calibri Bold', Calibri, 'Segoe UI', Arial, sans-serif",
                        fontWeight: 900,
                        fontSize: "3.6cqh",  // matches PIL ~70px on a 1920 canvas
                        lineHeight: 1.3,
                        whiteSpace: "nowrap",
                      }}>
                        {line}
                      </div>
                    ))}
                  </div>
                );
              })()}
              {loadingVideo && !loadError && (
                <div style={{
                  position: "absolute", inset: 0,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  background: "rgba(0,0,0,0.85)", color: "#fff", gap: 10,
                }}>
                  <div className="loading-spinner" style={{ width: 32, height: 32 }} />
                  <p style={{ margin: 0, fontSize: 12, color: "#aaa" }}>Cargando video...</p>
                </div>
              )}
              {loadError && (
                <div style={{
                  position: "absolute", inset: 0,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  background: "#1a1a1a", color: "#ef4444", gap: 10, textAlign: "center", padding: 20,
                }}>
                  <div style={{ fontSize: 28 }}>❌</div>
                  <p style={{ margin: 0, fontSize: 13 }}>
                    No se pudo cargar el video.<br/>
                    <span style={{ fontSize: 11, color: "#999" }}>Reinicia el backend o intenta de nuevo.</span>
                  </p>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      // Cache-bust the URL so the browser actually re-fetches
                      setVideoUrl(`${api.getRawVideoUrl(projectId)}?t=${Date.now()}`);
                      setLoadingVideo(true);
                      setLoadError(false);
                    }}
                    style={{ marginTop: 8, padding: "6px 14px", fontSize: 12 }}
                  >
                    🔄 Reintentar
                  </button>
                </div>
              )}
            </div>

            {/* Timeline + scrub */}
            <div style={{ marginTop: 14, padding: "0 8px" }}>
              <div style={{
                position: "relative", height: 40, background: "#1a1a1a", borderRadius: 8,
                cursor: "pointer", overflow: "visible",
              }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = (e.clientX - rect.left) / rect.width;
                  seekTo(startTime + pct * clipDur);
                }}
              >
                {/* Trim range (highlighted) */}
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0, right: 0,
                  background: "linear-gradient(90deg, rgba(99,102,241,0.15), rgba(99,102,241,0.3))",
                  borderRadius: 8,
                }} />
                {/* Playhead */}
                <div style={{
                  position: "absolute", left: `${progress}%`, top: 0, bottom: 0,
                  width: 3, background: "#fff", boxShadow: "0 0 8px rgba(255,255,255,0.6)",
                  pointerEvents: "none",
                }} />
                {/* Keyframe markers (diamonds). Time is clip-relative, so the
                    visible position depends on the current trim window. */}
                {keyframes.map((kf, i) => {
                  const tAbs = clip.start_time + kf.time;
                  const pct = clipDur > 0 ? ((tAbs - startTime) / clipDur) * 100 : 0;
                  if (pct < -2 || pct > 102) return null;  // outside visible trim
                  const isSel = selectedKfIndex === i;
                  return (
                    <div
                      key={i}
                      onClick={(e) => { e.stopPropagation(); selectKfAndSeek(i); }}
                      title={`Keyframe ${i + 1} — t=${kf.time.toFixed(2)}s · zoom ${kf.zoom.toFixed(2)} · pan (${kf.pan_x.toFixed(0)},${kf.pan_y.toFixed(0)})`}
                      style={{
                        position: "absolute",
                        left: `${pct}%`,
                        top: "50%",
                        width: 14, height: 14,
                        transform: "translate(-50%, -50%) rotate(45deg)",
                        background: isSel ? "#fbbf24" : "#6366f1",
                        border: "2px solid #000",
                        boxShadow: isSel ? "0 0 10px rgba(251,191,36,0.7)" : "0 0 4px rgba(0,0,0,0.6)",
                        cursor: "pointer",
                        zIndex: 4,
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888", marginTop: 4, fontFamily: "monospace" }}>
                <span>{formatTime(startTime)}</span>
                <span style={{ color: "var(--accent)", fontWeight: 700 }}>{formatTime(currentTime)}</span>
                <span>{formatTime(endTime)}</span>
              </div>
              <p style={{ fontSize: 11, color: "#666", marginTop: 6, textAlign: "center", lineHeight: 1.5 }}>
                El <b>fondo</b> es la composición completa (caption, blur/negro, subtítulos, filtro).<br/>
                Tu zoom/posición solo afecta el <b>contenido del cuadro central</b> donde está el video.
              </p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                <button className="btn btn-secondary" onClick={() => seekTo(startTime)} style={{ padding: "6px 12px" }}>⏮</button>
                <button className="btn btn-primary" onClick={togglePlay} style={{ padding: "6px 24px", minWidth: 80 }}>
                  {playing ? "⏸ Pausa" : "▶ Play"}
                </button>
                <button className="btn btn-secondary" onClick={() => seekTo(endTime)} style={{ padding: "6px 12px" }}>⏭</button>
              </div>
            </div>
          </div>

          {/* Controls panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* ─── Keyframes section ─────────────────────────────────────── */}
            <div style={{
              background: "var(--bg-secondary)", borderRadius: 10, padding: "14px 16px",
              border: kfMode ? "1px solid rgba(251,191,36,0.4)" : "1px solid transparent",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h4 style={{ margin: 0, fontSize: 14 }}>
                  🎞 Keyframes <span style={{ color: "#777", fontWeight: 400 }}>({keyframes.length})</span>
                </h4>
                <button
                  onClick={addKeyframeHere}
                  className="btn btn-primary"
                  style={{ padding: "4px 10px", fontSize: 12 }}
                  title="Agregar un keyframe en el tiempo actual con los valores visibles"
                >
                  ➕ Aquí
                </button>
              </div>
              {kfMode ? (
                <>
                  <div style={{
                    display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8,
                    maxHeight: 80, overflowY: "auto",
                  }}>
                    {keyframes.map((kf, i) => (
                      <button
                        key={i}
                        onClick={() => selectKfAndSeek(i)}
                        style={{
                          padding: "3px 8px", fontSize: 11, borderRadius: 6,
                          border: selectedKfIndex === i ? "1px solid #fbbf24" : "1px solid #333",
                          background: selectedKfIndex === i ? "rgba(251,191,36,0.15)" : "#1a1a1a",
                          color: selectedKfIndex === i ? "#fbbf24" : "#aaa",
                          cursor: "pointer", fontFamily: "monospace",
                        }}
                        title={`zoom ${kf.zoom.toFixed(2)} · pan (${kf.pan_x.toFixed(0)},${kf.pan_y.toFixed(0)})`}
                      >
                        {i + 1}·{kf.time.toFixed(1)}s
                      </button>
                    ))}
                  </div>
                  {editingKf ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "#fbbf24", flex: 1, alignSelf: "center" }}>
                        Editando KF {selectedKfIndex + 1}
                      </span>
                      <button
                        onClick={deleteSelectedKf}
                        className="btn btn-secondary"
                        style={{ padding: "3px 10px", fontSize: 11 }}
                      >
                        🗑 Borrar
                      </button>
                    </div>
                  ) : (
                    <p style={{ fontSize: 11, color: "#888", margin: 0 }}>
                      Click un keyframe para editarlo.
                    </p>
                  )}
                </>
              ) : (
                <p style={{ fontSize: 11, color: "#888", margin: 0 }}>
                  Modo estático. Agrega un keyframe para animar zoom/posición durante el clip.
                </p>
              )}
            </div>

            <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: "14px 16px" }}>
              <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>
                Transform
                {editingKf && <span style={{ color: "#fbbf24", fontSize: 11, fontWeight: 400, marginLeft: 6 }}>· KF {selectedKfIndex + 1}</span>}
                {kfMode && !editingKf && <span style={{ color: "#888", fontSize: 11, fontWeight: 400, marginLeft: 6 }}>· (estático — sin kf seleccionado)</span>}
              </h4>

              {/* Zoom slider — in keyframes mode min is 1.0 (zoompan can't zoom out) */}
              <label style={{ fontSize: 12, color: "#aaa" }}>
                Tamaño del cuadro: <b style={{ color: editingKf ? "#fbbf24" : "var(--accent)" }}>{sliderZoom.toFixed(2)}x</b>
              </label>
              <input type="range"
                min={editingKf ? 1.0 : 0.3}
                max={editingKf ? 3.0 : 2.0}
                step={0.05}
                value={sliderZoom}
                onChange={(e) => setSliderZoom(parseFloat(e.target.value))}
                style={{ width: "100%", marginBottom: 12 }} />

              {/* Pan ranges differ between modes (overlay-shift vs source-crop) */}
              <label style={{ fontSize: 12, color: "#aaa" }}>
                Posición X: <b style={{ color: editingKf ? "#fbbf24" : "var(--accent)" }}>{sliderPanX.toFixed(0)}{editingKf ? "" : "%"}</b>
              </label>
              <input type="range"
                min={editingKf ? -100 : -50}
                max={editingKf ? 100 : 50}
                step={1}
                value={sliderPanX}
                onChange={(e) => setSliderPanX(parseFloat(e.target.value))}
                style={{ width: "100%", marginBottom: 12 }} />

              <label style={{ fontSize: 12, color: "#aaa" }}>
                Posición Y: <b style={{ color: editingKf ? "#fbbf24" : "var(--accent)" }}>{sliderPanY.toFixed(0)}{editingKf ? "" : "%"}</b>
              </label>
              <input type="range"
                min={editingKf ? -100 : -50}
                max={editingKf ? 100 : 50}
                step={1}
                value={sliderPanY}
                onChange={(e) => setSliderPanY(parseFloat(e.target.value))}
                style={{ width: "100%", marginBottom: 8 }} />

              <button className="btn btn-secondary" onClick={handleReset}
                style={{ width: "100%", padding: "8px 0", fontSize: 12 }}>
                ↻ Reset todo (limpia keyframes)
              </button>
            </div>

            <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: "14px 16px" }}>
              <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>Trim del clip</h4>
              <label style={{ fontSize: 12, color: "#aaa" }}>Inicio: <b style={{ color: "var(--accent)", fontFamily: "monospace" }}>{formatTime(startTime)}</b></label>
              <input type="range"
                min={Math.max(0, clip.start_time - 10)}
                max={endTime - 1}
                step={0.1}
                value={startTime}
                onChange={(e) => setStartTime(parseFloat(e.target.value))}
                style={{ width: "100%", marginBottom: 10 }} />
              <label style={{ fontSize: 12, color: "#aaa" }}>Final: <b style={{ color: "var(--accent)", fontFamily: "monospace" }}>{formatTime(endTime)}</b></label>
              <input type="range"
                min={startTime + 1}
                max={clip.end_time + 10}
                step={0.1}
                value={endTime}
                onChange={(e) => setEndTime(parseFloat(e.target.value))}
                style={{ width: "100%", marginBottom: 4 }} />
              <p style={{ fontSize: 11, color: "#666", margin: "6px 0 0", textAlign: "center" }}>
                Duración: {formatTime(endTime - startTime)}
              </p>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" onClick={onClose} style={{ flex: 1 }}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}
                style={{ flex: 2 }}>
                {saving ? "⏳ Guardando..." : "💾 Guardar"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ================================================
// STEP 2: Clip Results
// ================================================
function ClipsStep({ projectId, clips, onEdit, onUpdateClip, onReorder, onNext }) {
  const [editingClip, setEditingClip] = useState(null);
  const [editText, setEditText] = useState("");
  const [playingClip, setPlayingClip] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [reanalyzingClip, setReanalyzingClip] = useState(null);
  const [selectedClips, setSelectedClips] = useState(new Set());
  const [reanalyzingBatch, setReanalyzingBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, currentId: null });
  const [reanalyzeModel, setReanalyzeModel] = useState("gemini-2.5-flash");
  const [switchingModel, setSwitchingModel] = useState(false);
  const [modelHealth, setModelHealth] = useState({});
  const [checkingModels, setCheckingModels] = useState(false);
  // Image preview
  const [imagePreviewClip, setImagePreviewClip] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  // Filter by duration
  const [filterMin, setFilterMin] = useState(0);
  const [filterMax, setFilterMax] = useState(300);
  // Sort
  const [sortBy, setSortBy] = useState("default"); // "default" | "score_desc" | "score_asc"
  // Confidence filter
  const [confidenceFilter, setConfidenceFilter] = useState("all"); // "all" | "match" | "mismatch" | "no_audio"
  // Transcript modal — show the words spoken in a clip
  const [scriptViewClip, setScriptViewClip] = useState(null);
  // In-app editor modal — zoom / pan / trim
  const [editorClip, setEditorClip] = useState(null);
  // Drag and drop
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const maxDuration = Math.max(...clips.map(c => Math.ceil(c.duration)), 60);

  const confidenceCounts = {
    match: clips.filter(c => c.match_confidence === "match").length,
    mismatch: clips.filter(c => c.match_confidence === "mismatch").length,
    no_audio: clips.filter(c => c.match_confidence === "no_audio").length,
  };

  const filteredClips = clips
    .filter(c => c.duration >= filterMin && c.duration <= filterMax)
    .filter(c => confidenceFilter === "all" || c.match_confidence === confidenceFilter)
    .sort((a, b) => {
      if (sortBy === "score_desc") return (b.viral_score || 5) - (a.viral_score || 5);
      if (sortBy === "score_asc") return (a.viral_score || 5) - (b.viral_score || 5);
      return 0; // default: keep original order
    });

  const handleCheckModels = async () => {
    setCheckingModels(true);
    try {
      const result = await api.checkModelHealth(GEMINI_VIDEO_MODELS.map((m) => m.val));
      const next = {};
      for (const item of result.models || []) next[item.model] = item;
      setModelHealth(next);
    } catch (e) {
      alert(`No se pudo chequear modelos: ${e.message}`);
    } finally {
      setCheckingModels(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingClip) return;
    try {
      await api.editCaption(projectId, editingClip.id, editText);
      onEdit(editingClip.id, editText);
      setEditingClip(null);
    } catch (err) {
      alert("Failed to save: " + err.message);
    }
  };

  const handlePlayClip = async (clip) => {
    setPlayingClip(clip);
    setLoadingVideo(true);
    setVideoUrl(api.getVideoPreviewUrl(projectId, clip.id));
  };

  const handleImagePreview = (clip) => {
    setImagePreviewClip(clip);
    setImageLoading(true);
    setImagePreviewUrl(api.getPreviewUrl(projectId, clip.id));
  };

  const handleReanalyze = async (clip) => {
    setReanalyzingClip(clip.id);
    try {
      const result = await api.reanalyzeClip(projectId, clip.id);
      onEdit(clip.id, result.clip.viral_caption);
    } catch (err) {
      alert("Re-análisis falló: " + err.message);
    } finally {
      setReanalyzingClip(null);
    }
  };

  const toggleSelect = (clipId) => {
    setSelectedClips(prev => {
      const next = new Set(prev);
      if (next.has(clipId)) next.delete(clipId);
      else next.add(clipId);
      return next;
    });
  };

  const handleReanalyzeBatch = async () => {
    if (selectedClips.size === 0) return;
    const ids = Array.from(selectedClips);
    setReanalyzingBatch(true);
    setBatchProgress({ current: 0, total: ids.length, currentId: null });
    for (let i = 0; i < ids.length; i++) {
      const clipId = ids[i];
      setBatchProgress({ current: i + 1, total: ids.length, currentId: clipId });
      try {
        const result = await api.reanalyzeClip(projectId, clipId);
        onEdit(clipId, result.clip.viral_caption);
      } catch (err) {
        console.error(`Re-análisis falló para clip ${clipId}:`, err.message);
      }
      // Wait 20s between requests to avoid Gemini 503 rate limit errors
      if (i < ids.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 20000));
      }
    }
    setReanalyzingBatch(false);
    setBatchProgress({ current: 0, total: 0, currentId: null });
    setSelectedClips(new Set());
  };

  // Drag and drop handlers
  const handleDragStart = (e, clipId) => {
    setDraggedId(clipId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, clipId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(clipId);
  };

  const handleDrop = (e, targetId) => {
    e.preventDefault();
    if (draggedId === null || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    const newClips = [...clips];
    const fromIdx = newClips.findIndex(c => c.id === draggedId);
    const toIdx = newClips.findIndex(c => c.id === targetId);
    const [moved] = newClips.splice(fromIdx, 1);
    newClips.splice(toIdx, 0, moved);
    onReorder(newClips);
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  return (
    <div>
      <h2 className="section-title">📋 Detected Clips ({clips.length})</h2>
      <p className="section-subtitle">
        Review clips, edit captions, play previews, then style & export.
      </p>

      {/* Sort + Filter toolbar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Ordenar:</span>
        {[
          { val: "default", label: "Original" },
          { val: "score_desc", label: "🔥 Mayor score" },
          { val: "score_asc", label: "⬇ Menor score" },
        ].map(({ val, label }) => (
          <button key={val} className={`btn ${sortBy === val ? "btn-primary" : "btn-secondary"}`}
            style={{ padding: "5px 12px", fontSize: 12 }}
            onClick={() => setSortBy(val)}>
            {label}
          </button>
        ))}
      </div>

      {/* Filter by duration */}
      <div style={{ background: "var(--bg-secondary)", borderRadius: 12, padding: "14px 18px", marginBottom: 14, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
          ⏱ Filtrar por duración:
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Mín</span>
          <input type="range" min={0} max={maxDuration} value={filterMin}
            onChange={e => setFilterMin(Math.min(Number(e.target.value), filterMax - 1))}
            style={{ flex: 1, minWidth: 80 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", minWidth: 28 }}>{filterMin}s</span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Máx</span>
          <input type="range" min={0} max={maxDuration} value={filterMax}
            onChange={e => setFilterMax(Math.max(Number(e.target.value), filterMin + 1))}
            style={{ flex: 1, minWidth: 80 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", minWidth: 28 }}>{filterMax}s</span>
        </div>
        {(filterMin > 0 || filterMax < maxDuration) && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {filteredClips.length}/{clips.length} clips
          </span>
        )}
        {(filterMin > 0 || filterMax < maxDuration) && (
          <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => { setFilterMin(0); setFilterMax(maxDuration); }}>
            Reset
          </button>
        )}
      </div>

      {/* Confidence filter */}
      {(confidenceCounts.match + confidenceCounts.mismatch + confidenceCounts.no_audio) > 0 && (
        <div style={{ background: "var(--bg-secondary)", borderRadius: 12, padding: "12px 18px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
            🎯 Confianza:
          </span>
          {[
            { val: "all",      label: `Todos (${clips.length})`,           color: "#888" },
            { val: "match",    label: `🟢 OK (${confidenceCounts.match})`,    color: "#22c55e" },
            { val: "mismatch", label: `🔴 Mal (${confidenceCounts.mismatch})`, color: "#ef4444" },
            { val: "no_audio", label: `🟡 Sin audio (${confidenceCounts.no_audio})`, color: "#eab308" },
          ].map(({ val, label, color }) => (
            <button
              key={val}
              onClick={() => setConfidenceFilter(val)}
              style={{
                padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                cursor: "pointer", transition: "all 0.2s",
                background: confidenceFilter === val ? color : "#111",
                color: confidenceFilter === val ? "#fff" : "#aaa",
                border: confidenceFilter === val ? `1px solid ${color}` : "1px solid #333",
              }}
            >
              {label}
            </button>
          ))}
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
            🟢 caption coincide · 🔴 puede estar mal · 🟡 clip sin diálogo
          </span>
        </div>
      )}

      {/* Model selector for re-analysis (also persists choice to backend) */}
      <div style={{ background: "var(--bg-secondary)", borderRadius: 12, padding: "12px 18px", marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>
          🧠 Modelo para reanalizar
        </div>
        <ModelSelector
          value={reanalyzeModel}
          disabled={switchingModel}
          onChange={async (val) => {
            setSwitchingModel(true);
            try {
              await api.updateProjectModel(projectId, val);
              setReanalyzeModel(val);
            } catch (e) {
              alert(`No se pudo cambiar el modelo: ${e.message}`);
            } finally {
              setSwitchingModel(false);
            }
          }}
          health={modelHealth}
          checking={checkingModels}
          onCheck={handleCheckModels}
        />
      </div>

      {/* Batch re-analyze bar */}
      {selectedClips.size > 0 && (
        <div style={{ marginBottom: 14, padding: "12px 16px", background: "var(--bg-secondary)", borderRadius: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            {selectedClips.size} clip{selectedClips.size > 1 ? "s" : ""} seleccionado{selectedClips.size > 1 ? "s" : ""}
          </span>
          {reanalyzingBatch ? (
            <span style={{ fontSize: 13, color: "var(--accent)" }}>
              ⏳ Analizando clip {batchProgress.current}/{batchProgress.total} (ID {batchProgress.currentId})...
            </span>
          ) : (
            <>
              <button className="btn btn-primary" style={{ padding: "6px 14px", fontSize: 13 }} onClick={handleReanalyzeBatch}>
                🔄 Re-analizar seleccionados
              </button>
              <button className="btn btn-secondary" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => setSelectedClips(new Set())}>
                Deseleccionar
              </button>
            </>
          )}
        </div>
      )}

      <div className="clips-list">
        {filteredClips.map((clip) => {
          const isSelected = selectedClips.has(clip.id);
          const isBeingAnalyzed = reanalyzingBatch && batchProgress.currentId === clip.id;
          const isDragging = draggedId === clip.id;
          const isDragOver = dragOverId === clip.id;
          return (
            <div
              className="clip-card"
              key={clip.id}
              draggable
              onDragStart={(e) => handleDragStart(e, clip.id)}
              onDragOver={(e) => handleDragOver(e, clip.id)}
              onDrop={(e) => handleDrop(e, clip.id)}
              onDragEnd={handleDragEnd}
              style={{
                outline: isSelected ? "2px solid var(--accent)" : isDragOver ? "2px dashed #888" : undefined,
                opacity: isDragging ? 0.4 : 1,
                cursor: "grab",
                transition: "opacity 0.15s, outline 0.15s",
              }}
              onClick={() => toggleSelect(clip.id)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16, color: "#444", cursor: "grab", userSelect: "none" }}>⠿</span>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(clip.id)}
                  onClick={e => e.stopPropagation()}
                  style={{ width: 16, height: 16, cursor: "pointer", accentColor: "var(--accent)" }}
                />
                <div className="clip-number">{clip.id}</div>
              </div>
              <div className="clip-info">
                <h4>
                  {clip.match_confidence === "match" && (
                    <span title="Caption coincide con lo que se dice en el clip" style={{ marginRight: 6 }}>🟢</span>
                  )}
                  {clip.match_confidence === "mismatch" && (
                    <span title="Las palabras del caption no aparecen en el audio del clip" style={{ marginRight: 6 }}>🔴</span>
                  )}
                  {clip.match_confidence === "no_audio" && (
                    <span title="No se detectó audio/diálogo — revisión manual recomendada" style={{ marginRight: 6 }}>🟡</span>
                  )}
                  {clip.description}
                </h4>
                <p className="caption">
                  {isBeingAnalyzed ? "⏳ Re-analizando..." : `"${clip.viral_caption}"`}
                </p>
              </div>
              <div className="clip-meta">
                <span className="tag">⏱ {clip.duration.toFixed(0)}s</span>
                <span className="tag">
                  📍 {formatTime(clip.start_time)} — {formatTime(clip.end_time)}
                </span>
                {/* Editor badge — appears when zoom/pan has been modified.
                    Trims are already reflected in the duration tag above. */}
                {((clip.edit_zoom ?? 1) !== 1 || (clip.edit_pan_x ?? 0) !== 0 || (clip.edit_pan_y ?? 0) !== 0) && (
                  <span
                    className="tag"
                    title={`zoom ${(clip.edit_zoom ?? 1).toFixed(2)}x · pan ${(clip.edit_pan_x ?? 0).toFixed(0)},${(clip.edit_pan_y ?? 0).toFixed(0)}`}
                    style={{ background: "rgba(99,102,241,0.18)", color: "#a5b4fc", borderColor: "rgba(99,102,241,0.45)" }}
                  >
                    🎬 editado
                  </span>
                )}
                {clip.viral_score && (
                  <span style={{
                    padding: "2px 8px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                    background: clip.viral_score >= 8 ? "#dc2626" : clip.viral_score >= 6 ? "#d97706" : "#374151",
                    color: "#fff",
                  }}>
                    {clip.viral_score >= 8 ? "🔥" : clip.viral_score >= 6 ? "⚡" : "·"} {clip.viral_score}/10
                    {clip.viral_score_reason ? ` · ${clip.viral_score_reason}` : ""}
                  </span>
                )}
              </div>
              <div className="clip-actions" onClick={e => e.stopPropagation()}>
                <button onClick={() => handleImagePreview(clip)} title="Preview rápido (imagen)">🖼 Preview</button>
                <button onClick={() => handlePlayClip(clip)}>▶ Play</button>
                <button
                  onClick={() => setScriptViewClip(clip)}
                  disabled={!clip.transcript_snippet}
                  title={clip.transcript_snippet
                    ? "Ver lo que se dice en este clip (Whisper)"
                    : "Sin diálogo detectado"}
                  style={{ opacity: clip.transcript_snippet ? 1 : 0.4 }}
                >
                  📄 Guión
                </button>
                <button
                  onClick={() => setEditorClip(clip)}
                  title="Editor: zoom, posición y trim del clip"
                >
                  🎬 Editar
                </button>
                <button
                  onClick={() => {
                    setEditingClip(clip);
                    setEditText(clip.viral_caption);
                  }}
                >
                  ✏️ Edit
                </button>
                <button
                  onClick={() => handleReanalyze(clip)}
                  disabled={reanalyzingClip === clip.id || reanalyzingBatch}
                  title="Re-analizar con IA este clip específico"
                  style={{ opacity: reanalyzingClip === clip.id ? 0.6 : 1 }}
                >
                  {reanalyzingClip === clip.id ? "⏳..." : "🔄"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="btn-group">
        <button className="btn btn-primary" onClick={onNext}>
          🎨 Style & Export →
        </button>
      </div>

      {/* Image Preview Modal */}
      {imagePreviewClip && (
        <div className="modal-overlay" onClick={() => { setImagePreviewClip(null); setImagePreviewUrl(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h3>🖼 Clip {imagePreviewClip.id}: {imagePreviewClip.description}</h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: 12, fontSize: 13 }}>
              {formatTime(imagePreviewClip.start_time)} — {formatTime(imagePreviewClip.end_time)}
            </p>
            {imageLoading && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)" }}>
                <div className="loading-spinner" style={{ margin: "0 auto 10px" }}></div>
                <p style={{ fontSize: 13 }}>Generando imagen... (~3s)</p>
              </div>
            )}
            {imagePreviewUrl && (
              <img
                src={imagePreviewUrl}
                alt="preview"
                onLoad={() => setImageLoading(false)}
                onError={() => { setImageLoading(false); alert("No se pudo generar el preview."); }}
                style={{ width: "100%", borderRadius: 10, display: imageLoading ? "none" : "block" }}
              />
            )}
            <div className="btn-group" style={{ marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={() => { setImagePreviewClip(null); setImagePreviewUrl(null); }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transcript / Script Modal */}
      {scriptViewClip && (
        <div className="modal-overlay" onClick={() => setScriptViewClip(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <h3>📄 Guión · Clip {scriptViewClip.id}</h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: 14, fontSize: 13 }}>
              {formatTime(scriptViewClip.start_time)} — {formatTime(scriptViewClip.end_time)}
              {" · "}
              <span style={{ color: "#aaa" }}>{scriptViewClip.description}</span>
            </p>

            <div style={{
              background: "#111",
              border: `2px solid ${
                scriptViewClip.match_confidence === "match" ? "#22c55e" :
                scriptViewClip.match_confidence === "mismatch" ? "#ef4444" : "#444"
              }`,
              borderRadius: 10, padding: "14px 16px", marginBottom: 14,
            }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
                Caption actual
              </div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#fff", lineHeight: 1.4 }}>
                "{scriptViewClip.viral_caption}"
              </p>
            </div>

            <div style={{
              background: "#0a0a0a", border: "1px solid #2a2a2a",
              borderRadius: 10, padding: "14px 16px", marginBottom: 14,
            }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
                🎙️ Lo que se dice en el clip (Whisper)
              </div>
              <p style={{ margin: 0, fontSize: 14, color: "#ddd", lineHeight: 1.6, fontStyle: "italic" }}>
                {scriptViewClip.transcript_snippet || "(sin diálogo detectado)"}
              </p>
            </div>

            <div className="btn-group">
              <button className="btn btn-secondary" onClick={() => setScriptViewClip(null)}>
                Cerrar
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setEditingClip(scriptViewClip);
                  setEditText(scriptViewClip.viral_caption);
                  setScriptViewClip(null);
                }}
              >
                ✏️ Editar caption
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  const clip = scriptViewClip;
                  setScriptViewClip(null);
                  handleReanalyze(clip);
                }}
                disabled={reanalyzingClip === scriptViewClip.id || reanalyzingBatch}
              >
                🔄 Reanalizar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clip Editor Modal — zoom, pan, trim (live preview via CSS transform).
          Style is unknown at this step (user hasn't picked one yet), so the
          modal preview uses the StyleConfig defaults: fit + blur. */}
      {editorClip && (
        <ClipEditorModal
          projectId={projectId}
          clip={editorClip}
          onClose={() => setEditorClip(null)}
          onSaved={(updated) => {
            // Propagate the full clip (zoom/pan/trim/duration/caption) to the
            // parent's clips array so the edit survives going to step 3.
            if (onUpdateClip) onUpdateClip(updated.id, updated);
            else onEdit(updated.id, updated.viral_caption);
            setEditorClip(null);
          }}
        />
      )}

      {/* Video Player Modal */}
      {playingClip && (
        <div className="modal-overlay" onClick={() => { setPlayingClip(null); setVideoUrl(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h3>▶ Clip {playingClip.id}: {playingClip.description}</h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: 12, fontSize: 13 }}>
              {formatTime(playingClip.start_time)} — {formatTime(playingClip.end_time)} ({playingClip.duration.toFixed(0)}s)
            </p>
            {loadingVideo && (
              <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text-muted)" }}>
                <div className="loading-spinner" style={{ margin: "0 auto 12px" }}></div>
                <p style={{ fontSize: 13 }}>Generating preview... (first time may take ~15s)</p>
              </div>
            )}
            {videoUrl && (
              <video
                key={videoUrl}
                controls
                autoPlay
                style={{ width: "100%", borderRadius: 10, background: "black", maxHeight: 400, display: loadingVideo ? "none" : "block" }}
                src={videoUrl}
                onCanPlay={() => setLoadingVideo(false)}
                onError={() => {
                  setLoadingVideo(false);
                  alert("Failed to generate video preview. Try again.");
                  setVideoUrl(null);
                }}
              />
            )}
            <div className="btn-group">
              <button className="btn btn-secondary" onClick={() => { setPlayingClip(null); setVideoUrl(null); }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Caption Modal */}
      {editingClip && (
        <div className="modal-overlay" onClick={() => setEditingClip(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Caption — Clip {editingClip.id}</h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: 12, fontSize: 13 }}>
              "{editingClip.description}"
            </p>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              autoFocus
            />
            <div className="btn-group">
              <button className="btn btn-primary" onClick={handleSaveEdit}>
                💾 Save
              </button>
              <button className="btn btn-secondary" onClick={() => setEditingClip(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ================================================
// STEP 3: Visual Editor & Export
// ================================================
function EditorStep({ projectId, clips, onUpdateClip, onExportDone }) {
  const [watermarkFile, setWatermarkFile] = useState(null);
  const [watermarkPreview, setWatermarkPreview] = useState(null);
  const [splitImagePreview, setSplitImagePreview] = useState(null);
  const [style, setStyle] = useState({
    text_x: 0.5,
    text_y: 0.15,
    font_size: 70,
    text_color: "#FFFFFF",
    text_stroke_color: "#000000",
    text_stroke_width: 5,
    watermark_x: 0.5,
    watermark_y: 0.85,
    watermark_scale: 0.3,
    watermark_opacity: 0.9,
    fill_mode: "fit",
    fill_mode_scale: 1.0,
    ig_fill_mode: "fit",
    ig_top_padding: 130,
    ig_watermark_y: 0.85,
    strip_metadata: false,
    flip_horizontal: false,
    zoom_uniquify: false,
    boost_contrast: false,
    split_screen_enabled: false,
    split_ratio: 0.5,
    caption_style: "box",
    caption_font: "calibri",
    subtitle_style: "none",
    subtitle_size_scale: 1.0,
    subtitle_y: 0.0,         // -0.5 (down) to +0.5 (up) — offset from style default
    visual_filter: "none",
    background_style: "blur",
    no_text: false,
    no_emojis: false,
  });
  const [exportStatus, setExportStatus] = useState("idle"); // idle, exporting, done
  const [exportMode, setExportMode] = useState("tiktok"); // "tiktok" | "instagram"
  const [progress, setProgress] = useState({ current: 0, total: 0, current_file: "" });
  const [exportedFiles, setExportedFiles] = useState([]);
  const [selectedClip, setSelectedClip] = useState(clips[0] || null);
  const [editorClip, setEditorClip] = useState(null);  // 🎬 Editar modal
  const [previewUrl, setPreviewUrl] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [selectedClipIds, setSelectedClipIds] = useState(new Set(clips.map(c => c.id)));

  const toggleClipSelection = (clipId) => {
    setSelectedClipIds(prev => {
      const next = new Set(prev);
      if (next.has(clipId)) next.delete(clipId);
      else next.add(clipId);
      return next;
    });
  };

  const selectAll = () => setSelectedClipIds(new Set(clips.map(c => c.id)));
  const selectNone = () => setSelectedClipIds(new Set());

  // Dragging state
  const [dragging, setDragging] = useState(null);
  const canvasRef = useRef(null);

  const handleWatermarkUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setWatermarkFile(file);
    setWatermarkPreview(URL.createObjectURL(file));
    try {
      await api.uploadWatermark(projectId, file);
    } catch (err) {
      console.error("Watermark upload failed:", err);
    }
  };

  const handleSplitImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSplitImagePreview(URL.createObjectURL(file));
    setStyle(s => ({ ...s, split_screen_enabled: true }));
    try {
      await api.uploadSplitImage(projectId, file);
    } catch (err) {
      console.error("Split image upload failed:", err);
    }
  };

  const handleRemoveSplitImage = () => {
    setSplitImagePreview(null);
    setStyle(s => ({ ...s, split_screen_enabled: false }));
  };

  const handlePreview = async () => {
    if (!selectedClip) {
      alert("Please select a clip first");
      return;
    }
    setLoadingPreview(true);
    setVideoPreviewUrl(null);
    try {
      console.log("Updating style for project:", projectId);
      await api.updateStyle(projectId, style);
      console.log("Generating preview for clip:", selectedClip.id);
      setPreviewUrl(api.getPreviewUrl(projectId, selectedClip.id));
    } catch (err) {
      console.error("Preview failed:", err);
      alert("Preview failed: " + err.message);
    }
    setLoadingPreview(false);
  };

  const handlePlayVideo = async () => {
    if (!selectedClip) return;
    setLoadingVideo(true);
    setPreviewUrl(null);
    setVideoPreviewUrl(api.getVideoPreviewUrl(projectId, selectedClip.id));
    // loadingVideo stays true until onCanPlay fires on the video element
  };

  const handlePlayInstagram = async () => {
    if (!selectedClip) return;
    setLoadingPreview(true);
    setVideoPreviewUrl(null);
    try {
      await api.updateStyle(projectId, style);
      setPreviewUrl(api.getInstagramPreviewUrl(projectId, selectedClip.id));
    } catch (err) {
      alert("Failed to generate IG preview: " + err.message);
    }
    setLoadingPreview(false);
  };

  // Auto-refresh preview when style changes
  useEffect(() => {
    if (!selectedClip) return;
    const hasPreview = previewUrl || videoPreviewUrl;
    if (!hasPreview) return;
    const timer = setTimeout(async () => {
      try {
        await api.updateStyle(projectId, style);
        if (videoPreviewUrl) {
          setVideoPreviewUrl(api.getVideoPreviewUrl(projectId, selectedClip.id));
        }
        if (previewUrl) {
          const isIg = previewUrl.includes("instagram-preview");
          setPreviewUrl(
            isIg
              ? api.getInstagramPreviewUrl(projectId, selectedClip.id)
              : api.getPreviewUrl(projectId, selectedClip.id)
          );
        }
      } catch (_) {}
    }, 300);
    return () => clearTimeout(timer);
  }, [style.fill_mode, style.fill_mode_scale, style.ig_fill_mode, style.ig_top_padding, style.ig_watermark_y, style.split_screen_enabled, style.split_ratio, style.text_y, style.flip_horizontal, style.boost_contrast, style.subtitle_style, style.caption_style, style.visual_filter, style.subtitle_size_scale, style.subtitle_y, style.background_style, style.no_text, style.caption_font, style.no_emojis]);

  // Poll progress
  useEffect(() => {
    if (exportStatus !== "exporting") return;

    const interval = setInterval(async () => {
      try {
        const p = exportMode === "instagram"
          ? await api.getInstagramProgress(projectId)
          : await api.getExportProgress(projectId);
        setProgress(p);

        if (p.status === "completed" || p.status === "done") {
          setExportStatus("done");
          setExportedFiles(p.files || []);
          clearInterval(interval);
        }
      } catch (err) {
        console.error("Progress poll failed:", err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [exportStatus, exportMode, projectId]);

  const handleExport = async (mode = "tiktok") => {
    const idsToExport = Array.from(selectedClipIds);
    if (idsToExport.length === 0) {
      alert("Please select at least one clip to export.");
      return;
    }
    setExportMode(mode);
    setExportStatus("exporting");
    setProgress({ current: 0, total: idsToExport.length, current_file: "Starting...", status: "exporting" });
    try {
      await api.updateStyle(projectId, style);
      if (mode === "instagram") {
        await api.startInstagramExport(projectId, idsToExport);
      } else {
        await api.startExport(projectId, idsToExport);
      }
      // Polling will handle the rest via useEffect
    } catch (err) {
      alert("Export failed: " + err.message);
      setExportStatus("idle");
    }
  };

  // Drag handlers
  const handleMouseDown = (type) => (e) => {
    e.preventDefault();
    setDragging(type);
  };

  const handleMouseMove = useCallback(
    (e) => {
      if (!dragging || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0.05, Math.min(0.95, (e.clientY - rect.top) / rect.height));
      setStyle((prev) => ({
        ...prev,
        [`${dragging}_x`]: x,
        [`${dragging}_y`]: y,
      }));
    },
    [dragging]
  );

  const handleMouseUp = useCallback(() => setDragging(null), []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragging, handleMouseMove, handleMouseUp]);

  // ---- EXPORTING STATE ----
  if (exportStatus === "exporting") {
    const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <h3>{exportMode === "instagram" ? "📸 Exporting Instagram clips..." : "Exporting clips..."} {pct}%</h3>
        <p>
          Clip {progress.current} / {progress.total}
          {progress.current_file ? ` — ${progress.current_file}` : ""}
        </p>
        <div className="progress-bar">
          <div className="fill" style={{ width: `${pct}%` }}></div>
        </div>
      </div>
    );
  }

  // ---- DONE STATE ----
  if (exportStatus === "done") {
    return (
      <div className="export-results">
        <div className="success-icon">✅</div>
        <h2>{exportMode === "instagram" ? "📸 Instagram Export Complete!" : "Export Complete!"}</h2>
        <p>
          {exportedFiles.length} / {clips.length} clips exported successfully.
        </p>
        <div className="exported-list" style={{ textAlign: "left", maxWidth: 500, margin: "20px auto" }}>
          {exportedFiles.map((f, i) => (
            <div key={i} style={{
              padding: "8px 12px",
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              marginBottom: "6px",
              fontSize: "13px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span>📎 {f}</span>
              <a
                href={exportMode === "instagram"
                  ? api.getInstagramDownloadUrl(projectId, f)
                  : api.getDownloadUrl(projectId, f)}
                download
                style={{ color: "var(--accent)", textDecoration: "none", fontSize: "12px" }}
              >
                Download
              </a>
            </div>
          ))}
        </div>
        <div className="btn-group" style={{ justifyContent: "center", marginTop: "16px" }}>
          <a
            href={`http://localhost:8000/api/export-info/${projectId}`}
            download="clips_info.txt"
            className="btn btn-secondary"
            style={{ textDecoration: "none" }}
          >
            📄 Download Clips Info (TXT)
          </a>
          <button className="btn btn-primary" onClick={() => onExportDone()}>
            🔄 New Project
          </button>
        </div>
      </div>
    );
  }

  // ---- EDITOR STATE ----
  return (
    <div>
      <h2 className="section-title">🎨 Visual Editor</h2>
      <p className="section-subtitle">
        Position your text and watermark, then export all clips.
      </p>

      <div className="editor-layout">
        {/* Canvas Preview */}
        <div className="editor-canvas-container" ref={canvasRef}>
          <div className="editor-canvas">
            {loadingPreview ? (
              <div style={{
                width: "100%", height: "100%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "linear-gradient(180deg, #1a1a2e 0%, #0a0a0f 100%)",
                flexDirection: "column", gap: "12px",
              }}>
                <span style={{ fontSize: "40px" }}>⏳</span>
                <span style={{ color: "var(--accent)", fontSize: "14px", fontWeight: "500" }}>
                  Generating preview...
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                  First time may take ~15 seconds
                </span>
              </div>
            ) : videoPreviewUrl ? (
              <>
                {loadingVideo && (
                  <div style={{
                    width: "100%", height: "100%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "linear-gradient(180deg, #1a1a2e 0%, #0a0a0f 100%)",
                    flexDirection: "column", gap: "12px",
                    position: "absolute", top: 0, left: 0, zIndex: 2,
                  }}>
                    <span style={{ fontSize: "40px" }}>⏳</span>
                    <span style={{ color: "var(--accent)", fontSize: "14px", fontWeight: "500" }}>
                      Generating video preview...
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                      First time may take ~15 seconds
                    </span>
                  </div>
                )}
                <video
                  key={videoPreviewUrl}
                  controls
                  autoPlay
                  src={videoPreviewUrl}
                  style={{ width: "100%", height: "100%", objectFit: "contain", background: "black", borderRadius: 8, display: loadingVideo ? "none" : "block" }}
                  onCanPlay={() => setLoadingVideo(false)}
                  onError={() => {
                    setLoadingVideo(false);
                    alert("Failed to generate video preview. Try again.");
                    setVideoPreviewUrl(null);
                  }}
                />
              </>
            ) : previewUrl ? (
              <img
                src={previewUrl}
                alt="Preview"
                onLoad={() => {
                  console.log("Preview image loaded successfully!");
                  setLoadingPreview(false);
                }}
                onError={(e) => {
                  console.error("Preview image failed to load:", e);
                  alert("Failed to load preview image. Check console for details.");
                  setPreviewUrl(null);
                  setLoadingPreview(false);
                }}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            ) : (
              <div style={{
                width: "100%", height: "100%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "linear-gradient(180deg, #1a1a2e 0%, #0a0a0f 100%)",
                flexDirection: "column", gap: "12px",
              }}>
                <span style={{ fontSize: "40px" }}>📱</span>
                <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                  Select a clip and click "Preview" or "Play Clip"
                </span>
              </div>
            )}

            {/* Draggable text position indicator - only show when no preview is active */}
            {selectedClip && !previewUrl && !videoPreviewUrl && (
              <div
                className={`draggable-text ${dragging === "text" ? "dragging" : ""}`}
                style={{
                  left: `${style.text_x * 100}%`,
                  top: `${style.text_y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  fontSize: "12px",
                  color: style.text_color,
                  WebkitTextStroke: `1px ${style.text_stroke_color}`,
                  padding: "6px 12px",
                  whiteSpace: "nowrap",
                }}
                onMouseDown={handleMouseDown("text")}
              >
                T caption
              </div>
            )}

            {/* Center guide line - only show when watermark is visible and no preview active */}
            {watermarkPreview && !previewUrl && !videoPreviewUrl && (
              <div style={{
                position: "absolute",
                left: "50%",
                top: 0,
                bottom: 0,
                width: "1px",
                background: "repeating-linear-gradient(to bottom, rgba(255,255,255,0.7) 0px, rgba(255,255,255,0.7) 6px, transparent 6px, transparent 12px)",
                transform: "translateX(-50%)",
                pointerEvents: "none",
                zIndex: 1,
              }} />
            )}

            {/* Draggable watermark - only show when no preview is active */}
            {watermarkPreview && !previewUrl && !videoPreviewUrl && (
              <div
                className={`draggable-watermark ${dragging === "watermark" ? "dragging" : ""}`}
                style={{
                  left: `${style.watermark_x * 100}%`,
                  top: `${style.watermark_y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  opacity: style.watermark_opacity,
                  zIndex: 2,
                }}
                onMouseDown={handleMouseDown("watermark")}
              >
                <img
                  src={watermarkPreview}
                  alt="Watermark"
                  style={{ width: `${style.watermark_scale * 250}px` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="editor-controls">
          {/* Clip selector */}
          <div className="control-section">
            <h3>📌 Select Clip</h3>
            <select
              style={{
                width: "100%", padding: "10px",
                background: "var(--bg-input)", border: "1px solid var(--border)",
                borderRadius: "8px", color: "var(--text-primary)", fontSize: "13px",
              }}
              value={selectedClip?.id || ""}
              onChange={(e) => {
                const clip = clips.find((c) => c.id === parseInt(e.target.value));
                setSelectedClip(clip);
                setPreviewUrl(null);
                setVideoPreviewUrl(null);
              }}
            >
              {clips.map((c) => (
                <option key={c.id} value={c.id}>
                  Clip {c.id}: {c.description}
                </option>
              ))}
            </select>
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-secondary" onClick={handlePreview} disabled={loadingPreview}>
                {loadingPreview ? "⏳ Generating..." : "👁️ Preview"}
              </button>
              <button className="btn btn-primary" onClick={handlePlayVideo} disabled={loadingVideo} style={{ fontSize: 13 }}>
                {loadingVideo ? "⏳ Loading..." : "▶ Play Clip"}
              </button>
              <button
                className="btn"
                onClick={handlePlayInstagram}
                disabled={loadingPreview}
                style={{
                  fontSize: 12,
                  background: "linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%)",
                  color: "#fff",
                  border: "none",
                }}
              >
                {loadingPreview ? "⏳" : "📸 IG"}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => selectedClip && setEditorClip(selectedClip)}
                disabled={!selectedClip}
                style={{ fontSize: 13 }}
                title="Editor de zoom, posición y trim del clip seleccionado"
              >
                🎬 Editar
              </button>
            </div>
          </div>

          {/* Video format */}
          <div className="control-section">
            <h3>🎬 Video Format</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["fit", "medium", "mini", "zoom", "fill", "small"].map((m) => (
                <button
                  key={m}
                  className={`btn ${style.fill_mode === m ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setStyle((s) => ({ ...s, fill_mode: m }))}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              Fit = full · Medium = un poco más chico · Mini = el más pequeño · Zoom = grande · Fill = frame completo · Small = reducido
            </p>

            {/* Fine-tune multiplier on top of the chosen preset (1.0 = preset as-is) */}
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                Tamaño fino:
              </span>
              <input
                type="range" min={0.5} max={1.5} step={0.02}
                value={style.fill_mode_scale ?? 1.0}
                onChange={(e) => setStyle((s) => ({ ...s, fill_mode_scale: parseFloat(e.target.value) }))}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", minWidth: 50, textAlign: "right" }}>
                {Math.round((style.fill_mode_scale ?? 1.0) * 100)}%
              </span>
              <button
                className="btn btn-secondary"
                style={{ padding: "4px 10px", fontSize: 11 }}
                onClick={() => setStyle((s) => ({ ...s, fill_mode_scale: 1.0 }))}
              >
                Reset
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Multiplica el tamaño del preset elegido. 100% = preset tal cual · 120% = un poco más grande · 80% = más chico.
            </p>
          </div>

          {/* Background */}
          <div className="control-section">
            <h3>🎨 Fondo</h3>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { val: "blur",  label: "🌫️ Blur",  desc: "Difuminado del video" },
                { val: "black", label: "⬛ Negro", desc: "Negro sólido · TikTok style" },
              ].map(({ val, label, desc }) => (
                <button
                  key={val}
                  className={`btn ${style.background_style === val ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setStyle((s) => ({ ...s, background_style: val }))}
                  style={{ flex: 1, textAlign: "left", padding: "10px 14px" }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
                  <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Text toggles: sin textos + sin emojis */}
          <div className="control-section">
            <h3>🚫 Opciones de texto</h3>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -4, marginBottom: 8 }}>
              Toggles para limpiar el caption sin re-analizar el video.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                className={`btn ${style.no_text ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setStyle((s) => ({ ...s, no_text: !s.no_text }))}
                style={{ width: "100%", padding: "10px 14px", textAlign: "center" }}
              >
                {style.no_text
                  ? "✅ Sin textos activado — video totalmente limpio"
                  : "📝 Mostrar caption + subtítulos (default)"}
              </button>
              <button
                className={`btn ${style.no_emojis ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setStyle((s) => ({ ...s, no_emojis: !s.no_emojis }))}
                disabled={style.no_text}
                style={{
                  width: "100%", padding: "10px 14px", textAlign: "center",
                  opacity: style.no_text ? 0.4 : 1,
                  cursor: style.no_text ? "not-allowed" : "pointer",
                }}
                title={style.no_text ? "Ya estás ocultando todo el texto" : ""}
              >
                {style.no_emojis
                  ? "✅ Sin emojis — caption sin 🔥 💀 etc"
                  : "😀 Mostrar emojis en caption (default)"}
              </button>
            </div>
          </div>

          {/* Caption Style */}
          <div className="control-section">
            <h3>✍️ Caption Style</h3>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { val: "box",    label: "□ Caja blanca", desc: "Texto negro sobre caja" },
                { val: "tiktok", label: "🎵 TikTok",     desc: "Texto blanco con outline" },
              ].map(({ val, label, desc }) => (
                <button
                  key={val}
                  className={`btn ${style.caption_style === val ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setStyle((s) => ({ ...s, caption_style: val }))}
                  style={{ flex: 1, textAlign: "left", padding: "10px 14px" }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
                  <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>{desc}</div>
                </button>
              ))}
            </div>

            {/* Font picker for caption */}
            <div style={{ marginTop: 14 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                Fuente del caption
              </label>
              <select
                value={style.caption_font}
                onChange={(e) => setStyle((s) => ({ ...s, caption_font: e.target.value }))}
                style={{
                  width: "100%", background: "#111", border: "1px solid #333",
                  borderRadius: 8, padding: "9px 12px", color: "#e5e5e5",
                  fontSize: 13, cursor: "pointer",
                }}
              >
                <optgroup label="Windows (siempre disponibles)">
                  <option value="calibri">Calibri Bold (default)</option>
                  <option value="arial_black">Arial Black — gruesa, alta impacto</option>
                  <option value="impact">Impact — meme classic, condensada</option>
                  <option value="verdana">Verdana Bold — ancha y legible</option>
                  <option value="segoe_ui">Segoe UI Black — moderna Windows</option>
                  <option value="trebuchet">Trebuchet MS Bold — casual con curvas</option>
                </optgroup>
                <optgroup label="Google Fonts (descargar — ver fonts/README.md)">
                  <option value="montserrat">Montserrat Black — la más viral, profesional</option>
                  <option value="poppins">Poppins Bold — redondeada, motivacional</option>
                  <option value="bebas">Bebas Neue — alta condensada, headlines</option>
                  <option value="anton">Anton — bold condensada moderna</option>
                  <option value="oswald">Oswald Bold — condensada elegante</option>
                </optgroup>
              </select>
              <p style={{ fontSize: 10, color: "#555", marginTop: 6, marginBottom: 0 }}>
                Si eliges una de Google Fonts y aún no la descargaste, se usará Calibri como fallback (no rompe nada).
              </p>
            </div>
          </div>

          {/* Cinematic visual filter */}
          <div className="control-section">
            <h3>🎨 Filtro cinematográfico</h3>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -4, marginBottom: 8 }}>
              Cambia el look del video. Se aplica al preview y al export.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[
                { val: "none",      label: "✕ Ninguno",   desc: "Sin filtro" },
                { val: "cinematic", label: "🎬 Cinematic", desc: "Teal & orange · drama" },
                { val: "warm",      label: "🌅 Warm",      desc: "Dorado · motivacional" },
                { val: "vivid",     label: "⚡ Vivid",     desc: "Saturado · stop scroll" },
                { val: "moody",     label: "🌑 Moody",     desc: "Oscuro · storytime" },
                { val: "bw",        label: "⚫ B&W",       desc: "Blanco y negro" },
              ].map(({ val, label, desc }) => (
                <button
                  key={val}
                  className={`btn ${style.visual_filter === val ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setStyle((s) => ({ ...s, visual_filter: val }))}
                  style={{ textAlign: "left", padding: "10px 12px" }}
                >
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{label}</div>
                  <div style={{ fontSize: 10, opacity: 0.65, marginTop: 2 }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Subtitles (burned into export) */}
          <div className="control-section">
            <h3>💬 Subtítulos automáticos</h3>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -4, marginBottom: 8 }}>
              Generados con Whisper. Se aplican al preview y al export.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { val: "none",        label: "✕ Ninguno",      desc: "Sin subtítulos" },
                { val: "clean",       label: "📝 Limpio",       desc: "Texto blanco con borde" },
                { val: "karaoke",     label: "🎤 Karaoke",      desc: "Palabra resaltada amarillo" },
                { val: "popup",       label: "💥 Pop-up",       desc: "Una palabra a la vez" },
                { val: "highlight",   label: "📦 Highlight Box", desc: "Submagic · caja amarilla" },
                { val: "big_center",  label: "🔠 Big Center",   desc: "Palabra gigante centro" },
                { val: "twoword",     label: "2️⃣ Two-Word",     desc: "Dos palabras a la vez" },
                { val: "bounce",      label: "🎢 Bounce",       desc: "Aparece con rebote grande" },
                { val: "typewriter",  label: "⌨️ Typewriter",   desc: "Letra por letra" },
              ].map(({ val, label, desc }) => (
                <button
                  key={val}
                  className={`btn ${style.subtitle_style === val ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setStyle((s) => ({ ...s, subtitle_style: val }))}
                  style={{ textAlign: "left", padding: "10px 14px" }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
                  <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>{desc}</div>
                </button>
              ))}
            </div>

            {/* Subtitle size slider */}
            {style.subtitle_style !== "none" && (
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  Tamaño:
                </span>
                <input
                  type="range" min={0.6} max={1.6} step={0.05}
                  value={style.subtitle_size_scale}
                  onChange={(e) => setStyle((s) => ({ ...s, subtitle_size_scale: parseFloat(e.target.value) }))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", minWidth: 50 }}>
                  {Math.round(style.subtitle_size_scale * 100)}%
                </span>
                <button
                  className="btn btn-secondary"
                  style={{ padding: "4px 10px", fontSize: 11 }}
                  onClick={() => setStyle((s) => ({ ...s, subtitle_size_scale: 1.0 }))}
                >
                  Reset
                </button>
              </div>
            )}

            {/* Subtitle vertical position slider */}
            {style.subtitle_style !== "none" && (() => {
              const y = style.subtitle_y || 0;
              const labelTxt = y === 0 ? "default" : y > 0 ? `⬆ ${Math.round(y * 100)}%` : `⬇ ${Math.round(-y * 100)}%`;
              return (
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    Posición:
                  </span>
                  <input
                    type="range" min={-0.5} max={0.5} step={0.02}
                    value={y}
                    onChange={(e) => setStyle((s) => ({ ...s, subtitle_y: parseFloat(e.target.value) }))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", minWidth: 70, textAlign: "right" }}>
                    {labelTxt}
                  </span>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: "4px 10px", fontSize: 11 }}
                    onClick={() => setStyle((s) => ({ ...s, subtitle_y: 0.0 }))}
                  >
                    Reset
                  </button>
                </div>
              );
            })()}
          </div>

          {/* IG Video Size */}
          <div className="control-section">
            <h3>📸 IG Video Size</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["fit", "medium", "mini", "zoom", "fill", "small"].map((m) => (
                <button
                  key={m}
                  className={`btn ${style.ig_fill_mode === m ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setStyle((s) => ({ ...s, ig_fill_mode: m }))}>
                  {m === "medium" ? "Medium" : m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              Fit = pequeño · Medium = un poco más grande · Zoom = grande · Fill = completo · Small = reducido
            </p>
            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 12, display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span>Posición del texto IG</span>
                <span style={{ color: "var(--text-muted)" }}>
                  {style.ig_top_padding <= 100 ? "⬆ Arriba" : style.ig_top_padding >= 280 ? "⬇ Abajo" : "↕ Centro"}
                </span>
              </label>
              <input
                type="range"
                min="40"
                max="400"
                step="10"
                value={style.ig_top_padding}
                onChange={(e) => setStyle((s) => ({ ...s, ig_top_padding: parseInt(e.target.value) }))}
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 12, display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span>Marca de agua IG</span>
                <span style={{ color: "var(--text-muted)" }}>
                  {style.ig_watermark_y <= 0.25 ? "⬆ Arriba" : style.ig_watermark_y >= 0.75 ? "⬇ Abajo" : "↕ Centro"}
                </span>
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={style.ig_watermark_y}
                onChange={(e) => setStyle((s) => ({ ...s, ig_watermark_y: parseFloat(e.target.value) }))}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          {/* Split Screen */}
          <div className="control-section">
            <h3>📐 Split Screen</h3>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
              Video arriba + imagen abajo
            </p>
            <label className={`watermark-upload ${splitImagePreview ? "has-image" : ""}`} htmlFor="split-img-input"
              style={{ marginBottom: 10 }}>
              {splitImagePreview ? (
                <img src={splitImagePreview} alt="Split" style={{ maxHeight: 80 }} />
              ) : (
                <span style={{ color: "var(--text-muted)" }}>Click to upload image (PNG/JPG)</span>
              )}
              <input id="split-img-input" type="file" accept="image/*" hidden onChange={handleSplitImageUpload} />
            </label>

            {splitImagePreview && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>Enabled</label>
                  <input
                    type="checkbox"
                    checked={style.split_screen_enabled}
                    onChange={(e) => setStyle(s => ({ ...s, split_screen_enabled: e.target.checked }))}
                    style={{ accentColor: "var(--accent)" }}
                  />
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 11, padding: "3px 8px", marginLeft: "auto" }}
                    onClick={handleRemoveSplitImage}
                  >
                    Remove
                  </button>
                </div>
                {style.split_screen_enabled && (
                  <div className="slider-group">
                    <label>
                      Video / Image
                      <span>{Math.round(style.split_ratio * 100)}% / {Math.round((1 - style.split_ratio) * 100)}%</span>
                    </label>
                    <input
                      type="range" min={30} max={70}
                      value={Math.round(style.split_ratio * 100)}
                      onChange={(e) => setStyle(s => ({ ...s, split_ratio: parseInt(e.target.value) / 100 }))}
                    />
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                      Video: {Math.round(1920 * style.split_ratio)}px · Image: {Math.round(1920 * (1 - style.split_ratio))}px
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Text controls */}
          <div className="control-section">
            <h3>📝 Text Overlay</h3>
            <div className="slider-group">
              <label>
                Posición vertical
                <span>
                  {style.text_y <= 0.25 ? "⬆ Top" : style.text_y >= 0.65 ? "⬇ Bottom" : "↕ Middle"} · {Math.round(style.text_y * 100)}%
                </span>
              </label>
              <input
                type="range" min={5} max={95}
                value={Math.round(style.text_y * 100)}
                onChange={(e) => setStyle((s) => ({ ...s, text_y: parseInt(e.target.value) / 100 }))}
              />
            </div>
            <div className="slider-group">
              <label>
                Posición horizontal
                <span>
                  {style.text_x <= 0.2 ? "← Izquierda" : style.text_x >= 0.8 ? "→ Derecha" : "↔ Centro"} · {Math.round(style.text_x * 100)}%
                </span>
              </label>
              <input
                type="range" min={5} max={95}
                value={Math.round(style.text_x * 100)}
                onChange={(e) => setStyle((s) => ({ ...s, text_x: parseInt(e.target.value) / 100 }))}
              />
            </div>
            <div className="slider-group">
              <label>Font Size <span>{style.font_size}px</span></label>
              <input type="range" min={20} max={100} value={style.font_size}
                onChange={(e) => setStyle((s) => ({ ...s, font_size: parseInt(e.target.value) }))} />
            </div>
            <div className="slider-group">
              <label>Stroke Width <span>{style.text_stroke_width}px</span></label>
              <input type="range" min={0} max={12} value={style.text_stroke_width}
                onChange={(e) => setStyle((s) => ({ ...s, text_stroke_width: parseInt(e.target.value) }))} />
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              <div className="config-field" style={{ flex: 1 }}>
                <label>Text Color</label>
                <input type="color" value={style.text_color}
                  onChange={(e) => setStyle((s) => ({ ...s, text_color: e.target.value }))}
                  style={{ height: 40 }} />
              </div>
              <div className="config-field" style={{ flex: 1 }}>
                <label>Stroke Color</label>
                <input type="color" value={style.text_stroke_color}
                  onChange={(e) => setStyle((s) => ({ ...s, text_stroke_color: e.target.value }))}
                  style={{ height: 40 }} />
              </div>
            </div>
          </div>

          {/* Watermark */}
          <div className="control-section">
            <h3>🖼️ Watermark</h3>
            <label className={`watermark-upload ${watermarkPreview ? "has-image" : ""}`} htmlFor="wm-input">
              {watermarkPreview ? (
                <img src={watermarkPreview} alt="Watermark" />
              ) : (
                <span style={{ color: "var(--text-muted)" }}>Click to upload PNG</span>
              )}
              <input id="wm-input" type="file" accept="image/png" hidden onChange={handleWatermarkUpload} />
            </label>

            {watermarkPreview && (
              <>
                <div className="slider-group" style={{ marginTop: 12 }}>
                  <label>Size <span>{(style.watermark_scale * 100).toFixed(0)}%</span></label>
                  <input type="range" min={10} max={100} value={style.watermark_scale * 100}
                    onChange={(e) => setStyle((s) => ({ ...s, watermark_scale: parseInt(e.target.value) / 100 }))} />
                </div>
                <div className="slider-group">
                  <label>Opacity <span>{(style.watermark_opacity * 100).toFixed(0)}%</span></label>
                  <input type="range" min={10} max={100} value={style.watermark_opacity * 100}
                    onChange={(e) => setStyle((s) => ({ ...s, watermark_opacity: parseInt(e.target.value) / 100 }))} />
                </div>
                <div className="slider-group">
                  <label>
                    Posición vertical
                    <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
                      {style.watermark_y <= 0.25 ? "⬆ Arriba" : style.watermark_y >= 0.75 ? "⬇ Abajo" : "↕ Centro"}
                    </span>
                  </label>
                  <input type="range" min={0} max={1} step={0.05} value={style.watermark_y}
                    onChange={(e) => setStyle((s) => ({ ...s, watermark_y: parseFloat(e.target.value) }))} />
                </div>
              </>
            )}
          </div>

          {/* Anti-detect */}
          <div className="control-section">
            <h3>🛡️ Anti-Detect
              {[style.strip_metadata, style.flip_horizontal, style.zoom_uniquify, style.boost_contrast].filter(Boolean).length > 0 && (
                <span style={{ fontSize: 11, background: "var(--accent)", color: "#fff", borderRadius: 10, padding: "1px 7px", marginLeft: 8 }}>
                  {[style.strip_metadata, style.flip_horizontal, style.zoom_uniquify, style.boost_contrast].filter(Boolean).length} activo{[style.strip_metadata, style.flip_horizontal, style.zoom_uniquify, style.boost_contrast].filter(Boolean).length > 1 ? "s" : ""}
                </span>
              )}
            </h3>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
              Se aplican al exportar · No modifican el preview
            </p>
            <div className="btn-group" style={{ flexWrap: "wrap", gap: 6 }}>
              <button
                className={`btn ${style.strip_metadata ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setStyle(s => ({ ...s, strip_metadata: !s.strip_metadata }))}
                title="Elimina metadatos EXIF/MP4 del archivo">
                {style.strip_metadata ? "✓ " : ""}🧹 Strip Metadata
              </button>
              <button
                className={`btn ${style.flip_horizontal ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setStyle(s => ({ ...s, flip_horizontal: !s.flip_horizontal }))}
                title="Espejo horizontal del video">
                {style.flip_horizontal ? "✓ " : ""}🔄 Flip
              </button>
              <button
                className={`btn ${style.zoom_uniquify ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setStyle(s => ({ ...s, zoom_uniquify: !s.zoom_uniquify }))}
                title="Zoom +2% sutil para romper el fingerprint">
                {style.zoom_uniquify ? "✓ " : ""}🔍 Zoom +2%
              </button>
              <button
                className={`btn ${style.boost_contrast ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setStyle(s => ({ ...s, boost_contrast: !s.boost_contrast }))}
                title="Leve ajuste de contraste y brillo">
                {style.boost_contrast ? "✓ " : ""}✨ Boost
              </button>
            </div>
          </div>

          {/* Clip Selection for Export */}
          <div className="control-section">
            <h3>📦 Select Clips to Export</h3>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button className="btn btn-secondary" style={{ fontSize: 11, padding: "4px 10px" }} onClick={selectAll}>Select All</button>
              <button className="btn btn-secondary" style={{ fontSize: 11, padding: "4px 10px" }} onClick={selectNone}>Select None</button>
              <span style={{ color: "var(--text-muted)", fontSize: 12, alignSelf: "center", marginLeft: 4 }}>
                {selectedClipIds.size} / {clips.length} selected
              </span>
            </div>
            <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {clips.map(c => (
                <label key={c.id} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 10px", background: selectedClipIds.has(c.id) ? "var(--bg-card-hover)" : "var(--bg-card)",
                  borderRadius: 6, cursor: "pointer", fontSize: 12,
                  border: selectedClipIds.has(c.id) ? "1px solid var(--accent)" : "1px solid var(--border)",
                  transition: "all 0.15s ease",
                }}>
                  <input
                    type="checkbox"
                    checked={selectedClipIds.has(c.id)}
                    onChange={() => toggleClipSelection(c.id)}
                    style={{ accentColor: "var(--accent)" }}
                  />
                  <span style={{ color: "var(--text-primary)" }}>Clip {c.id}:</span>
                  <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.description}
                  </span>
                  <span style={{ color: "var(--text-muted)", marginLeft: "auto", flexShrink: 0 }}>{c.duration.toFixed(0)}s</span>
                </label>
              ))}
            </div>
          </div>

          {/* Export Button */}
          <div className="btn-group" style={{ flexDirection: "column", gap: 8 }}>
            <button className="btn btn-success" onClick={() => handleExport("tiktok")} disabled={selectedClipIds.size === 0}>
              📦 Export {selectedClipIds.size} Clip{selectedClipIds.size !== 1 ? "s" : ""}
            </button>
            <button
              className="btn"
              onClick={() => handleExport("instagram")}
              disabled={selectedClipIds.size === 0}
              style={{
                background: "linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%)",
                color: "#fff",
                border: "none",
                opacity: selectedClipIds.size === 0 ? 0.5 : 1,
              }}
            >
              📸 Export Instagram ({selectedClipIds.size})
            </button>
          </div>
        </div>
      </div>

      {/* 🎬 Clip Editor Modal — also accessible from this step */}
      {editorClip && (
        <ClipEditorModal
          projectId={projectId}
          clip={editorClip}
          fillMode={style.fill_mode}
          backgroundStyle={style.background_style}
          onClose={() => setEditorClip(null)}
          onSaved={(updated) => {
            // Persist the full clip update to the parent's clips array so the
            // edit survives navigating back to step 2 or re-rendering.
            if (onUpdateClip) onUpdateClip(updated.id, updated);
            // If the saved clip is the currently selected one, sync local
            // selectedClip state and force the next preview to regenerate
            // (URLs already include ?t=Date.now() so any new call cache-busts).
            if (selectedClip && selectedClip.id === updated.id) {
              setSelectedClip({ ...selectedClip, ...updated });
              setPreviewUrl(null);
              setVideoPreviewUrl(null);
            }
            setEditorClip(null);
          }}
        />
      )}
    </div>
  );
}

// ================================================
// ================================================
// LIVE STREAM CLIPPER
// ================================================
function SegmentTimer({ startedAt, totalMinutes }) {
  const [elapsed, setElapsed] = useState(0);
  const totalSecs = totalMinutes * 60;

  useEffect(() => {
    if (!startedAt) return;
    const update = () => {
      const diff = (Date.now() - new Date(startedAt).getTime()) / 1000;
      setElapsed(Math.min(diff, totalSecs));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt, totalSecs]);

  const remaining = Math.max(0, totalSecs - elapsed);
  const pct = Math.min(100, (elapsed / totalSecs) * 100);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: "#f87171", fontWeight: 600 }}>🔴 Grabando</span>
        <span style={{ color: "var(--text-muted)" }}>{fmt(remaining)} restantes</span>
      </div>
      <div style={{ background: "var(--bg-primary)", borderRadius: 4, height: 6, overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 4,
          background: "linear-gradient(90deg, #a78bfa, #ec4899)",
          width: `${pct}%`,
          transition: "width 1s linear",
        }} />
      </div>
    </div>
  );
}

function LiveStreamStep() {
  const [url, setUrl] = useState("");
  const [segmentMinutes, setSegmentMinutes] = useState(10);
  const [resolution, setResolution] = useState("720p");
  const [startOffset, setStartOffset] = useState(0);
  const [sessionId, setSessionId] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  // Poll status every 3s while session active
  useEffect(() => {
    if (!sessionId) return;
    const poll = async () => {
      try {
        const data = await api.getStreamStatus(sessionId);
        setSessionData(data);
        if (data.status === "stopped" || data.status === "error") {
          clearInterval(pollRef.current);
          clearInterval(timerRef.current);
        }
      } catch (e) { /* ignore transient */ }
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => clearInterval(pollRef.current);
  }, [sessionId]);

  const handleStart = async () => {
    if (!url.trim()) { setError("Ingresa una URL de Twitch o Kick"); return; }
    setError("");
    setLoading(true);
    try {
      const res = await api.startStream(url.trim(), segmentMinutes, 5, resolution, startOffset);
      setSessionId(res.session_id);
      setSessionData({ session_id: res.session_id, status: res.status, segments: [], ready_count: 0 });
      setElapsed(0);
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const handleStop = async () => {
    if (!sessionId) return;
    try {
      await api.stopStream(sessionId);
      setSessionData((prev) => ({ ...prev, status: "stopping" }));
    } catch (e) { setError(e.message); }
  };

  const handleReset = () => {
    clearInterval(pollRef.current);
    clearInterval(timerRef.current);
    setSessionId(null);
    setSessionData(null);
    setUrl("");
    setError("");
    setElapsed(0);
  };

  const formatElapsed = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const isActive = sessionData && (sessionData.status === "recording" || sessionData.status === "starting");
  const segments = sessionData?.segments ?? [];
  const readyCount = sessionData?.ready_count ?? 0;

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #1a0a0a 0%, #2a0a0a 100%)",
        borderRadius: 16, padding: "22px 28px", marginBottom: 20,
        border: "1px solid #4a1a1a",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 28 }}>🔴</div>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#fff" }}>Live Stream Clipper</h2>
            <p style={{ margin: 0, color: "#aa8888", fontSize: 13 }}>
              Graba segmentos → descarga → sube al Video Clipper para extraer clips con Gemini
            </p>
          </div>
        </div>
      </div>

      <div style={{ background: "#1a1a1a", borderRadius: 14, padding: "20px 24px", border: "1px solid #2a2a2a", marginBottom: 16 }}>
        {!sessionId ? (
          <>
            {/* URL input */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 12, color: "#888", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>
                URL del Stream
              </label>
              <input
                type="text"
                placeholder="https://twitch.tv/canal  ·  https://kick.com/canal"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStart()}
                style={{
                  width: "100%", background: "#111", border: url ? "1px solid #6366f1" : "1px solid #333",
                  borderRadius: 10, padding: "12px 14px", color: "#fff", fontSize: 14,
                  boxSizing: "border-box", transition: "border 0.2s",
                }}
              />
            </div>

            {/* Duration */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 12, color: "#888", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>
                Duración por segmento
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                {[5, 7, 10, 15, 20, 30].map((m) => (
                  <button
                    key={m}
                    onClick={() => setSegmentMinutes(m)}
                    style={{
                      flex: 1, padding: "10px 4px", borderRadius: 8, cursor: "pointer",
                      border: segmentMinutes === m ? "2px solid #ef4444" : "2px solid #2a2a2a",
                      background: segmentMinutes === m ? "#ef444422" : "#111",
                      color: segmentMinutes === m ? "#fca5a5" : "#666",
                      fontSize: 13, fontWeight: 600, transition: "all 0.15s",
                    }}
                  >{m}m</button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: "#555", marginTop: 6 }}>
                5m = clips rápido · 10-15m = más contexto para Gemini
              </p>
            </div>

            {/* Resolution */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 12, color: "#888", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>
                Resolución
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {[["480p", "Pequeño"], ["720p", "Balance"], ["1080p", "HD"]].map(([r, desc]) => (
                  <button
                    key={r}
                    onClick={() => setResolution(r)}
                    style={{
                      flex: 1, padding: "10px 8px", borderRadius: 8, cursor: "pointer",
                      border: resolution === r ? "2px solid #ef4444" : "2px solid #2a2a2a",
                      background: resolution === r ? "#ef444422" : "#111",
                      color: resolution === r ? "#fca5a5" : "#666",
                      fontWeight: 600, transition: "all 0.15s",
                    }}
                  >
                    <div style={{ fontSize: 13 }}>{r}</div>
                    <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Start offset (rewind) */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 12, color: "#888", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 6 }}>
                ⏪ Empezar desde
              </label>
              <p style={{ fontSize: 11, color: "#555", margin: "0 0 8px" }}>
                Retrocede en el stream en vivo (Twitch guarda ~30-60 min en caché)
              </p>
              <div style={{ display: "flex", gap: 6 }}>
                {[[0, "🔴 En vivo"], [10, "−10 min"], [20, "−20 min"], [30, "−30 min"]].map(([mins, label]) => (
                  <button
                    key={mins}
                    onClick={() => setStartOffset(mins)}
                    style={{
                      flex: 1, padding: "10px 4px", borderRadius: 8, cursor: "pointer",
                      border: startOffset === mins ? "2px solid #ef4444" : "2px solid #2a2a2a",
                      background: startOffset === mins ? "#ef444422" : "#111",
                      color: startOffset === mins ? "#fca5a5" : "#666",
                      fontSize: 12, fontWeight: 600, transition: "all 0.15s",
                    }}
                  >{label}</button>
                ))}
              </div>
            </div>

            {error && (
              <div style={{ color: "#f87171", fontSize: 13, marginBottom: 14, background: "#ef444411", padding: "10px 14px", borderRadius: 8 }}>
                {error}
              </div>
            )}

            <button
              onClick={handleStart}
              disabled={loading || !url.trim()}
              style={{
                width: "100%", fontSize: 15, padding: "14px 0", borderRadius: 12,
                border: "none", cursor: url.trim() ? "pointer" : "default", fontWeight: 700,
                background: url.trim()
                  ? "linear-gradient(135deg, #dc2626 0%, #ef4444 100%)"
                  : "#1a1a1a",
                color: url.trim() ? "#fff" : "#444",
                transition: "all 0.2s",
                boxShadow: url.trim() ? "0 4px 20px rgba(239,68,68,0.3)" : "none",
              }}
            >
              {loading ? "⏳ Conectando..." : "▶ Iniciar grabación"}
            </button>
          </>
        ) : (
          <>
            {/* Status bar */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10, marginBottom: 16,
              background: "#111", borderRadius: 10, padding: "12px 16px",
              border: isActive ? "1px solid #ef444444" : "1px solid #2a2a2a",
            }}>
              <div style={{
                width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                background: isActive ? "#ef4444" : "#6b7280",
                boxShadow: isActive ? "0 0 0 3px rgba(239,68,68,0.3)" : "none",
                animation: isActive ? "pulse 1.5s infinite" : "none",
              }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: isActive ? "#fca5a5" : "#aaa" }}>
                {isActive ? "🔴 En vivo" : sessionData?.status === "stopping" ? "⏳ Deteniendo..." : "⏹ Finalizado"}
              </span>
              {isActive && (
                <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700, background: "#ef444418", padding: "2px 8px", borderRadius: 6, flexShrink: 0 }}>
                  ⏱ {formatElapsed(elapsed)}
                </span>
              )}
              <span style={{ fontSize: 12, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {url}
              </span>
              <span style={{ fontSize: 13, flexShrink: 0 }}>
                <b style={{ color: "#22c55e" }}>{readyCount}</b>
                <span style={{ color: "#555", fontSize: 11 }}> listos</span>
                {" / "}
                <b>{segments.length}</b>
                <span style={{ color: "#555", fontSize: 11 }}> total</span>
              </span>
            </div>

            {sessionData?.error && (
              <div style={{ background: "#450a0a", border: "1px solid #f87171", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#fca5a5" }}>
                ❌ {sessionData.error}
              </div>
            )}

            {/* Segments */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {segments.map((seg) => (
                <div key={seg.index} style={{
                  background: seg.status === "ready" ? "#0d1a0d" : "#111",
                  borderRadius: 10, padding: "12px 14px",
                  border: seg.status === "ready" ? "1px solid #22c55e33" : "1px solid #222",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 15, flexShrink: 0 }}>
                      {seg.status === "recording" ? "🔴" : seg.status === "ready" ? "✅" : seg.status === "skipped" ? "⏭️" : "❌"}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 14, flexShrink: 0, color: "#e5e5e5" }}>
                      Segmento {seg.index + 1}
                    </span>
                    {seg.status === "recording" && seg.started_at ? (
                      <SegmentTimer startedAt={seg.started_at} totalMinutes={segmentMinutes} />
                    ) : seg.status === "ready" ? (
                      <>
                        <span style={{ fontSize: 12, color: "#666" }}>
                          {seg.duration_recorded > 0 ? `${Math.round(seg.duration_recorded / 60)}m` : ""}
                          {seg.file_size_mb > 0 ? ` · ${seg.file_size_mb} MB` : ""}
                        </span>
                        <a
                          href={`http://localhost:8000/api/stream/download/${sessionData.session_id}/${seg.index}`}
                          download
                          style={{
                            marginLeft: "auto", padding: "5px 14px", fontSize: 12, textDecoration: "none",
                            background: "#22c55e22", color: "#22c55e", border: "1px solid #22c55e44",
                            borderRadius: 8, fontWeight: 600,
                          }}
                        >
                          ⬇ Descargar
                        </a>
                      </>
                    ) : seg.status === "skipped" ? (
                      <span style={{ fontSize: 12, color: "#555" }}>Muy corto, ignorado</span>
                    ) : seg.error ? (
                      <span style={{ fontSize: 12, color: "#f87171" }}>{seg.error.slice(0, 80)}</span>
                    ) : null}
                  </div>
                </div>
              ))}

              {isActive && segments.length === 0 && (
                <div style={{ background: "#111", borderRadius: 10, padding: "18px", textAlign: "center", fontSize: 13, color: "#555" }}>
                  ⏳ Conectando al stream...
                </div>
              )}
            </div>

            {readyCount > 0 && (
              <div style={{ background: "#052e16", border: "1px solid #16a34a", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#86efac" }}>
                ✅ {readyCount} segmento{readyCount > 1 ? "s" : ""} listo{readyCount > 1 ? "s" : ""} — descárgalo{readyCount > 1 ? "s" : ""} y súbelo{readyCount > 1 ? "s" : ""} al <b>Video Clipper</b>
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              {isActive && (
                <button
                  onClick={handleStop}
                  style={{
                    flex: 1, padding: "12px 0", borderRadius: 10,
                    background: "#2a1010", color: "#f87171", cursor: "pointer",
                    fontSize: 14, fontWeight: 600, border: "1px solid #ef444444",
                  }}
                >
                  ⏹ Detener grabación
                </button>
              )}
              {!isActive && (
                <button
                  onClick={handleReset}
                  style={{
                    flex: 1, padding: "12px 0", borderRadius: 10, border: "none",
                    background: "linear-gradient(135deg, #dc2626, #ef4444)",
                    color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700,
                  }}
                >
                  🔄 Nueva sesión
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


// ================================================
// MEME PRESETS (global — applied to all cards at once)
// ================================================
const MEME_PRESETS = [
  { label: "🎯 Estándar",    vals: { textY: 0.08, textX: 0.05, videoY: 0.60, videoScale: 0.9,  fontSize: 60 } },
  { label: "⬆ Texto arriba", vals: { textY: 0.04, textX: 0.05, videoY: 0.65, videoScale: 0.9,  fontSize: 60 } },
  { label: "🎬 Video grande", vals: { textY: 0.04, textX: 0.05, videoY: 0.58, videoScale: 1.0,  fontSize: 60 } },
  { label: "📐 Equilibrado",  vals: { textY: 0.12, textX: 0.05, videoY: 0.55, videoScale: 0.85, fontSize: 60 } },
];

// ================================================
// MEME ITEM CARD
// ================================================
function MemeItemCard({ item, batchId, index, statusLabel, globalPreset, globalCropTopPct = 0, globalCropBottomPct = 0, globalCropLeftPct = 0, globalCropRightPct = 0, globalCornerRadius = 0 }) {
  const [textY, setTextY] = useState(0.22);
  const [textX, setTextX] = useState(0.05);
  const [videoY, setVideoY] = useState(0.55);
  const [videoScale, setVideoScale] = useState(0.9);
  const [fontSize, setFontSize] = useState(60);
  const [cropTopPct, setCropTopPct] = useState(0);
  const [cropBottomPct, setCropBottomPct] = useState(0);
  const [cropLeftPct, setCropLeftPct] = useState(0);
  const [cropRightPct, setCropRightPct] = useState(0);
  const [cornerRadius, setCornerRadius] = useState(0);
  const [cropPreviewUrl, setCropPreviewUrl] = useState(null);
  const [reexporting, setReexporting] = useState(false);
  const [bust, setBust] = useState(null);
  const [showSliders, setShowSliders] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingText, setEditingText] = useState(false);
  const [customText, setCustomText] = useState("");

  // Sync global values into local state
  useEffect(() => {
    setCropTopPct(globalCropTopPct);
    setCropBottomPct(globalCropBottomPct);
  }, [globalCropTopPct, globalCropBottomPct]);

  useEffect(() => {
    setCropLeftPct(globalCropLeftPct);
    setCropRightPct(globalCropRightPct);
  }, [globalCropLeftPct, globalCropRightPct]);

  useEffect(() => {
    setCornerRadius(globalCornerRadius);
  }, [globalCornerRadius]);

  // Apply global preset whenever parent changes it
  useEffect(() => {
    if (!globalPreset) return;
    setTextY(globalPreset.textY);
    setTextX(globalPreset.textX);
    setVideoY(globalPreset.videoY);
    setVideoScale(globalPreset.videoScale);
    setFontSize(globalPreset.fontSize);
  }, [globalPreset]);

  const handleReexport = async () => {
    setReexporting(true);
    try {
      await api.reexportMeme(batchId, index, textY, textX, videoScale, videoY, fontSize, customText, cropTopPct / 100, cropBottomPct / 100, cornerRadius, cropLeftPct / 100, cropRightPct / 100);
      setBust(Date.now());
      setEditingText(false);
    } catch (e) {
      // ignore
    } finally {
      setReexporting(false);
    }
  };

  const handleCopyDesc = async () => {
    try {
      const text = await api.getMemeIgDescription(batchId, index);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // ignore
    }
  };

  const isReady = item.status === "ready";
  const isError = item.status === "error";

  const statusColors = {
    pending: "#555",
    uploading: "#f59e0b",
    analyzing: "#3b82f6",
    exporting: "#8b5cf6",
    ready: "#22c55e",
    error: "#ef4444",
  };
  const statusColor = statusColors[item.status] || "#555";

  return (
    <div style={{
      background: "linear-gradient(135deg, #161616 0%, #1a1a1a 100%)",
      borderRadius: 12,
      border: `1px solid ${isReady ? "#22c55e33" : isError ? "#ef444433" : "#2a2a2a"}`,
      overflow: "hidden",
      boxShadow: isReady ? "0 0 0 1px #22c55e22" : "none",
    }}>
      {/* Header */}
      <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        {/* Status dot */}
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: statusColor, flexShrink: 0,
          boxShadow: `0 0 6px ${statusColor}`,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: "#e5e5e5",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{item.filename}</div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{statusLabel(item)}</div>
        </div>
        {/* Status badge */}
        <div style={{
          fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20,
          background: `${statusColor}22`, color: statusColor, flexShrink: 0,
          textTransform: "uppercase", letterSpacing: "0.05em",
        }}>
          {item.status === "ready" ? "Listo" : item.status === "error" ? "Error" : "..."}
        </div>
      </div>

      {/* Meme/vibe text box */}
      {item.meme_text && (
        <div style={{
          margin: "0 14px 12px",
          padding: "10px 14px",
          background: "#0d0d0d",
          borderRadius: 8,
          borderLeft: `3px solid ${item.artist_info !== undefined ? "#f59e0b" : "#6366f1"}`,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: item.artist_info !== undefined ? "#f59e0b" : "#6366f1", fontWeight: 700, letterSpacing: "0.05em" }}>
              {item.artist_info !== undefined ? "VIBE TEXT" : "MEME TEXT"}
            </div>
            {isReady && (
              <button
                onClick={() => { setEditingText(v => !v); setCustomText(item.meme_text); }}
                style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 5, cursor: "pointer",
                  background: editingText ? "#6366f122" : "transparent",
                  color: editingText ? "#818cf8" : "#555",
                  border: editingText ? "1px solid #6366f144" : "1px solid #333",
                  fontWeight: 600,
                }}
              >
                ✏️ Editar
              </button>
            )}
          </div>
          {editingText ? (
            <textarea
              value={customText}
              onChange={e => setCustomText(e.target.value)}
              rows={3}
              style={{
                width: "100%", background: "#111", border: "1px solid #6366f155",
                borderRadius: 6, color: "#e5e5e5", fontSize: 14, fontWeight: 600,
                padding: "8px 10px", resize: "vertical", outline: "none",
                lineHeight: 1.5, boxSizing: "border-box",
              }}
              placeholder="Escribe el texto personalizado..."
            />
          ) : (
            <div style={{ fontSize: 14, color: "#e5e5e5", fontWeight: 600, lineHeight: 1.5 }}>
              {customText && customText !== item.meme_text ? customText : item.meme_text}
            </div>
          )}
        </div>
      )}

      {/* Artist info (music mode only) */}
      {item.artist_info?.artist && (
        <div style={{
          margin: "-4px 14px 12px",
          padding: "8px 14px",
          background: "#0d0d0d",
          borderRadius: 8,
          borderLeft: "3px solid #f59e0b",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ fontSize: 18 }}>🎤</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fbbf24" }}>{item.artist_info.artist}</div>
            {item.artist_info.instagram && (
              <div style={{ fontSize: 12, color: "#888", marginTop: 1 }}>{item.artist_info.instagram}</div>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {isReady && (
        <div style={{ padding: "0 14px 14px", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <a
            href={api.getMemeDownloadUrl(batchId, index, bust)}
            download
            style={{
              fontSize: 12, padding: "7px 14px", borderRadius: 8, textDecoration: "none",
              background: "#22c55e22", color: "#22c55e", border: "1px solid #22c55e44",
              fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5,
            }}
          >
            ⬇ Video
          </a>
          <a
            href={api.getMemeDescriptionUrl(batchId, index)}
            download
            style={{
              fontSize: 12, padding: "7px 14px", borderRadius: 8, textDecoration: "none",
              background: "#6366f122", color: "#818cf8", border: "1px solid #6366f144",
              fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5,
            }}
          >
            📄 Descripción .txt
          </a>
          <button
            onClick={handleCopyDesc}
            style={{
              fontSize: 12, padding: "7px 14px", borderRadius: 8, cursor: "pointer",
              background: copied ? "#22c55e22" : "#f59e0b22",
              color: copied ? "#22c55e" : "#fbbf24",
              border: `1px solid ${copied ? "#22c55e44" : "#f59e0b44"}`,
              fontWeight: 600,
            }}
          >
            {copied ? "✓ Copiado!" : "📋 Copiar desc"}
          </button>
          <button
            onClick={() => setShowVideo(v => !v)}
            style={{
              fontSize: 12, padding: "7px 14px", borderRadius: 8, cursor: "pointer",
              background: "#3b82f622", color: "#60a5fa", border: "1px solid #3b82f644",
              fontWeight: 600,
            }}
          >
            {showVideo ? "🙈 Ocultar" : "▶ Preview"}
          </button>
          <button
            onClick={() => setShowSliders(v => !v)}
            style={{
              fontSize: 12, padding: "7px 14px", borderRadius: 8, cursor: "pointer",
              background: "#8b5cf622", color: "#a78bfa", border: "1px solid #8b5cf644",
              fontWeight: 600,
            }}
          >
            {showSliders ? "✕ Cerrar" : "⚙ Ajustes"}
          </button>
        </div>
      )}

      {/* Video preview (collapsible) */}
      {isReady && showVideo && (
        <div style={{ padding: "0 14px 14px" }}>
          <video
            key={bust}
            src={api.getMemeDownloadUrl(batchId, index, bust)}
            controls
            style={{ width: "100%", maxHeight: 300, borderRadius: 8, background: "#000", display: "block" }}
          />
        </div>
      )}

      {/* Sliders (collapsible) */}
      {isReady && showSliders && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid #222" }}>
          <div style={{ paddingTop: 12 }}>

            {/* Crop + Corner sliders per item */}
            <div style={{ marginBottom: 12, padding: "12px", background: "#1a1100", borderRadius: 8, border: "1px solid #f59e0b44" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", marginBottom: 10 }}>✂️ Crop individual (elimina tweet/UI)</div>
              {[
                { label: "⬆️ Crop superior", value: cropTopPct, setValue: v => { setCropTopPct(v); setCropPreviewUrl(null); }, min: 0, max: 70, step: 1, fmt: v => `${v}%` },
                { label: "⬇️ Crop inferior",  value: cropBottomPct, setValue: v => { setCropBottomPct(v); setCropPreviewUrl(null); }, min: 0, max: 40, step: 1, fmt: v => `${v}%` },
                { label: "◀️ Crop izquierdo", value: cropLeftPct, setValue: v => { setCropLeftPct(v); setCropPreviewUrl(null); }, min: 0, max: 40, step: 1, fmt: v => `${v}%` },
                { label: "▶️ Crop derecho",   value: cropRightPct, setValue: v => { setCropRightPct(v); setCropPreviewUrl(null); }, min: 0, max: 40, step: 1, fmt: v => `${v}%` },
              ].map(({ label, value, setValue, min, max, step, fmt }) => (
                <div key={label} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#ccc", marginBottom: 3 }}>
                    <span>{label}</span>
                    <span style={{ color: "#f59e0b", fontWeight: 700 }}>{fmt(value)}</span>
                  </div>
                  <input type="range" min={min} max={max} step={step}
                    value={value} onChange={e => setValue(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "#f59e0b" }} />
                </div>
              ))}

              {/* Per-card crop preview */}
              {(cropTopPct > 0 || cropBottomPct > 0 || cropLeftPct > 0 || cropRightPct > 0) && (
                <button
                  onClick={() => setCropPreviewUrl(api.getCropPreviewUrl(batchId, index, cropTopPct / 100, cropBottomPct / 100, cropLeftPct / 100, cropRightPct / 100))}
                  style={{
                    width: "100%", padding: "6px 0", marginBottom: 8, borderRadius: 6,
                    border: "1px solid #f59e0b55", background: "#2a1800", color: "#f59e0b",
                    fontWeight: 600, fontSize: 12, cursor: "pointer",
                  }}
                >
                  🔍 Ver preview del crop
                </button>
              )}
              {cropPreviewUrl && (
                <div style={{ borderRadius: 6, overflow: "hidden", marginBottom: 8, border: "1px solid #f59e0b33" }}>
                  <img src={cropPreviewUrl} alt="crop preview" style={{ width: "100%", display: "block" }}
                    onError={() => setCropPreviewUrl(null)} />
                </div>
              )}

            </div>

            {[
              { label: "Texto vertical", value: textY, setValue: setTextY, min: 0.02, max: 0.45, step: 0.01, fmt: v => v <= 0.12 ? "⬆ Arriba" : v <= 0.28 ? "↕ Centro" : "⬇ Abajo" },
              { label: "Texto horizontal", value: textX, setValue: setTextX, min: 0.03, max: 0.7, step: 0.01, fmt: v => v <= 0.08 ? "← Izq" : v <= 0.42 ? "↔ Centro" : "→ Der" },
              { label: "Posición video", value: videoY, setValue: setVideoY, min: 0.25, max: 0.85, step: 0.01, fmt: v => v <= 0.38 ? "⬆ Arriba" : v <= 0.62 ? "↕ Centro" : "⬇ Abajo" },
              { label: "Tamaño video", value: videoScale, setValue: setVideoScale, min: 0.4, max: 1.0, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
              { label: "Tamaño letra", value: fontSize, setValue: v => setFontSize(parseInt(v)), min: 40, max: 140, step: 5, fmt: v => `${v}px` },
            ].map(({ label, value, setValue, min, max, step, fmt }) => (
              <div key={label} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888", marginBottom: 4 }}>
                  <span>{label}</span>
                  <span style={{ color: "#c4b5fd" }}>{fmt(value)}</span>
                </div>
                <input type="range" min={min} max={max} step={step}
                  value={value} onChange={e => setValue(e.target.value)}
                  style={{ width: "100%", accentColor: "#6366f1" }} />
              </div>
            ))}
            <button
              className="btn"
              style={{
                width: "100%", fontSize: 13, marginTop: 4,
                background: reexporting ? "#222" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "#fff", border: "none", borderRadius: 8, padding: "10px 0",
              }}
              onClick={handleReexport}
              disabled={reexporting}
            >
              {reexporting ? "⏳ Re-exportando..." : "🔄 Re-exportar con estos ajustes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ================================================
// MEME GENERATOR
// ================================================
function MemeStep() {
  const [files, setFiles] = useState([]);
  const [bgColor, setBgColor] = useState("black");
  const [contentType, setContentType] = useState("meme");
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [batchId, setBatchId] = useState(null);
  const [batch, setBatch] = useState(null);
  const [error, setError] = useState("");
  const [showGlobalSliders, setShowGlobalSliders] = useState(false);
  const [gTextY, setGTextY] = useState(0.22);
  const [gTextX, setGTextX] = useState(0.05);
  const [gVideoY, setGVideoY] = useState(0.55);
  const [gVideoScale, setGVideoScale] = useState(0.9);
  const [gFontSize, setGFontSize] = useState(65);
  const [gCropTopPct, setGCropTopPct] = useState(0);
  const [gCropBottomPct, setGCropBottomPct] = useState(0);
  const [gCropLeftPct, setGCropLeftPct] = useState(0);
  const [gCropRightPct, setGCropRightPct] = useState(0);
  const [gCornerRadius, setGCornerRadius] = useState(0);
  const [cropPreviewImg, setCropPreviewImg] = useState(null);
  const [reexportingAll, setReexportingAll] = useState(false);
  // Crop state
  const [cropEnabled, setCropEnabled] = useState(false);
  const [cropTopPct, setCropTopPct] = useState(0);
  const [cropBottomPct, setCropBottomPct] = useState(0);
  const [cropLeftPct, setCropLeftPct] = useState(0);
  const [cropRightPct, setCropRightPct] = useState(0);
  const [cropFrameUrl, setCropFrameUrl] = useState(null);
  const [detectingCrop, setDetectingCrop] = useState(false);
  const [cropDetectError, setCropDetectError] = useState("");
  const pollRef = useRef(null);
  const fileInputRef = useRef(null);

  // Poll batch status
  useEffect(() => {
    if (!batchId) return;
    pollRef.current = setInterval(async () => {
      try {
        const data = await api.getMemeStatus(batchId);
        setBatch(data);
        if (data.status === "completed") {
          clearInterval(pollRef.current);
        }
      } catch (e) {
        // ignore poll errors
      }
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [batchId]);

  const handleFiles = (e) => {
    const selected = Array.from(e.target.files);
    setFiles(selected);
    setError("");
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("video/"));
    if (dropped.length) {
      setFiles(dropped);
      setError("");
    }
  };

  const handleAutoDetectCrop = async () => {
    if (!files.length) return;
    setDetectingCrop(true);
    setCropDetectError("");
    try {
      // Load frame preview
      const frameUrl = await api.getVideoFrameUrl(files[0]);
      setCropFrameUrl(frameUrl);
      // Ask Gemini
      const result = await api.detectMemeCrop(files[0]);
      setCropTopPct(Math.round(result.crop_top_pct * 100));
      setCropBottomPct(Math.round(result.crop_bottom_pct * 100));
      setCropLeftPct(Math.round((result.crop_left_pct || 0) * 100));
      setCropRightPct(Math.round((result.crop_right_pct || 0) * 100));
    } catch (e) {
      setCropDetectError("No se pudo detectar automáticamente. Ajusta los sliders manualmente.");
    } finally {
      setDetectingCrop(false);
    }
  };

  const handleLoadFrameOnly = async () => {
    if (!files.length || cropFrameUrl) return;
    try {
      const frameUrl = await api.getVideoFrameUrl(files[0]);
      setCropFrameUrl(frameUrl);
    } catch (e) { /* ignore */ }
  };

  const handleStart = async () => {
    if (!files.length) { setError("Selecciona al menos un video"); return; }
    setError("");
    setUploading(true);
    setUploadPct(0);
    setBatch(null);
    setBatchId(null);
    try {
      const topPct = cropEnabled ? cropTopPct / 100 : 0;
      const bottomPct = cropEnabled ? cropBottomPct / 100 : 0;
      const leftPct = cropEnabled ? cropLeftPct / 100 : 0;
      const rightPct = cropEnabled ? cropRightPct / 100 : 0;
      const result = await api.processMemes(files, bgColor, 0.08, 0.9, setUploadPct, contentType, topPct, bottomPct, leftPct, rightPct);
      setBatchId(result.batch_id);
    } catch (e) {
      setError(e.message || "Error al subir los videos");
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    clearInterval(pollRef.current);
    setFiles([]);
    setBgColor("black");
    setContentType("meme");
    setUploading(false);
    setUploadPct(0);
    setBatchId(null);
    setBatch(null);
    setError("");
    setCropEnabled(false);
    setCropTopPct(0);
    setCropBottomPct(0);
    setCropFrameUrl(null);
    setCropDetectError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDownloadAllDescriptions = async () => {
    if (!batch) return;
    const parts = [];
    for (let i = 0; i < batch.items.length; i++) {
      const item = batch.items[i];
      if (item.status === "ready") {
        try {
          const text = await api.getMemeIgDescription(batchId, i);
          parts.push(`=== Meme ${i + 1}: ${item.filename} ===\n\n${text}`);
        } catch (e) {
          parts.push(`=== Meme ${i + 1}: ${item.filename} ===\n\n[Descripción no disponible]`);
        }
      }
    }
    if (!parts.length) return;
    const blob = new Blob([parts.join("\n\n" + "─".repeat(60) + "\n\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `descripciones_memes_${batchId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReexportAll = async () => {
    if (!batch) return;
    setReexportingAll(true);
    const readyItems = batch.items.map((item, i) => ({ item, i })).filter(({ item }) => item.status === "ready");
    await Promise.all(readyItems.map(({ i }) =>
      api.reexportMeme(batchId, i, gTextY, gTextX, gVideoScale, gVideoY, gFontSize, "", gCropTopPct / 100, gCropBottomPct / 100, gCornerRadius, gCropLeftPct / 100, gCropRightPct / 100).catch(() => {})
    ));
    setReexportingAll(false);
  };

  const statusLabel = (item) => {
    switch (item.status) {
      case "pending":    return "⏳ Pendiente";
      case "cropping":   return "✂️ Recortando...";
      case "uploading":  return "⬆️ Subiendo a Gemini...";
      case "analyzing":  return "🧠 Analizando...";
      case "exporting":  return "🎬 Exportando...";
      case "ready":      return "✅ Listo";
      case "error":      return `❌ Error: ${item.error}`;
      default:           return item.status;
    }
  };

  const doneCount = batch ? batch.items.filter(i => i.status === "ready").length : 0;
  const totalCount = batch ? batch.items.length : 0;

  return (
    <div style={{ maxWidth: 680, margin: "24px auto", padding: "0 16px" }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #1a1a2e 100%)",
        borderRadius: 16, padding: "24px 28px", color: "#fff", marginBottom: 20,
        border: "1px solid #2a2a4a",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div style={{ fontSize: 28 }}>{contentType === "music" ? "🎵" : "😂"}</div>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
              {contentType === "music" ? "Music Vibe Generator" : "Meme Generator"}
            </h2>
            <p style={{ margin: 0, color: "#8888aa", fontSize: 13 }}>
              {contentType === "music"
                ? "Gemini detecta el vibe de la música y genera una frase que lo describe"
                : "Gemini analiza el video y genera texto + descripción larga para Instagram"}
            </p>
          </div>
        </div>
      </div>

      {!batchId ? (
        <div style={{
          background: "#1a1a1a", borderRadius: 16, padding: 24, border: "1px solid #2a2a2a",
        }}>
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${files.length ? "#6366f1" : "#333"}`,
              borderRadius: 12, padding: "36px 20px", textAlign: "center",
              cursor: "pointer", marginBottom: 20,
              background: files.length ? "#6366f108" : "#111",
              transition: "all 0.2s",
            }}
          >
            <input ref={fileInputRef} type="file" accept="video/*" multiple
              style={{ display: "none" }} onChange={handleFiles} />
            {files.length ? (
              <div>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🎥</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#e5e5e5", marginBottom: 4 }}>
                  {files.length} video{files.length > 1 ? "s" : ""} listo{files.length > 1 ? "s" : ""}
                </div>
                <div style={{ fontSize: 12, color: "#6366f1", marginBottom: 10 }}>Click para cambiar</div>
                <div style={{
                  maxHeight: 120, overflowY: "auto", textAlign: "left",
                  background: "#0d0d0d", borderRadius: 8, padding: "8px 12px",
                }}>
                  {files.map((f, i) => (
                    <div key={i} style={{ fontSize: 11, color: "#888", padding: "2px 0",
                      borderBottom: i < files.length - 1 ? "1px solid #1a1a1a" : "none" }}>
                      🎬 {f.name}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 40, marginBottom: 10 }}>📂</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#ccc", marginBottom: 6 }}>
                  Arrastra videos aquí
                </div>
                <div style={{ fontSize: 13, color: "#555" }}>o haz click para seleccionar · máximo ~20 videos</div>
              </div>
            )}
          </div>

          {/* Crop section */}
          {files.length > 0 && (
            <div style={{
              background: "#111", borderRadius: 12, padding: "16px 18px",
              border: `1px solid ${cropEnabled ? "#6366f155" : "#222"}`,
              marginBottom: 20, transition: "border 0.2s",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: cropEnabled ? 16 : 0 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#e5e5e5" }}>✂️ Recortar memes de Instagram</div>
                  <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>Elimina el tweet de arriba y UI de abajo antes de procesar</div>
                </div>
                <button
                  onClick={() => { setCropEnabled(v => !v); if (!cropEnabled) handleLoadFrameOnly(); }}
                  style={{
                    padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
                    fontWeight: 700, fontSize: 13,
                    background: cropEnabled ? "#6366f1" : "#222",
                    color: cropEnabled ? "#fff" : "#888",
                    transition: "all 0.2s",
                  }}
                >{cropEnabled ? "ON" : "OFF"}</button>
              </div>

              {cropEnabled && (
                <div>
                  {/* Auto-detect button */}
                  <button
                    onClick={handleAutoDetectCrop}
                    disabled={detectingCrop}
                    style={{
                      width: "100%", padding: "10px 0", borderRadius: 10, border: "none",
                      cursor: detectingCrop ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14,
                      background: detectingCrop ? "#222" : "linear-gradient(135deg,#0ea5e9,#6366f1)",
                      color: detectingCrop ? "#555" : "#fff", marginBottom: 14, transition: "all 0.2s",
                    }}
                  >
                    {detectingCrop ? "🔍 Analizando con Gemini..." : "🔍 Auto-detectar crop (Gemini)"}
                  </button>

                  {cropDetectError && (
                    <div style={{ color: "#f87171", fontSize: 12, marginBottom: 12,
                      background: "#ef444411", padding: "8px 12px", borderRadius: 8 }}>
                      {cropDetectError}
                    </div>
                  )}

                  {/* Frame preview with crop overlay */}
                  {cropFrameUrl && (
                    <div style={{ position: "relative", marginBottom: 16, borderRadius: 10, overflow: "hidden", border: "1px solid #333" }}>
                      <img src={cropFrameUrl} alt="frame" style={{ width: "100%", display: "block" }} />
                      {/* Top crop overlay */}
                      {cropTopPct > 0 && (
                        <div style={{
                          position: "absolute", top: 0, left: 0, right: 0,
                          height: `${cropTopPct}%`,
                          background: "rgba(239,68,68,0.45)",
                          borderBottom: "2px solid #ef4444",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12, fontWeight: 700, color: "#fff",
                        }}>
                          ✂️ recortar top {cropTopPct}%
                        </div>
                      )}
                      {/* Bottom crop overlay */}
                      {cropBottomPct > 0 && (
                        <div style={{
                          position: "absolute", bottom: 0, left: 0, right: 0,
                          height: `${cropBottomPct}%`,
                          background: "rgba(239,68,68,0.45)",
                          borderTop: "2px solid #ef4444",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12, fontWeight: 700, color: "#fff",
                        }}>
                          ✂️ recortar bottom {cropBottomPct}%
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sliders */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {[
                      { label: "⬆️ Crop superior (marco/tweet arriba)", value: cropTopPct, setValue: setCropTopPct, max: 60 },
                      { label: "⬇️ Crop inferior (marco/player UI abajo)", value: cropBottomPct, setValue: setCropBottomPct, max: 40 },
                      { label: "◀️ Crop izquierdo (barra lateral izq)", value: cropLeftPct, setValue: setCropLeftPct, max: 40 },
                      { label: "▶️ Crop derecho (barra lateral der)", value: cropRightPct, setValue: setCropRightPct, max: 40 },
                    ].map(({ label, value, setValue, max }) => (
                      <div key={label}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#aaa", marginBottom: 6 }}>
                          <span>{label}</span>
                          <span style={{ color: "#6366f1", fontWeight: 700 }}>{value}%</span>
                        </div>
                        <input type="range" min={0} max={max} value={value}
                          onChange={e => setValue(Number(e.target.value))}
                          style={{ width: "100%", accentColor: "#6366f1" }} />
                      </div>
                    ))}
                  </div>

                  {!cropFrameUrl && (
                    <button
                      onClick={handleLoadFrameOnly}
                      style={{
                        marginTop: 12, width: "100%", padding: "8px 0", borderRadius: 8,
                        border: "1px solid #333", background: "#1a1a1a", color: "#888",
                        cursor: "pointer", fontSize: 13,
                      }}
                    >
                      🖼️ Cargar frame de preview
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Content type selector */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: "#888", fontWeight: 600, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Tipo de contenido
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {[
                { val: "meme", label: "😂 Meme", desc: "Texto gracioso y relatable" },
                { val: "music", label: "🎵 Música", desc: "Frase que describe el vibe" },
              ].map(({ val, label, desc }) => (
                <button
                  key={val}
                  onClick={() => setContentType(val)}
                  style={{
                    flex: 1, padding: "12px 16px", borderRadius: 10, cursor: "pointer",
                    border: contentType === val
                      ? (val === "music" ? "2px solid #f59e0b" : "2px solid #6366f1")
                      : "2px solid #2a2a2a",
                    background: contentType === val
                      ? (val === "music" ? "#f59e0b18" : "#6366f118")
                      : "#111",
                    color: contentType === val
                      ? (val === "music" ? "#fbbf24" : "#818cf8")
                      : "#666",
                    transition: "all 0.2s", textAlign: "left",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Background selector */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: "#888", fontWeight: 600, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Fondo del meme
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {[
                { val: "black", label: "⬛ Negro", desc: "Texto blanco" },
                { val: "white", label: "⬜ Blanco", desc: "Texto negro" },
              ].map(({ val, label, desc }) => (
                <button
                  key={val}
                  onClick={() => setBgColor(val)}
                  style={{
                    flex: 1, padding: "12px 0", borderRadius: 10, cursor: "pointer",
                    border: bgColor === val ? "2px solid #6366f1" : "2px solid #2a2a2a",
                    background: bgColor === val ? "#6366f122" : "#111",
                    color: bgColor === val ? "#e5e5e5" : "#666",
                    fontWeight: 600, fontSize: 14, transition: "all 0.15s",
                  }}
                >
                  <div>{label}</div>
                  <div style={{ fontSize: 11, opacity: 0.6, marginTop: 3 }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ color: "#f87171", fontSize: 13, marginBottom: 14,
              background: "#ef444411", padding: "10px 14px", borderRadius: 8 }}>
              {error}
            </div>
          )}

          {uploading ? (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ fontSize: 13, color: "#aaa", marginBottom: 8 }}>
                ⬆️ Subiendo videos... {uploadPct}%
              </div>
              <div style={{ background: "#222", borderRadius: 6, height: 8 }}>
                <div style={{
                  background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
                  borderRadius: 6, height: 8, width: `${uploadPct}%`, transition: "width 0.3s",
                }} />
              </div>
            </div>
          ) : (
            <button
              onClick={handleStart}
              style={{
                width: "100%", fontSize: 15, padding: "14px 0", borderRadius: 12,
                border: "none", cursor: "pointer", fontWeight: 700,
                background: files.length
                  ? "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)"
                  : "#222",
                color: files.length ? "#fff" : "#555",
                transition: "all 0.2s",
              }}
              disabled={!files.length}
            >
              🚀 Generar memes ({files.length} video{files.length !== 1 ? "s" : ""}{cropEnabled && cropTopPct > 0 ? ` · crop ${cropTopPct}%` : ""})
            </button>
          )}
        </div>
      ) : (
        <div>
          {/* Progress header */}
          <div style={{
            background: "#1a1a1a", borderRadius: 12, padding: "16px 20px",
            border: "1px solid #2a2a2a", marginBottom: 16,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                {batch?.status === "completed"
                  ? `✅ Completado — ${doneCount}/${totalCount} listos`
                  : `⏳ Procesando... ${doneCount}/${totalCount}`}
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>
                {batch?.status !== "completed" && "Gemini está analizando cada video secuencialmente"}
              </div>
            </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {batch?.status === "completed" && doneCount > 0 && (
                  <button
                    onClick={handleDownloadAllDescriptions}
                    style={{
                      fontSize: 12, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
                      background: "#6366f122", color: "#818cf8",
                      border: "1px solid #6366f144", fontWeight: 600,
                    }}
                  >
                    📄 Todas las descripciones
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8 }}
                  onClick={handleReset}
                >
                  Nuevo batch
                </button>
              </div>
          </div>

          {/* Progress bar */}
          {batch && batch.status !== "completed" && (
            <div style={{ background: "#222", borderRadius: 6, height: 4, marginBottom: 16 }}>
              <div style={{
                background: "linear-gradient(90deg, #6366f1, #22c55e)",
                borderRadius: 6, height: 4,
                width: `${totalCount ? (doneCount / totalCount) * 100 : 0}%`,
                transition: "width 0.5s",
              }} />
            </div>
          )}

          {/* ✂️ Crop panel — visible when batch completed */}
          {batch?.status === "completed" && doneCount > 0 && (
            <div style={{
              background: "#1a1100", borderRadius: 12, border: "2px solid #f59e0b55",
              marginBottom: 12, padding: "14px 16px",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b", marginBottom: 12 }}>
                ✂️ Recortar tweet card / UI — aplica a todos los videos
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                {[
                  { label: "⬆️ Crop superior (elimina tweet de arriba)", value: gCropTopPct, setValue: setGCropTopPct, min: 0, max: 70 },
                  { label: "⬇️ Crop inferior (elimina player UI de abajo)", value: gCropBottomPct, setValue: setGCropBottomPct, min: 0, max: 40 },
                  { label: "◀️ Crop izquierdo (elimina barra lateral izq)", value: gCropLeftPct, setValue: setGCropLeftPct, min: 0, max: 40 },
                  { label: "▶️ Crop derecho (elimina barra lateral der)", value: gCropRightPct, setValue: setGCropRightPct, min: 0, max: 40 },
                ].map(({ label, value, setValue, min, max }) => (
                  <div key={label}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#ccc", marginBottom: 5 }}>
                      <span>{label}</span>
                      <span style={{ color: value > 0 ? "#f59e0b" : "#555", fontWeight: 700 }}>{value}%</span>
                    </div>
                    <input type="range" min={min} max={max} step={1} value={value}
                      onChange={e => { setValue(Number(e.target.value)); setCropPreviewImg(null); }}
                      style={{ width: "100%", accentColor: "#f59e0b" }} />
                  </div>
                ))}
              </div>

              {/* Preview button */}
              {(gCropTopPct > 0 || gCropBottomPct > 0 || gCropLeftPct > 0 || gCropRightPct > 0) && batchId && batch?.items?.length > 0 && (
                <button
                  onClick={() => {
                    const url = api.getCropPreviewUrl(batchId, 0, gCropTopPct / 100, gCropBottomPct / 100, gCropLeftPct / 100, gCropRightPct / 100);
                    setCropPreviewImg(url);
                  }}
                  style={{
                    width: "100%", padding: "8px 0", borderRadius: 8, border: "1px solid #f59e0b55",
                    background: "#2a1800", color: "#f59e0b", fontWeight: 600, fontSize: 13,
                    cursor: "pointer", marginBottom: 10,
                  }}
                >
                  🔍 Ver preview del crop (primer video)
                </button>
              )}

              {/* Frame preview */}
              {cropPreviewImg && (
                <div style={{ marginBottom: 12, borderRadius: 8, overflow: "hidden", border: "1px solid #f59e0b44" }}>
                  <div style={{ fontSize: 11, color: "#f59e0b88", padding: "4px 8px", background: "#111" }}>
                    Así quedará el video recortado — si aún se ve el tweet, aumenta el % superior
                  </div>
                  <img
                    src={cropPreviewImg}
                    alt="crop preview"
                    style={{ width: "100%", display: "block" }}
                    onError={() => setCropPreviewImg(null)}
                  />
                </div>
              )}

              <button
                onClick={handleReexportAll}
                disabled={reexportingAll || (gCropTopPct === 0 && gCropBottomPct === 0 && gCropLeftPct === 0 && gCropRightPct === 0)}
                style={{
                  width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
                  fontWeight: 700, fontSize: 14, cursor: (reexportingAll || (gCropTopPct === 0 && gCropBottomPct === 0 && gCropLeftPct === 0 && gCropRightPct === 0)) ? "not-allowed" : "pointer",
                  background: (gCropTopPct > 0 || gCropBottomPct > 0 || gCropLeftPct > 0 || gCropRightPct > 0)
                    ? "linear-gradient(135deg, #d97706, #f59e0b)"
                    : "#222",
                  color: (gCropTopPct > 0 || gCropBottomPct > 0 || gCropLeftPct > 0 || gCropRightPct > 0) ? "#000" : "#555",
                  transition: "all 0.2s",
                }}
              >
                {reexportingAll
                  ? "⏳ Re-exportando..."
                  : (gCropTopPct > 0 || gCropBottomPct > 0 || gCropLeftPct > 0 || gCropRightPct > 0)
                    ? `🔄 Re-exportar todos${gCropTopPct > 0 ? ` · top ${gCropTopPct}%` : ""}${gCropBottomPct > 0 ? ` · bot ${gCropBottomPct}%` : ""}${gCropLeftPct > 0 ? ` · izq ${gCropLeftPct}%` : ""}${gCropRightPct > 0 ? ` · der ${gCropRightPct}%` : ""}`
                    : "← Mueve los sliders para activar"}
              </button>
            </div>
          )}

          {/* Global adjustments panel */}
          <div style={{ background: "#111", borderRadius: 10, border: "1px solid #2a2a2a", marginBottom: 12, overflow: "hidden" }}>
            <div
              style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
              onClick={() => setShowGlobalSliders(v => !v)}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "#c4b5fd" }}>⚙ Ajustes globales — aplica a todos</div>
              <div style={{ fontSize: 12, color: "#666" }}>{showGlobalSliders ? "▲ Cerrar" : "▼ Abrir"}</div>
            </div>
            {showGlobalSliders && (
              <div style={{ padding: "0 14px 14px", borderTop: "1px solid #1e1e1e" }}>
                <div style={{ paddingTop: 12 }}>
                  {/* Crop sliders */}
                  <div style={{ marginBottom: 14, padding: "10px 12px", background: "#1a1a1a", borderRadius: 8, border: "1px solid #333" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", marginBottom: 10 }}>✂️ Crop — elimina tweet/UI del video original</div>
                    {[
                      { label: "⬆️ Crop superior (tweet card)", value: gCropTopPct, setValue: setGCropTopPct, min: 0, max: 60, step: 1, fmt: v => `${v}%` },
                      { label: "⬇️ Crop inferior (player UI)",  value: gCropBottomPct, setValue: setGCropBottomPct, min: 0, max: 30, step: 1, fmt: v => `${v}%` },
                      { label: "◀️ Crop izquierdo (barra lateral izq)", value: gCropLeftPct, setValue: setGCropLeftPct, min: 0, max: 40, step: 1, fmt: v => `${v}%` },
                      { label: "▶️ Crop derecho (barra lateral der)",   value: gCropRightPct, setValue: setGCropRightPct, min: 0, max: 40, step: 1, fmt: v => `${v}%` },
                    ].map(({ label, value, setValue, min, max, step, fmt }) => (
                      <div key={label} style={{ marginBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888", marginBottom: 4 }}>
                          <span>{label}</span>
                          <span style={{ color: "#f59e0b", fontWeight: 700 }}>{fmt(value)}</span>
                        </div>
                        <input type="range" min={min} max={max} step={step}
                          value={value} onChange={e => setValue(Number(e.target.value))}
                          style={{ width: "100%", accentColor: "#f59e0b" }} />
                      </div>
                    ))}
                    {(gCropTopPct > 0 || gCropBottomPct > 0 || gCropLeftPct > 0 || gCropRightPct > 0) && (
                      <div style={{ fontSize: 11, color: "#f59e0b88", marginTop: 4 }}>
                        Se aplica al re-exportar ↓
                      </div>
                    )}
                  </div>

                  {[
                    { label: "Texto vertical",  value: gTextY,     setValue: setGTextY,     min: 0.02, max: 0.45, step: 0.01, fmt: v => +v <= 0.12 ? "⬆ Arriba" : +v <= 0.28 ? "↕ Centro" : "⬇ Abajo" },
                    { label: "Texto horizontal", value: gTextX,     setValue: setGTextX,     min: 0.03, max: 0.7,  step: 0.01, fmt: v => +v <= 0.08 ? "← Izq"    : +v <= 0.42 ? "↔ Centro" : "→ Der" },
                    { label: "Posición video",   value: gVideoY,    setValue: setGVideoY,    min: 0.25, max: 0.85, step: 0.01, fmt: v => +v <= 0.38 ? "⬆ Arriba" : +v <= 0.62 ? "↕ Centro" : "⬇ Abajo" },
                    { label: "Tamaño video",     value: gVideoScale,setValue: setGVideoScale, min: 0.4,  max: 1.0,  step: 0.05, fmt: v => `${Math.round(+v * 100)}%` },
                    { label: "Tamaño letra",     value: gFontSize,  setValue: v => setGFontSize(parseInt(v)), min: 40, max: 140, step: 5, fmt: v => `${v}px` },
                  ].map(({ label, value, setValue, min, max, step, fmt }) => (
                    <div key={label} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888", marginBottom: 4 }}>
                        <span>{label}</span>
                        <span style={{ color: "#c4b5fd" }}>{fmt(value)}</span>
                      </div>
                      <input type="range" min={min} max={max} step={step}
                        value={value} onChange={e => setValue(e.target.value)}
                        style={{ width: "100%", accentColor: "#6366f1" }} />
                    </div>
                  ))}
                  <button
                    onClick={handleReexportAll}
                    disabled={reexportingAll}
                    style={{
                      width: "100%", fontSize: 13, padding: "11px 0", borderRadius: 8,
                      border: "none", cursor: reexportingAll ? "not-allowed" : "pointer", fontWeight: 700,
                      background: reexportingAll ? "#222" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                      color: "#fff", marginTop: 4,
                    }}
                  >
                    {reexportingAll ? "⏳ Re-exportando todos..." : "🔄 Re-exportar todos con estos ajustes"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Items list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {batch?.items.map((item, i) => (
              <MemeItemCard
                key={i}
                item={item}
                batchId={batchId}
                index={i}
                statusLabel={statusLabel}
                globalCropTopPct={gCropTopPct}
                globalCropBottomPct={gCropBottomPct}
                globalCropLeftPct={gCropLeftPct}
                globalCropRightPct={gCropRightPct}
                globalCornerRadius={gCornerRadius}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// MAIN APP
// ================================================
// ─── Analyzer Mode ────────────────────────────────────────────────────────────

function AnalyzerStep() {
  const [file, setFile] = useState(null);
  const [clipCount, setClipCount] = useState(15);
  const [phase, setPhase] = useState("idle"); // idle | uploading | analyzing | done | error
  const [uploadPct, setUploadPct] = useState(0);
  const [moments, setMoments] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [analyzerModel, setAnalyzerModel] = useState("gemini-2.5-flash");
  const [sortByScore, setSortByScore] = useState(false);
  const [modelHealth, setModelHealth] = useState({});
  const [checkingModels, setCheckingModels] = useState(false);

  const handleCheckModels = async () => {
    setCheckingModels(true);
    try {
      const result = await api.checkModelHealth(GEMINI_VIDEO_MODELS.map((m) => m.val));
      const next = {};
      for (const item of result.models || []) next[item.model] = item;
      setModelHealth(next);
    } catch (e) {
      alert(`No se pudo chequear modelos: ${e.message}`);
    } finally {
      setCheckingModels(false);
    }
  };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleFile = (f) => {
    if (f && f.type.startsWith("video/")) setFile(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    handleFile(f);
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setPhase("uploading");
    setUploadPct(0);
    setMoments([]);
    setErrorMsg("");

    try {
      // Upload video (pass selected model so user controls quota usage)
      const uploadResult = await api.uploadVideo(
        file, clipCount, 15, "", (pct) => setUploadPct(pct), analyzerModel
      );
      const projectId = uploadResult.project_id;

      // Analyze
      setPhase("analyzing");
      const result = await api.analyzeVideo(projectId);
      setMoments(result.clips || []);
      setPhase("done");
    } catch (err) {
      setErrorMsg(err.message);
      setPhase("error");
    }
  };

  const handleCopy = (moment) => {
    const text =
      `${formatTime(moment.start_time)} — ${formatTime(moment.end_time)} (${(moment.end_time - moment.start_time).toFixed(0)}s)\n` +
      `${moment.description}\n` +
      `"${moment.viral_caption}"\n` +
      `Why viral: ${moment.viral_reason}` +
      (moment.transcript_snippet ? `\nScript: ${moment.transcript_snippet}` : "");
    navigator.clipboard.writeText(text);
    setCopied(moment.id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCopyAll = () => {
    const list = (sortByScore
      ? [...moments].sort((a, b) => (b.viral_score || 5) - (a.viral_score || 5))
      : moments
    ).map((m, i) =>
      `${i + 1}. ${formatTime(m.start_time)} — ${formatTime(m.end_time)} (${(m.end_time - m.start_time).toFixed(0)}s) · score ${m.viral_score || "-"}/10\n` +
      `   ${m.description}\n` +
      `   "${m.viral_caption}"`
    ).join("\n\n");
    navigator.clipboard.writeText(list);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleReset = () => {
    setFile(null);
    setPhase("idle");
    setMoments([]);
    setErrorMsg("");
    setUploadPct(0);
  };

  return (
    <div style={{ maxWidth: 700, margin: "32px auto", padding: "0 16px" }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>🔍 Video Analyzer</h2>
      <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 24 }}>
        Sube un video y Gemini te dice qué momentos son los mejores — con timestamps y texto de clickbait listo para usar.
      </p>

      {phase === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById("analyzer-file-input").click()}
            style={{
              border: `2px dashed ${dragging ? "var(--accent)" : file ? "#4ade80" : "#333"}`,
              borderRadius: 14, padding: "40px 20px", textAlign: "center",
              cursor: "pointer", background: dragging ? "rgba(99,102,241,0.05)" : "var(--bg-secondary)",
              transition: "all 0.2s",
            }}
          >
            <input id="analyzer-file-input" type="file" accept="video/*" style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files[0])} />
            {file ? (
              <>
                <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
                <div style={{ fontWeight: 600, color: "#4ade80", marginBottom: 4 }}>{file.name}</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {(file.size / 1024 / 1024).toFixed(1)} MB — Click para cambiar
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🎬</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Arrastra un video aquí</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>o haz click para seleccionar</div>
              </>
            )}
          </div>

          {/* Model selector */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 12, padding: "16px 20px" }}>
            <label style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 10 }}>
              Modelo de IA
            </label>
            <ModelSelector
              value={analyzerModel}
              onChange={setAnalyzerModel}
              health={modelHealth}
              checking={checkingModels}
              onCheck={handleCheckModels}
            />
          </div>

          {/* Clip count */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 12, padding: "16px 20px" }}>
            <label style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 10 }}>
              ¿Cuántos momentos buscar? <span style={{ color: "var(--accent)", fontWeight: 700 }}>{clipCount}</span>
            </label>
            <input type="range" min={5} max={30} value={clipCount}
              onChange={(e) => setClipCount(Number(e.target.value))}
              style={{ width: "100%" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              <span>5 (rápido)</span><span>30 (completo)</span>
            </div>
          </div>

          <button
            className="btn btn-primary"
            onClick={handleAnalyze}
            disabled={!file}
            style={{ fontSize: 16, padding: "14px 0", width: "100%" }}
          >
            🔍 Analizar Video
          </button>
        </div>
      )}

      {(phase === "uploading" || phase === "analyzing") && (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div className="loading-spinner" style={{ margin: "0 auto 20px", width: 48, height: 48 }}></div>
          {phase === "uploading" ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Subiendo video... {uploadPct}%</div>
              <div style={{ background: "#1a1a1a", borderRadius: 8, height: 8, overflow: "hidden", maxWidth: 300, margin: "0 auto" }}>
                <div style={{ background: "var(--accent)", height: "100%", width: `${uploadPct}%`, transition: "width 0.3s" }} />
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Gemini analizando el video...</div>
              <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>Esto puede tardar 1-3 minutos dependiendo del largo del video</div>
            </>
          )}
        </div>
      )}

      {phase === "error" && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>❌</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Error</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>{errorMsg}</div>
          <button className="btn btn-secondary" onClick={handleReset}>Intentar de nuevo</button>
        </div>
      )}

      {phase === "done" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>✅ {moments.length} momentos encontrados</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => setSortByScore(s => !s)}
                style={{
                  background: sortByScore ? "var(--accent)" : "#2a2a2a", color: "#fff",
                  border: "none", borderRadius: 10, padding: "6px 14px", fontSize: 13,
                  cursor: "pointer", fontWeight: 600,
                }}
              >
                {sortByScore ? "🔥 Por score" : "↕ Orden original"}
              </button>
              <button
                onClick={handleCopyAll}
                style={{
                  background: copiedAll ? "#4ade80" : "#2a2a2a", color: copiedAll ? "#000" : "#fff",
                  border: "none", borderRadius: 10, padding: "6px 14px", fontSize: 13,
                  cursor: "pointer", fontWeight: 600,
                }}
              >
                {copiedAll ? "✅ Copiado" : "📋 Copiar todo"}
              </button>
              <button className="btn btn-secondary" onClick={handleReset} style={{ fontSize: 13, padding: "6px 14px" }}>
                🔄 Nuevo video
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {(sortByScore ? [...moments].sort((a,b)=>(b.viral_score||5)-(a.viral_score||5)) : moments).map((m) => (
              <div key={m.id} style={{
                background: "var(--bg-secondary)", borderRadius: 14, padding: "16px 20px",
                border: "1px solid #2a2a2a",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    {/* Timestamp + score */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                      <span style={{
                        background: "var(--accent)", color: "#fff", borderRadius: 8,
                        padding: "3px 10px", fontSize: 13, fontWeight: 700, fontFamily: "monospace"
                      }}>
                        ⏱ {formatTime(m.start_time)} — {formatTime(m.end_time)}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {(m.end_time - m.start_time).toFixed(0)}s
                      </span>
                      {m.viral_score != null && (
                        <span style={{
                          background: m.viral_score >= 8 ? "#dc2626" : m.viral_score >= 6 ? "#d97706" : "#374151",
                          color: "#fff", borderRadius: 8, padding: "3px 10px",
                          fontSize: 12, fontWeight: 700,
                        }}>
                          {m.viral_score >= 8 ? "🔥" : m.viral_score >= 6 ? "⚡" : "·"} {m.viral_score}/10
                          {m.viral_score_reason ? ` · ${m.viral_score_reason}` : ""}
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{m.description}</div>

                    {/* Viral reason */}
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
                      {m.viral_reason}
                    </div>

                    {/* Clickbait text */}
                    <div style={{
                      background: "#111", borderRadius: 8, padding: "8px 12px",
                      fontSize: 14, fontWeight: 600, color: "#e2e8f0", fontStyle: "italic",
                      borderLeft: "3px solid var(--accent)"
                    }}>
                      "{m.viral_caption}"
                    </div>

                    {/* Script (Whisper transcript) — read this to validate fast */}
                    {m.transcript_snippet ? (
                      <div style={{
                        background: "#0a0a0a", borderRadius: 8, padding: "8px 12px", marginTop: 8,
                        fontSize: 13, color: "#bbb", fontStyle: "italic", lineHeight: 1.5,
                        borderLeft: `3px solid ${
                          m.match_confidence === "match" ? "#22c55e" :
                          m.match_confidence === "mismatch" ? "#ef4444" : "#666"
                        }`,
                      }}>
                        🎙️ {m.transcript_snippet}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "#666", marginTop: 8, fontStyle: "italic" }}>
                        🔇 Sin diálogo detectado en este momento
                      </div>
                    )}
                  </div>

                  {/* Copy button */}
                  <button
                    onClick={() => handleCopy(m)}
                    style={{
                      background: copied === m.id ? "#4ade80" : "#2a2a2a",
                      color: copied === m.id ? "#000" : "#fff",
                      border: "none", borderRadius: 10, padding: "8px 14px",
                      fontSize: 13, cursor: "pointer", fontWeight: 600,
                      whiteSpace: "nowrap", transition: "all 0.2s", flexShrink: 0,
                    }}
                  >
                    {copied === m.id ? "✅ Copiado" : "📋 Copiar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ================================================
// SubtitleOverlay — renders the active subtitle word(s) live over an HTML
// <video>, in sync with currentTime. Implements the 8 styles in CSS so the
// editor gives instant visual feedback (no FFmpeg roundtrip while editing).
// The final FFmpeg export is the source of truth; this is a faithful preview.
// ================================================
function _groupSizeForStyle(style) {
  if (style === "popup" || style === "big_center" || style === "bounce") return 1;
  if (style === "twoword") return 2;
  return 4; // clean, karaoke, highlight, typewriter
}

function _currentGroup(words, t, groupSize) {
  // Walk grouped words; return the group active at time t (clip-relative
  // = original-video-time since the API stores absolute times).
  for (let i = 0; i < words.length; i += groupSize) {
    const grp = words.slice(i, i + groupSize);
    if (!grp.length) continue;
    const g0 = grp[0].start;
    const gN = grp[grp.length - 1].end;
    if (t >= g0 && t <= gN + 0.05) {
      const active = grp.find((w) => t >= w.start && t <= w.end + 0.02) || grp[grp.length - 1];
      // Index of active letter for typewriter
      const aw = active || grp[0];
      const letterFrac = aw.end > aw.start
        ? Math.max(0, Math.min(1, (t - aw.start) / (aw.end - aw.start)))
        : 1;
      return { group: grp, active, letterFrac, gStart: g0, gEnd: gN };
    }
  }
  return null;
}

function SubtitleOverlay({ words, currentTime, style, sizeScale, yOffset }) {
  if (!words || words.length === 0) return null;
  const groupSize = _groupSizeForStyle(style);
  const cur = _currentGroup(words, currentTime, groupSize);
  if (!cur) return null;
  const { group, active, letterFrac } = cur;

  // Mirror the backend's base sizes from subtitle_service._ass_header
  const baseSizes = {
    clean: 75, karaoke: 80, popup: 110, highlight: 78,
    big_center: 150, twoword: 100, bounce: 120, typewriter: 80,
  };
  // Mirror the marginV defaults too — ASS uses bottom-anchored margin.
  // 0.30 = 30% above the bottom of the canvas.
  const baseMargins = {
    clean: 0.30, karaoke: 0.30, highlight: 0.30, typewriter: 0.30,
    twoword: 0.40, bounce: 0.40, popup: 0.45, big_center: 0.45,
  };
  const fontPx = (baseSizes[style] || 75) * Math.max(0.6, Math.min(1.6, sizeScale || 1));
  // Convert canvas px (out of 1920 tall) to container-relative cqh
  const fontCqh = (fontPx / 1920) * 100;
  const baseBottomFrac = baseMargins[style] || 0.30;
  // yOffset is +up / -down, additive on top of baseMargin
  const bottomFrac = Math.max(0.04, Math.min(0.96, baseBottomFrac + (yOffset || 0)));
  const bottomPct = bottomFrac * 100;

  // Common positioning wrapper
  const wrapStyle = {
    position: "absolute",
    left: 0, right: 0,
    bottom: `${bottomPct}%`,
    textAlign: "center",
    pointerEvents: "none",
    fontFamily: "'Arial Black', 'Segoe UI Black', sans-serif",
    fontWeight: 900,
    lineHeight: 1.1,
    textTransform: "uppercase",
    zIndex: 5,
  };

  // Mirror the heavy black outline ASS uses — stack drop-shadows for crispness
  const outline = "2px 2px 0 #000, -2px 2px 0 #000, 2px -2px 0 #000, -2px -2px 0 #000, 0 0 4px #000";

  // ── Style-specific rendering ──
  if (style === "clean") {
    const text = group.map((w) => w.word).join(" ");
    return (
      <div style={wrapStyle}>
        <span style={{ color: "#fff", fontSize: `${fontCqh}cqh`, textShadow: outline, padding: "0 0.4cqh" }}>{text}</span>
      </div>
    );
  }

  if (style === "karaoke") {
    return (
      <div style={wrapStyle}>
        <span style={{ fontSize: `${fontCqh}cqh`, textShadow: outline, padding: "0 0.4cqh" }}>
          {group.map((w, i) => (
            <span key={i} style={{ color: w === active ? "#fde047" : "#fff", transition: "color 0.08s" }}>
              {w.word}{i < group.length - 1 ? " " : ""}
            </span>
          ))}
        </span>
      </div>
    );
  }

  if (style === "popup") {
    // Single word, scale-in animation each new active word
    return (
      <div style={wrapStyle}>
        <span
          key={`${active.start}`}  // re-mount on word change → re-trigger animation
          style={{
            display: "inline-block",
            color: "#fff", fontSize: `${fontCqh}cqh`,
            textShadow: outline,
            animation: "subPopup 180ms cubic-bezier(.34,1.56,.64,1)",
          }}
        >
          {active?.word || ""}
        </span>
        <style>{`@keyframes subPopup { 0%{transform:scale(0.4);opacity:0} 70%{transform:scale(1.15)} 100%{transform:scale(1);opacity:1} }`}</style>
      </div>
    );
  }

  if (style === "highlight") {
    // Submagic-style — full group visible, active word on yellow box
    return (
      <div style={wrapStyle}>
        <span style={{ fontSize: `${fontCqh}cqh`, padding: "0 0.4cqh", textShadow: outline }}>
          {group.map((w, i) => (
            <span key={i} style={{
              color: w === active ? "#000" : "#fff",
              background: w === active ? "#fde047" : "transparent",
              padding: w === active ? "0 0.6cqh" : 0,
              borderRadius: "0.4cqh",
              transition: "all 0.05s",
            }}>
              {w.word}{i < group.length - 1 ? " " : ""}
            </span>
          ))}
        </span>
      </div>
    );
  }

  if (style === "big_center") {
    // Huge single word at vertical centre regardless of bottom margin
    return (
      <div style={{ ...wrapStyle, bottom: "auto", top: "50%", transform: "translateY(-50%)" }}>
        <span key={`${active.start}`} style={{
          color: "#fff", fontSize: `${fontCqh}cqh`, textShadow: outline,
          display: "inline-block", animation: "subPopup 150ms ease-out",
        }}>{active?.word || ""}</span>
      </div>
    );
  }

  if (style === "twoword") {
    const text = group.map((w) => w.word).join(" ");
    return (
      <div style={wrapStyle}>
        <span key={`${cur.gStart}`} style={{
          color: "#fff", fontSize: `${fontCqh}cqh`, textShadow: outline,
          display: "inline-block", animation: "subPopup 140ms ease-out",
        }}>{text}</span>
      </div>
    );
  }

  if (style === "bounce") {
    return (
      <div style={wrapStyle}>
        <span key={`${active.start}`} style={{
          color: "#fff", fontSize: `${fontCqh}cqh`, textShadow: outline,
          display: "inline-block", animation: "subBounce 320ms cubic-bezier(.5,1.6,.4,1)",
        }}>{active?.word || ""}</span>
        <style>{`@keyframes subBounce { 0%{transform:translateY(40%) scale(0.6);opacity:0} 60%{transform:translateY(-12%) scale(1.18)} 80%{transform:translateY(4%) scale(0.96)} 100%{transform:translateY(0) scale(1);opacity:1} }`}</style>
      </div>
    );
  }

  if (style === "typewriter") {
    // Show full group, but the active word reveals letter-by-letter
    return (
      <div style={wrapStyle}>
        <span style={{ fontSize: `${fontCqh}cqh`, color: "#fff", textShadow: outline, padding: "0 0.4cqh" }}>
          {group.map((w, i) => {
            if (w === active) {
              const cut = Math.max(1, Math.ceil(w.word.length * letterFrac));
              return <span key={i}>{w.word.slice(0, cut)}{i < group.length - 1 ? " " : ""}</span>;
            }
            // Past words: full; future words: hidden (typewriter mood)
            const isPast = w.end <= (active?.start || 0);
            return isPast ? <span key={i}>{w.word}{i < group.length - 1 ? " " : ""}</span> : null;
          })}
        </span>
      </div>
    );
  }

  return null;
}


// ================================================
// TimelineEditor — CapCut-style compacted, reorderable timeline.
// Shows ONLY the kept segments as blocks (width ∝ duration) in playback order.
// Drag a block to reorder, click to select, ✂️ split at playhead, 🗑 delete.
// The playhead and all interaction are in OUTPUT time (the final video's
// timeline). Each block shows the thumbnails that fall in its source range.
// ================================================
function TimelineEditor({
  thumbnails, segments, selectedIdx, outputTime, outputDuration,
  onSeekOutput, onSelectSegment, onSplit, onDeleteSegment, onReorder, onResizeSegment,
  loadingThumbs,
}) {
  const rulerRef = useRef(null);   // thin scrub bar
  const blocksRef = useRef(null);  // blocks row
  const [scrubbing, setScrubbing] = useState(false);
  // Manual block drag state (ref so listeners see latest without re-subscribing)
  const dragRef = useRef(null);    // {idx, startX, moved}
  const [dragIdx, setDragIdx] = useState(null);
  const [dropIdx, setDropIdx] = useState(null);
  const resizeRef = useRef(null);  // {idx, startX, pxPerSec, startVal, isImage}
  const [resizingIdx, setResizingIdx] = useState(null);

  const fmt = (sec) => {
    const m = Math.floor(sec / 60), s = Math.floor(Math.max(0, sec) % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };
  const pctOut = (t) => (outputDuration > 0 ? (t / outputDuration) * 100 : 0);

  // ── Scrub (ruler) ──
  const seekFromClientX = (clientX) => {
    const el = rulerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeekOutput(frac * outputDuration);
  };
  useEffect(() => {
    if (!scrubbing) return;
    const move = (e) => seekFromClientX(e.clientX);
    const up = () => setScrubbing(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [scrubbing, outputDuration]); // eslint-disable-line

  // ── Block drag-to-reorder (manual, with a movement threshold so a plain
  // click still selects without triggering a reorder) ──
  const dropIdxFromClientX = (clientX) => {
    const el = blocksRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    // Walk block widths (proportional to duration) to find which slot x is over
    let acc = 0;
    for (let i = 0; i < segments.length; i++) {
      const w = (segments[i].end - segments[i].start) / (outputDuration || 1) * rect.width;
      if (x < acc + w / 2) return i;
      acc += w;
    }
    return segments.length - 1;
  };

  useEffect(() => {
    const move = (e) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.abs(e.clientX - d.startX) > 6) d.moved = true;
      if (d.moved) setDropIdx(dropIdxFromClientX(e.clientX));
    };
    const up = (e) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.moved) {
        const to = dropIdxFromClientX(e.clientX);
        if (to !== d.idx) {
          const next = [...segments];
          const [moved] = next.splice(d.idx, 1);
          next.splice(to, 0, moved);
          onReorder(next);
        }
      } else {
        // Plain click → select that block
        onSelectSegment(d.idx);
      }
      dragRef.current = null;
      setDragIdx(null);
      setDropIdx(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [segments, outputDuration]); // eslint-disable-line

  // Resize handle drag (stretch a block: image→duration, video→trim end)
  useEffect(() => {
    const move = (e) => {
      const r = resizeRef.current;
      if (!r) return;
      const deltaSec = (e.clientX - r.startX) / (r.pxPerSec || 30);
      onResizeSegment(r.idx, r.startVal + deltaSec, r.isImage);
    };
    const up = () => { resizeRef.current = null; setResizingIdx(null); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [onResizeSegment]); // eslint-disable-line

  const thumbsFor = (seg) => {
    const inside = thumbnails.filter((t) => t.time >= seg.start && t.time <= seg.end);
    return inside.length ? inside : thumbnails.slice(0, 1);
  };

  return (
    <div style={{ marginTop: 8 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <button className="btn btn-primary" onClick={onSplit}
          title="Cortar aquí (divide el segmento bajo el cursor)"
          style={{ padding: "6px 14px", fontSize: 13 }}>
          ✂️ Cortar aquí
        </button>
        <button className="btn btn-secondary" onClick={onDeleteSegment}
          disabled={selectedIdx === null || segments.length <= 1}
          style={{ padding: "6px 14px", fontSize: 13, opacity: (selectedIdx === null || segments.length <= 1) ? 0.5 : 1 }}>
          🗑 Borrar
        </button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#888", fontFamily: "monospace" }}>
          {fmt(outputTime)} / {fmt(outputDuration)}
        </span>
      </div>

      {/* Ruler (scrub the playhead) */}
      <div
        ref={rulerRef}
        onMouseDown={(e) => { setScrubbing(true); seekFromClientX(e.clientX); }}
        style={{
          position: "relative", height: 18, background: "#161616",
          borderRadius: "6px 6px 0 0", border: "1px solid #2a2a2a", borderBottom: "none",
          cursor: "pointer", userSelect: "none",
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(99,102,241,0.12), rgba(99,102,241,0.22))" }} />
        {/* Playhead on the ruler */}
        {outputDuration > 0 && (
          <div style={{
            position: "absolute", top: 0, bottom: -56, left: `${pctOut(outputTime)}%`,
            width: 2, background: "#fff", boxShadow: "0 0 8px rgba(255,255,255,0.9)",
            pointerEvents: "none", zIndex: 6,
          }}>
            <div style={{
              position: "absolute", top: -3, left: "50%", transform: "translateX(-50%)",
              width: 11, height: 11, background: "#fff", borderRadius: "50%",
              boxShadow: "0 0 6px rgba(0,0,0,0.6)",
            }} />
          </div>
        )}
      </div>

      {/* Blocks row */}
      <div
        ref={blocksRef}
        style={{
          position: "relative", height: 70, background: "#0a0a0a",
          borderRadius: "0 0 8px 8px", border: "1px solid #2a2a2a", userSelect: "none",
          display: "flex", overflow: "hidden",
        }}
      >
        {loadingThumbs ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 12 }}>
            Generando miniaturas...
          </div>
        ) : segments.map((seg, i) => {
          // Width must use OUTPUT duration (image clips have end-start=0; their
          // length is `duration`. Video clips shrink/grow with speed).
          const segDur = seg.type === "image" ? (seg.duration || 3) : (seg.end - seg.start) / (seg.speed || 1);
          const w = outputDuration > 0 ? (segDur / outputDuration) * 100 : 0;
          const isSel = selectedIdx === i;
          const isImage = seg.type === "image";
          return (
            <div
              key={i}
              onMouseDown={(e) => {
                e.preventDefault();
                dragRef.current = { idx: i, startX: e.clientX, moved: false };
                setDragIdx(i);
              }}
              title="Arrastrá para reordenar · click para seleccionar · borde derecho para estirar"
              style={{
                position: "relative", width: `${w}%`, minWidth: 14, height: "100%",
                cursor: "grab", overflow: "hidden",
                borderRight: i < segments.length - 1 ? "2px solid #000" : "none",
                outline: isSel ? "2px solid #fbbf24" : "none",
                outlineOffset: "-2px",
                opacity: dragIdx === i ? 0.4 : 1,
                boxShadow: dropIdx === i && dragIdx !== null ? "inset 4px 0 0 #22c55e" : "none",
                background: isImage ? "#1e293b" : "transparent",
              }}
            >
              {isImage ? (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {seg.url ? <img src={seg.url} alt="" draggable={false} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", opacity: 0.9 }} />
                    : <span style={{ fontSize: 18 }}>🖼</span>}
                </div>
              ) : (
                <div style={{ position: "absolute", inset: 0, display: "flex" }}>
                  {thumbsFor(seg).map((t, k) => (
                    <img key={k} src={t.url} alt="" draggable={false}
                      style={{ flex: 1, height: "100%", objectFit: "cover", minWidth: 0, opacity: 0.85 }} />
                  ))}
                </div>
              )}
              {isSel && <div style={{ position: "absolute", inset: 0, background: "rgba(251,191,36,0.14)", pointerEvents: "none" }} />}
              <div style={{ position: "absolute", top: 2, left: 4, fontSize: 10, fontWeight: 700, color: "#fff", textShadow: "0 1px 2px #000", pointerEvents: "none" }}>
                {i + 1}{!isImage && seg.speed && seg.speed !== 1 ? ` · ${seg.speed}x` : ""}{isImage ? ` · ${(seg.duration || 3).toFixed(1)}s` : ""}
              </div>
              {/* Resize handle on the right edge — drag to stretch (image =
                  duration, video = trim its end). Wider hit area, visible grip. */}
              <div
                onMouseDown={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  const rect = blocksRef.current?.getBoundingClientRect();
                  resizeRef.current = {
                    idx: i, startX: e.clientX,
                    pxPerSec: rect && outputDuration > 0 ? rect.width / outputDuration : 30,
                    startVal: isImage ? (seg.duration || 3) : seg.end,
                    isImage,
                  };
                  setResizingIdx(i);
                }}
                style={{
                  position: "absolute", right: 0, top: 0, bottom: 0, width: 10,
                  cursor: "ew-resize", zIndex: 4,
                  background: "linear-gradient(90deg, transparent, rgba(251,191,36,0.5))",
                  display: "flex", alignItems: "center", justifyContent: "flex-end",
                }}
                title="Arrastrá para estirar"
              >
                <div style={{ width: 3, height: "40%", background: "#fbbf24", borderRadius: 2, marginRight: 2 }} />
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 11, color: "#666", margin: "8px 0 0", lineHeight: 1.5 }}>
        Barra de arriba = cursor. Bloques: <b>arrastrá</b> para reordenar, <b>click</b> para seleccionar,
        <b> borde derecho (amarillo)</b> para estirar. <b>✂️ Cortar</b> · <b>🗑 Borrar</b>.
      </p>
    </div>
  );
}


// ================================================
// EDITOR MODE — standalone manual editor (no AI clip detection)
// Upload → cut timeline → on-demand Whisper → subtitles → export
// ================================================
function EditorMode() {
  // ─── Upload state ───────────────────────────────────────────────────────
  const [projectId, setProjectId] = useState(null);
  const [filename, setFilename] = useState("");
  const [videoDuration, setVideoDuration] = useState(0);
  const [uploadingProgress, setUploadingProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);
  const [draggingFile, setDraggingFile] = useState(false);

  // ─── Timeline cut state ─────────────────────────────────────────────────
  // segments = kept pieces in source seconds. Starts as one piece covering the
  // whole video; the user splits/deletes to cut out boring middles.
  const [segments, setSegments] = useState([]);            // [{start, end}]
  const [selectedSegIdx, setSelectedSegIdx] = useState(null);
  const [thumbnails, setThumbnails] = useState([]);
  const [loadingThumbs, setLoadingThumbs] = useState(false);

  // ─── Clip object (for ClipEditorModal — it wants a full clip shape) ─────
  const [clipObj, setClipObj] = useState(null);
  const [showKeyframesModal, setShowKeyframesModal] = useState(false);
  const [aspectRatio, setAspectRatio] = useState("9:16");
  // Direct mouse manipulation of the video (pan/zoom) in the main preview.
  const videoDragRef = useRef(null);  // {startX, startY, ox, oy}

  // ─── Image overlays state ───────────────────────────────────────────────
  // Each: {url, path, x, y, scale, start, end, opacity}. x/y/scale relative to
  // canvas; start/end in OUTPUT seconds. selectedOverlayIdx drives the editor.
  const [overlays, setOverlays] = useState([]);
  const [selectedOverlayIdx, setSelectedOverlayIdx] = useState(null);
  const [uploadingOverlay, setUploadingOverlay] = useState(false);
  const overlayFileRef = useRef(null);
  const imageClipFileRef = useRef(null);
  const previewBoxRef = useRef(null);  // the 9:16 preview container (for drag math)
  const overlayDragRef = useRef(null); // {mode:'move'|'resize', startX, startY, ...}

  // ─── Subtitles state ────────────────────────────────────────────────────
  const [subtitlesOn, setSubtitlesOn] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState(null);
  const [transcribedRange, setTranscribedRange] = useState(null); // {start,end}
  const [subWordCount, setSubWordCount] = useState(0);
  // Full word list from Whisper — used by the LIVE SubtitleOverlay so the
  // user sees real subtitles painted onto the HTML <video> while editing.
  const [transcriptWords, setTranscriptWords] = useState([]);
  const [subStyle, setSubStyle] = useState("clean");
  const [subSize, setSubSize] = useState(1.0);
  const [subY, setSubY] = useState(0.0);

  // Live currentTime updated at 60Hz while playing (timeupdate only fires
  // ~4Hz which makes the overlay laggy for fast-cadence styles like Two-Word).
  const [livePlayheadTime, setLivePlayheadTime] = useState(0);

  // ─── Export ─────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });
  const [exportFiles, setExportFiles] = useState([]);

  // ─── Raw video URL for inline scrubbing preview ─────────────────────────
  const rawVideoUrl = projectId ? api.getRawVideoUrl(projectId) : null;
  const videoRef = useRef(null);
  const bgVideoRef = useRef(null);   // blurred background fill, synced to main
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);   // SOURCE time (drives video + subtitle overlay)
  // Which segment (index in the array = playback order) is currently playing.
  const playbackSegIdx = useRef(0);

  // ─── Helpers ────────────────────────────────────────────────────────────
  const formatT = (sec) => {
    if (!isFinite(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Derived: kept span + total kept duration from segments
  const sortedSegs = [...segments].sort((a, b) => a.start - b.start);
  const trimStart = sortedSegs.length ? sortedSegs[0].start : 0;
  const trimEnd = sortedSegs.length ? sortedSegs[sortedSegs.length - 1].end : videoDuration;
  const trimDuration = segments.reduce((a, s) => a + (s.end - s.start), 0);

  // ─── Output<->source mapping (segments in ARRAY order = playback order) ──
  // Each segment's OUTPUT duration accounts for speed (video) or its own
  // duration (image clip).
  const segOutDur = (seg) => {
    if (!seg) return 0;
    if (seg.type === "image") return seg.duration || 3;
    return (seg.end - seg.start) / (seg.speed || 1);
  };
  const outputDuration = segments.reduce((a, s) => a + segOutDur(s), 0);
  // output seconds -> { segIdx, sourceTime }
  const outputToSource = (outT) => {
    let acc = 0;
    for (let i = 0; i < segments.length; i++) {
      const d = segOutDur(segments[i]);
      if (outT < acc + d || i === segments.length - 1) {
        const seg = segments[i];
        const sp = seg.type === "image" ? 1 : (seg.speed || 1);
        return { segIdx: i, sourceTime: seg.start + Math.max(0, outT - acc) * sp };
      }
      acc += d;
    }
    return { segIdx: 0, sourceTime: segments[0]?.start ?? 0 };
  };
  // (segIdx, sourceTime) -> output seconds
  const sourceToOutput = (segIdx, sourceTime) => {
    let acc = 0;
    for (let i = 0; i < segIdx && i < segments.length; i++) acc += segOutDur(segments[i]);
    const seg = segments[segIdx];
    if (!seg) return acc;
    const sp = seg.type === "image" ? 1 : (seg.speed || 1);
    return acc + Math.max(0, sourceTime - seg.start) / sp;
  };
  // Current playhead position in OUTPUT time (for the timeline)
  const outputTime = sourceToOutput(playbackSegIdx.current, currentTime);
  // Segment currently under the playhead (to show image clips in the preview)
  const currentSegment = segments.length ? segments[Math.min(playbackSegIdx.current, segments.length - 1)] : null;
  const showingImageClip = currentSegment && currentSegment.type === "image";
  const subsStale = subtitlesOn && transcribedRange && (
    Math.abs(transcribedRange.start - trimStart) > 0.5 ||
    Math.abs(transcribedRange.end - trimEnd) > 0.5
  );

  // ─── Upload ─────────────────────────────────────────────────────────────
  const handleFile = async (file) => {
    if (!file) return;
    setUploadError(null);
    setUploadingProgress(0);
    try {
      const result = await api.uploadForEditor(file, (pct) => setUploadingProgress(pct));
      setProjectId(result.project_id);
      setFilename(result.filename);
      setVideoDuration(result.duration);
      // One segment covering the whole video to start.
      setSegments([{ start: 0, end: result.duration }]);
      setSelectedSegIdx(0);
      setClipObj({
        id: result.clip_id,
        start_time: 0,
        end_time: result.duration,
        duration: result.duration,
        description: "edit",
        viral_caption: "",
        keyframes: [],
        edit_zoom: 1,
        edit_pan_x: 0,
        edit_pan_y: 0,
      });
      // Default style (no subtitles yet). no_text=false because that flag
      // ALSO disables burned-in subtitles (export_service.py:179); the AI
      // caption won't render anyway since viral_caption is "" in editor mode.
      // The central style useEffect keeps it in sync afterwards.
      try {
        await api.updateStyle(result.project_id, {
          fill_mode: "fit", fill_mode_scale: 1.0, background_style: "black",
          caption_style: "tiktok", aspect_ratio: "9:16",
          subtitle_style: "none", subtitle_size_scale: 1.0, subtitle_y: 0.0,
          no_text: false, no_emojis: true, visual_filter: "none",
        });
      } catch (_) { /* style is best-effort */ }
      // Generate timeline thumbnails in the background
      setLoadingThumbs(true);
      api.getEditorThumbnails(result.project_id, 30)
        .then((d) => setThumbnails(d.thumbnails || []))
        .catch((e) => console.error("thumbnails failed:", e))
        .finally(() => setLoadingThumbs(false));
    } catch (e) {
      setUploadError(e.message || "Upload failed");
    } finally {
      setUploadingProgress(0);
    }
  };

  // ─── Segments — push to backend (debounced) ─────────────────────────────
  useEffect(() => {
    if (!projectId || segments.length === 0) return;
    const t = setTimeout(async () => {
      try {
        await api.saveEditorSegments(projectId, segments.map(segToPayload));
      } catch (e) {
        console.error("segments save failed:", e);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [projectId, segments]);

  // ─── Cut operations (all in OUTPUT time) ────────────────────────────────
  const splitAtPlayhead = () => {
    // Split the segment currently under the playhead at the source position.
    const { segIdx, sourceTime } = outputToSource(outputTime);
    const seg = segments[segIdx];
    if (!seg) return;
    if (sourceTime <= seg.start + 0.1 || sourceTime >= seg.end - 0.1) return; // at edge
    const next = [...segments];
    next.splice(segIdx, 1, { start: seg.start, end: sourceTime }, { start: sourceTime, end: seg.end });
    setSegments(next);
    setSelectedSegIdx(segIdx + 1);
  };

  const deleteSelectedSegment = () => {
    if (selectedSegIdx === null || segments.length <= 1) return;
    const next = segments.filter((_, i) => i !== selectedSegIdx);
    setSegments(next);
    setSelectedSegIdx(null);
    playbackSegIdx.current = 0;
    seekOutput(0);
  };

  const reorderSegments = (next) => {
    setSegments(next);
    setSelectedSegIdx(null);
  };

  // Wire format for persisting a segment (image clips include image_path/duration)
  const segToPayload = (s) => ({
    start: s.start, end: s.end, speed: s.speed || 1,
    type: s.type || "video", image_path: s.image_path || null,
    duration: s.duration || 0,
  });

  // Insert an image as a timeline clip (full-screen, default 3s, appended)
  const addImageClip = async (file) => {
    if (!file || !projectId) return;
    setUploadingOverlay(true);
    try {
      const res = await api.uploadOverlayImage(projectId, file);
      const newSeg = { type: "image", image_path: res.path, url: res.url, duration: 3, start: 0, end: 0, speed: 1 };
      setSegments((prev) => {
        const next = [...prev, newSeg];
        setSelectedSegIdx(next.length - 1);
        return next;
      });
    } catch (e) {
      alert(`Error subiendo imagen: ${e.message}`);
    } finally {
      setUploadingOverlay(false);
    }
  };

  // Change the selected segment's speed (video clips only)
  const setSegmentSpeed = (idx, speed) => {
    setSegments((prev) => prev.map((s, i) => (i === idx ? { ...s, speed } : s)));
  };
  const setImageClipDuration = (idx, duration) => {
    setSegments((prev) => prev.map((s, i) => (i === idx ? { ...s, duration } : s)));
  };

  // Drag the right edge of a block: image → set duration; video → set end (trim)
  const resizeSegment = (idx, newVal, isImage) => {
    setSegments((prev) => prev.map((s, i) => {
      if (i !== idx) return s;
      if (isImage) {
        return { ...s, duration: Math.max(0.5, Math.min(30, newVal)) };
      }
      // video: new end clamped to (start+0.3 .. videoDuration)
      return { ...s, end: Math.max(s.start + 0.3, Math.min(videoDuration, newVal)) };
    }));
    setSelectedSegIdx(idx);
  };

  // ─── Video transform (mouse pan/zoom in the preview) ────────────────────
  const vZoom = clipObj?.edit_zoom ?? 1;
  const vPanX = clipObj?.edit_pan_x ?? 0;   // -100..100 (% of canvas)
  const vPanY = clipObj?.edit_pan_y ?? 0;
  const setVideoTransform = (patch) => {
    setClipObj((c) => c ? { ...c, ...patch } : c);
  };
  const resetVideoTransform = () => setVideoTransform({ edit_zoom: 1, edit_pan_x: 0, edit_pan_y: 0 });

  // Persist transform to backend (debounced). editClipTransform overwrites
  // start/end so we re-save segments right after to keep the cut intact.
  useEffect(() => {
    if (!projectId || !clipObj) return;
    const t = setTimeout(async () => {
      try {
        await api.editClipTransform(projectId, clipObj.id, {
          edit_zoom: vZoom, edit_pan_x: vPanX, edit_pan_y: vPanY,
          keyframes: clipObj.keyframes || [],
        });
        if (segments.length) {
          await api.saveEditorSegments(projectId, segments.map(segToPayload));
        }
      } catch (e) { console.error("transform save failed:", e); }
    }, 450);
    return () => clearTimeout(t);
  }, [vZoom, vPanX, vPanY]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mouse drag (pan) + wheel (zoom) on the main preview video
  useEffect(() => {
    const onMove = (e) => {
      const d = videoDragRef.current;
      if (!d) return;
      const box = previewBoxRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const dx = ((e.clientX - d.startX) / rect.width) * 100;
      const dy = ((e.clientY - d.startY) / rect.height) * 100;
      setVideoTransform({
        edit_pan_x: Math.max(-100, Math.min(100, d.ox + dx)),
        edit_pan_y: Math.max(-100, Math.min(100, d.oy + dy)),
      });
    };
    const onUp = () => { videoDragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Image overlays ──────────────────────────────────────────────────────
  const handleOverlayUpload = async (file) => {
    if (!file || !projectId) return;
    setUploadingOverlay(true);
    try {
      const res = await api.uploadOverlayImage(projectId, file);
      const newOv = {
        url: res.url, path: res.path,
        x: 0.5, y: 0.35, scale: 0.4,
        start: 0, end: Math.max(1, Math.round(outputDuration || 5)),
        opacity: 1.0,
      };
      setOverlays((prev) => {
        const next = [...prev, newOv];
        setSelectedOverlayIdx(next.length - 1);
        return next;
      });
    } catch (e) {
      alert(`Error subiendo imagen: ${e.message}`);
    } finally {
      setUploadingOverlay(false);
    }
  };

  const updateOverlay = (idx, patch) => {
    setOverlays((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  };
  const deleteOverlay = (idx) => {
    setOverlays((prev) => prev.filter((_, i) => i !== idx));
    setSelectedOverlayIdx(null);
  };

  // Central style builder — the PUT /style endpoint REPLACES the whole style,
  // so every save must include all editor fields or they'd reset to defaults.
  const buildEditorStyle = () => ({
    fill_mode: "fit", fill_mode_scale: 1.0, background_style: "black",
    caption_style: "tiktok", aspect_ratio: aspectRatio,
    subtitle_style: subtitlesOn ? subStyle : "none",
    subtitle_size_scale: subSize, subtitle_y: subY,
    no_text: false, no_emojis: true, visual_filter: "none",
    image_overlays: overlays.map((o) => ({
      path: o.path, x: o.x, y: o.y, scale: o.scale,
      start: o.start, end: o.end, opacity: o.opacity,
    })),
  });

  // Single debounced persist whenever ANY style-affecting field changes.
  useEffect(() => {
    if (!projectId) return;
    const t = setTimeout(() => {
      api.updateStyle(projectId, buildEditorStyle()).catch((e) => console.error("style save failed:", e));
    }, 350);
    return () => clearTimeout(t);
  }, [aspectRatio, subtitlesOn, subStyle, subSize, subY, overlays]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag / resize an overlay on the preview (mouse)
  useEffect(() => {
    const onMove = (e) => {
      const d = overlayDragRef.current;
      if (!d) return;
      const box = previewBoxRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const dx = (e.clientX - d.startX) / rect.width;
      const dy = (e.clientY - d.startY) / rect.height;
      if (d.mode === "move") {
        updateOverlay(d.idx, {
          x: Math.max(0, Math.min(1, d.ox + dx)),
          y: Math.max(0, Math.min(1, d.oy + dy)),
        });
      } else if (d.mode === "resize") {
        updateOverlay(d.idx, { scale: Math.max(0.05, Math.min(1.5, d.oscale + dx)) });
      }
    };
    const onUp = () => { overlayDragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the blurred background video roughly in step with the main one.
  const syncBg = (t, play) => {
    const bg = bgVideoRef.current;
    if (!bg) return;
    if (t !== undefined && isFinite(t) && Math.abs(bg.currentTime - t) > 0.25) {
      try { bg.currentTime = t; } catch {}
    }
    if (play === true && bg.paused) bg.play().catch(() => {});
    if (play === false && !bg.paused) bg.pause();
  };

  // ─── Seek by OUTPUT time: map to source, set the playing segment + video ──
  const seekOutput = (outT) => {
    const v = videoRef.current;
    const clampedOut = Math.max(0, Math.min(outputDuration || 0, outT));
    const { segIdx, sourceTime } = outputToSource(clampedOut);
    playbackSegIdx.current = segIdx;
    if (v) v.currentTime = sourceTime;
    setCurrentTime(sourceTime);
    syncBg(sourceTime);
  };

  // onTimeUpdate only matters when paused (manual seek); RAF drives playback.
  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    if (!playing) setCurrentTime(v.currentTime);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // If at/after the end, restart from the first segment.
      if (outputTime >= outputDuration - 0.05) {
        playbackSegIdx.current = 0;
        if (segments[0]) { v.currentTime = segments[0].start; setCurrentTime(segments[0].start); }
      } else {
        // Make sure the video is positioned at the current playhead's source.
        const { segIdx, sourceTime } = outputToSource(outputTime);
        playbackSegIdx.current = segIdx;
        v.currentTime = sourceTime;
      }
      const p = v.play();
      if (p && p.then) p.then(() => setPlaying(true)).catch((err) => { console.error("play() rejected:", err); setPlaying(false); });
      else setPlaying(true);
      syncBg(v.currentTime, true);
    } else {
      v.pause();
      setPlaying(false);
      syncBg(undefined, false);
    }
  };

  // ─── Add Subtitles (button → trigger Whisper on the trim) ──────────────
  const activateSubtitles = async () => {
    if (!projectId) return;
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const result = await api.editorTranscribeTrim(projectId);
      setSubtitlesOn(true);  // the central style useEffect persists the change
      setSubWordCount(result.word_count);
      setTranscribedRange({ start: result.trim_start, end: result.trim_end });
      setTranscriptWords(result.words || []);  // for the live overlay
    } catch (e) {
      setTranscribeError(e.message || "Transcription failed");
    } finally {
      setTranscribing(false);
    }
  };

  const deactivateSubtitles = () => {
    setSubtitlesOn(false);  // central style useEffect persists subtitle_style:none
    setTranscriptWords([]);
  };

  // ─── Playback driver (60Hz RAF) — plays segments in ARRAY order ─────────
  // The raw <video> is the source. We let it play within the current segment;
  // when it reaches that segment's end we jump to the NEXT segment in the
  // array (which may be earlier or later in source time — that's the reorder).
  // currentTime stays in source time (drives the video + subtitle overlay);
  // the timeline derives output time from (playbackSegIdx, currentTime).
  const imgElapsedRef = useRef(0);
  const lastTsRef = useRef(0);
  useEffect(() => {
    if (!playing) return;
    let raf;
    const tick = (ts) => {
      const v = videoRef.current;
      if (segments.length) {
        let idx = playbackSegIdx.current;
        if (idx >= segments.length) idx = 0;
        const seg = segments[idx];

        if (seg.type === "image") {
          // Image clip: advance a wall-clock timer; show the still; no video.
          // NOTE: v.pause() here no longer kills playback because we removed
          // the onPause handler — `playing` is controlled only by togglePlay.
          if (v && !v.paused) v.pause();
          syncBg(undefined, false);
          if (!lastTsRef.current) lastTsRef.current = ts;
          imgElapsedRef.current += (ts - lastTsRef.current) / 1000;
          lastTsRef.current = ts;
          const dur = seg.duration || 3;
          if (imgElapsedRef.current >= dur) {
            imgElapsedRef.current = 0;
            const nextIdx = idx + 1 >= segments.length ? 0 : idx + 1;
            playbackSegIdx.current = nextIdx;
            const ns = segments[nextIdx];
            if (ns.type === "video" && v) { v.currentTime = ns.start; v.playbackRate = ns.speed || 1; v.play().catch(() => {}); }
          } else {
            // currentTime = elapsed makes sourceToOutput (start=0) give the
            // right output playhead for the image block.
            setCurrentTime(imgElapsedRef.current);
            setLivePlayheadTime(imgElapsedRef.current);
          }
        } else if (v) {
          // Video clip: play at its speed; jump to next at end.
          lastTsRef.current = 0;
          if (v.paused) v.play().catch(() => {});
          v.playbackRate = seg.speed || 1;
          let t = v.currentTime;
          if (t >= seg.end - 0.03) {
            const nextIdx = idx + 1 >= segments.length ? 0 : idx + 1;
            playbackSegIdx.current = nextIdx;
            const ns = segments[nextIdx];
            if (ns.type === "image") { imgElapsedRef.current = 0; lastTsRef.current = ts; v.pause(); }
            else { v.currentTime = ns.start; v.playbackRate = ns.speed || 1; t = ns.start; setCurrentTime(t); setLivePlayheadTime(t); }
          } else if (t < seg.start - 0.1) {
            v.currentTime = seg.start; t = seg.start; setCurrentTime(t); setLivePlayheadTime(t);
          } else {
            setCurrentTime(t); setLivePlayheadTime(t);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, segments]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Export ─────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!projectId) return;
    setExporting(true);
    setExportFiles([]);
    try {
      await api.startExport(projectId, [clipObj.id]);
    } catch (e) {
      alert(`Export failed: ${e.message}`);
      setExporting(false);
    }
  };

  useEffect(() => {
    if (!exporting || !projectId) return;
    const interval = setInterval(async () => {
      try {
        const p = await api.getExportProgress(projectId);
        setExportProgress(p);
        if (p.status === "completed" || p.status === "done") {
          setExporting(false);
          setExportFiles(p.files || []);
          clearInterval(interval);
        }
        if (p.status === "error") {
          setExporting(false);
          alert(`Export failed: ${(p.errors || []).join(", ") || "unknown"}`);
          clearInterval(interval);
        }
      } catch (e) { console.error("progress poll failed:", e); }
    }, 1500);
    return () => clearInterval(interval);
  }, [exporting, projectId]);

  const reset = () => {
    setProjectId(null);
    setFilename("");
    setVideoDuration(0);
    setClipObj(null);
    setSegments([]); setSelectedSegIdx(null); setThumbnails([]);
    setOverlays([]); setSelectedOverlayIdx(null);
    setAspectRatio("9:16");
    setSubtitlesOn(false); setTranscribedRange(null); setSubWordCount(0);
    setTranscriptWords([]);
    setExporting(false); setExportFiles([]); setExportProgress({ current: 0, total: 0 });
  };

  // ─── RENDER ─────────────────────────────────────────────────────────────
  // Upload screen
  if (!projectId) {
    return (
      <div style={{ maxWidth: 720, margin: "40px auto", padding: 20 }}>
        <h2 style={{ marginBottom: 8 }}>🎬 Editor</h2>
        <p style={{ color: "var(--text-muted)", marginBottom: 24, fontSize: 14 }}>
          Sube un video, recórtalo, agrégale subtítulos y exporta. Sin IA — todo manual.
        </p>
        <div
          onDragOver={(e) => { e.preventDefault(); setDraggingFile(true); }}
          onDragLeave={() => setDraggingFile(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDraggingFile(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${draggingFile ? "#6366f1" : "#333"}`,
            borderRadius: 16, padding: "60px 20px",
            textAlign: "center", cursor: "pointer",
            background: draggingFile ? "rgba(99,102,241,0.05)" : "#0a0a0a",
            transition: "all 0.15s",
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>📁</div>
          <p style={{ margin: 0, fontWeight: 600 }}>Arrastra un video aquí o clickea para elegir</p>
          <p style={{ margin: "8px 0 0", color: "#666", fontSize: 12 }}>mp4, mov, mkv — cualquier duración</p>
          <input
            ref={fileInputRef} type="file" accept="video/*" style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </div>
        {uploadingProgress > 0 && uploadingProgress < 100 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ background: "#1a1a1a", borderRadius: 8, height: 8, overflow: "hidden" }}>
              <div style={{ width: `${uploadingProgress}%`, background: "linear-gradient(90deg,#6366f1,#8b5cf6)", height: "100%", transition: "width 0.2s" }} />
            </div>
            <p style={{ fontSize: 12, color: "#888", marginTop: 6, textAlign: "center" }}>Subiendo... {uploadingProgress}%</p>
          </div>
        )}
        {uploadError && (
          <div style={{ marginTop: 16, padding: 12, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, color: "#ef4444", fontSize: 13 }}>
            ❌ {uploadError}
          </div>
        )}
      </div>
    );
  }

  // Main editor screen
  return (
    <div style={{ maxWidth: 1280, margin: "20px auto", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>🎬 Editor — <span style={{ color: "#888", fontWeight: 400, fontSize: 16 }}>{filename}</span></h2>
        <button onClick={reset} className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 12px" }}>
          ✕ Nuevo video
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20 }}>
        {/* ═══ LEFT: PREVIEW ═══ */}
        <div>
          {/* Video preview — raw HTML video with the live SubtitleOverlay
              painted on top, so the user sees the actual subtitle styling in
              real time while editing (no FFmpeg roundtrip per change). */}
          <div ref={previewBoxRef} style={{
            background: "#000", borderRadius: 12, overflow: "hidden",
            aspectRatio: aspectRatio.replace(":", " / "), maxHeight: 640, margin: "0 auto",
            position: "relative",
            containerType: "size",  // enables `cqh` units in the overlay
          }}>
            {/* Blurred background fill — mirrors the export (fit mode = video
                fills the width, blur behind fills the corners). */}
            <video
              ref={bgVideoRef}
              src={rawVideoUrl}
              muted
              style={{
                position: "absolute", inset: 0, width: "100%", height: "100%",
                objectFit: "cover", filter: "blur(24px) brightness(0.5)",
                transform: "scale(1.15)", pointerEvents: "none",
                visibility: showingImageClip ? "hidden" : "visible",
              }}
            />
            <video
              ref={videoRef}
              src={rawVideoUrl}
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={() => { if (videoRef.current) videoRef.current.currentTime = trimStart; }}
              onMouseDown={(e) => {
                e.preventDefault();
                videoDragRef.current = { startX: e.clientX, startY: e.clientY, ox: vPanX, oy: vPanY };
              }}
              onWheel={(e) => {
                const dz = -e.deltaY * 0.0015;
                setVideoTransform({ edit_zoom: Math.max(0.3, Math.min(3, vZoom + dz)) });
              }}
              title="Arrastrá para mover · rueda del mouse para zoom"
              style={{
                position: "relative", zIndex: 1,
                width: "100%", height: "100%", objectFit: "contain", background: "transparent",
                transform: `translate(${vPanX}%, ${vPanY}%) scale(${vZoom})`,
                transformOrigin: "center",
                cursor: "grab",
                visibility: showingImageClip ? "hidden" : "visible",
              }}
            />
            {/* Image clip — shown full-screen over the video when the playhead
                is on an image segment in the timeline. */}
            {showingImageClip && currentSegment.url && (
              <div style={{ position: "absolute", inset: 0, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
                <img src={currentSegment.url} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
              </div>
            )}
            {/* Image overlays — show those whose time range covers the playhead.
                The selected one is draggable + has a resize handle. */}
            {overlays.map((ov, i) => {
              const visible = outputTime >= ov.start - 0.01 && outputTime <= ov.end + 0.01;
              const isSel = selectedOverlayIdx === i;
              if (!visible && !isSel) return null;
              return (
                <div key={i}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSelectedOverlayIdx(i);
                    overlayDragRef.current = { mode: "move", idx: i, startX: e.clientX, startY: e.clientY, ox: ov.x, oy: ov.y };
                  }}
                  style={{
                    position: "absolute",
                    left: `${ov.x * 100}%`, top: `${ov.y * 100}%`,
                    width: `${ov.scale * 100}%`,
                    transform: "translate(-50%, -50%)",
                    opacity: visible ? ov.opacity : 0.35,
                    cursor: "move",
                    outline: isSel ? "2px dashed #fbbf24" : "none",
                    zIndex: 6,
                  }}
                >
                  <img src={ov.url} alt="" draggable={false}
                    style={{ width: "100%", height: "auto", display: "block", pointerEvents: "none" }} />
                  {isSel && (
                    <div
                      onMouseDown={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        overlayDragRef.current = { mode: "resize", idx: i, startX: e.clientX, startY: e.clientY, oscale: ov.scale };
                      }}
                      style={{
                        position: "absolute", right: -8, bottom: -8, width: 16, height: 16,
                        background: "#fbbf24", borderRadius: "50%", cursor: "nwse-resize",
                        border: "2px solid #000",
                      }}
                    />
                  )}
                </div>
              );
            })}
            {subtitlesOn && transcriptWords.length > 0 && (
              <SubtitleOverlay
                words={transcriptWords}
                currentTime={livePlayheadTime}
                style={subStyle}
                sizeScale={subSize}
                yOffset={subY}
              />
            )}
          </div>

          {/* Play controls */}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => seekOutput(0)} style={{ padding: "6px 12px" }}>⏮</button>
            <button className="btn btn-primary" onClick={togglePlay} style={{ padding: "6px 24px", minWidth: 80 }}>
              {playing ? "⏸ Pausa" : "▶ Play"}
            </button>
            <button className="btn btn-secondary" onClick={() => seekOutput(outputDuration - 0.1)} style={{ padding: "6px 12px" }}>⏭</button>
          </div>

          {/* Video transform hint + reset (mouse pan/zoom) */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 8, fontSize: 11, color: "#888" }}>
            <span>🖐 Arrastrá el video para moverlo · rueda = zoom</span>
            <span style={{ color: "var(--accent)", fontFamily: "monospace" }}>{vZoom.toFixed(2)}x</span>
            {(vZoom !== 1 || vPanX !== 0 || vPanY !== 0) && (
              <button className="btn btn-secondary" onClick={resetVideoTransform} style={{ padding: "2px 8px", fontSize: 10 }}>
                ↺ Reset
              </button>
            )}
          </div>

          {/* ═══ TIMELINE EDITOR (compacted, reorderable) ═══ */}
          <TimelineEditor
            thumbnails={thumbnails}
            segments={segments}
            selectedIdx={selectedSegIdx}
            outputTime={outputTime}
            outputDuration={outputDuration}
            onSeekOutput={seekOutput}
            onSelectSegment={setSelectedSegIdx}
            onSplit={splitAtPlayhead}
            onDeleteSegment={deleteSelectedSegment}
            onReorder={reorderSegments}
            onResizeSegment={resizeSegment}
            loadingThumbs={loadingThumbs}
          />

          {/* Timeline toolbar extras: insert image clip + selected block props */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn btn-secondary" onClick={() => imageClipFileRef.current?.click()}
              disabled={uploadingOverlay}
              style={{ padding: "5px 12px", fontSize: 12 }}>
              {uploadingOverlay ? "⏳..." : "🖼 Insertar imagen como clip"}
            </button>
            <input ref={imageClipFileRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={(e) => { addImageClip(e.target.files[0]); e.target.value = ""; }} />

            {/* Speed control for the selected VIDEO block */}
            {selectedSegIdx !== null && segments[selectedSegIdx] && segments[selectedSegIdx].type !== "image" && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#aaa" }}>⚡ Velocidad:</span>
                {[0.25, 0.5, 1, 1.5, 2, 4].map((sp) => (
                  <button key={sp}
                    className={`btn ${(segments[selectedSegIdx].speed || 1) === sp ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setSegmentSpeed(selectedSegIdx, sp)}
                    style={{ padding: "3px 8px", fontSize: 11 }}>
                    {sp}x
                  </button>
                ))}
              </div>
            )}

            {/* Duration control for the selected IMAGE block */}
            {selectedSegIdx !== null && segments[selectedSegIdx] && segments[selectedSegIdx].type === "image" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#aaa" }}>🖼 Duración: <b style={{ color: "var(--accent)" }}>{(segments[selectedSegIdx].duration || 3).toFixed(1)}s</b></span>
                <input type="range" min={0.5} max={30} step={0.5}
                  value={segments[selectedSegIdx].duration || 3}
                  onChange={(e) => setImageClipDuration(selectedSegIdx, parseFloat(e.target.value))}
                  style={{ width: 160 }} />
                <span style={{ fontSize: 10, color: "#666" }}>(arrastrá para estirar)</span>
              </div>
            )}
          </div>

          {subtitlesOn && (
            <p style={{ fontSize: 11, color: "#666", margin: "12px 4px 0", textAlign: "center", lineHeight: 1.5 }}>
              Vista previa en vivo — los subtítulos se renderizan sobre el video mientras editas.
              El export final usa FFmpeg para máxima calidad.
            </p>
          )}
        </div>

        {/* ═══ RIGHT: CONTROLS ═══ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Aspect ratio */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 14 }}>
            <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>📐 Formato</h4>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                { v: "9:16", label: "9:16", desc: "TikTok" },
                { v: "1:1", label: "1:1", desc: "Cuadrado" },
                { v: "16:9", label: "16:9", desc: "YouTube" },
                { v: "4:5", label: "4:5", desc: "IG Feed" },
              ].map(({ v, label, desc }) => (
                <button key={v}
                  className={`btn ${aspectRatio === v ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setAspectRatio(v)}
                  style={{ padding: "6px 10px", fontSize: 12, flex: "1 0 auto", minWidth: 64 }}>
                  <div style={{ fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: 9, opacity: 0.6 }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Keyframes button → opens existing modal */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 14 }}>
            <button
              className="btn"
              onClick={() => setShowKeyframesModal(true)}
              style={{ width: "100%", padding: "10px 0", fontSize: 13,
                background: (clipObj?.keyframes?.length > 0) ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "#222",
                color: "#fff", border: "none", borderRadius: 8 }}
            >
              🎬 Keyframes {clipObj?.keyframes?.length > 0 ? `(${clipObj.keyframes.length})` : "(zoom/pan animado)"}
            </button>
          </div>

          {/* Image overlays section */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 14,
            border: overlays.length ? "1px solid rgba(99,102,241,0.4)" : "1px solid transparent" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h4 style={{ margin: 0, fontSize: 14 }}>🖼 Imágenes <span style={{ color: "#777", fontWeight: 400, fontSize: 11 }}>({overlays.length})</span></h4>
              <button className="btn btn-primary" onClick={() => overlayFileRef.current?.click()}
                disabled={uploadingOverlay}
                style={{ padding: "4px 10px", fontSize: 12 }}>
                {uploadingOverlay ? "⏳..." : "➕ Subir"}
              </button>
              <input ref={overlayFileRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => { handleOverlayUpload(e.target.files[0]); e.target.value = ""; }} />
            </div>

            {overlays.length === 0 ? (
              <p style={{ fontSize: 11, color: "#888", margin: 0 }}>
                Subí una imagen (logo, captura, meme) para ponerla encima del video. La arrastrás y redimensionás en el preview.
              </p>
            ) : (
              <>
                {/* Overlay chips */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                  {overlays.map((ov, i) => (
                    <button key={i} onClick={() => setSelectedOverlayIdx(i)}
                      style={{
                        padding: "3px 8px", fontSize: 11, borderRadius: 6,
                        border: selectedOverlayIdx === i ? "1px solid #fbbf24" : "1px solid #333",
                        background: selectedOverlayIdx === i ? "rgba(251,191,36,0.15)" : "#1a1a1a",
                        color: selectedOverlayIdx === i ? "#fbbf24" : "#aaa", cursor: "pointer",
                      }}>
                      🖼 {i + 1}
                    </button>
                  ))}
                </div>

                {selectedOverlayIdx !== null && overlays[selectedOverlayIdx] && (() => {
                  const ov = overlays[selectedOverlayIdx];
                  const i = selectedOverlayIdx;
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <label style={{ fontSize: 12, color: "#aaa" }}>
                        Aparece desde: <b style={{ color: "var(--accent)" }}>{ov.start.toFixed(1)}s</b>
                      </label>
                      <input type="range" min={0} max={Math.max(1, outputDuration)} step={0.1} value={ov.start}
                        onChange={(e) => updateOverlay(i, { start: Math.min(parseFloat(e.target.value), ov.end - 0.2) })} />
                      <label style={{ fontSize: 12, color: "#aaa" }}>
                        Hasta: <b style={{ color: "var(--accent)" }}>{ov.end.toFixed(1)}s</b>
                      </label>
                      <input type="range" min={0} max={Math.max(1, outputDuration)} step={0.1} value={ov.end}
                        onChange={(e) => updateOverlay(i, { end: Math.max(parseFloat(e.target.value), ov.start + 0.2) })} />
                      <label style={{ fontSize: 12, color: "#aaa" }}>
                        Opacidad: <b style={{ color: "var(--accent)" }}>{Math.round(ov.opacity * 100)}%</b>
                      </label>
                      <input type="range" min={0.1} max={1} step={0.05} value={ov.opacity}
                        onChange={(e) => updateOverlay(i, { opacity: parseFloat(e.target.value) })} />
                      <button className="btn btn-secondary" onClick={() => deleteOverlay(i)}
                        style={{ padding: "5px 0", fontSize: 11 }}>
                        🗑 Borrar imagen
                      </button>
                    </div>
                  );
                })()}
                <p style={{ fontSize: 10, color: "#666", margin: "8px 0 0" }}>
                  Arrastrá la imagen en el preview para moverla · esquina amarilla para redimensionar.
                </p>
              </>
            )}
          </div>

          {/* Subtitles section */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 14,
            border: subtitlesOn ? "1px solid rgba(34,197,94,0.4)" : "1px solid transparent" }}>
            {!subtitlesOn ? (
              <>
                <button
                  className="btn btn-primary"
                  onClick={activateSubtitles}
                  disabled={transcribing || trimDuration < 0.5}
                  style={{ width: "100%", padding: "10px 0", fontSize: 13 }}
                >
                  {transcribing ? "⏳ Transcribiendo..." : `➕ Subtítulos (${formatT(trimDuration)} de audio)`}
                </button>
                {transcribeError && (
                  <p style={{ color: "#ef4444", fontSize: 11, marginTop: 6, margin: "6px 0 0" }}>
                    ❌ {transcribeError}
                  </p>
                )}
                <p style={{ fontSize: 11, color: "#888", margin: "8px 0 0", lineHeight: 1.5 }}>
                  Whisper corre solo sobre el trim actual. {trimDuration > 300
                    ? `~${Math.round(trimDuration / 60 * 0.3)} min de espera.`
                    : `~${Math.max(3, Math.round(trimDuration * 0.3))} segundos.`}
                </p>
              </>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <h4 style={{ margin: 0, fontSize: 14, color: "#22c55e" }}>
                    ✓ Subtítulos <span style={{ color: "#777", fontSize: 11, fontWeight: 400 }}>({subWordCount} palabras)</span>
                  </h4>
                  <button onClick={deactivateSubtitles} className="btn btn-secondary" style={{ padding: "3px 10px", fontSize: 11 }}>
                    ✕ Quitar
                  </button>
                </div>

                {subsStale && (
                  <div style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.35)", padding: 8, borderRadius: 6, marginBottom: 10 }}>
                    <p style={{ margin: 0, fontSize: 11, color: "#fbbf24" }}>
                      ⚠️ Cambiaste el trim después de transcribir.
                    </p>
                    <button onClick={activateSubtitles} disabled={transcribing}
                      className="btn btn-secondary" style={{ marginTop: 6, padding: "4px 10px", fontSize: 11, width: "100%" }}>
                      {transcribing ? "⏳..." : "🔄 Re-transcribir"}
                    </button>
                  </div>
                )}

                {/* Style picker */}
                <label style={{ fontSize: 12, color: "#aaa", display: "block", marginBottom: 4 }}>Estilo</label>
                <select
                  value={subStyle}
                  onChange={(e) => setSubStyle(e.target.value)}
                  style={{ width: "100%", padding: 8, background: "#1a1a1a", color: "#fff", border: "1px solid #333", borderRadius: 6, fontSize: 12, marginBottom: 10 }}
                >
                  <option value="clean">📋 Limpio</option>
                  <option value="karaoke">🎤 Karaoke</option>
                  <option value="popup">💥 Pop-up</option>
                  <option value="highlight">📦 Highlight Box</option>
                  <option value="big_center">🔠 Big Center</option>
                  <option value="twoword">2️⃣ Two-Word</option>
                  <option value="bounce">🎢 Bounce</option>
                  <option value="typewriter">⌨️ Typewriter</option>
                </select>

                <label style={{ fontSize: 12, color: "#aaa" }}>
                  Tamaño: <b style={{ color: "var(--accent)" }}>{Math.round(subSize * 100)}%</b>
                </label>
                <input type="range" min={0.6} max={1.6} step={0.05}
                  value={subSize} onChange={(e) => setSubSize(parseFloat(e.target.value))}
                  style={{ width: "100%", marginBottom: 10 }} />

                <label style={{ fontSize: 12, color: "#aaa" }}>
                  Posición: <b style={{ color: "var(--accent)" }}>
                    {subY === 0 ? "default" : subY > 0 ? `⬆ ${Math.round(subY * 100)}%` : `⬇ ${Math.round(-subY * 100)}%`}
                  </b>
                </label>
                <input type="range" min={-0.5} max={0.5} step={0.02}
                  value={subY} onChange={(e) => setSubY(parseFloat(e.target.value))}
                  style={{ width: "100%" }} />
              </>
            )}
          </div>

          {/* Export */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 14 }}>
            {!exporting && exportFiles.length === 0 && (
              <button onClick={handleExport} disabled={trimDuration < 0.5}
                className="btn btn-primary"
                style={{ width: "100%", padding: "12px 0", fontSize: 14, background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none" }}>
                💾 Exportar ({formatT(trimDuration)})
              </button>
            )}
            {exporting && (
              <>
                <p style={{ fontSize: 12, color: "#aaa", margin: "0 0 8px", textAlign: "center" }}>
                  Renderizando... {exportProgress.current}/{exportProgress.total}
                </p>
                <div style={{ background: "#1a1a1a", borderRadius: 6, height: 8, overflow: "hidden" }}>
                  <div style={{
                    width: `${exportProgress.total > 0 ? (exportProgress.current / exportProgress.total) * 100 : 30}%`,
                    background: "linear-gradient(90deg,#22c55e,#16a34a)", height: "100%", transition: "width 0.3s",
                  }} />
                </div>
              </>
            )}
            {!exporting && exportFiles.length > 0 && (
              <>
                <p style={{ fontSize: 13, color: "#22c55e", margin: "0 0 8px", textAlign: "center", fontWeight: 600 }}>
                  ✓ Exportado
                </p>
                {exportFiles.map((f) => (
                  <a key={f} href={api.getDownloadUrl(projectId, f)} download
                    className="btn btn-secondary"
                    style={{ display: "block", textAlign: "center", padding: "8px 0", fontSize: 12, textDecoration: "none", marginBottom: 6 }}>
                    ⬇ {f}
                  </a>
                ))}
                <button onClick={() => { setExportFiles([]); setExportProgress({ current: 0, total: 0 }); }}
                  className="btn btn-secondary" style={{ width: "100%", padding: "6px 0", fontSize: 11, marginTop: 4 }}>
                  Exportar de nuevo
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Keyframes modal — reuses the existing ClipEditorModal */}
      {showKeyframesModal && clipObj && (
        <ClipEditorModal
          projectId={projectId}
          clip={clipObj}
          fillMode="fit"
          backgroundStyle="black"
          onClose={() => setShowKeyframesModal(false)}
          onSaved={(updated) => {
            // Keep only the transform fields (zoom/pan/keyframes). In editor
            // mode the timeline `segments` define the cut, not the modal's
            // trim — so we don't touch segments here.
            setClipObj((c) => ({ ...c, keyframes: updated.keyframes ?? c.keyframes,
              edit_zoom: updated.edit_zoom ?? c.edit_zoom,
              edit_pan_x: updated.edit_pan_x ?? c.edit_pan_x,
              edit_pan_y: updated.edit_pan_y ?? c.edit_pan_y }));
            // Re-save segments since the modal's editClipTransform overwrote
            // start_time/end_time on the backend clip.
            if (segments.length) {
              api.saveEditorSegments(projectId, segments.map(segToPayload)).catch(() => {});
            }
            setShowKeyframesModal(false);
          }}
        />
      )}
    </div>
  );
}


// ─── Main App ─────────────────────────────────────────────────────────────────

function App() {
  const [mode, setMode] = useState("video"); // "video" | "stream" | "meme" | "analyzer" | "editor"
  const [step, setStep] = useState(1);
  const [projectId, setProjectId] = useState(null);
  const [clips, setClips] = useState([]);
  const [filename, setFilename] = useState("");

  const handleUploadComplete = ({ projectId, clips, filename }) => {
    setProjectId(projectId);
    setClips(clips);
    setFilename(filename);
    setStep(2);
  };

  const handleEditCaption = (clipId, newCaption) => {
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, viral_caption: newCaption } : c))
    );
  };

  // Generic patcher used by the clip editor modal (zoom / pan / trim).
  // Accepts a full clip object or a partial diff — either way the matching
  // clip in the parent's clips array gets the new fields merged in so the
  // user's edits survive navigating between steps.
  const handleUpdateClip = (clipId, updated) => {
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, ...updated } : c))
    );
  };

  const handleReorderClips = (newClips) => {
    setClips(newClips);
  };

  const handleReset = () => {
    setStep(1);
    setProjectId(null);
    setClips([]);
    setFilename("");
  };

  const steps = [
    { num: 1, label: "Upload & Config" },
    { num: 2, label: "Review Clips" },
    { num: 3, label: "Style & Export" },
  ];

  return (
    <>
      <header className="app-header">
        <div className="app-logo">
          <span className="icon">🎬</span>
          AI Video Clipper
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="app-version">v9.6</span>
          <ThemeToggle />
        </div>
      </header>

      <main className="app-main">
        {/* Mode toggle — Studio segmented control (monochrome) */}
        <div style={{ padding: "20px 16px 0", display: "flex", justifyContent: "center" }}>
          <div style={{
            display: "inline-flex", gap: 4, background: "var(--st-alt)", borderRadius: 12,
            padding: 4, border: "1px solid var(--st-line)",
          }}>
            {[
              { key: "video",    icon: "📹", label: "Video Clipper" },
              { key: "analyzer", icon: "🔍", label: "Analyzer" },
              { key: "stream",   icon: "🔴", label: "Live Stream" },
              { key: "meme",     icon: "😂", label: "Meme Generator" },
              { key: "editor",   icon: "🎬", label: "Editor" },
            ].map(({ key, icon, label }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                style={{
                  padding: "9px 18px", borderRadius: 9, border: "1px solid transparent", cursor: "pointer",
                  background: mode === key ? "var(--st-accent)" : "transparent",
                  color: mode === key ? "var(--st-on-accent)" : "var(--st-muted)",
                  fontFamily: "var(--st-ui)", fontWeight: 600, fontSize: 13.5, transition: "all 0.15s",
                  whiteSpace: "nowrap",
                }}
              >
                {icon} {label}
              </button>
            ))}
          </div>
        </div>

        {mode === "analyzer" && <AnalyzerStep />}
        {mode === "stream" && <LiveStreamStep />}
        {mode === "meme" && <MemeStep />}
        {mode === "editor" && <EditorMode />}

        {mode === "video" && <>
          <div className="steps-bar" style={{ marginTop: 20 }}>
            {steps.map((s) => (
              <div
                key={s.num}
                className={`step ${step === s.num ? "active" : ""} ${step > s.num ? "completed" : ""}`}
                onClick={() => { if (s.num < step) setStep(s.num); }}
              >
                <div className="step-number">{step > s.num ? "✓" : s.num}</div>
                <span className="step-label">{s.label}</span>
              </div>
            ))}
          </div>

          {step === 1 && <UploadStep onComplete={handleUploadComplete} />}
          {step === 2 && (
            <ClipsStep
              projectId={projectId}
              clips={clips}
              onEdit={handleEditCaption}
              onUpdateClip={handleUpdateClip}
              onReorder={handleReorderClips}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <EditorStep
              projectId={projectId}
              clips={clips}
              onUpdateClip={handleUpdateClip}
              onExportDone={handleReset}
            />
          )}
        </>}
      </main>
    </>
  );
}

export default App;
