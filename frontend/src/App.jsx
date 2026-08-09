import { useState, useRef, useCallback, useEffect, Fragment } from "react";
import "./App.css";
import * as api from "./services/api";
import { useTheme } from "./ThemeContext.jsx";
import { useModel } from "./ModelContext.jsx";
import { StSection, StChip, StSlider, StToggle, StFieldRow, StRow, StSegmented } from "./components/studio.jsx";

// Human label for a model value (falls back to the raw value).
const modelLabel = (val) => (GEMINI_VIDEO_MODELS.find((m) => m.val === val) || {}).label || val;

// Strip *yellow* / **red** color markers for read-only caption display.
// Edit fields keep the raw text so markers stay editable.
const stripCaptionMarkers = (t) =>
  typeof t === "string" && t.includes("*")
    ? t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1")
    : t;
import {
  Sun, Moon, Scissors, Film, Upload, Download, Image as ImageIcon,
  Radio, Sparkles, Settings, ChevronDown, ChevronRight, Search,
  List, LayoutGrid, Clock, GripVertical, Check, Play, Pencil, RefreshCw,
  ZoomIn, Type, Wand2, SkipBack, SkipForward, Pause,
  Copy, AlertCircle, Loader2, X, Plus, Square, CheckCircle2, Crosshair,
  Undo2, Redo2, FileText, Trash2, Music2,
} from "lucide-react";


// ─── PromptEditButton ──────────────────────────────────────────────────────
// Tiny "Editar prompt" button + inline modal for the screen it's placed in.
// `promptKeys` is the list of registry keys relevant to that screen (e.g.
// ["analysis_system"] for Upload). Saves via api.updatePrompt → prompts.json
// (same persistent override as Ajustes → Prompts). Empty save = reset.
function PromptEditButton({ promptKeys, label = "Editar prompt", title = "Editar prompts" }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [activeKey, setActiveKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const d = await api.listPrompts();
      const filtered = (d.prompts || []).filter((p) => promptKeys.includes(p.key));
      setItems(filtered);
      setDrafts(Object.fromEntries(filtered.map((p) => [p.key, p.current])));
      if (filtered.length && !activeKey) setActiveKey(filtered[0].key);
    } catch (e) { setErr(e.message || "No se pudieron cargar los prompts"); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open]);

  const save = async () => {
    if (!activeKey) return;
    setBusy(true); setErr("");
    try {
      await api.updatePrompt(activeKey, drafts[activeKey] || "");
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1400);
      await load();
    } catch (e) { setErr(e.message || "Error al guardar"); }
    finally { setBusy(false); }
  };
  const resetCurrent = async () => {
    if (!activeKey) return;
    if (!window.confirm("¿Volver al prompt original (descarta tu versión)?")) return;
    setBusy(true); setErr("");
    try {
      await api.resetPrompt(activeKey);
      await load();
    } catch (e) { setErr(e.message || "Error al restablecer"); }
    finally { setBusy(false); }
  };

  const active = items.find((p) => p.key === activeKey);
  const dirty = active && drafts[activeKey] !== active.current;

  return (
    <>
      <button onClick={() => setOpen(true)} className="st-btn st-btn--ghost"
        style={{ padding: "6px 10px", fontSize: 12, gap: 6 }}
        title="Editar el prompt que usa Gemini en esta pantalla">
        <FileText size={13} /> {label}
      </button>

      {open && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "grid", placeItems: "center", zIndex: 60, padding: 20 }}>
          <div style={{
            width: "min(820px, 96vw)", maxHeight: "88vh", display: "flex", flexDirection: "column",
            background: "var(--st-surface)", border: "1px solid var(--st-border)", borderRadius: 14,
            boxShadow: "var(--st-shadow)", overflow: "hidden",
          }}>
            {/* Header */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--st-line)", display: "flex", alignItems: "center", gap: 10 }}>
              <FileText size={16} style={{ color: "var(--st-muted)" }} />
              <span style={{ fontFamily: "var(--st-display)", fontSize: 16, fontWeight: 600 }}>{title}</span>
              <div style={{ flex: 1 }} />
              {savedFlash && <span style={{ fontSize: 11, color: "var(--st-ok)" }}>✓ guardado</span>}
              <button onClick={() => setOpen(false)} className="st-btn st-btn--ghost" style={{ padding: "5px 8px" }}>
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--st-muted)" }}>Cargando…</div>
            ) : items.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--st-muted)" }}>No hay prompts disponibles</div>
            ) : (
              <>
                {/* Tabs if more than 1 prompt */}
                {items.length > 1 && (
                  <div style={{ display: "flex", gap: 4, padding: "10px 16px 0", borderBottom: "1px solid var(--st-line)", flexWrap: "wrap" }}>
                    {items.map((p) => (
                      <span key={p.key} onClick={() => setActiveKey(p.key)} style={{
                        padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                        borderRadius: "8px 8px 0 0", marginBottom: -1,
                        background: activeKey === p.key ? "var(--st-alt)" : "transparent",
                        color: activeKey === p.key ? "var(--st-text)" : "var(--st-muted)",
                        border: `1px solid ${activeKey === p.key ? "var(--st-line)" : "transparent"}`,
                        borderBottom: activeKey === p.key ? "1px solid var(--st-alt)" : "1px solid transparent",
                      }}>{p.label || p.key}</span>
                    ))}
                  </div>
                )}

                {active && (
                  <div style={{ padding: "16px 20px", overflow: "hidden", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                    {active.description && (
                      <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--st-muted)", lineHeight: 1.5 }}>{active.description}</p>
                    )}
                    {active.tokens && active.tokens.length > 0 && (
                      <div style={{ marginBottom: 10, fontSize: 11, color: "var(--st-faint)" }}>
                        Tokens disponibles:{" "}
                        {active.tokens.map((t) => (
                          <code key={t} style={{ fontFamily: "var(--st-mono)", background: "var(--st-alt)", padding: "1px 6px", borderRadius: 4, margin: "0 3px", color: "var(--st-muted)" }}>{t}</code>
                        ))}
                      </div>
                    )}
                    <textarea
                      value={drafts[active.key] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [active.key]: e.target.value }))}
                      spellCheck={false}
                      style={{
                        flex: 1, minHeight: 280, width: "100%", resize: "vertical",
                        fontFamily: "var(--st-mono)", fontSize: 12.5, lineHeight: 1.55,
                        background: "var(--st-alt)", color: "var(--st-text)",
                        border: "1px solid var(--st-border)", borderRadius: 9, padding: 12,
                        boxSizing: "border-box",
                      }}
                    />
                    {err && <p style={{ color: "var(--st-live)", fontSize: 11.5, margin: "8px 0 0" }}>{err}</p>}
                  </div>
                )}
              </>
            )}

            {/* Footer */}
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--st-line)", display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={resetCurrent} disabled={busy || !active} className="st-btn st-btn--ghost" style={{ padding: "7px 12px" }}>
                <RefreshCw size={13} /> Restablecer
              </button>
              <div style={{ flex: 1 }} />
              <button onClick={() => setOpen(false)} className="st-btn st-btn--quiet" style={{ padding: "7px 14px" }}>
                Cerrar
              </button>
              <button onClick={save} disabled={busy || !dirty} className="st-btn st-btn--primary" style={{ padding: "7px 16px" }}>
                {busy ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Monochrome confidence dot (match=solid, mismatch=ring, no_audio=half)
function ConfDot({ conf }) {
  const sz = 8;
  if (conf === "match") return <span style={{ width: sz, height: sz, borderRadius: 99, background: "var(--st-text)", display: "inline-block", flexShrink: 0 }} />;
  if (conf === "mismatch") return <span style={{ width: sz, height: sz, borderRadius: 99, border: "1.6px solid var(--st-faint)", display: "inline-block", boxSizing: "border-box", flexShrink: 0 }} />;
  if (conf === "no_audio") return <span style={{ width: sz, height: sz, borderRadius: 99, background: "linear-gradient(90deg, var(--st-text) 50%, transparent 50%)", border: "1.4px solid var(--st-faint)", display: "inline-block", boxSizing: "border-box", flexShrink: 0 }} />;
  return <span style={{ width: sz, height: sz, borderRadius: 99, border: "1.4px solid var(--st-line)", display: "inline-block", boxSizing: "border-box", flexShrink: 0 }} />;
}

// Studio score badge (>=8 solid accent w/ sparkle, else outline muted)
function ScoreBadge({ score }) {
  const hot = (score || 0) >= 8;
  return (
    <span style={{
      fontFamily: "var(--st-mono)", fontSize: 11, fontWeight: 600, letterSpacing: ".02em",
      padding: "3px 8px", borderRadius: 7, display: "inline-flex", alignItems: "center", gap: 4,
      background: hot ? "var(--st-accent)" : "transparent",
      color: hot ? "var(--st-on-accent)" : "var(--st-muted)",
      border: hot ? "1px solid var(--st-accent)" : "1px solid var(--st-border)",
    }}>
      {hot && <Sparkles size={11} />}{score}/10
    </span>
  );
}

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

// ── Studio sidebar nav item ──
function NavItem({ icon, label, active, badge, disabled, onClick }) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
        borderRadius: 9, cursor: disabled ? "default" : "pointer",
        fontFamily: "var(--st-ui)", fontSize: 13.5, fontWeight: active ? 600 : 500,
        color: disabled ? "var(--st-faint)" : active ? "var(--st-text)" : "var(--st-muted)",
        background: active ? "var(--st-alt)" : "transparent",
        opacity: disabled ? 0.5 : 1, transition: "all .12s", userSelect: "none",
      }}
      onMouseEnter={(e) => { if (!active && !disabled) e.currentTarget.style.background = "var(--st-soft)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ color: active ? "var(--st-text)" : "var(--st-faint)", display: "grid" }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge != null && (
        <span style={{ fontFamily: "var(--st-mono)", fontSize: 10.5, color: "var(--st-faint)" }}>{badge}</span>
      )}
    </div>
  );
}

// ── Studio left sidebar (replaces the old top tabs) ──
function Sidebar({ active, filename, clipCount, hasProject, onNav }) {
  const { theme, toggle } = useTheme();
  const { model } = useModel();
  const group = { display: "flex", flexDirection: "column", gap: 2 };
  const eyebrow = {
    fontFamily: "var(--st-ui)", fontSize: 10.5, fontWeight: 700, letterSpacing: ".09em",
    color: "var(--st-faint)", textTransform: "uppercase", padding: "0 10px 7px",
  };
  return (
    <div style={{
      width: "clamp(196px, 18vw, 232px)", flexShrink: 0, background: "var(--st-surface)",
      borderRight: "1px solid var(--st-line)", padding: "20px 14px",
      display: "flex", flexDirection: "column", gap: 22, height: "100vh",
      position: "sticky", top: 0,
    }}>
      {/* wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 8px" }}>
        <div style={{ width: 26, height: 26, borderRadius: 8, background: "var(--st-accent)", display: "grid", placeItems: "center" }}>
          <Scissors size={15} style={{ color: "var(--st-on-accent)" }} />
        </div>
        <span style={{ fontFamily: "var(--st-display)", fontWeight: 700, fontSize: 18, color: "var(--st-text)", letterSpacing: "-.02em" }}>Clipper</span>
        <span style={{ fontFamily: "var(--st-mono)", fontSize: 9.5, color: "var(--st-faint)", marginLeft: "auto" }}>v9.6</span>
      </div>

      {/* project selector */}
      <div style={{
        display: "flex", alignItems: "center", gap: 9, padding: "9px 11px",
        borderRadius: 10, border: "1px solid var(--st-border)", background: "var(--st-soft)",
      }}>
        <Film size={15} style={{ color: "var(--st-muted)" }} />
        <span style={{ fontFamily: "var(--st-mono)", fontSize: 11.5, color: "var(--st-text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {filename || "sin proyecto"}
        </span>
        <ChevronDown size={14} style={{ color: "var(--st-faint)" }} />
      </div>

      {/* PROYECTO */}
      <div style={group}>
        <div style={eyebrow}>Proyecto</div>
        <NavItem icon={<Upload size={17} />} label="Subir video" active={active === "upload"} onClick={() => onNav("upload")} />
        <NavItem icon={<Film size={17} />} label="Clips" active={active === "clips"} badge={clipCount || null} disabled={!hasProject} onClick={() => onNav("clips")} />
        <NavItem icon={<Scissors size={17} />} label="Editor" active={active === "editor"} onClick={() => onNav("editor")} />
        <NavItem icon={<Download size={17} />} label="Exportar" active={active === "export"} disabled={!hasProject} onClick={() => onNav("export")} />
      </div>

      {/* HERRAMIENTAS */}
      <div style={group}>
        <div style={eyebrow}>Herramientas</div>
        <NavItem icon={<ImageIcon size={17} />} label="Memes" active={active === "meme"} onClick={() => onNav("meme")} />
        <NavItem icon={<Radio size={17} />} label="Live Stream" active={active === "live"} onClick={() => onNav("live")} />
        <NavItem icon={<Sparkles size={17} />} label="Analyzer" active={active === "analyzer"} onClick={() => onNav("analyzer")} />
        <NavItem icon={<Download size={17} />} label="Descargas" active={active === "downloader"} onClick={() => onNav("downloader")} />
      </div>

      {/* footer */}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderRadius: 9, background: "var(--st-soft)", border: "1px solid var(--st-line)" }}>
          <Sparkles size={14} style={{ color: "var(--st-muted)" }} />
          <span style={{ fontFamily: "var(--st-ui)", fontSize: 12, color: "var(--st-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Gemini {modelLabel(model)}</span>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--st-ok)" }} />
        </div>
        <NavItem icon={<Settings size={17} />} label="Ajustes" active={active === "settings"} onClick={() => onNav("settings")} />
        <NavItem
          icon={theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          label={theme === "dark" ? "Tema claro" : "Tema oscuro"}
          onClick={toggle}
        />
      </div>
    </div>
  );
}

const GEMINI_VIDEO_MODELS = [
  { val: "gemini-2.5-flash",              label: "2.5 Flash",       sub: "1500/día · recomendado" },
  { val: "gemini-2.5-flash-lite",         label: "2.5 Flash Lite",  sub: "1000/día · liviano" },
  { val: "gemini-3.6-flash",              label: "3.6 Flash",       sub: "free · más nuevo" },
  { val: "gemini-3.5-flash-lite",         label: "3.5 Flash Lite",  sub: "free · rápido" },
  { val: "gemini-3.5-flash",              label: "3.5 Flash",       sub: "pago · nuevo I/O 26" },
  { val: "gemini-3.1-flash-lite",         label: "3.1 Flash Lite",  sub: "stable · free" },
  { val: "gemini-3.1-flash-lite-preview", label: "3.1 Flash Lite P", sub: "preview · free" },
  { val: "gemini-3-flash",                label: "3 Flash",         sub: "stable · free" },
  { val: "gemini-3-flash-preview",        label: "3 Flash P",       sub: "20/día · preview" },
  { val: "gemini-2.5-pro",                label: "2.5 Pro",         sub: "50/día · mejor calidad" },
  { val: "gemini-3.1-pro-preview",        label: "3.1 Pro",         sub: "pago · top calidad" },
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
  const [maxDuration, setMaxDuration] = useState(90);
  const [customPrompt, setCustomPrompt] = useState("");
  const [contentType, setContentType] = useState("drama"); // "drama" | "motivational"
  const [analyzeLang, setAnalyzeLang] = useState("en"); // caption language: "en" | "es"
  const { model: geminiModel, setModel: setGeminiModel } = useModel(); // global model (synced w/ sidebar + Ajustes)
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
        analyzeDuration,
        maxDuration,
        analyzeLang
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
    const steps = [
      { key: "upload", label: "Subiendo" },
      { key: "analyzing", label: "Analizando" },
      { key: "done", label: "Clips listos" },
    ];
    const curIdx = phase === "analyzing" ? 1 : 0;
    const ringCirc = 160;
    const ringOffset = ringCirc * (1 - Math.max(0, Math.min(100, percent)) / 100);

    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh", padding: 24 }}>
        <div style={{ width: 460, maxWidth: "100%" }}>
          {/* Stepper */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 34 }}>
            {steps.map((s, i) => {
              const st = i < curIdx ? "done" : i === curIdx ? "active" : "todo";
              return (
                <div key={s.key} style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 99, display: "grid", placeItems: "center",
                      fontFamily: "var(--st-mono)", fontSize: 13, fontWeight: 600,
                      background: st === "active" ? "var(--st-accent)" : "transparent",
                      color: st === "active" ? "var(--st-on-accent)" : st === "done" ? "var(--st-text)" : "var(--st-faint)",
                      border: st === "active" ? "none" : `1px solid ${st === "done" ? "var(--st-muted)" : "var(--st-border)"}`,
                    }}>
                      {st === "done" ? <Check size={16} /> : i + 1}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: st === "active" ? 600 : 500, color: st === "active" ? "var(--st-text)" : "var(--st-faint)" }}>{s.label}</span>
                  </div>
                  {i < steps.length - 1 && <div style={{ width: 56, height: 1, background: "var(--st-line)", margin: "0 10px 22px" }} />}
                </div>
              );
            })}
          </div>

          {/* Main card */}
          <div className="st-card" style={{ padding: "30px 28px", textAlign: "center", boxShadow: "var(--st-shadow)" }}>
            <div style={{ width: 54, height: 54, borderRadius: 14, background: "var(--st-soft)", border: "1px solid var(--st-border)", display: "grid", placeItems: "center", margin: "0 auto 16px", position: "relative" }}>
              <Sparkles size={24} style={{ color: "var(--st-text)" }} />
              <svg width="54" height="54" viewBox="0 0 54 54" style={{ position: "absolute", inset: 0 }}>
                <circle cx="27" cy="27" r="25.5" fill="none" stroke="var(--st-border)" strokeWidth="1.5" />
                <circle cx="27" cy="27" r="25.5" fill="none" stroke="var(--st-accent)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray={ringCirc} strokeDashoffset={ringOffset} transform="rotate(-90 27 27)" style={{ transition: "stroke-dashoffset 0.4s ease" }} />
              </svg>
            </div>
            <h3 style={{ margin: "0 0 6px", fontFamily: "var(--st-display)", fontSize: 21, fontWeight: 600, letterSpacing: "-.02em" }}>
              {phase === "analyzing" ? "Analizando con Gemini" : "Subiendo video"}
            </h3>
            <p style={{ margin: "0 0 4px", fontSize: 13.5, color: "var(--st-muted)", lineHeight: 1.5 }}>
              {phase === "analyzing" ? "Gemini está viendo tu video completo. No cierres esta ventana." : "Enviando el archivo al servidor local."}
            </p>
            {statusMsg && (
              <p style={{ margin: "0 0 18px", fontFamily: "var(--st-mono)", fontSize: 12, color: "var(--st-faint)" }}>{statusMsg}</p>
            )}

            <div style={{ height: 6, borderRadius: 99, background: "var(--st-alt)", overflow: "hidden", marginBottom: 8 }}>
              <div style={{ height: "100%", width: `${percent}%`, borderRadius: 99, background: "var(--st-accent)", transition: "width 0.4s ease" }} />
            </div>
            <p style={{ margin: 0, fontFamily: "var(--st-mono)", fontSize: 12, color: "var(--st-muted)", textAlign: "right" }}>{percent}%</p>

            {phase === "analyzing" && (
              <div style={{ marginTop: 18, padding: "13px 15px", background: "var(--st-soft)", borderRadius: 10, border: "1px solid var(--st-line)", textAlign: "left", display: "flex", gap: 10 }}>
                <Sparkles size={15} style={{ color: "var(--st-faint)", flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: 12, color: "var(--st-muted)", lineHeight: 1.55 }}>
                  Mientras esperás, Gemini identifica los momentos más virales, analiza las reacciones y genera los captions automáticamente.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "30px 32px" }}>
      {/* Title */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
        <h1 style={{ margin: 0, fontFamily: "var(--st-display)", fontSize: 28, fontWeight: 600, letterSpacing: "-0.025em", color: "var(--st-text)", flex: 1 }}>
          Subir video
        </h1>
        <PromptEditButton
          promptKeys={["analysis_system", "default_instruction", "creator_section"]}
          title="Prompts · Análisis principal" />
      </div>
      <p style={{ margin: "0 0 26px", fontSize: 14.5, color: "var(--st-muted)", lineHeight: 1.5 }}>
        Gemini revisa el video completo y encuentra los momentos más virales automáticamente.
      </p>

      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
        onDragLeave={() => setDragover(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: file ? "1.5px solid var(--st-ok)" : `1.5px dashed ${dragover ? "var(--st-accent)" : "var(--st-border)"}`,
          borderRadius: 14, padding: "42px 24px", textAlign: "center",
          background: "var(--st-soft)", marginBottom: 24, cursor: "pointer", transition: "all 0.15s",
        }}
      >
        <input ref={inputRef} type="file" accept="video/*" hidden
          onChange={(e) => setFile(e.target.files[0])} />
        <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--st-surface)", border: "1px solid var(--st-border)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
          <Upload size={22} style={{ color: file ? "var(--st-ok)" : "var(--st-muted)" }} />
        </div>
        {file ? (
          <>
            <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 5, color: "var(--st-ok)" }}>{file.name}</div>
            <div style={{ fontSize: 12.5, color: "var(--st-faint)", fontFamily: "var(--st-mono)" }}>{(file.size / 1024 / 1024).toFixed(1)} MB · click para cambiar</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 5, color: "var(--st-text)" }}>Arrastra tu video aquí</div>
            <div style={{ fontSize: 13, color: "var(--st-faint)", fontFamily: "var(--st-mono)" }}>MP4 · MOV · AVI</div>
          </>
        )}
      </div>

      {/* Config */}
      <div className="st-card" style={{ padding: "20px 24px", marginBottom: 18 }}>
        <div className="st-eyebrow" style={{ marginBottom: 16 }}>Configuración</div>

        {/* Clips + min/max duration */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 6 }}>
          <div>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 6 }}>Número de clips</label>
            <input type="number" value={clipCount} onChange={(e) => setClipCount(Math.max(1, parseInt(e.target.value) || 1))} min={1} max={50}
              className="st-input" style={{ fontFamily: "var(--st-mono)" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 6 }}>Duración mín. (seg)</label>
            <input type="number" value={minDuration} onChange={(e) => setMinDuration(parseInt(e.target.value) || 10)} min={5} max={120}
              className="st-input" style={{ fontFamily: "var(--st-mono)" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 6 }}>Duración máx. (seg)</label>
            <input type="number" value={maxDuration}
              onChange={(e) => setMaxDuration(Math.min(180, Math.max(minDuration + 5, parseInt(e.target.value) || 90)))}
              min={20} max={180}
              className="st-input" style={{ fontFamily: "var(--st-mono)" }} />
          </div>
        </div>
        <p style={{ fontSize: 11, color: "var(--st-faint)", margin: "0 0 18px", lineHeight: 1.5 }}>
          Para podcasts subí el máximo (90-180s) — si un momento es bueno pero largo, Gemini lo respeta y lo deja completo. Para short-form dejalo en ~60.
        </p>

        {/* Content type */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 8 }}>Tipo de contenido</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { val: "drama", label: "Drama / Entretenimiento", icon: <Film size={15} /> },
              { val: "motivational", label: "Motivacional", icon: <Sparkles size={15} /> },
            ].map(({ val, label, icon }) => (
              <StChip key={val} active={contentType === val}
                onClick={() => {
                  setContentType(val);
                  setCustomPrompt(val === "motivational"
                    ? "Find the most powerful, inspiring, and motivational moments. Prioritize: life-changing quotes, transformation stories, breakthrough realizations, words of wisdom, advice that hits hard, success principles, mindset shifts, and statements that make viewers want to take action. Skip drama, conflict, complaints, or negative emotions. Each clip MUST leave the viewer feeling inspired, motivated, or with a powerful insight. Start at the PEAK of the impactful statement — not before it builds up."
                    : "");
                }}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 14px", fontSize: 13 }}>
                {icon} {label}
              </StChip>
            ))}
          </div>
        </div>

        {/* Caption language — same EN/ES choice as the reanalyze buttons */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 8 }}>
            Idioma de los captions
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { val: "en", label: "🇺🇸 English" },
              { val: "es", label: "🇪🇸 Español" },
            ].map(({ val, label }) => (
              <StChip key={val} active={analyzeLang === val}
                onClick={() => setAnalyzeLang(val)}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 14px", fontSize: 13 }}>
                {label}
              </StChip>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: "var(--st-faint)", margin: "6px 0 0" }}>
            Los captions, descripciones y el texto del clip saldrán en ese idioma.
          </p>
        </div>

        {/* Creator name */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 6 }}>
            Nombre del creador <span style={{ color: "var(--st-faint)", fontWeight: 400 }}>(opcional)</span>
          </label>
          <input type="text" value={creatorName} onChange={(e) => setCreatorName(e.target.value)}
            placeholder="p. ej. Sophie Rain · varios separados por coma" className="st-input" />
          <p style={{ fontSize: 11.5, color: "var(--st-faint)", margin: "6px 0 0" }}>
            Gemini lo incluye en captions y títulos donde fluya natural. Varios nombres separados por coma.
          </p>
        </div>

        {/* AI instructions */}
        <div>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 6 }}>
            Instrucciones para la IA <span style={{ color: "var(--st-faint)", fontWeight: 400 }}>(opcional)</span>
          </label>
          <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="Prioriza confesiones, reacciones graciosas y momentos dramáticos…"
            className="st-textarea" style={{ resize: "vertical", minHeight: 80 }} />
        </div>

        {/* Advanced (collapsible) */}
        <div style={{ marginTop: 10 }}>
          <StRow icon={<Sparkles size={15} />} label="Modelo de IA" summary={(GEMINI_VIDEO_MODELS.find(m => m.val === geminiModel) || {}).label || "2.5 Flash"}>
            <ModelSelector value={geminiModel} onChange={setGeminiModel} health={modelHealth} checking={checkingModels} onCheck={handleCheckModels} />
            <p style={{ fontSize: 11.5, color: "var(--st-faint)", marginTop: 8, marginBottom: 0 }}>
              Si un modelo da 429 (cuota) o 503 (saturado), cambiá a otro. <b>Check modelos</b> hace un ping rápido y pinta su estado.
            </p>
          </StRow>
          <StRow icon={<Scissors size={15} />} label="Analizar un rango"
            summary={(analyzeStartStr || analyzeEndStr) ? `${analyzeStartStr || "0:00"} – ${analyzeEndStr || "fin"}` : "todo el video"}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input type="text" value={analyzeStartStr} onChange={(e) => setAnalyzeStartStr(e.target.value)} placeholder="Desde (ej. 5:00)" className="st-input" style={{ fontFamily: "var(--st-mono)" }} />
              <input type="text" value={analyzeEndStr} onChange={(e) => setAnalyzeEndStr(e.target.value)} placeholder="Hasta (ej. 15:00)" className="st-input" style={{ fontFamily: "var(--st-mono)" }} />
            </div>
            <p style={{ fontSize: 11.5, color: "var(--st-faint)", margin: "8px 0 0" }}>
              Formato mm:ss (ej. 10:30) o solo minutos (ej. 10). Vacío = todo el video. Recomendado: rangos de 10–15 min.
            </p>
          </StRow>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
        <button
          className="st-btn st-btn--primary"
          style={{ fontSize: 14, padding: "11px 20px" }}
          disabled={!file}
          onClick={handleSubmit}
        >
          <Sparkles size={15} /> Analizar video
        </button>
      </div>
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
  // Timeline cuts — kept pieces in ORIGINAL-video seconds. A single piece
  // spanning the full clip = legacy mode (start/end). Non-empty with >1 piece
  // = the user removed middles; the export concatenates these segments.
  const [segments, setSegments] = useState(() => {
    const orig = clip.segments || [];
    if (orig.length) return orig.map((s) => ({
      start: Number(s.start), end: Number(s.end), speed: Number(s.speed) || 1,
    }));
    return [{ start: clip.start_time, end: clip.end_time }];
  });
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
  // When cuts exist, playback only walks the KEPT (green) segments: reaching a
  // segment end jumps to the next kept segment, and the removed (black) gaps
  // are never shown.
  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    if (v.currentTime < startTime - 0.5) {
      v.currentTime = startTime;
    } else if (v.currentTime >= endTime) {
      const s = sortedSegs();
      v.currentTime = s.length ? s[0].start : startTime;
    } else if (hasCuts) {
      const t = v.currentTime;
      const inSeg = segAt(t);
      if (inSeg !== -1) {
        const seg = sortedSegs()[inSeg];
        if (t >= seg.end - 0.05) {
          const s = sortedSegs();
          v.currentTime = s[(inSeg + 1) % s.length].start;
          if (inSeg + 1 >= s.length) v.pause();
        }
      } else {
        // Playhead sits in a removed (black) gap → jump to the next kept segment
        const s = sortedSegs();
        const nxt = s.find((seg) => seg.start >= t);
        v.currentTime = (nxt || s[0]).start;
      }
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
        // One piece = legacy single-range mode (empty segments on the server).
        // Multiple pieces = cuts; the server persists them and the export
        // concatenates the kept parts.
        segments: hasCuts
          ? segments.map((s) => ({ start: s.start, end: s.end, speed: s.speed || 1 }))
          : [],
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
    setSegments([{ start: clip.start_time, end: clip.end_time }]);
    if (videoRef.current) videoRef.current.currentTime = clip.start_time;
  };

  // ─── Cuts (remove boring middles) ──────────────────────────────────────
  // Each segment is in ORIGINAL-video seconds (same coordinate as start/end).
  // Split the segment currently under the playhead, then the user can delete
  // any piece to cut it out. Sorted on every mutation.
  const [cutMsg, setCutMsg] = useState("");
  const clearCutMsg = () => setCutMsg("");
  const sortedSegs = () => [...segments].sort((a, b) => a.start - b.start);
  const segAt = (t) => sortedSegs().findIndex((s) => t >= s.start && t <= s.end);
  const totalSegDur = segments.reduce((acc, s) => acc + (s.end - s.start), 0);

  const splitAtPlayhead = () => {
    const t = Math.max(startTime, Math.min(endTime, currentTime));
    const idx = segAt(t);
    if (idx === -1) { setCutMsg("El playhead no está sobre un tramo conservado. Arrastrá la línea para moverlo."); return; }
    const seg = sortedSegs()[idx];
    if (t - seg.start < 0.15 || seg.end - t < 0.15) {
      setCutMsg("El playhead está demasiado cerca del borde del tramo. Movelo dentro del tramo verde para cortar.");
      return;
    }
    const next = [...segments].filter((_, i) => i !== idx);
    next.push({ start: seg.start, end: t }, { start: t, end: seg.end });
    setSegments(next.sort((a, b) => a.start - b.start));
    setCutMsg("");
  };

  const deleteSegAtPlayhead = () => {
    const idx = segAt(currentTime);
    if (idx === -1) { setCutMsg("No hay un tramo bajo el playhead para eliminar."); return; }
    const next = [...segments].filter((_, i) => i !== idx);
    if (!next.length) return;
    setSegments(next.sort((a, b) => a.start - b.start));
    setCutMsg(`Tramo eliminado — quedan los tramos en verde.`);
  };

  const clearCuts = () => {
    setSegments([{ start: clip.start_time, end: clip.end_time }]);
    setCutMsg("");
  };

  // "Tiene cortes" = cualquier estado distinto del rango original único (o sea,
  // al eliminar hasta quedar un solo tramo recortado, sigue siendo un corte).
  const pristineSingle = segments.length === 1
    && Math.abs(segments[0].start - clip.start_time) < 0.01
    && Math.abs(segments[0].end - clip.end_time) < 0.01;
  const hasCuts = !pristineSingle;

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
           style={{ maxWidth: 1100, width: "92vw", maxHeight: "92vh", overflowY: "auto" }}>
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
                const words = stripCaptionMarkers(clip.viral_caption).split(/\s+/);
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
                {/* Trim range — when cuts exist, paint the KEPT segments as
                    bright blocks and leave removed gaps dark. Otherwise a
                    single full-highlight gradient (legacy single-range). */}
                {hasCuts ? segments.map((s, i) => {
                  const left = clipDur > 0 ? ((s.start - startTime) / clipDur) * 100 : 0;
                  const width = clipDur > 0 ? ((s.end - s.start) / clipDur) * 100 : 0;
                  if (left > 100 || left + width < 0) return null;
                  const isPlayheadSeg = currentTime >= s.start && currentTime <= s.end;
                  return (
                    <div key={i}
                      onClick={(e) => { e.stopPropagation(); seekTo((s.start + s.end) / 2); }}
                      title={`Kept ${formatTime(s.start)} – ${formatTime(s.end)} (${(s.end - s.start).toFixed(1)}s)`}
                      style={{
                        position: "absolute", top: 3, bottom: 3, zIndex: 1,
                        left: `${Math.max(0, left)}%`,
                        width: `${(left < 0 ? width + left : width)}%`,
                        background: isPlayheadSeg
                          ? "linear-gradient(90deg, rgba(34,197,94,0.5), rgba(34,197,94,0.75))"
                          : "linear-gradient(90deg, rgba(34,197,94,0.3), rgba(34,197,94,0.55))",
                        border: "1px solid rgba(34,197,94,0.8)",
                        borderRadius: 5,
                        cursor: "pointer",
                      }}
                    />
                  );
                }) : (
                  <div style={{
                    position: "absolute", left: 0, top: 0, bottom: 0, right: 0,
                    background: "linear-gradient(90deg, rgba(99,102,241,0.15), rgba(99,102,241,0.3))",
                    borderRadius: 8,
                  }} />
                )}
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

            {/* ─── Cuts (recortar partes del medio) ─────────────────────── */}
            <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: "14px 16px", border: hasCuts ? "1px solid rgba(34,197,94,0.4)" : "1px solid transparent" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h4 style={{ margin: 0, fontSize: 14 }}>
                  ✂ Cortes <span style={{ color: "#777", fontWeight: 400 }}>({segments.length} tramo{segments.length > 1 ? "s" : ""})</span>
                </h4>
                {hasCuts && (
                  <button onClick={clearCuts} className="btn btn-secondary"
                    style={{ padding: "3px 10px", fontSize: 11 }}>
                    ↻ Quitar cortes
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button onClick={splitAtPlayhead} className="btn btn-primary"
                  style={{ flex: 1, padding: "7px 0", fontSize: 12 }}
                  title="Divide el tramo bajo el playhead en dos. Repetí para separar distintas secciones y después borrá las que no quieras.">
                  ✂ Cortar aquí
                </button>
                <button onClick={deleteSegAtPlayhead} disabled={!hasCuts}
                  className="btn btn-secondary"
                  style={{ flex: 1, padding: "7px 0", fontSize: 12 }}
                  title="Elimina el tramo que contiene el playhead (se remueve del clip)">
                  🗑 Eliminar tramo
                </button>
              </div>
              <p style={{ fontSize: 11, color: "#888", margin: 0, lineHeight: 1.5 }}>
                {hasCuts ? (
                  <>Video resultante: <b style={{ color: "#22c55e" }}>{formatTime(totalSegDur)}</b> (de {formatTime(endTime - startTime)} originales). Mové el playhead sobre un tramo verde y usá "Eliminar tramo" para quitarlo.</>
                ) : (
                  <>Ubicá el playhead y "Cortar aquí" para separar secciones. Luego eliminá las que no quieras — se concatenan las que quedan.</>
                )}
              </p>
              {cutMsg && (
                <p style={{ fontSize: 11.5, color: "#fbbf24", margin: "8px 0 0", lineHeight: 1.45, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 8, padding: "8px 10px" }}>
                  {cutMsg}
                </p>
              )}
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
  // Manual re-trim of the previewed clip (instant — just moves in/out points).
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimSaving, setTrimSaving] = useState(false);
  const playerRef = useRef(null);
  // ── Subtitle text correction (fix Whisper words) ──────────────────────────
  const [subEditClip, setSubEditClip] = useState(null);
  const [subWords, setSubWords] = useState([]);          // [{i, word, start, end, orig}]
  const [subLoading, setSubLoading] = useState(false);
  const [subSaving, setSubSaving] = useState(false);
  const [subHasTranscript, setSubHasTranscript] = useState(true);
  const [subFind, setSubFind] = useState("");
  const [subReplace, setSubReplace] = useState("");
  const [reanalyzingClip, setReanalyzingClip] = useState(null);
  const [selectedClips, setSelectedClips] = useState(new Set());
  const [reanalyzingBatch, setReanalyzingBatch] = useState(false);
  // ⬇ Per-clip quick export: renders THIS clip in 9:16 and downloads it.
  const [quickExportId, setQuickExportId] = useState(null);
  const [copiedTweetId, setCopiedTweetId] = useState(null);
  // 🐦 Tweet text modal — generate + view + copy the 280-char post text.
  const [tweetClip, setTweetClip] = useState(null);
  const [tweetText, setTweetText] = useState("");
  const [tweetGenerating, setTweetGenerating] = useState(false);
  const [tweetCopied, setTweetCopied] = useState(false);
  // ── Project-wide music state (Clips screen) ────────────────────────────
  // ClipsStep affects the WHOLE PROJECT's music settings — i.e. all clips
  // in the batch will use this when they export. For per-clip music
  // overrides, the Visual Editor (Paso 3) still has the "Aplicar a" scope.
  // These mirror the EditorStep state so the UX is consistent.
  const [musicStyle, setMusicStyle] = useState({
    music_path: null,
    music_volume: 0.8,
    original_volume: 1.0,
    music_start: 0.0,
    music_end: 0.0,
  });
  const [musicMeta, setMusicMeta] = useState(null);    // {url, name, duration, peaks}
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [musicUploadPct, setMusicUploadPct] = useState(0);
  const [musicExpanded, setMusicExpanded] = useState(false);
  const musicAudioRef = useRef(null);
  const musicFileRef = useRef(null);

  // Spanish translation/export: per-clip translation data keyed by clip.id.
  // Each value is { caption_es, transcript_es, transcript_en }. Empty caption_es
  // means "not translated yet" (don't render the sub-row).
  const [translatedClips, setTranslatedClips] = useState(new Set());
  const [translationData, setTranslationData] = useState({});  // {clipId: {caption_es, transcript_es, transcript_en}}
  const [spanishBatchRunning, setSpanishBatchRunning] = useState(false);
  const [spanishBatchProgress, setSpanishBatchProgress] = useState({ current: 0, total: 0 });
  // 📄 Guión ES modal — null when closed
  const [scriptEsClip, setScriptEsClip] = useState(null);
  // ▶ Play ES modal — null when closed
  const [playingEsClip, setPlayingEsClip] = useState(null);
  const [videoEsUrl, setVideoEsUrl] = useState(null);
  const [loadingVideoEs, setLoadingVideoEs] = useState(false);
  // Creator name (loaded from project on mount, editable, saved on blur/Enter)
  const [creatorName, setCreatorName] = useState("");
  const [creatorSaving, setCreatorSaving] = useState(false);
  const [creatorSavedTs, setCreatorSavedTs] = useState(0);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, currentId: null });
  const { model: reanalyzeModel, setModel: setReanalyzeModel } = useModel(); // global model (synced w/ sidebar + Ajustes)
  const [switchingModel, setSwitchingModel] = useState(false);
  const [modelHealth, setModelHealth] = useState({});
  const [checkingModels, setCheckingModels] = useState(false);
  const [showModels, setShowModels] = useState(false);

  // Change the model used for (re)analysis — updates the global model AND the
  // backend project model so the 🔄 reanalyze buttons use it.
  const handleModelChange = async (val) => {
    setReanalyzeModel(val);
    setSwitchingModel(true);
    try { await api.updateProjectModel(projectId, val); } catch (_) {}
    finally { setSwitchingModel(false); }
  };
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
    // Instant preview to judge if the MOMENT is good (no styling). Plays the
    // RAW source seeked to the clip range — zero render, zero wait. The styled
    // render (captions/crop/blur) lives in the editor where it matters.
    setPlayingClip(clip);
    setLoadingVideo(false);
    setTrimStart(clip.start_time);
    setTrimEnd(clip.end_time);
    setVideoUrl(api.getRawVideoUrl(projectId));
  };

    // ⬇ Render THIS single clip in 16:9 WITHOUT text (Twitter-ready) and download
  // it. One click = render + download. Polls the export progress and grabs the
  // variant file (clip_XX_title_16x9_notext.mp4) as soon as it appears.
  const handleQuickExport = async (clip) => {
    if (quickExportId) return;
    setQuickExportId(clip.id);
    const clipPrefix = `clip_${String(clip.id).padStart(2, "0")}_`;
    const fileMark = "_16x9_notext";
    try {
      await api.startExport(projectId, [clip.id], { aspectRatio: "16:9", noText: true, useWatermark: false, variant: "16x9_notext" });
      const deadline = Date.now() + 600000; // 10 min cap
      let started = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const p = await api.getExportProgress(projectId);
        // Wait until the NEW job actually starts (progress resets to running
        // with total 1) so we never grab a stale file from an old export.
        if (!started && p.status === "running" && p.total === 1) started = true;
        if (started) {
          const f = (p.files || []).find((x) => x.startsWith(clipPrefix) && x.includes(fileMark));
          if (f) {
            const a = document.createElement("a");
            a.href = api.getDownloadUrl(projectId, f);
            a.download = f;
            document.body.appendChild(a);
            a.click();
            a.remove();
            break;
          }
          if (p.status === "completed" || p.status === "done") break;
        }
      }
    } catch (e) {
      alert("No se pudo exportar el clip: " + e.message);
    } finally {
      setQuickExportId(null);
    }
  };

  // 📋 Copy a ready-to-paste post text for this clip (caption + basic tags).
  const handleCopyTweet = async (clip) => {
    // If a dedicated tweet_text exists, copy that; otherwise fall back to the caption.
    const text = (tweet_text_map[clip.id] || "").trim() || stripCaptionMarkers(clip.viral_caption || "").trim() || clip.description || "";
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTweetId(clip.id);
      setTimeout(() => setCopiedTweetId((id) => (id === clip.id ? null : id)), 1500);
    } catch (err) {
      alert("No se pudo copiar: " + err.message);
    }
  };

  // 🐦 Open the tweet text modal for a clip (generate on demand, view + copy).
  const handleOpenTweet = async (clip) => {
    setTweetClip(clip);
    setTweetText(tweet_text_map[clip.id] || "");
    setTweetGenerating(false);
    setTweetCopied(false);
  };

  const handleGenerateTweet = async () => {
    if (!tweetClip || tweetGenerating) return;
    setTweetGenerating(true);
    try {
      const res = await api.generateTweetText(projectId, tweetClip.id);
      setTweetText(res.tweet_text || "");
      setTweet_text_map((m) => ({ ...m, [tweetClip.id]: res.tweet_text || "" }));
      if (onUpdateClip) onUpdateClip(tweetClip.id, { tweet_text: res.tweet_text || "" });
    } catch (err) {
      alert("No se pudo generar el tweet: " + err.message);
    } finally {
      setTweetGenerating(false);
    }
  };

  const handleCopyTweetModal = async () => {
    if (!tweetText.trim()) return;
    try {
      await navigator.clipboard.writeText(tweetText);
      setTweetCopied(true);
      setTimeout(() => setTweetCopied(false), 1500);
    } catch (err) {
      alert("No se pudo copiar: " + err.message);
    }
  };

  // Load existing tweet_text values for all clips on mount.
  const [tweet_text_map, setTweet_text_map] = useState({});
  useEffect(() => {
    const m = {};
    (clips || []).forEach((c) => { if (c.tweet_text) m[c.id] = c.tweet_text; });
    setTweet_text_map(m);
  }, []);

  // Save the manually re-trimmed in/out points (instant, no render).
  const handleSaveTrim = async () => {
    if (!playingClip) return;
    if (trimEnd - trimStart < 0.5) { alert("El clip debe durar al menos 0.5s"); return; }
    setTrimSaving(true);
    try {
      const res = await api.trimClip(projectId, playingClip.id, trimStart, trimEnd);
      const updated = res.clip || { start_time: trimStart, end_time: trimEnd, duration: trimEnd - trimStart };
      if (onUpdateClip) onUpdateClip(playingClip.id, updated);
      setPlayingClip((p) => ({ ...p, ...updated }));
    } catch (e) {
      alert("No se pudo guardar el recorte: " + e.message);
    } finally {
      setTrimSaving(false);
    }
  };

  // ── Subtitle correction handlers ──────────────────────────────────────────
  const openSubEditor = async (clip) => {
    setSubEditClip(clip);
    setSubWords([]); setSubFind(""); setSubReplace(""); setSubHasTranscript(true);
    setSubLoading(true);
    try {
      const r = await api.getSubtitleWords(projectId, clip.id);
      setSubHasTranscript(!!r.has_transcript);
      setSubWords((r.words || []).map((w) => ({ ...w, orig: w.word })));
    } catch (e) {
      alert("No se pudieron cargar los subtítulos: " + e.message);
    } finally { setSubLoading(false); }
  };

  const reloadSubWords = async () => {
    if (!subEditClip) return;
    const r = await api.getSubtitleWords(projectId, subEditClip.id);
    setSubWords((r.words || []).map((w) => ({ ...w, orig: w.word })));
  };

  const saveSubWords = async () => {
    const updates = subWords.filter((w) => w.word !== w.orig).map((w) => ({ i: w.i, word: w.word }));
    if (updates.length === 0) { setSubEditClip(null); return; }
    setSubSaving(true);
    try {
      await api.updateSubtitleWords(projectId, updates);
      setSubEditClip(null);
    } catch (e) {
      alert("No se pudo guardar: " + e.message);
    } finally { setSubSaving(false); }
  };

  const doSubReplace = async () => {
    if (!subFind.trim()) return;
    setSubSaving(true);
    try {
      const r = await api.replaceSubtitleWord(projectId, subFind.trim(), subReplace.trim());
      await reloadSubWords();
      setSubFind(""); setSubReplace("");
      if (!r.changed) alert("No se encontró esa palabra en el transcript.");
    } catch (e) {
      alert("No se pudo reemplazar: " + e.message);
    } finally { setSubSaving(false); }
  };

  const handlePlayClipEs = async (clip) => {
    setPlayingEsClip(clip);
    setLoadingVideoEs(true);
    setVideoEsUrl(api.getVideoPreviewEsUrl(projectId, clip.id));
  };

  const handleImagePreview = (clip) => {
    setImagePreviewClip(clip);
    setImageLoading(true);
    setImagePreviewUrl(api.getPreviewUrl(projectId, clip.id));
  };

  // Persist the latest typed creator name BEFORE any reanalyze fires.
  // Avoids the onBlur→click race where the PATCH lands after the reanalyze.
  const flushCreatorBeforeReanalyze = async () => {
    if (!projectId) return;
    try { await api.updateProjectCreator(projectId, (creatorName || "").trim()); } catch (_) {}
  };

  const handleReanalyze = async (clip, lang = "en") => {
    await flushCreatorBeforeReanalyze();
    setReanalyzingClip(clip.id);
    try {
      const result = await api.reanalyzeClip(projectId, clip.id, lang);
      onEdit(clip.id, result.clip.viral_caption);
    } catch (err) {
      alert(`Re-análisis falló (${lang === "es" ? "ES" : "EN"}): ` + err.message);
    } finally {
      setReanalyzingClip(null);
    }
  };

  // Load existing creator_name + music style from the project on mount. The
  // music fields live on project.style; if a track is already saved we also
  // build a musicMeta entry so the audio element + trim sliders render with
  // the right limits.
  useEffect(() => {
    if (!projectId) return;
    api.getProject(projectId)
      .then((p) => {
        setCreatorName(p?.creator_name || "");
        const s = p?.style || {};
        const next = {
          music_path: s.music_path || null,
          music_volume: typeof s.music_volume === "number" ? s.music_volume : 0.8,
          original_volume: typeof s.original_volume === "number" ? s.original_volume : 1.0,
          music_start: typeof s.music_start === "number" ? s.music_start : 0.0,
          music_end: typeof s.music_end === "number" ? s.music_end : 0.0,
        };
        setMusicStyle(next);
        if (next.music_path) {
          const basename = String(next.music_path).split(/[\\/]/).pop();
          setMusicMeta({
            url: api.getProjectMusicUrl(projectId, basename),
            name: basename,
            duration: 0,
            peaks: [],
          });
          setMusicExpanded(true);
        }
      })
      .catch(() => { /* project may not exist after backend restart */ });
  }, [projectId]);

  // Persist the music style fields back to the project whenever they change.
  // Skipped on the very first render (we read FROM the project then) to avoid
  // a redundant save with defaults. Debounced 350ms so dragging a slider
  // doesn't spam the backend.
  const _musicFirstRunRef = useRef(true);
  useEffect(() => {
    if (!projectId) return;
    if (_musicFirstRunRef.current) { _musicFirstRunRef.current = false; return; }
    const t = setTimeout(() => {
      // Fetch the latest project style, merge music fields, send back. We
      // avoid clobbering other fields (caption, watermark, etc.) the user
      // might have set in the Visual Editor.
      api.getProject(projectId)
        .then((p) => {
          const merged = { ...(p?.style || {}), ...musicStyle };
          return api.updateStyle(projectId, merged);
        })
        .catch((e) => console.warn("[music] save failed:", e));
    }, 350);
    return () => clearTimeout(t);
  }, [projectId, musicStyle.music_path, musicStyle.music_volume, musicStyle.original_volume, musicStyle.music_start, musicStyle.music_end]);

  // ── Music handlers (ClipsStep) ──────────────────────────────────────────
  const handleMusicUpload = async (file) => {
    if (!file || !projectId) return;
    setUploadingMusic(true);
    setMusicUploadPct(0);
    try {
      const res = await api.uploadProjectMusic(projectId, file, (pct) => setMusicUploadPct(pct));
      setMusicMeta({
        url: res.url, name: res.filename, duration: res.duration || 0,
        peaks: res.peaks || [],
      });
      setMusicStyle((s) => ({
        ...s,
        music_path: res.path,
        music_start: 0.0,
        music_end: 0.0,
      }));
      setMusicExpanded(true);
    } catch (e) {
      alert(`Error subiendo música: ${e.message}`);
    } finally {
      setUploadingMusic(false);
      setMusicUploadPct(0);
    }
  };

  const handleMusicRemove = () => {
    setMusicMeta(null);
    setMusicStyle((s) => ({ ...s, music_path: null, music_start: 0, music_end: 0 }));
    if (musicAudioRef.current) {
      try { musicAudioRef.current.pause(); musicAudioRef.current.currentTime = 0; } catch (_) {}
    }
  };

  // Load which clips already have a cached Spanish version so the 🌐ES sub-row
  // shows up immediately on mount, AND grab the translated text so we can
  // render it inline / in the Guión modal without extra round-trips.
  useEffect(() => {
    if (!projectId) return;
    api.getTranslationStatus(projectId)
      .then((r) => {
        const ids = Object.entries(r?.translated || {})
          .filter(([, v]) => v)
          .map(([k]) => Number(k));
        setTranslatedClips(new Set(ids));
        // Normalize string keys → number keys so lookups by clip.id work.
        const dataObj = {};
        for (const [k, v] of Object.entries(r?.data || {})) dataObj[Number(k)] = v;
        setTranslationData(dataObj);
      })
      .catch(() => { /* no-op: endpoint missing or project not found */ });
  }, [projectId]);

  // Spanish batch export: translates the selected clips (if not already cached)
  // and exports them as separate _es.mp4 files. The English versions are
  // never touched. Polls /export/progress until done.
  const handleSpanishBatch = async () => {
    if (selectedClips.size === 0 || spanishBatchRunning) return;
    const ids = Array.from(selectedClips);
    setSpanishBatchRunning(true);
    setSpanishBatchProgress({ current: 0, total: ids.length });
    try {
      const start = await api.startSpanishExport(projectId, ids);
      if (start?.translation_errors?.length) {
        console.warn("[ES] translation warnings:", start.translation_errors);
      }
      // Poll progress until finished
      while (true) {
        await new Promise(r => setTimeout(r, 1500));
        const p = await api.getExportProgress(projectId);
        setSpanishBatchProgress({ current: p.current || 0, total: p.total || ids.length });
        if (p.status === "completed" || p.status === "idle") break;
      }
      // Refresh translation cache marker + translated text so the ES sub-rows
      // appear immediately with the new captions/transcripts.
      try {
        const s = await api.getTranslationStatus(projectId);
        const newIds = Object.entries(s?.translated || {})
          .filter(([, v]) => v)
          .map(([k]) => Number(k));
        setTranslatedClips(new Set(newIds));
        const dataObj = {};
        for (const [k, v] of Object.entries(s?.data || {})) dataObj[Number(k)] = v;
        setTranslationData(dataObj);
      } catch (_) {}
    } catch (e) {
      alert("Falló la generación en español: " + e.message);
    } finally {
      setSpanishBatchRunning(false);
      setSpanishBatchProgress({ current: 0, total: 0 });
    }
  };

  // Save creator_name (called on blur or Enter). Saves silently and flashes
  // a "✓ guardado" indicator for 1.5s.
  const saveCreator = async () => {
    if (!projectId) return;
    setCreatorSaving(true);
    try {
      await api.updateProjectCreator(projectId, creatorName.trim());
      setCreatorSavedTs(Date.now());
    } catch (err) {
      alert("No se pudo guardar el creador: " + err.message);
    } finally {
      setCreatorSaving(false);
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

  const handleReanalyzeBatch = async (lang = "en") => {
    if (selectedClips.size === 0) return;
    await flushCreatorBeforeReanalyze();
    const ids = Array.from(selectedClips);
    setReanalyzingBatch(true);
    setBatchProgress({ current: 0, total: ids.length, currentId: null });
    for (let i = 0; i < ids.length; i++) {
      const clipId = ids[i];
      setBatchProgress({ current: i + 1, total: ids.length, currentId: clipId });
      try {
        const result = await api.reanalyzeClip(projectId, clipId, lang);
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
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* ═══ Studio header ═══ */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 28px", borderBottom: "1px solid var(--st-line)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)", marginBottom: 5 }}>
            <span>proyecto</span><ChevronRight size={12} /><span style={{ color: "var(--st-muted)" }}>Clips</span>
          </div>
          <h1 style={{ margin: 0, fontFamily: "var(--st-display)", fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", color: "var(--st-text)" }}>
            Clips detectados <span style={{ color: "var(--st-faint)", fontWeight: 500 }}>{clips.length}</span>
          </h1>
        </div>
        <PromptEditButton
          promptKeys={["analysis_system", "reanalyze_clip", "alternate_captions", "verify_timestamps"]}
          title="Prompts · Análisis y reanálisis" />
        <button className="btn btn-primary" onClick={onNext}>
          <Download size={15} /> Exportar selección
        </button>
      </div>

      {/* ═══ Toolbar ═══ */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "13px 28px", borderBottom: "1px solid var(--st-line)", flexWrap: "wrap" }}>
        {/* Ordenar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--st-muted)" }}>Ordenar</span>
          <div style={{ display: "flex", background: "var(--st-alt)", borderRadius: 8, padding: 3, gap: 2 }}>
            {[{ v: "default", l: "Original" }, { v: "score_desc", l: "Score" }].map(({ v, l }) => (
              <span key={v} onClick={() => setSortBy(v)} style={{
                fontSize: 12, fontWeight: sortBy === v ? 600 : 500, padding: "5px 11px", borderRadius: 6, cursor: "pointer",
                background: sortBy === v ? "var(--st-surface)" : "transparent",
                color: sortBy === v ? "var(--st-text)" : "var(--st-muted)",
                boxShadow: sortBy === v ? "var(--st-shadow)" : "none",
              }}>{l}</span>
            ))}
          </div>
        </div>
        <div style={{ width: 1, height: 22, background: "var(--st-line)" }} />
        {/* Confianza */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--st-muted)" }}>Confianza</span>
          {[
            { v: "all", l: "Todos", c: null },
            { v: "match", l: "OK", c: "match" },
            { v: "no_audio", l: "Sin audio", c: "no_audio" },
            { v: "mismatch", l: "Revisar", c: "mismatch" },
          ].map(({ v, l, c }) => (
            <span key={v} onClick={() => setConfidenceFilter(v)} style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500,
              padding: "5px 10px", borderRadius: 7, cursor: "pointer",
              border: `1px solid ${confidenceFilter === v ? "var(--st-text)" : "var(--st-border)"}`,
              color: confidenceFilter === v ? "var(--st-text)" : "var(--st-muted)",
            }}>
              {c && <ConfDot conf={c} />}{l}
            </span>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setShowModels((v) => !v)} className="st-btn st-btn--ghost"
            title="Ver / cambiar el modelo de Gemini y chequear disponibilidad"
            style={{ padding: "6px 11px", fontSize: 12,
              border: `1px solid ${showModels ? "var(--st-accent)" : "var(--st-border)"}`,
              background: showModels ? "var(--st-soft)" : "transparent" }}>
            <Sparkles size={13} /> Modelo: {modelLabel(reanalyzeModel)}
            <ChevronDown size={13} style={{ transform: showModels ? "rotate(180deg)" : "none", transition: "transform .15s", color: "var(--st-faint)" }} />
          </button>
          <span style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)" }}>
            <Clock size={13} /> 9:16 · TikTok / Reels
          </span>
        </div>
      </div>

      {/* ═══ Model panel (toggled) — which Gemini model + availability check ═══ */}
      {showModels && (
        <div style={{ padding: "14px 28px", borderBottom: "1px solid var(--st-line)", background: "var(--st-soft)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <span className="st-eyebrow">Modelo de Gemini {switchingModel && <span style={{ fontFamily: "var(--st-mono)", color: "var(--st-faint)", textTransform: "none", letterSpacing: 0 }}>· cambiando…</span>}</span>
            <span style={{ fontSize: 11.5, color: "var(--st-muted)" }}>Se usa para analizar y re-analizar. “Check modelos” pinta cuáles están disponibles.</span>
          </div>
          <ModelSelector
            value={reanalyzeModel}
            onChange={handleModelChange}
            health={modelHealth}
            checking={checkingModels}
            onCheck={handleCheckModels}
          />
        </div>
      )}

      {/* ── 🎵 Música del proyecto ──────────────────────────────────────
          Project-wide music — applies to every clip on export. Per-clip
          overrides still live in the Visual Editor (Paso 3) under "Aplicar
          a: Este clip". Collapsible so the clips list stays the focus. */}
      <div style={{ padding: "12px 28px", borderBottom: "1px solid var(--st-line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}
             onClick={() => setMusicExpanded(v => !v)}>
          <Music2 size={14} style={{ color: musicStyle.music_path ? "var(--st-accent)" : "var(--st-muted)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--st-text)" }}>
            Música del proyecto
          </span>
          {musicStyle.music_path && musicMeta?.name && (
            <span style={{
              fontFamily: "var(--st-mono)", fontSize: 10.5, color: "var(--st-faint)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200,
            }}>
              {musicMeta.name}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <ChevronDown size={15} style={{
            color: "var(--st-faint)",
            transform: musicExpanded ? "rotate(180deg)" : "none",
            transition: "transform .15s",
          }} />
        </div>

        {musicExpanded && (
          <div style={{ marginTop: 10 }}>
            {!musicStyle.music_path ? (
              <>
                <p style={{ fontSize: 11.5, color: "var(--st-muted)", margin: "0 0 8px", lineHeight: 1.5 }}>
                  Subí una canción para que se mezcle en TODOS los clips al exportar. Para que un clip puntual tenga otra música o ninguna, usá el Visual Editor (Paso 3).
                </p>
                <button onClick={() => musicFileRef.current?.click()} disabled={uploadingMusic}
                  className="btn btn-secondary"
                  style={{ width: "100%", padding: "8px 0", fontSize: 12.5, justifyContent: "center" }}>
                  {uploadingMusic
                    ? `Subiendo… ${musicUploadPct}%`
                    : <><Music2 size={13} /> Subir música</>}
                </button>
              </>
            ) : (
              <>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 10px", marginBottom: 10,
                  background: "var(--st-soft)", border: "1px solid var(--st-line)",
                  borderRadius: 8,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, color: "var(--st-text)", fontWeight: 600,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{musicMeta?.name || "Pista cargada"}</div>
                    {musicMeta?.duration > 0 && (
                      <div style={{ fontSize: 10.5, color: "var(--st-faint)", fontFamily: "var(--st-mono)" }}>
                        {Math.floor(musicMeta.duration / 60)}:{String(Math.floor(musicMeta.duration % 60)).padStart(2, "0")}
                      </div>
                    )}
                  </div>
                  <button onClick={handleMusicRemove} title="Quitar música"
                    style={{
                      background: "transparent", border: "1px solid var(--st-border)",
                      borderRadius: 6, color: "var(--st-muted)", padding: "4px 8px",
                      fontSize: 11, cursor: "pointer",
                    }}>
                    Quitar
                  </button>
                </div>

                {musicMeta?.url && (
                  <audio
                    ref={musicAudioRef}
                    src={musicMeta.url}
                    controls
                    preload="metadata"
                    style={{ width: "100%", height: 32, marginBottom: 12 }}
                    onLoadedMetadata={(e) => {
                      const d = e.currentTarget.duration;
                      if (isFinite(d) && d > 0 && (!musicMeta.duration || Math.abs(musicMeta.duration - d) > 0.1)) {
                        setMusicMeta((m) => m ? { ...m, duration: d } : m);
                      }
                    }}
                  />
                )}

                {/* Volumes side-by-side to save vertical space here */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
                  {[
                    { label: "Vol música", value: musicStyle.music_volume, key: "music_volume", def: 0.8 },
                    { label: "Vol original", value: musicStyle.original_volume, key: "original_volume", def: 1.0 },
                  ].map(({ label, value, key, def }) => (
                    <div key={key}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--st-muted)", marginBottom: 3 }}>
                        <span>{label}</span>
                        <span style={{ fontFamily: "var(--st-mono)", color: "var(--st-text)" }}>{Math.round(value * 100)}%</span>
                      </div>
                      <input type="range" min={0} max={2} step={0.05} value={value}
                        onChange={(e) => setMusicStyle((s) => ({ ...s, [key]: parseFloat(e.target.value) }))}
                        onDoubleClick={() => setMusicStyle((s) => ({ ...s, [key]: def }))}
                        style={{ width: "100%" }}
                        title="Doble click para resetear" />
                    </div>
                  ))}
                </div>

                {/* Trim — only when we know the duration */}
                {musicMeta?.duration > 0.5 && (
                  <div style={{ padding: "8px 10px", background: "var(--st-soft)", border: "1px solid var(--st-line)", borderRadius: 8 }}>
                    <div style={{ fontSize: 10.5, color: "var(--st-faint)", marginBottom: 6, fontFamily: "var(--st-mono)", letterSpacing: ".06em" }}>
                      ↳ ¿QUÉ PARTE DE LA PISTA QUERÉS QUE SUENE?
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--st-muted)", marginBottom: 3 }}>
                          <span>Empieza en</span>
                          <span style={{ fontFamily: "var(--st-mono)", color: "var(--st-text)" }}>{(musicStyle.music_start || 0).toFixed(1)}s</span>
                        </div>
                        <input type="range" min={0} max={Math.max(0.5, musicMeta.duration - 0.1)} step={0.1}
                          value={musicStyle.music_start || 0}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setMusicStyle((s) => ({
                              ...s,
                              music_start: Math.min(v, (s.music_end || musicMeta.duration) - 0.1),
                            }));
                          }}
                          style={{ width: "100%" }} />
                      </div>
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--st-muted)", marginBottom: 3 }}>
                          <span>Termina en</span>
                          <span style={{ fontFamily: "var(--st-mono)", color: "var(--st-text)" }}>
                            {(musicStyle.music_end || 0) === 0 ? "fin natural" : `${musicStyle.music_end.toFixed(1)}s`}
                          </span>
                        </div>
                        <input type="range" min={0} max={musicMeta.duration} step={0.1}
                          value={musicStyle.music_end || 0}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setMusicStyle((s) => ({
                              ...s,
                              music_end: v > 0 ? Math.max(v, (s.music_start || 0) + 0.1) : 0,
                            }));
                          }}
                          style={{ width: "100%" }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--st-faint)", marginTop: 4, fontFamily: "var(--st-mono)" }}>
                      Termina en 0 → suena hasta el final natural de la canción
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {/* Hidden file input for the music upload button */}
      <input ref={musicFileRef} type="file" accept="audio/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleMusicUpload(f); e.target.value = ""; }} />

      {/* batch + model bar (only when clips selected) */}
      {selectedClips.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 28px", borderBottom: "1px solid var(--st-line)", flexWrap: "wrap", background: "var(--st-soft)" }}>
          <span style={{ fontSize: 13, color: "var(--st-muted)" }}>
            {selectedClips.size} seleccionado{selectedClips.size > 1 ? "s" : ""}
          </span>
          {reanalyzingBatch ? (
            <span style={{ fontSize: 12.5, color: "var(--st-text)", fontFamily: "var(--st-mono)" }}>
              Analizando {batchProgress.current}/{batchProgress.total}…
            </span>
          ) : spanishBatchRunning ? (
            <span style={{ fontSize: 12.5, color: "var(--st-text)", fontFamily: "var(--st-mono)" }}>
              🇪🇸 Traduciendo + exportando {spanishBatchProgress.current}/{spanishBatchProgress.total}…
            </span>
          ) : (
            <>
              <button className="btn btn-secondary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => handleReanalyzeBatch("en")}>
                <RefreshCw size={13} /> Re-analizar EN
              </button>
              <button className="btn btn-secondary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => handleReanalyzeBatch("es")}>
                🇪🇸 Re-analizar ES
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: "5px 12px", fontSize: 12 }}
                onClick={handleSpanishBatch}
                title="Genera una segunda versión con caption y subtítulos traducidos al español. La versión en inglés no se toca."
              >
                🇪🇸 Generar versión en español
              </button>
              <button className="btn btn-secondary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setSelectedClips(new Set())}>
                Deseleccionar
              </button>
              {/* Creator name — Gemini incluye este nombre en los captions al reanalizar */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8, paddingLeft: 12, borderLeft: "1px solid var(--st-line)" }}>
                <span style={{ fontSize: 12, color: "var(--st-muted)" }}>Creador:</span>
                <input
                  type="text"
                  value={creatorName}
                  onChange={(e) => setCreatorName(e.target.value)}
                  onBlur={saveCreator}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
                  placeholder="p. ej. Sophie Rain"
                  title="Nombre del creador para incluir en captions al reanalizar. Varios separados por coma."
                  style={{
                    fontFamily: "var(--st-ui)", fontSize: 12, padding: "4px 9px",
                    background: "var(--st-surface)", border: "1px solid var(--st-line)",
                    color: "var(--st-text)", borderRadius: 6, width: 180,
                    outline: "none",
                  }}
                />
                {creatorSaving && (
                  <span style={{ fontSize: 11, color: "var(--st-faint)", fontFamily: "var(--st-mono)" }}>guardando…</span>
                )}
                {!creatorSaving && creatorSavedTs > 0 && Date.now() - creatorSavedTs < 1500 && (
                  <span style={{ fontSize: 11, color: "var(--st-ok, #6dd58c)", fontFamily: "var(--st-mono)" }}>✓ guardado</span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ Clip rows ═══ */}
      <div style={{ padding: "8px 16px" }}>
        {filteredClips.map((clip, i) => {
          const isSelected = selectedClips.has(clip.id);
          const isBeingAnalyzed = reanalyzingBatch && batchProgress.currentId === clip.id;
          const isDragOver = dragOverId === clip.id;
          const isDragging = draggedId === clip.id;
          const hasSpanish = translatedClips.has(clip.id);
          return (
            <Fragment key={clip.id}>
            <div
              draggable
              onDragStart={(e) => handleDragStart(e, clip.id)}
              onDragOver={(e) => handleDragOver(e, clip.id)}
              onDrop={(e) => handleDrop(e, clip.id)}
              onDragEnd={handleDragEnd}
              onClick={() => toggleSelect(clip.id)}
              style={{
                display: "flex", alignItems: "center", gap: 16, padding: "14px 12px",
                borderBottom: i < filteredClips.length - 1 ? "1px solid var(--st-line)" : "none",
                borderRadius: 10, cursor: "pointer",
                background: isSelected ? "var(--st-soft)" : isDragOver ? "var(--st-alt)" : "transparent",
                opacity: isDragging ? 0.4 : 1, transition: "background .12s, opacity .12s",
              }}
            >
              <span style={{ color: "var(--st-faint)", display: "grid", cursor: "grab" }}><GripVertical size={16} /></span>
              <div style={{
                width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                border: `1.5px solid ${isSelected ? "var(--st-accent)" : "var(--st-border)"}`,
                background: isSelected ? "var(--st-accent)" : "transparent",
                display: "grid", placeItems: "center",
              }}>{isSelected && <Check size={13} style={{ color: "var(--st-on-accent)" }} />}</div>
              <span style={{ fontFamily: "var(--st-mono)", fontSize: 12, color: "var(--st-faint)", width: 20, flexShrink: 0 }}>{String(clip.id).padStart(2, "0")}</span>
              {/* thumbnail */}
              <div style={{ width: 38, height: 38 * 16 / 9, borderRadius: 7, background: "var(--st-alt)", border: "1px solid var(--st-border)", flexShrink: 0, display: "grid", placeItems: "center", position: "relative" }}>
                <Play size={13} style={{ color: "var(--st-faint)" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
                  <ConfDot conf={clip.match_confidence} />
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--st-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clip.description}</span>
                  {clip.music_vibe && (
                    <span title={`Música sugerida: ${clip.music_vibe}`} style={{
                      flexShrink: 0, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                      background: "var(--st-soft)", border: "1px solid var(--st-line)", color: "var(--st-muted)",
                    }}>
                      🎵 {clip.music_vibe}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13.5, color: "var(--st-muted)", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {isBeingAnalyzed ? "Re-analizando…" : clip.viral_caption
                    ? `“${stripCaptionMarkers(clip.viral_caption)}”`
                    : <span style={{ color: "#f59e0b" }}>Sin analizar — usá ↻ para pedir caption a Gemini</span>}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
                <span style={{ fontFamily: "var(--st-mono)", fontSize: 11.5, color: "var(--st-muted)" }}>{clip.duration.toFixed(0)}s</span>
                <span style={{ fontFamily: "var(--st-mono)", fontSize: 11.5, color: "var(--st-faint)" }}>{formatTime(clip.start_time)}–{formatTime(clip.end_time)}</span>
                {clip.viral_score > 0 && <ScoreBadge score={clip.viral_score} />}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                {[
                  { ic: quickExportId === clip.id ? <Loader2 size={16} style={{ animation: "st-spin 1s linear infinite" }} /> : <Download size={16} />, title: "Descargar clip 16:9 sin texto (Twitter)", fn: () => handleQuickExport(clip) },
                  { ic: tweet_text_map[clip.id] ? <span style={{ fontSize: 13 }}>🐦</span> : <span style={{ fontSize: 13, opacity: 0.65 }}>🐦</span>, title: "Tweet — ver / generar texto (280)", fn: () => handleOpenTweet(clip) },
                  { ic: copiedTweetId === clip.id ? <Check size={16} style={{ color: "var(--st-accent)" }} /> : <Copy size={16} />, title: "Copiar texto para publicar", fn: () => handleCopyTweet(clip) },
                  { ic: <Play size={16} />, title: "Reproducir", fn: () => handlePlayClip(clip) },
                  { ic: <Scissors size={16} />, title: "Editar (zoom/trim)", fn: () => setEditorClip(clip) },
                  { ic: <Pencil size={16} />, title: "Editar caption", fn: () => { setEditingClip(clip); setEditText(clip.viral_caption); } },
                  { ic: <FileText size={16} />, title: "Corregir subtítulos", fn: () => openSubEditor(clip) },
                  { ic: <RefreshCw size={16} />, title: "Re-analizar (EN)", fn: () => handleReanalyze(clip, "en") },
                  { ic: <span style={{ fontSize: 13 }}>🇪🇸</span>, title: "Re-analizar (ES)", fn: () => handleReanalyze(clip, "es") },
                ].map((a, k) => (
                  <span key={k} title={a.title} onClick={a.fn}
                    style={{ width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: 8, color: "var(--st-muted)", cursor: "pointer" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--st-alt)"; e.currentTarget.style.color = "var(--st-text)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--st-muted)"; }}>
                    {a.ic}
                  </span>
                ))}
              </div>
            </div>
            {/* Spanish sub-row — appears only after a clip has been translated.
                Visually nested under the English row so the pairing is obvious;
                clicking it does NOT toggle selection (own onClick stops bubbling). */}
            {hasSpanish && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: "flex", alignItems: "center", gap: 16,
                  padding: "8px 12px 10px 56px",   // indent under the EN row's content
                  borderBottom: i < filteredClips.length - 1 ? "1px solid var(--st-line)" : "none",
                  background: "var(--st-soft)",
                  borderRadius: 10,
                  marginTop: -6, marginBottom: 4,
                  cursor: "default",
                }}
              >
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  fontSize: 11, fontWeight: 700, fontFamily: "var(--st-mono)",
                  padding: "3px 8px", borderRadius: 6,
                  background: "var(--st-accent, #d4a64a)", color: "var(--st-on-accent, #1a1a1a)",
                  flexShrink: 0,
                }}>
                  🌐 ES
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: "var(--st-text)", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    “{translationData[clip.id]?.caption_es || "(caption en español no disponible)"}”
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  {[
                    { ic: <Play size={16} />, title: "Reproducir versión en español (10s)", fn: () => handlePlayClipEs(clip) },
                    { ic: <FileText size={16} />, title: "Ver guión traducido vs original", fn: () => setScriptEsClip(clip) },
                  ].map((a, k) => (
                    <span key={k} title={a.title} onClick={a.fn}
                      style={{ width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: 8, color: "var(--st-muted)", cursor: "pointer" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--st-alt)"; e.currentTarget.style.color = "var(--st-text)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--st-muted)"; }}>
                      {a.ic}
                    </span>
                  ))}
                </div>
              </div>
            )}
            </Fragment>
          );
        })}
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
                "{stripCaptionMarkers(scriptViewClip.viral_caption)}"
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
                  handleReanalyze(clip, "en");
                }}
                disabled={reanalyzingClip === scriptViewClip.id || reanalyzingBatch}
              >
                <RefreshCw size={13} /> Reanalizar EN
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  const clip = scriptViewClip;
                  setScriptViewClip(null);
                  handleReanalyze(clip, "es");
                }}
                disabled={reanalyzingClip === scriptViewClip.id || reanalyzingBatch}
              >
                🇪🇸 Reanalizar ES
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🐦 Tweet text modal — generate / view / copy the 280-char post text */}
      {tweetClip && (
        <div className="modal-overlay" onClick={() => setTweetClip(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h3>🐦 Tweet · Clip {tweetClip.id}</h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: 14, fontSize: 13 }}>
              {formatTime(tweetClip.start_time)} — {formatTime(tweetClip.end_time)}
              {" · "}
              <span style={{ color: "#aaa" }}>{tweetClip.description}</span>
            </p>

            <div style={{
              background: "#0a0a0a", border: "1px solid #2a2a2a",
              borderRadius: 10, padding: "12px 14px", marginBottom: 8,
            }}>
              <textarea
                value={tweetText}
                onChange={(e) => setTweetText(e.target.value.slice(0, 280))}
                placeholder={tweetGenerating ? "Generando…" : "Presioná “Generar tweet” para que Gemini escriba el texto (máx 280 caracteres)."}
                disabled={tweetGenerating}
                rows={5}
                style={{
                  width: "100%", boxSizing: "border-box", resize: "vertical",
                  background: "transparent", border: "none", outline: "none",
                  color: "#fff", fontSize: 14, lineHeight: 1.55, fontFamily: "inherit",
                }}
              />
            </div>
            <div style={{
              display: "flex", justifyContent: "flex-end", marginBottom: 14,
              fontSize: 12, fontFamily: "var(--mono, monospace)",
              color: tweetText.length > 280 ? "#ef4444" : tweetText.length >= 250 ? "#f59e0b" : "var(--text-muted)",
            }}>
              {tweetText.length}/280
            </div>

            <div className="btn-group">
              <button className="btn btn-secondary" onClick={() => setTweetClip(null)}>
                Cerrar
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleGenerateTweet}
                disabled={tweetGenerating}
                style={{ marginLeft: "auto" }}
              >
                {tweetGenerating ? <><Loader2 size={13} style={{ animation: "st-spin 1s linear infinite" }} /> Generando…</> : "🔄 Generar tweet"}
              </button>
              <button className="btn btn-primary" onClick={handleCopyTweetModal} disabled={!tweetText.trim()}>
                {tweetCopied ? "✓ Copiado" : "📋 Copiar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spanish Transcript / Script Modal — side-by-side English vs Spanish
          so the user can verify the translation without opening the .mp4. */}
      {scriptEsClip && (
        <div className="modal-overlay" onClick={() => setScriptEsClip(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
            <h3>📄 Guión ES · Clip {scriptEsClip.id}</h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: 14, fontSize: 13 }}>
              {formatTime(scriptEsClip.start_time)} — {formatTime(scriptEsClip.end_time)}
              {" · "}
              <span style={{ color: "#aaa" }}>{scriptEsClip.description}</span>
            </p>

            {/* Caption side-by-side */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div style={{
                background: "#111", border: "1px solid #2a2a2a",
                borderRadius: 10, padding: "12px 14px",
              }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
                  🇬🇧 Caption (EN)
                </div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#fff", lineHeight: 1.4 }}>
                  "{stripCaptionMarkers(scriptEsClip.viral_caption)}"
                </p>
              </div>
              <div style={{
                background: "#111", border: "2px solid var(--st-accent, #d4a64a)",
                borderRadius: 10, padding: "12px 14px",
              }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
                  🇪🇸 Caption (ES)
                </div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#fff", lineHeight: 1.4 }}>
                  "{translationData[scriptEsClip.id]?.caption_es || "(no disponible)"}"
                </p>
              </div>
            </div>

            {/* Whisper transcript side-by-side */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div style={{
                background: "#0a0a0a", border: "1px solid #2a2a2a",
                borderRadius: 10, padding: "12px 14px",
              }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
                  🎙️ Subtítulos (EN — Whisper)
                </div>
                <p style={{ margin: 0, fontSize: 13, color: "#ddd", lineHeight: 1.6, fontStyle: "italic" }}>
                  {translationData[scriptEsClip.id]?.transcript_en || scriptEsClip.transcript_snippet || "(sin diálogo detectado)"}
                </p>
              </div>
              <div style={{
                background: "#0a0a0a", border: "1px solid var(--st-accent, #d4a64a)",
                borderRadius: 10, padding: "12px 14px",
              }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
                  🎙️ Subtítulos (ES — traducido)
                </div>
                <p style={{ margin: 0, fontSize: 13, color: "#ddd", lineHeight: 1.6, fontStyle: "italic" }}>
                  {translationData[scriptEsClip.id]?.transcript_es || "(sin subtítulos — la traducción solo cubre el caption)"}
                </p>
              </div>
            </div>

            <div className="btn-group">
              <button className="btn btn-secondary" onClick={() => setScriptEsClip(null)}>
                Cerrar
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const c = scriptEsClip;
                  setScriptEsClip(null);
                  handlePlayClipEs(c);
                }}
              >
                ▶ Reproducir ES (10s)
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

      {/* Video Player Modal — Spanish version preview */}
      {playingEsClip && (
        <div className="modal-overlay" onClick={() => { setPlayingEsClip(null); setVideoEsUrl(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h3>🇪🇸 Clip {playingEsClip.id} (ES): {playingEsClip.description}</h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: 12, fontSize: 13 }}>
              {formatTime(playingEsClip.start_time)} — {formatTime(playingEsClip.end_time)} ({playingEsClip.duration.toFixed(0)}s)
              {" · "}
              <span style={{ color: "var(--st-accent, #d4a64a)", fontWeight: 600 }}>caption + subtítulos en español</span>
            </p>
            {loadingVideoEs && (
              <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text-muted)" }}>
                <div className="loading-spinner" style={{ margin: "0 auto 12px" }}></div>
                <p style={{ fontSize: 13 }}>Generando preview en español… (primera vez ~15s)</p>
              </div>
            )}
            {videoEsUrl && (
              <video
                key={videoEsUrl}
                controls
                autoPlay
                style={{ width: "100%", borderRadius: 10, background: "black", maxHeight: 400, display: loadingVideoEs ? "none" : "block" }}
                src={videoEsUrl}
                onCanPlay={() => setLoadingVideoEs(false)}
                onError={() => {
                  setLoadingVideoEs(false);
                  alert("No se pudo generar el preview en español. ¿Está traducido el clip?");
                  setVideoEsUrl(null);
                }}
              />
            )}
            <div className="btn-group">
              <button className="btn btn-secondary" onClick={() => { setPlayingEsClip(null); setVideoEsUrl(null); }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video Player Modal */}
      {playingClip && (
        <div className="modal-overlay" onClick={() => { setPlayingClip(null); setVideoUrl(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h3>▶ Clip {playingClip.id}: {playingClip.description}</h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: 12, fontSize: 13, fontFamily: "var(--st-mono)" }}>
              {formatTime(trimStart)} — {formatTime(trimEnd)} ({(trimEnd - trimStart).toFixed(1)}s)
            </p>
            {videoUrl && (
              <video
                key={playingClip.id}
                ref={playerRef}
                controls
                autoPlay
                style={{ width: "100%", borderRadius: 10, background: "black", maxHeight: 360, display: "block" }}
                src={videoUrl}
                onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = trimStart; } catch {} }}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  // Loop within the (possibly re-trimmed) range to re-watch.
                  if (v.currentTime >= trimEnd || v.currentTime < trimStart - 0.5) {
                    try { v.currentTime = trimStart; } catch {}
                  }
                }}
                onError={() => {
                  alert("No se pudo reproducir el video. ¿El archivo fuente sigue en disco?");
                  setVideoUrl(null);
                }}
              />
            )}
            {/* ── Re-trim controls (instant, no render) ── */}
            <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 10, background: "var(--st-soft, rgba(255,255,255,.04))", border: "1px solid var(--st-line, rgba(255,255,255,.08))" }}>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
                ✂️ Ajustá el recorte: pausá/movés el video al punto que querés y marcá inicio o fin.
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <button className="btn btn-secondary" style={{ padding: "6px 10px", fontSize: 12 }}
                  onClick={() => { const t = playerRef.current?.currentTime ?? trimStart; setTrimStart(Math.max(0, Math.min(t, trimEnd - 0.5))); }}>
                  ⏮ Inicio aquí
                </button>
                <button className="btn btn-secondary" style={{ padding: "6px 8px", fontSize: 12 }}
                  onClick={() => setTrimStart((s) => Math.max(0, Math.min(s - 0.5, trimEnd - 0.5)))}>−0.5s</button>
                <button className="btn btn-secondary" style={{ padding: "6px 8px", fontSize: 12 }}
                  onClick={() => setTrimStart((s) => Math.min(s + 0.5, trimEnd - 0.5))}>+0.5s</button>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: "var(--st-mono)", fontSize: 12, color: "var(--text-muted)" }}>inicio {formatTime(trimStart)}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn btn-secondary" style={{ padding: "6px 10px", fontSize: 12 }}
                  onClick={() => { const t = playerRef.current?.currentTime ?? trimEnd; setTrimEnd(Math.max(trimStart + 0.5, t)); }}>
                  Fin aquí ⏭
                </button>
                <button className="btn btn-secondary" style={{ padding: "6px 8px", fontSize: 12 }}
                  onClick={() => setTrimEnd((e2) => Math.max(e2 - 0.5, trimStart + 0.5))}>−0.5s</button>
                <button className="btn btn-secondary" style={{ padding: "6px 8px", fontSize: 12 }}
                  onClick={() => setTrimEnd((e2) => e2 + 0.5)}>+0.5s</button>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: "var(--st-mono)", fontSize: 12, color: "var(--text-muted)" }}>fin {formatTime(trimEnd)}</span>
              </div>
            </div>
            <div className="btn-group" style={{ marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={() => { setPlayingClip(null); setVideoUrl(null); }}>
                Cerrar
              </button>
              {(Math.abs(trimStart - playingClip.start_time) > 0.05 || Math.abs(trimEnd - playingClip.end_time) > 0.05) && (
                <>
                  <button className="btn btn-secondary" onClick={() => { setTrimStart(playingClip.start_time); setTrimEnd(playingClip.end_time); }}>
                    Deshacer
                  </button>
                  <button className="btn btn-primary" onClick={handleSaveTrim} disabled={trimSaving}>
                    {trimSaving ? "Guardando…" : "Guardar recorte"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Subtitle correction modal — fix Whisper words (keeps timestamps) */}
      {subEditClip && (
        <div className="modal-overlay" onClick={() => setSubEditClip(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h3>📝 Corregir subtítulos · Clip {subEditClip.id}</h3>
            <p style={{ color: "var(--st-muted)", fontSize: 12.5, margin: "4px 0 14px" }}>
              Arreglá las palabras que Whisper transcribió mal (nombres, slang). Se mantienen los tiempos, así los subtítulos quedan sincronizados.
            </p>

            {subLoading ? (
              <div style={{ padding: "26px 0", textAlign: "center", color: "var(--st-muted)", fontSize: 13 }}>
                <Loader2 size={22} style={{ animation: "st-spin 1s linear infinite" }} /> Cargando…
              </div>
            ) : !subHasTranscript ? (
              <div style={{ padding: "20px 0", textAlign: "center", color: "var(--st-muted)", fontSize: 13 }}>
                Este proyecto no tiene transcripción (Whisper no corrió o falló), así que no hay subtítulos que corregir.
              </div>
            ) : subWords.length === 0 ? (
              <div style={{ padding: "20px 0", textAlign: "center", color: "var(--st-muted)", fontSize: 13 }}>
                No hay diálogo detectado en el rango de este clip.
              </div>
            ) : (
              <>
                {/* Global find & replace */}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                  <input className="st-input" placeholder="Buscar palabra…" value={subFind}
                    onChange={(e) => setSubFind(e.target.value)} style={{ flex: 1, minWidth: 120, fontSize: 13 }} />
                  <span style={{ color: "var(--st-faint)" }}>→</span>
                  <input className="st-input" placeholder="Reemplazar por…" value={subReplace}
                    onChange={(e) => setSubReplace(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && doSubReplace()}
                    style={{ flex: 1, minWidth: 120, fontSize: 13 }} />
                  <button className="st-btn st-btn--ghost" onClick={doSubReplace} disabled={!subFind.trim() || subSaving}
                    style={{ padding: "8px 12px", fontSize: 12 }}>Reemplazar todo</button>
                </div>

                {/* Per-word editor */}
                <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexWrap: "wrap", gap: 6, padding: "10px", border: "1px solid var(--st-line)", borderRadius: 9, background: "var(--st-soft)" }}>
                  {subWords.map((w, idx) => {
                    const changed = w.word !== w.orig;
                    return (
                      <input
                        key={w.i}
                        value={w.word}
                        onChange={(e) => setSubWords((prev) => prev.map((p, j) => j === idx ? { ...p, word: e.target.value } : p))}
                        title={`${w.start.toFixed(1)}s`}
                        size={Math.max(3, (w.word || "").length)}
                        style={{
                          fontSize: 13, padding: "4px 7px", borderRadius: 6, fontFamily: "var(--st-ui)",
                          background: "var(--st-surface)", color: "var(--st-text)",
                          border: `1px solid ${changed ? "var(--st-accent)" : "var(--st-border)"}`,
                          outline: "none", minWidth: 30,
                        }} />
                    );
                  })}
                </div>
                <p style={{ fontSize: 11, color: "var(--st-faint)", margin: "8px 0 0" }}>
                  {subWords.filter((w) => w.word !== w.orig).length} palabra(s) modificada(s). Las que cambiaste se marcan con borde dorado.
                </p>
              </>
            )}

            <div className="btn-group" style={{ marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setSubEditClip(null)}>Cerrar</button>
              {subHasTranscript && subWords.length > 0 && (
                <button className="btn btn-primary" onClick={saveSubWords} disabled={subSaving}>
                  {subSaving ? "Guardando…" : "Guardar cambios"}
                </button>
              )}
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
    caption_font: "trebuchet",
    caption_box_radius: 0.40,
    caption_box_opacity: 0.95,
    caption_box_color: "#FFFFFF",
    caption_box_pad_x: 30,
    caption_box_pad_y: 6,
    subtitle_style: "none",
    subtitle_size_scale: 1.0,
    subtitle_y: 0.0,         // -0.5 (down) to +0.5 (up) — offset from style default
    visual_filter: "none",
    background_style: "blur",
    no_text: false,
    no_emojis: false,
    // Auto-reframe (face tracking). Off by default — user enables per-clip
    // from the 🎯 Auto-encuadre panel after analyzing faces.
    auto_reframe_enabled: false,
    auto_reframe_mode: "all",           // "all" | "biggest" | "follow"
    auto_reframe_follow_id: null,
    auto_reframe_padding: 0.30,
    auto_reframe_smoothing: 0.85,
    // Background music — mixed in as a fast post-step on export. Follows the
    // existing "Aplicar a" scope (Todos / Este clip / Varios), so a project
    // can have a default track AND a specific clip can override with another.
    music_path: null,
    music_volume: 0.8,
    original_volume: 1.0,
    music_start: 0.0,     // music seconds — where the slice starts in source
    music_end: 0.0,       // music seconds — 0 means "play to natural end"
  });
  const [exportStatus, setExportStatus] = useState("idle"); // idle, exporting, done
  const [exportMode, setExportMode] = useState("tiktok"); // "tiktok" | "instagram"
  const [progress, setProgress] = useState({ current: 0, total: 0, current_file: "" });
  const [exportedFiles, setExportedFiles] = useState([]);
  const [selectedClip, setSelectedClip] = useState(clips[0] || null);
  const [editorClip, setEditorClip] = useState(null);  // 🎬 Editar modal
  // Inline caption-text editor (opens with the "Editar texto" button)
  const [editingCaption, setEditingCaption] = useState(null);  // { id, text } | null
  const [savingCaption, setSavingCaption] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [selectedClipIds, setSelectedClipIds] = useState(new Set(clips.map(c => c.id)));
  // Visual Editor preview language. "en" (default) shows the original caption +
  // burned-in Whisper subs. "es" switches the preview to caption_es + words_es
  // so the user can adjust subtitle style / position / size while seeing the
  // translated version directly. Toggle does NOT change StyleConfig — it only
  // routes preview requests to the _es endpoint variants.
  const [previewLanguage, setPreviewLanguage] = useState("en");
  // Which clip IDs already have a cached Spanish translation (caption_es +
  // words_es). Powers the "Play ES" buttons and the inline "Traducir este clip"
  // call-to-action when the user toggles ES on an untranslated clip.
  const [editorTranslated, setEditorTranslated] = useState(new Set());
  const [translatingNow, setTranslatingNow] = useState(false);

  // ── Music state (Visual Editor / Paso 3) ────────────────────────────────
  // The actual path/volumes live on `style` (so they round-trip through
  // persistStyle and follow the "Aplicar a" scope). These locals only hold
  // ephemeral UI things: upload status, the preview audio element ref, the
  // file's natural duration (for clamping the trim sliders), the waveform
  // peaks for the visual bar, and a friendly display name.
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [musicUploadPct, setMusicUploadPct] = useState(0);
  const [musicMeta, setMusicMeta] = useState(null);   // {url, name, duration, peaks}
  const musicAudioRef = useRef(null);
  const musicFileRef = useRef(null);

  // ── Auto-reframe per-clip state ─────────────────────────────────────────
  // Each AI clip has its own face_track because each clip covers a different
  // range of the source video. clipFaceTracks is keyed by clip_id and stores
  // { people, samples, width, height } as returned by /analyze-faces.
  // The reframe knobs (mode/padding/smoothing/follow_id/enabled) live on the
  // central `style` state below — written through `setStyle` so the existing
  // debounced persist effect picks them up and saves them to backend.
  // Preview is delivered through the existing Play clip flow: when
  // style.auto_reframe_enabled is on, the backend's /video-preview endpoint
  // routes through the real export pipeline instead of the fast preview path.
  const [clipFaceTracks, setClipFaceTracks] = useState({});  // {clipId: {people, samples, width, height}}
  const [analyzingFacesId, setAnalyzingFacesId] = useState(null);  // clipId being analyzed
  const [analyzeFacesError, setAnalyzeFacesError] = useState(null);

  // Load translation status once on mount so we know which clips already
  // have an ES cache (lets the EN/ES toggle Just Work for those clips).
  useEffect(() => {
    if (!projectId) return;
    api.getTranslationStatus(projectId)
      .then((r) => {
        const ids = Object.entries(r?.translated || {})
          .filter(([, v]) => v)
          .map(([k]) => Number(k));
        setEditorTranslated(new Set(ids));
      })
      .catch(() => {});
  }, [projectId]);

  // Translate the currently selected clip on demand (when user toggles ES on
  // a clip that doesn't have a cached translation yet). Idempotent — backend
  // returns cached data if already translated.
  // ── Auto-reframe handlers (Visual Editor / Paso 3) ───────────────────────
  // Each AI clip is analyzed independently because each covers a different
  // range of the source video. After analysis, the resulting face_track lives
  // server-side on the clip; we also keep a lightweight copy in
  // clipFaceTracks for the UI (people grid + thumbnails).
  const handleAnalyzeClipFaces = async (clip) => {
    if (!clip || analyzingFacesId === clip.id) return;
    setAnalyzingFacesId(clip.id);
    setAnalyzeFacesError(null);
    try {
      const r = await api.clipAnalyzeFaces(projectId, clip.id);
      setClipFaceTracks((prev) => ({
        ...prev,
        [clip.id]: {
          people: r.people || [],
          samples: r.samples || [],
          width: r.width || 0,
          height: r.height || 0,
        },
      }));
      // If exactly one person was detected, default-pick them for follow mode.
      if ((r.people || []).length === 1) {
        setStyle((s) => ({ ...s, auto_reframe_follow_id: r.people[0].id }));
      }
    } catch (e) {
      setAnalyzeFacesError(e.message || "Falló el análisis de caras");
    } finally {
      setAnalyzingFacesId(null);
    }
  };

  // ── Music handlers ──────────────────────────────────────────────────────
  const handleMusicUpload = async (file) => {
    if (!file || !projectId) return;
    setUploadingMusic(true);
    setMusicUploadPct(0);
    try {
      const res = await api.uploadProjectMusic(projectId, file, (pct) => setMusicUploadPct(pct));
      setMusicMeta({
        url: res.url, name: res.filename, duration: res.duration || 0,
        peaks: res.peaks || [],
      });
      // Default trim = whole track. Persisted through the existing style effect.
      setStyle((s) => ({
        ...s,
        music_path: res.path,
        music_start: 0.0,
        music_end: 0.0,
      }));
    } catch (e) {
      alert(`Error subiendo música: ${e.message}`);
    } finally {
      setUploadingMusic(false);
      setMusicUploadPct(0);
    }
  };

  // Sync the local musicMeta when style.music_path changes (clip switch /
  // scope change / project reload). If the path is set but we don't have the
  // matching meta (e.g. backend restart, or the user switched to a clip whose
  // override has a different track), derive a minimal entry from the path —
  // the <audio> element will fill in duration via onLoadedMetadata so the
  // trim sliders become available.
  useEffect(() => {
    if (!style.music_path) {
      if (musicMeta) setMusicMeta(null);
      return;
    }
    // Already matches?
    const basename = String(style.music_path).split(/[\\/]/).pop();
    if (musicMeta && musicMeta.url && musicMeta.url.includes(basename)) return;
    setMusicMeta({
      url: projectId ? api.getProjectMusicUrl(projectId, basename) : null,
      name: basename,
      duration: 0,
      peaks: [],
    });
  }, [style.music_path, projectId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const handleMusicRemove = () => {
    setMusicMeta(null);
    setStyle((s) => ({ ...s, music_path: null, music_start: 0, music_end: 0 }));
    if (musicAudioRef.current) {
      try { musicAudioRef.current.pause(); musicAudioRef.current.currentTime = 0; } catch (_) {}
    }
  };

  const handleTranslateCurrentClip = async () => {
    if (!selectedClip || translatingNow) return;
    setTranslatingNow(true);
    try {
      await api.translateClipOnly(projectId, selectedClip.id);
      setEditorTranslated((prev) => {
        const next = new Set(prev);
        next.add(selectedClip.id);
        return next;
      });
      // Force any open preview to refresh now that ES data exists.
      if (previewUrl) {
        const isIg = previewUrl.includes("instagram-preview");
        setPreviewUrl(isIg
          ? api.getInstagramPreviewEsUrl(projectId, selectedClip.id)
          : api.getPreviewEsUrl(projectId, selectedClip.id));
      }
      if (videoPreviewUrl) {
        setVideoPreviewUrl(api.getVideoPreviewEsUrl(projectId, selectedClip.id));
      }
    } catch (e) {
      alert("Traducción falló: " + e.message);
    } finally {
      setTranslatingNow(false);
    }
  };

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

  // ─── "Aplicar a" scope: where style edits go ───────────────────────────────
  // "all" = project.style (every clip) · "clip" = the selected clip's override ·
  // "selected" = the override of every checked clip. Per-clip overrides are kept
  // client-side in clipStyleMap and persisted to the backend per clip.
  const [applyScope, setApplyScope] = useState("all");
  const [clipStyleMap, setClipStyleMap] = useState({}); // { [clipId]: StyleConfig }
  const baseStyleRef = useRef(style);       // last known project-wide style
  const loadedStyleRef = useRef(style);     // style last loaded into the panel (to detect real edits)
  // Live mirrors so persistStyle (called from a debounced effect) never reads a
  // stale scope/selection via closure.
  const applyScopeRef = useRef(applyScope); applyScopeRef.current = applyScope;
  const clipStyleMapRef = useRef(clipStyleMap); clipStyleMapRef.current = clipStyleMap;
  const selectedClipRef = useRef(selectedClip); selectedClipRef.current = selectedClip;
  const selectedClipIdsRef = useRef(selectedClipIds); selectedClipIdsRef.current = selectedClipIds;

  // Save the working style to the right place(s) based on the active scope.
  const persistStyle = async (s) => {
    if (applyScopeRef.current === "all") {
      baseStyleRef.current = s;
      await api.updateStyle(projectId, s);
    } else {
      const ids = applyScopeRef.current === "clip"
        ? (selectedClipRef.current ? [selectedClipRef.current.id] : [])
        : Array.from(selectedClipIdsRef.current);
      if (ids.length) {
        setClipStyleMap((prev) => { const n = { ...prev }; ids.forEach((id) => { n[id] = s; }); return n; });
        await Promise.all(ids.map((id) => api.updateClipStyle(projectId, id, s).catch(() => {})));
      }
    }
  };

  // Drop the selected clip's override → it inherits the project style again.
  const clearOverride = async () => {
    if (!selectedClip) return;
    try { await api.clearClipStyle(projectId, selectedClip.id); } catch {}
    setClipStyleMap((prev) => { const n = { ...prev }; delete n[selectedClip.id]; return n; });
    loadedStyleRef.current = { ...baseStyleRef.current };
    setStyle({ ...baseStyleRef.current });
  };

  // When the scope or the selected clip changes, load the style that scope edits
  // into the panel (project base, or the clip's override if it has one).
  // loadedStyleRef remembers it so the persist effect only saves REAL edits —
  // merely switching never creates a spurious override.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let target;
    if (applyScope === "all") target = baseStyleRef.current;
    else if (selectedClip) target = clipStyleMap[selectedClip.id] || baseStyleRef.current;
    else target = baseStyleRef.current;
    loadedStyleRef.current = target;
    setStyle({ ...target });
  }, [applyScope, selectedClip?.id]);

  // Dragging state
  const [dragging, setDragging] = useState(null);
  const [showGuides, setShowGuides] = useState(true);  // center guide lines on/off
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

  // Helper: pick EN vs ES preview URL based on previewLanguage state.
  // If user selected ES but the clip hasn't been translated yet, falls back to
  // EN — the UI shows a "Traducir este clip" button so they can fix that.
  const _useEs = () => previewLanguage === "es" && selectedClip && editorTranslated.has(selectedClip.id);

  const handlePreview = async () => {
    if (!selectedClip) {
      alert("Please select a clip first");
      return;
    }
    setLoadingPreview(true);
    setVideoPreviewUrl(null);
    try {
      await persistStyle(style);
      setPreviewUrl(_useEs()
        ? api.getPreviewEsUrl(projectId, selectedClip.id)
        : api.getPreviewUrl(projectId, selectedClip.id));
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
    await persistStyle(style);
    setVideoPreviewUrl(_useEs()
      ? api.getVideoPreviewEsUrl(projectId, selectedClip.id)
      : api.getVideoPreviewUrl(projectId, selectedClip.id));
    // loadingVideo stays true until onCanPlay fires on the video element
  };

  const handlePlayInstagram = async () => {
    if (!selectedClip) return;
    setLoadingPreview(true);
    setVideoPreviewUrl(null);
    try {
      await persistStyle(style);
      setPreviewUrl(_useEs()
        ? api.getInstagramPreviewEsUrl(projectId, selectedClip.id)
        : api.getInstagramPreviewUrl(projectId, selectedClip.id));
    } catch (err) {
      alert("Failed to generate IG preview: " + err.message);
    }
    setLoadingPreview(false);
  };

  // Persist style on change (debounced) + refresh any active preview. Saving
  // runs regardless of whether a preview is open so per-clip overrides are kept
  // even when you tweak without previewing.
  useEffect(() => {
    if (!selectedClip) return;
    const timer = setTimeout(async () => {
      try {
        // Only save when the style actually changed since it was loaded — so
        // switching scope/clip never writes a spurious override.
        if (JSON.stringify(style) !== JSON.stringify(loadedStyleRef.current)) {
          await persistStyle(style);
          loadedStyleRef.current = style;
        }
        const useEs = _useEs();
        if (videoPreviewUrl) {
          setVideoPreviewUrl(useEs
            ? api.getVideoPreviewEsUrl(projectId, selectedClip.id)
            : api.getVideoPreviewUrl(projectId, selectedClip.id));
        }
        if (previewUrl) {
          const isIg = previewUrl.includes("instagram-preview");
          setPreviewUrl(
            isIg
              ? (useEs ? api.getInstagramPreviewEsUrl(projectId, selectedClip.id) : api.getInstagramPreviewUrl(projectId, selectedClip.id))
              : (useEs ? api.getPreviewEsUrl(projectId, selectedClip.id) : api.getPreviewUrl(projectId, selectedClip.id))
          );
        }
      } catch (_) {}
    }, 300);
    return () => clearTimeout(timer);
  }, [style.fill_mode, style.fill_mode_scale, style.ig_fill_mode, style.ig_top_padding, style.ig_watermark_y, style.split_screen_enabled, style.split_ratio, style.text_x, style.text_y, style.flip_horizontal, style.boost_contrast, style.subtitle_style, style.caption_style, style.visual_filter, style.subtitle_size_scale, style.subtitle_y, style.background_style, style.no_text, style.caption_font, style.no_emojis, style.caption_box_radius, style.caption_box_opacity, style.caption_box_color, style.caption_box_pad_x, style.caption_box_pad_y, style.mirror_cyclic_enabled, style.mirror_cyclic_interval, style.sway_enabled, style.sway_period, style.sway_amplitude, style.auto_reframe_enabled, style.auto_reframe_mode, style.auto_reframe_follow_id, style.auto_reframe_padding, style.auto_reframe_smoothing, style.music_path, style.music_volume, style.original_volume, style.music_start, style.music_end, previewLanguage, editorTranslated]);

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
      await persistStyle(style);
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

  // Caption resize: start state for the corner-handle drag.
  // We capture the initial distance from the caption center + the initial
  // font_size so we can scale proportionally as the mouse moves.
  const resizeStartRef = useRef(null);

  const handleCaptionResizeDown = (e) => {
    e.preventDefault();
    e.stopPropagation();  // do NOT also trigger the move drag
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = rect.left + (style.text_x ?? 0.5) * rect.width;
    const cy = rect.top + (style.text_y ?? 0.5) * rect.height;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    resizeStartRef.current = {
      dist: Math.max(20, Math.hypot(dx, dy)),
      fontSize: style.font_size || 70,
    };
    setDragging("text_resize");
  };

  const handleMouseMove = useCallback(
    (e) => {
      if (!dragging || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      if (dragging === "text_resize") {
        // Scale font_size by the ratio of current cursor distance to the
        // distance at drag start, anchored on the caption center.
        const s = resizeStartRef.current;
        if (!s) return;
        const cx = rect.left + (style.text_x ?? 0.5) * rect.width;
        const cy = rect.top + (style.text_y ?? 0.5) * rect.height;
        const d = Math.hypot(e.clientX - cx, e.clientY - cy);
        const ratio = d / s.dist;
        const newSize = Math.round(Math.max(20, Math.min(100, s.fontSize * ratio)));
        setStyle((prev) => ({ ...prev, font_size: newSize }));
        return;
      }
      let x = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
      let y = Math.max(0.05, Math.min(0.95, (e.clientY - rect.top) / rect.height));
      // Snap to the center guide lines when within ~2.5%.
      if (Math.abs(x - 0.5) < 0.025) x = 0.5;
      if (Math.abs(y - 0.5) < 0.025) y = 0.5;
      setStyle((prev) => ({
        ...prev,
        [`${dragging}_x`]: x,
        [`${dragging}_y`]: y,
      }));
    },
    [dragging, style.text_x, style.text_y]
  );

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    resizeStartRef.current = null;
  }, []);

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
      <div style={{ display: "grid", placeItems: "center", minHeight: "70vh", padding: 24 }}>
        <div style={{ width: 500, maxWidth: "100%" }}>
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <h1 style={{ margin: "0 0 6px", fontFamily: "var(--st-display)", fontSize: 25, fontWeight: 600, letterSpacing: "-.02em" }}>Exportando clips</h1>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--st-muted)" }}>
              Renderizando en 9:16 con FFmpeg{exportMode === "instagram" ? " · formato Instagram" : ""}
            </p>
          </div>
          <div className="st-card" style={{ padding: "22px 24px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Clip {progress.current} de {progress.total}</span>
              <span style={{ fontFamily: "var(--st-mono)", fontSize: 13, color: "var(--st-text)" }}>{pct}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: "var(--st-alt)", overflow: "hidden", marginBottom: 18 }}>
              <div style={{ height: "100%", width: `${pct}%`, borderRadius: 99, background: "var(--st-accent)", transition: "width 0.4s" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {clips.map((c, i) => {
                const state = i < progress.current ? "done" : i === progress.current ? "active" : "todo";
                return (
                  <div key={c.id ?? i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: 9, background: state === "active" ? "var(--st-soft)" : "transparent", border: `1px solid ${state === "active" ? "var(--st-border)" : "transparent"}` }}>
                    <span style={{ width: 18, height: 18, borderRadius: 99, display: "grid", placeItems: "center", flexShrink: 0, background: state === "done" ? "var(--st-accent)" : "transparent", border: state === "done" ? "none" : "1.5px solid var(--st-border)" }}>
                      {state === "done" && <Check size={12} style={{ color: "var(--st-on-accent)" }} />}
                      {state === "active" && <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--st-text)" }} />}
                    </span>
                    <Film size={15} style={{ color: "var(--st-faint)", flexShrink: 0 }} />
                    <span style={{ fontFamily: "var(--st-mono)", fontSize: 12, color: state === "todo" ? "var(--st-faint)" : "var(--st-text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      clip_{String(i + 1).padStart(2, "0")}.mp4
                    </span>
                    <span style={{ fontSize: 11.5, color: "var(--st-faint)" }}>{state === "done" ? "listo" : state === "active" ? "renderizando…" : "en cola"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- DONE STATE ----
  if (exportStatus === "done") {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "70vh", padding: 24 }}>
        <div style={{ width: 520, maxWidth: "100%" }}>
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <div style={{ width: 50, height: 50, borderRadius: 99, background: "var(--st-accent)", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
              <Check size={24} style={{ color: "var(--st-on-accent)" }} />
            </div>
            <h1 style={{ margin: "0 0 6px", fontFamily: "var(--st-display)", fontSize: 26, fontWeight: 600, letterSpacing: "-.025em" }}>Export completado</h1>
            <p style={{ margin: 0, fontSize: 14, color: "var(--st-muted)" }}>
              {exportedFiles.length} de {clips.length} clips exportados{exportMode === "instagram" ? " · listos para Instagram" : ""}
            </p>
          </div>

          <div className="st-card" style={{ padding: "14px 16px", marginBottom: 16 }}>
            {exportedFiles.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px", borderBottom: i < exportedFiles.length - 1 ? "1px solid var(--st-line)" : "none" }}>
                <span style={{ width: 26, height: 34, borderRadius: 5, background: "var(--st-alt)", display: "grid", placeItems: "center", fontFamily: "var(--st-mono)", fontSize: 10, color: "var(--st-faint)", flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ fontFamily: "var(--st-mono)", fontSize: 12.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f}</span>
                <a href={exportMode === "instagram" ? api.getInstagramDownloadUrl(projectId, f) : api.getDownloadUrl(projectId, f)} download
                  className="st-btn st-btn--ghost" style={{ padding: "6px 12px", textDecoration: "none" }}>
                  <Download size={14} /> Descargar
                </a>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <a href={`http://localhost:8000/api/export-info/${projectId}`} download="clips_info.txt"
              className="st-btn st-btn--ghost" style={{ textDecoration: "none" }}>
              <Type size={14} /> Descargar info (.txt)
            </a>
            <button className="st-btn st-btn--primary" onClick={() => onExportDone()}>
              <RefreshCw size={15} /> Nuevo proyecto
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- EDITOR STATE ----
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 30px", borderBottom: "1px solid var(--st-line)", flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--st-mono)", fontSize: 10.5, color: "var(--st-faint)" }}>Paso 3 · posiciona el texto y la marca de agua</div>
          <h1 style={{ margin: 0, fontFamily: "var(--st-display)", fontSize: 22, fontWeight: 600, letterSpacing: "-.02em" }}>Visual Editor</h1>
        </div>
        <div style={{ display: "flex", background: "var(--st-alt)", borderRadius: 9, padding: 3 }}>
          {[["tiktok", "TikTok"], ["instagram", "Instagram"]].map(([k, label]) => {
            const on = exportMode === k;
            return (
              <span key={k} onClick={() => setExportMode(k)} style={{
                fontSize: 12.5, fontWeight: on ? 600 : 500, padding: "6px 13px", borderRadius: 6, cursor: "pointer",
                background: on ? "var(--st-surface)" : "transparent", color: on ? "var(--st-text)" : "var(--st-muted)",
              }}>{label}</span>
            );
          })}
        </div>
        <span style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)" }}>{selectedClipIds.size} de {clips.length}</span>
        <button onClick={() => handleExport(exportMode)} disabled={selectedClipIds.size === 0} className="st-btn st-btn--primary" style={{ padding: "8px 15px" }}>
          <Download size={15} /> Exportar todos
        </button>
      </div>

      {/* Body: preview + inspector */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        {/* ── Center: preview ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--st-soft)", minWidth: 0 }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, minHeight: 0 }}>
            <div className="editor-canvas-container" ref={canvasRef} style={{ height: "100%", maxHeight: 560, width: "auto" }}>
              <div className="editor-canvas">
                {loadingPreview ? (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--st-soft)", flexDirection: "column", gap: 12 }}>
                    <Loader2 size={26} style={{ color: "var(--st-muted)", animation: "st-spin 1s linear infinite" }} />
                    <span style={{ color: "var(--st-muted)", fontSize: 13, fontWeight: 500 }}>Generando preview…</span>
                    <span style={{ color: "var(--st-faint)", fontFamily: "var(--st-mono)", fontSize: 11 }}>la primera vez tarda ~15s</span>
                  </div>
                ) : videoPreviewUrl ? (
                  <>
                    {loadingVideo && (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--st-soft)", flexDirection: "column", gap: 12, position: "absolute", top: 0, left: 0, zIndex: 2 }}>
                        <Loader2 size={26} style={{ color: "var(--st-muted)", animation: "st-spin 1s linear infinite" }} />
                        <span style={{ color: "var(--st-muted)", fontSize: 13, fontWeight: 500 }}>Generando video preview…</span>
                        <span style={{ color: "var(--st-faint)", fontFamily: "var(--st-mono)", fontSize: 11 }}>la primera vez tarda ~15s</span>
                      </div>
                    )}
                    <video
                      key={videoPreviewUrl}
                      controls autoPlay
                      src={videoPreviewUrl}
                      style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000", borderRadius: 16, display: loadingVideo ? "none" : "block" }}
                      onCanPlay={() => setLoadingVideo(false)}
                      onError={() => { setLoadingVideo(false); alert("Failed to generate video preview. Try again."); setVideoPreviewUrl(null); }}
                    />
                  </>
                ) : previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    onLoad={() => setLoadingPreview(false)}
                    onError={() => { alert("Failed to load preview image."); setPreviewUrl(null); setLoadingPreview(false); }}
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(120% 80% at 50% 30%, #2a2620, #100d09)", flexDirection: "column", gap: 12 }}>
                    <Film size={30} style={{ color: "rgba(255,255,255,.3)" }} />
                    <span style={{ color: "rgba(255,255,255,.5)", fontSize: 12.5, textAlign: "center", maxWidth: 200 }}>
                      Elegí un clip y tocá “Preview” o “Play clip”
                    </span>
                  </div>
                )}

                {/* Center guide lines (toggle with the Guías button). Each turns
                    gold + solid when the caption is snapped to that axis. */}
                {selectedClip && showGuides && (() => {
                  const cX = Math.abs((style.text_x ?? 0.5) - 0.5) < 0.012;
                  const cY = Math.abs((style.text_y ?? 0.5) - 0.5) < 0.012;
                  const dashV = "repeating-linear-gradient(to bottom, rgba(255,255,255,0.45) 0px, rgba(255,255,255,0.45) 6px, transparent 6px, transparent 12px)";
                  const dashH = "repeating-linear-gradient(to right, rgba(255,255,255,0.45) 0px, rgba(255,255,255,0.45) 6px, transparent 6px, transparent 12px)";
                  return (
                    <>
                      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: cX ? 2 : 1, transform: "translateX(-50%)", pointerEvents: "none", zIndex: 1, background: cX ? "var(--st-gold)" : dashV, opacity: cX ? 0.95 : 0.4 }} />
                      <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: cY ? 2 : 1, transform: "translateY(-50%)", pointerEvents: "none", zIndex: 1, background: cY ? "var(--st-gold)" : dashH, opacity: cY ? 0.95 : 0.4 }} />
                    </>
                  );
                })()}

                {/* Invisible caption hit area — sized + positioned to match
                    the REAL white-box caption rendered by PIL. Dimensions are
                    estimated from the actual caption text + font_size and
                    expressed as % of the 1080×1920 canvas so the outline
                    scales naturally with the preview (no absolute pixels).
                    PIL anchors the caption box with its TOP at
                    (text_y * H - pad_y), so we mirror that with
                    transform: translate(-50%, 0) and top adjusted by pad_y.
                    Dashed outline appears only on hover / drag (via the
                    .draggable-text:hover and .dragging CSS rules). Gold corner
                    handle = resize. */}
                {selectedClip && (() => {
                  const centered = Math.abs((style.text_x ?? 0.5) - 0.5) < 0.012;
                  const resizing = dragging === "text_resize";
                  const fs = style.font_size || 70;
                  const padX = style.caption_box_pad_x ?? 30;
                  const padY = style.caption_box_pad_y ?? 6;
                  const caption = stripCaptionMarkers(selectedClip.viral_caption || "");

                  // Estimate the rendered box in CANVAS pixels (1080×1920).
                  const CANVAS_W = 1080, CANVAS_H = 1920;
                  const SIDE = 40;
                  const charW = fs * 0.55;                       // avg Arial Bold char width at fs
                  const maxLineChars = Math.max(8, Math.floor((CANVAS_W - SIDE * 2 - 32) / charW));
                  let totalLines = 0;
                  let widestChars = 0;
                  for (const block of caption.split("\n")) {
                    const chars = block.trim().length;
                    if (chars === 0) continue;
                    const linesInBlock = Math.max(1, Math.ceil(chars / maxLineChars));
                    totalLines += linesInBlock;
                    widestChars = Math.max(widestChars, Math.min(chars, maxLineChars));
                  }
                  if (totalLines === 0) { totalLines = 1; widestChars = 12; }  // empty caption fallback

                  const boxWcanvas = Math.min(CANVAS_W - SIDE * 2, widestChars * charW + padX * 2);
                  const boxHcanvas = totalLines * fs * 1.3 + padY * 2;
                  const hitWPct = (boxWcanvas / CANVAS_W) * 100;
                  const hitHPct = (boxHcanvas / CANVAS_H) * 100;
                  const padYPct = (padY / CANVAS_H) * 100;

                  return (
                    <div
                      className={`draggable-text ${dragging === "text" ? "dragging" : ""}`}
                      style={{
                        left: `${style.text_x * 100}%`,
                        top: `calc(${style.text_y * 100}% - ${padYPct}%)`,
                        transform: "translate(-50%, 0)",
                        background: "transparent",
                        padding: 0,
                        fontSize: 0,
                        color: "transparent",
                        // Sized as % of the canvas so it scales with the preview
                        width: `${hitWPct}%`,
                        height: `${hitHPct}%`,
                        borderColor: centered ? "var(--st-gold)" : undefined,
                        borderRadius: 8,
                        zIndex: 10,
                      }}
                      onMouseDown={handleMouseDown("text")}
                      title="Arrastrá para mover el caption · esquina dorada para agrandar / achicar"
                    >
                      {/* Gold corner resize handle */}
                      <div
                        onMouseDown={handleCaptionResizeDown}
                        title="Arrastrá para escalar el caption"
                        style={{
                          position: "absolute", right: -7, bottom: -7,
                          width: 14, height: 14, borderRadius: "50%",
                          background: "var(--st-gold)", border: "2px solid #15130e",
                          cursor: "nwse-resize", zIndex: 11,
                          boxShadow: resizing ? "0 0 0 3px rgba(230,194,112,.35)" : "0 1px 3px rgba(0,0,0,.5)",
                        }}
                      />
                    </div>
                  );
                })()}

                {/* Draggable watermark */}
                {watermarkPreview && !previewUrl && !videoPreviewUrl && (
                  <div
                    className={`draggable-watermark ${dragging === "watermark" ? "dragging" : ""}`}
                    style={{ left: `${style.watermark_x * 100}%`, top: `${style.watermark_y * 100}%`, transform: "translate(-50%, -50%)", opacity: style.watermark_opacity, zIndex: 2 }}
                    onMouseDown={handleMouseDown("watermark")}
                  >
                    <img src={watermarkPreview} alt="Watermark" style={{ width: `${style.watermark_scale * 250}px` }} />
                  </div>
                )}

                {/* 9:16 badge */}
                <span style={{ position: "absolute", top: 10, left: 11, fontFamily: "var(--st-mono)", fontSize: 9.5, color: "#fff", background: "rgba(0,0,0,.5)", padding: "2px 6px", borderRadius: 5, zIndex: 11 }}>9:16</span>
              </div>
            </div>
          </div>

          {/* Preview action buttons */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "0 0 16px", flexShrink: 0, flexWrap: "wrap" }}>
            {/* EN / ES preview language toggle — only affects what's rendered
                in the preview; does NOT modify StyleConfig or the export.
                When ES is picked on an untranslated clip, the "Traducir este
                clip" button appears to the right and offers to fix it. */}
            <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--st-border)", borderRadius: 8, padding: 2, marginRight: 4 }}
                 title="Idioma del preview · EN (original) o ES (traducido). Solo afecta el preview, no el export.">
              {["en", "es"].map((lang) => (
                <button
                  key={lang}
                  onClick={() => setPreviewLanguage(lang)}
                  className="st-btn"
                  style={{
                    padding: "5px 10px", fontSize: 12, fontWeight: 600,
                    background: previewLanguage === lang ? "var(--st-accent)" : "transparent",
                    color: previewLanguage === lang ? "var(--st-on-accent)" : "var(--st-muted)",
                    border: "none", borderRadius: 6,
                  }}
                >
                  {lang === "en" ? "🇬🇧 EN" : "🇪🇸 ES"}
                </button>
              ))}
            </div>
            {/* Inline "Traducir este clip" CTA — shows only when user picked ES
                but the selected clip has no cached translation yet. */}
            {previewLanguage === "es" && selectedClip && !editorTranslated.has(selectedClip.id) && (
              <button
                onClick={handleTranslateCurrentClip}
                disabled={translatingNow}
                className="st-btn st-btn--ghost"
                style={{ padding: "7px 12px", fontSize: 12, border: "1px dashed var(--st-accent)" }}
                title="Traduce este clip con Gemini y actualiza el preview"
              >
                {translatingNow ? "Traduciendo…" : "🇪🇸 Traducir este clip"}
              </button>
            )}
            <button onClick={handlePreview} disabled={loadingPreview} className="st-btn st-btn--ghost" style={{ padding: "7px 12px" }}>
              {loadingPreview ? "Generando…" : <><Search size={14} /> Preview</>}
            </button>
            <button onClick={handlePlayVideo} disabled={loadingVideo} className="st-btn st-btn--primary" style={{ padding: "8px 14px", position: "relative" }}>
              {loadingVideo ? "Cargando…" : <><Play size={14} fill="currentColor" /> Play clip</>}
              {style.auto_reframe_enabled && selectedClip && clipFaceTracks[selectedClip.id] && (
                <span title="Auto-encuadre activo — el preview muestra el resultado real (más lento)"
                  style={{
                    position: "absolute", top: -6, right: -6,
                    background: "var(--st-accent)", color: "var(--st-on-accent)",
                    fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 99,
                    border: "2px solid var(--st-surface)",
                  }}>
                  🎯
                </span>
              )}
            </button>
            <button onClick={handlePlayInstagram} disabled={loadingPreview} className="st-btn st-btn--ghost" style={{ padding: "7px 12px" }}>
              <ImageIcon size={14} /> IG
            </button>
            <button onClick={() => selectedClip && setEditorClip(selectedClip)} disabled={!selectedClip} className="st-btn st-btn--ghost" style={{ padding: "7px 12px" }} title="Zoom, posición y trim del clip">
              <ZoomIn size={14} /> Editar encuadre
            </button>
            <button
              onClick={() => selectedClip && setEditingCaption({ id: selectedClip.id, text: selectedClip.viral_caption || "" })}
              disabled={!selectedClip}
              className="st-btn st-btn--ghost"
              style={{ padding: "7px 12px" }}
              title="Editar el texto del caption · Enter para nueva línea"
            >
              <Pencil size={14} /> Editar texto
            </button>
            <button onClick={() => setShowGuides((v) => !v)} className="st-btn st-btn--ghost"
              title={showGuides ? "Ocultar guías de centrado" : "Mostrar guías de centrado"}
              style={{ padding: "7px 12px",
                border: `1px solid ${showGuides ? "var(--st-accent)" : "var(--st-border)"}`,
                background: showGuides ? "var(--st-soft)" : "transparent",
                color: showGuides ? "var(--st-text)" : "var(--st-muted)" }}>
              <Crosshair size={14} /> Guías
            </button>
          </div>
        </div>

        {/* ── Inspector ── */}
        <div style={{ width: "clamp(280px, 30vw, 360px)", flexShrink: 0, borderLeft: "1px solid var(--st-line)", background: "var(--st-surface)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
            {/* Aplicar a — scope of style edits */}
            <StSection icon={<Crosshair size={14} />}>Aplicar cambios a</StSection>
            <StSegmented
              options={[["all", "Todos"], ["clip", "Este clip"], ["selected", `Varios (${selectedClipIds.size})`]]}
              value={applyScope}
              onChange={setApplyScope}
            />
            {applyScope === "clip" && selectedClip && clipStyleMap[selectedClip.id] && (
              <button onClick={clearOverride} className="st-btn st-btn--quiet" style={{ marginTop: 8, padding: "5px 10px", fontSize: 11.5 }}>
                <RefreshCw size={12} /> Usar estilo general
              </button>
            )}
            <p style={{ fontSize: 11, color: "var(--st-faint)", margin: "8px 0 0", lineHeight: 1.5 }}>
              {applyScope === "all"
                ? "Los cambios afectan a TODOS los clips."
                : applyScope === "clip"
                  ? "Los cambios afectan solo al clip seleccionado."
                  : `Los cambios afectan a los ${selectedClipIds.size} clips marcados en “Clips a exportar”.`}
            </p>
            <div style={{ height: 1, background: "var(--st-line)", margin: "18px 0" }} />

            {/* Clip seleccionado */}
            <StSection icon={<Film size={14} />}>Clip seleccionado</StSection>
            <select className="st-select" value={selectedClip?.id || ""}
              onChange={(e) => { const clip = clips.find((c) => c.id === parseInt(e.target.value)); setSelectedClip(clip); setPreviewUrl(null); setVideoPreviewUrl(null); }}
              style={{ marginBottom: 20 }}>
              {clips.map((c) => (<option key={c.id} value={c.id}>Clip {c.id}: {c.description}</option>))}
            </select>

            {/* Formato de video */}
            <StSection icon={<LayoutGrid size={14} />}>Formato de video</StSection>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
              {["fit", "medium", "mini", "zoom", "fill", "small"].map((m) => (
                <StChip key={m} active={style.fill_mode === m} onClick={() => setStyle((s) => ({ ...s, fill_mode: m }))}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </StChip>
              ))}
            </div>
            <StSlider label="Tamaño fino" display={`${Math.round((style.fill_mode_scale ?? 1.0) * 100)}%`} min={0.5} max={1.5} step={0.02}
              value={style.fill_mode_scale ?? 1.0} onChange={(e) => setStyle((s) => ({ ...s, fill_mode_scale: parseFloat(e.target.value) }))}
              onReset={() => setStyle((s) => ({ ...s, fill_mode_scale: 1.0 }))} />

            <div style={{ height: 1, background: "var(--st-line)", margin: "6px 0 18px" }} />

            {/* Fondo */}
            <StSection>Fondo</StSection>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
              <StChip active={style.background_style === "blur"} onClick={() => setStyle((s) => ({ ...s, background_style: "blur" }))}>Blur</StChip>
              <StChip active={style.background_style === "black"} onClick={() => setStyle((s) => ({ ...s, background_style: "black" }))}>Negro</StChip>
            </div>

            {/* Caption style */}
            <StSection icon={<Type size={14} />}>Caption style</StSection>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: style.caption_style === "highlight" ? 8 : 12 }}>
              <StChip active={style.caption_style === "box"} onClick={() => setStyle((s) => ({ ...s, caption_style: "box" }))}>Caja blanca</StChip>
              <StChip active={style.caption_style === "tiktok"} onClick={() => setStyle((s) => ({ ...s, caption_style: "tiktok" }))}>TikTok</StChip>
              <StChip active={style.caption_style === "meme"} onClick={() => setStyle((s) => ({ ...s, caption_style: "meme" }))}>Meme</StChip>
              <StChip active={style.caption_style === "clean"} onClick={() => setStyle((s) => ({ ...s, caption_style: "clean" }))}>Blanco limpio</StChip>
              <StChip active={style.caption_style === "yellow"} onClick={() => setStyle((s) => ({ ...s, caption_style: "yellow" }))}>Acento amarillo</StChip>
              <StChip active={style.caption_style === "highlight"} onClick={() => setStyle((s) => ({ ...s, caption_style: "highlight" }))}>Palabras de color</StChip>
            </div>
            {style.caption_style === "highlight" && (
              <p style={{ fontSize: 11, color: "var(--st-faint)", margin: "0 0 14px", lineHeight: 1.55 }}>
                Gemini pinta nombres y frases clave solo. Para marcar a mano editá el texto y envolvé palabras:{" "}
                <code style={{ color: "#FFD93D", fontFamily: "var(--st-mono)" }}>*amarillo*</code>{" · "}
                <code style={{ color: "#FF3B5C", fontFamily: "var(--st-mono)" }}>**rojo**</code>
              </p>
            )}
            <select className="st-select" value={style.caption_font} onChange={(e) => setStyle((s) => ({ ...s, caption_font: e.target.value }))} style={{ marginBottom: 20 }}>
              <optgroup label="Windows (siempre disponibles)">
                <option value="calibri">Calibri Bold (default)</option>
                <option value="arial">Arial (como memes)</option>
                <option value="arial_black">Arial Black</option>
                <option value="impact">Impact</option>
                <option value="verdana">Verdana Bold</option>
                <option value="segoe_ui">Segoe UI Black</option>
                <option value="trebuchet">Trebuchet MS Bold</option>
              </optgroup>
              <optgroup label="Google Fonts (ver fonts/README.md)">
                <option value="montserrat">Montserrat Black</option>
                <option value="poppins">Poppins Bold</option>
                <option value="bebas">Bebas Neue</option>
                <option value="anton">Anton</option>
                <option value="oswald">Oswald Bold</option>
              </optgroup>
            </select>

            {/* White-box controls (CapCut-like) — only for the box style */}
            {style.caption_style === "box" && (
              <div style={{ marginBottom: 20 }}>
                <StSlider label="Redondeo de esquinas" display={`${Math.round((style.caption_box_radius ?? 0.40) * 100)}%`}
                  min={0} max={1} step={0.01} value={style.caption_box_radius ?? 0.40}
                  onChange={(e) => setStyle((s) => ({ ...s, caption_box_radius: parseFloat(e.target.value) }))} />
                <StSlider label="Opacidad de la caja" display={`${Math.round((style.caption_box_opacity ?? 0.95) * 100)}%`}
                  min={0.2} max={1} step={0.01} value={style.caption_box_opacity ?? 0.95}
                  onChange={(e) => setStyle((s) => ({ ...s, caption_box_opacity: parseFloat(e.target.value) }))} />
                <StSlider label="Ancho de caja (Width)" display={`${style.caption_box_pad_x ?? 30}px`}
                  min={0} max={250} step={1} value={style.caption_box_pad_x ?? 30}
                  onChange={(e) => setStyle((s) => ({ ...s, caption_box_pad_x: parseInt(e.target.value) }))} />
                <StSlider label="Alto de caja (Height)" display={`${style.caption_box_pad_y ?? 6}px`}
                  min={0} max={200} step={1} value={style.caption_box_pad_y ?? 6}
                  onChange={(e) => setStyle((s) => ({ ...s, caption_box_pad_y: parseInt(e.target.value) }))} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)" }}>Color de la caja</span>
                  <input type="color" value={style.caption_box_color ?? "#FFFFFF"}
                    onChange={(e) => setStyle((s) => ({ ...s, caption_box_color: e.target.value }))}
                    style={{ width: 48, height: 30, border: "1px solid var(--st-border)", borderRadius: 8, background: "var(--st-surface)" }} />
                </div>
                <p style={{ fontSize: 11, color: "var(--st-faint)", margin: "8px 0 0", lineHeight: 1.5 }}>
                  La posición (X / Y) se ajusta en “Text Overlay”. El tamaño del texto, en “Font size”.
                </p>
              </div>
            )}

            {/* Filtro cinematográfico */}
            <StSection icon={<Sparkles size={14} />}>Filtro cinematográfico</StSection>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
              {[["none", "Ninguno"], ["cinematic", "Cinematic"], ["warm", "Warm"], ["vivid", "Vivid"], ["moody", "Moody"], ["bw", "B&W"]].map(([v, label]) => (
                <StChip key={v} active={style.visual_filter === v} onClick={() => setStyle((s) => ({ ...s, visual_filter: v }))}>{label}</StChip>
              ))}
            </div>

            {/* Subtítulos */}
            <StSection icon={<Type size={14} />}>Subtítulos</StSection>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7, marginBottom: style.subtitle_style !== "none" ? 14 : 8 }}>
              {[["none", "Ninguno"], ["standard", "Estándar"], ["clean", "Limpio"], ["karaoke", "Karaoke"], ["popup", "Pop-up"], ["highlight", "Highlight"], ["big_center", "Big Center"], ["twoword", "Two-Word"], ["bounce", "Bounce"], ["typewriter", "Typewriter"], ["karaoke_green", "Karaoke Verde"], ["karaoke_blue", "Karaoke Azul"], ["karaoke_pink", "Karaoke Rosa"], ["box_green", "Caja Verde"], ["box_blue", "Caja Azul"], ["neon", "Neón"], ["karaoke_red", "Karaoke Rojo"], ["karaoke_orange", "Karaoke Naranja"], ["karaoke_purple", "Karaoke Morado"], ["box_pink", "Caja Rosa"], ["box_red", "Caja Roja"], ["line_box", "Caja Línea"], ["underline", "Subrayado"], ["bubble", "Burbuja"], ["reveal", "Aparece"], ["stack", "Vertical"], ["hollow", "Contorno"], ["retro", "Retro 3D"], ["word_zoom", "1 palabra Zoom"], ["word_yellow", "1 palabra Amarillo"], ["word_box", "1 palabra Caja"], ["word_neon", "1 palabra Neón"], ["word_3d", "1 palabra 3D"], ["word_rotate", "1 palabra Giro"], ["word_glitch", "1 palabra Glitch"], ["word_outline", "1 palabra Doble borde"], ["word_gold", "1 palabra Gold"], ["word_comic", "1 palabra Comic"], ["word_italic", "1 palabra Itálica"], ["word_strip", "1 palabra Barra"], ["word_minimal", "1 palabra Minimal"], ["word_longshadow", "1 palabra Sombra"]].map(([v, label]) => (
                <SubThumb key={v} styleKey={v} label={label} selected={style.subtitle_style === v} onClick={() => setStyle((s) => ({ ...s, subtitle_style: v }))} />
              ))}
            </div>
            {style.subtitle_style !== "none" && (
              <>
                <StSlider label="Tamaño" display={`${Math.round(style.subtitle_size_scale * 100)}%`} min={0.6} max={1.6} step={0.05}
                  value={style.subtitle_size_scale} onChange={(e) => setStyle((s) => ({ ...s, subtitle_size_scale: parseFloat(e.target.value) }))}
                  onReset={() => setStyle((s) => ({ ...s, subtitle_size_scale: 1.0 }))} />
                <StSlider label="Posición"
                  display={(style.subtitle_y || 0) === 0 ? "default" : (style.subtitle_y > 0 ? `⬆ ${Math.round(style.subtitle_y * 100)}%` : `⬇ ${Math.round(-style.subtitle_y * 100)}%`)}
                  min={-0.5} max={0.5} step={0.02} value={style.subtitle_y || 0}
                  onChange={(e) => setStyle((s) => ({ ...s, subtitle_y: parseFloat(e.target.value) }))}
                  onReset={() => setStyle((s) => ({ ...s, subtitle_y: 0.0 }))} />
              </>
            )}

            <div style={{ height: 6 }} />

            {/* Música (background music post-mix). Follows the existing
                "Aplicar a" scope, so a project can have a default track AND a
                specific clip can override with another one. The persistStyle
                effect picks up the music_* fields on style; on export,
                mix_music_track runs as a fast post-step (video copied, only
                audio re-mixed). Trim sliders pick which SLICE of the song
                plays — handy when you want only a drop or a chorus. */}
            <StSection icon={<Music2 size={14} />}>Música</StSection>
            {selectedClip?.music_vibe && (
              <div style={{ fontSize: 12, color: "var(--st-muted)", margin: "0 0 10px", lineHeight: 1.5, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  flexShrink: 0, fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 99,
                  background: "var(--st-soft)", border: "1px solid var(--st-line)", color: "var(--st-text)",
                }}>
                  🎵 sugerido: {selectedClip.music_vibe}
                </span>
                <span>Gemini sugiere esta vibe para este clip.</span>
              </div>
            )}
            {!style.music_path ? (
              <>
                <p style={{ fontSize: 12, color: "var(--st-muted)", margin: "0 0 10px", lineHeight: 1.5 }}>
                  Sumá una pista de fondo (MP3 / WAV / OGG). Se mezcla por encima del audio original cuando exportás.
                </p>
                <button onClick={() => musicFileRef.current?.click()} disabled={uploadingMusic}
                  className="st-btn st-btn--ghost"
                  style={{ width: "100%", justifyContent: "center", padding: "9px 0" }}>
                  {uploadingMusic
                    ? `Subiendo… ${musicUploadPct}%`
                    : <><Music2 size={14} /> Subir música</>}
                </button>
              </>
            ) : (
              <>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 10px", marginBottom: 12,
                  background: "var(--st-soft)", border: "1px solid var(--st-line)",
                  borderRadius: 8,
                }}>
                  <Music2 size={14} style={{ color: "var(--st-muted)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, color: "var(--st-text)", fontWeight: 600,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{musicMeta?.name || "Pista cargada"}</div>
                    {musicMeta?.duration > 0 && (
                      <div style={{ fontSize: 10.5, color: "var(--st-faint)", fontFamily: "var(--st-mono)" }}>
                        {Math.floor(musicMeta.duration / 60)}:{String(Math.floor(musicMeta.duration % 60)).padStart(2, "0")}
                      </div>
                    )}
                  </div>
                  <button onClick={handleMusicRemove} title="Quitar música"
                    style={{
                      background: "transparent", border: "1px solid var(--st-border)",
                      borderRadius: 6, color: "var(--st-muted)", padding: "4px 8px",
                      fontSize: 11, cursor: "pointer",
                    }}>
                    <Trash2 size={12} />
                  </button>
                </div>

                {musicMeta?.url && (
                  <audio
                    ref={musicAudioRef}
                    src={musicMeta.url}
                    controls
                    preload="metadata"
                    style={{ width: "100%", height: 32, marginBottom: 14 }}
                    onLoadedMetadata={(e) => {
                      // Pick up the source duration once the browser knows it,
                      // so the trim sliders can clamp correctly even when the
                      // backend probe came back empty (e.g. reload after the
                      // server restarted).
                      const d = e.currentTarget.duration;
                      if (isFinite(d) && d > 0 && (!musicMeta.duration || Math.abs(musicMeta.duration - d) > 0.1)) {
                        setMusicMeta((m) => m ? { ...m, duration: d } : m);
                      }
                    }}
                  />
                )}

                <StSlider label="Volumen música" display={`${Math.round((style.music_volume ?? 0.8) * 100)}%`}
                  min={0} max={2} step={0.05} value={style.music_volume ?? 0.8}
                  onChange={(e) => setStyle((s) => ({ ...s, music_volume: parseFloat(e.target.value) }))}
                  onReset={() => setStyle((s) => ({ ...s, music_volume: 0.8 }))} />
                <StSlider label="Volumen original (video)" display={`${Math.round((style.original_volume ?? 1.0) * 100)}%`}
                  min={0} max={2} step={0.05} value={style.original_volume ?? 1.0}
                  onChange={(e) => setStyle((s) => ({ ...s, original_volume: parseFloat(e.target.value) }))}
                  onReset={() => setStyle((s) => ({ ...s, original_volume: 1.0 }))} />

                {/* Trim — only meaningful when we know the source duration. */}
                {musicMeta?.duration > 0.5 && (
                  <div style={{ marginTop: 4, padding: 10, background: "var(--st-soft)", borderRadius: 8, border: "1px solid var(--st-line)" }}>
                    <div style={{ fontSize: 10.5, color: "var(--st-faint)", marginBottom: 6, fontFamily: "var(--st-mono)", letterSpacing: ".06em" }}>
                      ↳ ¿QUÉ PARTE DE LA PISTA QUERÉS QUE SUENE?
                    </div>
                    <StSlider label="Empieza en" display={`${(style.music_start ?? 0).toFixed(1)}s`}
                      min={0} max={Math.max(0.5, musicMeta.duration - 0.1)} step={0.1}
                      value={style.music_start ?? 0}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setStyle((s) => ({
                          ...s,
                          music_start: Math.min(v, (s.music_end || musicMeta.duration) - 0.1),
                        }));
                      }}
                      onReset={() => setStyle((s) => ({ ...s, music_start: 0 }))} />
                    <StSlider label="Termina en" display={(style.music_end ?? 0) === 0 ? "fin natural" : `${style.music_end.toFixed(1)}s`}
                      min={0} max={musicMeta.duration} step={0.1}
                      value={style.music_end ?? 0}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setStyle((s) => ({
                          ...s,
                          music_end: v > 0 ? Math.max(v, (s.music_start || 0) + 0.1) : 0,
                        }));
                      }}
                      onReset={() => setStyle((s) => ({ ...s, music_end: 0 }))} />
                    <div style={{ fontSize: 10, color: "var(--st-faint)", marginTop: 3, fontFamily: "var(--st-mono)" }}>
                      Termina en 0 → suena hasta el final natural de la canción
                    </div>
                  </div>
                )}

                <p style={{ fontSize: 10.5, color: "var(--st-faint)", margin: "10px 0 0", lineHeight: 1.5 }}>
                  El "Aplicar a" de arriba decide a qué clips se aplica esta música — Todos, Este clip, o Varios.
                </p>
              </>
            )}

            <div style={{ height: 10 }} />

            {/* Auto-encuadre (face tracking) — per-clip.
                Each AI clip needs its own face analysis since each covers a
                different range of the source video. We key UI state by
                selectedClip.id; the saved face_track lives server-side on
                the clip. The auto_reframe_* knobs live on `style` and follow
                the global "Aplicar a" scope (Todos / Este clip / Varios). */}
            <StSection icon={<Crosshair size={14} />}>Auto-encuadre</StSection>
            {(() => {
              const cur = selectedClip;
              if (!cur) {
                return (
                  <p style={{ fontSize: 12, color: "var(--st-muted)", margin: "0 0 10px" }}>
                    Elegí un clip en "Clip seleccionado" para analizar sus caras.
                  </p>
                );
              }
              const track = clipFaceTracks[cur.id];
              const isAnalyzing = analyzingFacesId === cur.id;
              const dur = (cur.end_time || 0) - (cur.start_time || 0);
              const fmtDur = `${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, "0")}`;
              if (!track) {
                return (
                  <>
                    <p style={{ fontSize: 11.5, color: "var(--st-muted)", margin: "0 0 10px", lineHeight: 1.5 }}>
                      MediaPipe detecta las caras del clip y FFmpeg hace un crop 9:16 dinámico que las sigue.
                    </p>
                    <button onClick={() => handleAnalyzeClipFaces(cur)} disabled={isAnalyzing}
                      className="st-btn st-btn--primary"
                      style={{ width: "100%", justifyContent: "center", padding: "9px 0" }}>
                      {isAnalyzing ? "Analizando…" : `🎯 Analizar caras · ${fmtDur}`}
                    </button>
                    {analyzeFacesError && (
                      <p style={{ color: "var(--st-live)", fontSize: 11.5, margin: "8px 0 0" }}>{analyzeFacesError}</p>
                    )}
                    <p style={{ fontSize: 11, color: "var(--st-faint)", margin: "10px 0 4px", lineHeight: 1.5 }}>
                      Solo se analiza el rango de este clip ({fmtDur}). Estimado: ~{Math.max(8, Math.round(dur * 0.4))} seg en CPU.
                    </p>
                  </>
                );
              }
              const people = track.people || [];
              return (
                <>
                  <div style={{ fontSize: 11, color: "var(--st-faint)", marginBottom: 10, fontFamily: "var(--st-mono)" }}>
                    ✓ {people.length} {people.length === 1 ? "persona detectada" : "personas detectadas"} · {track.samples?.length || 0} muestras
                  </div>

                  {/* Master toggle */}
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 11px", marginBottom: 10,
                    background: style.auto_reframe_enabled ? "var(--st-soft)" : "transparent",
                    border: `1px solid ${style.auto_reframe_enabled ? "var(--st-accent)" : "var(--st-border)"}`,
                    borderRadius: 8,
                  }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>Aplicar al export</span>
                    <button onClick={() => setStyle((s) => ({ ...s, auto_reframe_enabled: !s.auto_reframe_enabled, split_screen_enabled: !s.auto_reframe_enabled ? false : s.split_screen_enabled }))}
                      style={{
                        width: 38, height: 20, borderRadius: 99, border: "none",
                        background: style.auto_reframe_enabled ? "var(--st-accent)" : "var(--st-border)",
                        position: "relative", cursor: "pointer",
                      }}>
                      <span style={{
                        position: "absolute", top: 2, left: style.auto_reframe_enabled ? 20 : 2,
                        width: 16, height: 16, borderRadius: "50%", background: "#fff",
                        transition: "left .15s",
                      }} />
                    </button>
                  </div>

                  {/* Mode picker */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: "var(--st-muted)", marginBottom: 5, fontFamily: "var(--st-mono)", letterSpacing: ".05em" }}>MODO</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
                      {[["all", "🫂 Todos"], ["biggest", "🔍 Grande"], ["follow", "👤 Manual"]].map(([k, label]) => {
                        const active = (style.auto_reframe_mode || "all") === k;
                        const disabled = k === "follow" && people.length === 0;
                        return (
                          <button key={k}
                            onClick={() => !disabled && setStyle((s) => ({ ...s, auto_reframe_mode: k }))}
                            disabled={disabled}
                            style={{
                              fontSize: 10.5, padding: "6px 3px",
                              background: active ? "var(--st-accent)" : "transparent",
                              color: active ? "var(--st-on-accent)" : "var(--st-muted)",
                              border: `1px solid ${active ? "var(--st-accent)" : "var(--st-border)"}`,
                              borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer",
                              opacity: disabled ? 0.5 : 1,
                            }}>{label}</button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Manual pick grid — uses the project's raw video as the
                      thumbnail source, scaled with CSS object-position to
                      crop onto each person's thumb_box. */}
                  {style.auto_reframe_mode === "follow" && people.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 10, color: "var(--st-muted)", marginBottom: 5, fontFamily: "var(--st-mono)", letterSpacing: ".05em" }}>
                        ELEGÍ A QUIÉN SEGUIR
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
                        {people.slice(0, 9).map((p) => {
                          const sel = style.auto_reframe_follow_id === p.id;
                          const srcW = track.width || 1, srcH = track.height || 1;
                          return (
                            <div key={p.id}
                              onClick={() => setStyle((s) => ({ ...s, auto_reframe_follow_id: p.id }))}
                              title={`Aparece en ${p.appearance_count} muestras`}
                              style={{
                                aspectRatio: "1/1",
                                border: `2px solid ${sel ? "var(--st-accent)" : "var(--st-border)"}`,
                                borderRadius: 7, overflow: "hidden", cursor: "pointer",
                                background: "#000", position: "relative",
                              }}>
                              <video
                                src={api.getRawVideoUrl(projectId)}
                                muted
                                preload="metadata"
                                onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = p.thumb_t || 0; } catch {} }}
                                style={{
                                  position: "absolute",
                                  width: `${(srcW / Math.max(1, p.thumb_box.w)) * 100}%`,
                                  height: `${(srcH / Math.max(1, p.thumb_box.h)) * 100}%`,
                                  left: `${-(p.thumb_box.x / Math.max(1, p.thumb_box.w)) * 100}%`,
                                  top: `${-(p.thumb_box.y / Math.max(1, p.thumb_box.h)) * 100}%`,
                                  objectFit: "cover",
                                }}
                              />
                              <span style={{
                                position: "absolute", top: 3, left: 4,
                                fontFamily: "var(--st-mono)", fontSize: 9.5, color: "#fff",
                                background: "rgba(0,0,0,.6)", padding: "1px 4px", borderRadius: 3,
                              }}>#{p.id}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <StSlider label="Suavidad" display={`${Math.round((style.auto_reframe_smoothing ?? 0.85) * 100)}%`}
                    min={0} max={0.99} step={0.02} value={style.auto_reframe_smoothing ?? 0.85}
                    onChange={(e) => setStyle((s) => ({ ...s, auto_reframe_smoothing: parseFloat(e.target.value) }))}
                    onReset={() => setStyle((s) => ({ ...s, auto_reframe_smoothing: 0.85 }))} />
                  <StSlider label="Aire" display={`${Math.round((style.auto_reframe_padding ?? 0.30) * 100)}%`}
                    min={0} max={1} step={0.02} value={style.auto_reframe_padding ?? 0.30}
                    onChange={(e) => setStyle((s) => ({ ...s, auto_reframe_padding: parseFloat(e.target.value) }))}
                    onReset={() => setStyle((s) => ({ ...s, auto_reframe_padding: 0.30 }))} />

                  <div style={{ marginTop: 10 }}>
                    <button onClick={() => handleAnalyzeClipFaces(cur)} disabled={isAnalyzing}
                      className="st-btn st-btn--ghost"
                      style={{ width: "100%", justifyContent: "center", padding: "7px 0", fontSize: 12 }}>
                      {isAnalyzing ? "..." : "Re-analizar caras"}
                    </button>
                  </div>
                  <p style={{ fontSize: 10.5, color: "var(--st-faint)", margin: "10px 0 0", lineHeight: 1.5 }}>
                    Mirá el resultado con <b style={{ color: "var(--st-text)" }}>▶ Play clip</b> abajo · Incompatible con split-screen.
                  </p>
                </>
              );
            })()}

            <div style={{ height: 10 }} />

            {/* Text Overlay (expandable) */}
            <StRow icon={<Type size={15} />} label="Text Overlay" summary={`${Math.round(style.text_x * 100)}·${Math.round(style.text_y * 100)} · ${style.font_size}px`}>
              <StSlider label="Posición vertical" display={`${style.text_y <= 0.25 ? "⬆ Top" : style.text_y >= 0.65 ? "⬇ Bottom" : "↕ Middle"} · ${Math.round(style.text_y * 100)}%`}
                min={5} max={95} step={1} value={Math.round(style.text_y * 100)} onChange={(e) => setStyle((s) => ({ ...s, text_y: parseInt(e.target.value) / 100 }))} />
              <StSlider label="Posición horizontal" display={`${style.text_x <= 0.2 ? "← Izq" : style.text_x >= 0.8 ? "→ Der" : "↔ Centro"} · ${Math.round(style.text_x * 100)}%`}
                min={5} max={95} step={1} value={Math.round(style.text_x * 100)} onChange={(e) => setStyle((s) => ({ ...s, text_x: parseInt(e.target.value) / 100 }))} />
              <StSlider label="Font size" display={`${style.font_size}px`} min={20} max={100} step={1} value={style.font_size} onChange={(e) => setStyle((s) => ({ ...s, font_size: parseInt(e.target.value) }))} />
              <StSlider label="Stroke width" display={`${style.text_stroke_width}px`} min={0} max={12} step={1} value={style.text_stroke_width} onChange={(e) => setStyle((s) => ({ ...s, text_stroke_width: parseInt(e.target.value) }))} />
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ flex: 1, fontSize: 12, color: "var(--st-muted)" }}>
                  <span style={{ display: "block", marginBottom: 4 }}>Color texto</span>
                  <input type="color" value={style.text_color} onChange={(e) => setStyle((s) => ({ ...s, text_color: e.target.value }))} style={{ width: "100%", height: 36, border: "1px solid var(--st-border)", borderRadius: 8, background: "var(--st-surface)" }} />
                </label>
                <label style={{ flex: 1, fontSize: 12, color: "var(--st-muted)" }}>
                  <span style={{ display: "block", marginBottom: 4 }}>Color borde</span>
                  <input type="color" value={style.text_stroke_color} onChange={(e) => setStyle((s) => ({ ...s, text_stroke_color: e.target.value }))} style={{ width: "100%", height: 36, border: "1px solid var(--st-border)", borderRadius: 8, background: "var(--st-surface)" }} />
                </label>
              </div>
            </StRow>

            {/* Watermark (expandable) */}
            <StRow icon={<ImageIcon size={15} />} label="Watermark" summary={watermarkPreview ? "activo" : "off"}>
              <label className={`watermark-upload ${watermarkPreview ? "has-image" : ""}`} htmlFor="wm-input">
                {watermarkPreview ? <img src={watermarkPreview} alt="Watermark" /> : <span style={{ color: "var(--st-muted)", fontSize: 12.5 }}>Subir PNG</span>}
                <input id="wm-input" type="file" accept="image/png" hidden onChange={handleWatermarkUpload} />
              </label>
              {watermarkPreview && (
                <div style={{ marginTop: 12 }}>
                  <StSlider label="Tamaño" display={`${(style.watermark_scale * 100).toFixed(0)}%`} min={10} max={100} step={1} value={style.watermark_scale * 100} onChange={(e) => setStyle((s) => ({ ...s, watermark_scale: parseInt(e.target.value) / 100 }))} />
                  <StSlider label="Opacidad" display={`${(style.watermark_opacity * 100).toFixed(0)}%`} min={10} max={100} step={1} value={style.watermark_opacity * 100} onChange={(e) => setStyle((s) => ({ ...s, watermark_opacity: parseInt(e.target.value) / 100 }))} />
                  <StSlider label="Posición vertical" display={style.watermark_y <= 0.25 ? "⬆ Arriba" : style.watermark_y >= 0.75 ? "⬇ Abajo" : "↕ Centro"} min={0} max={1} step={0.05} value={style.watermark_y} onChange={(e) => setStyle((s) => ({ ...s, watermark_y: parseFloat(e.target.value) }))} />
                </div>
              )}
            </StRow>

            {/* Split Screen (expandable) */}
            <StRow icon={<LayoutGrid size={15} />} label="Split Screen" summary={style.split_screen_enabled ? `${Math.round(style.split_ratio * 100)}/${Math.round((1 - style.split_ratio) * 100)}` : "off"}>
              <p style={{ fontSize: 12, color: "var(--st-muted)", margin: "0 0 10px" }}>Video arriba + imagen abajo.</p>
              <label className={`watermark-upload ${splitImagePreview ? "has-image" : ""}`} htmlFor="split-img-input" style={{ marginBottom: 10 }}>
                {splitImagePreview ? <img src={splitImagePreview} alt="Split" style={{ maxHeight: 80 }} /> : <span style={{ color: "var(--st-muted)", fontSize: 12.5 }}>Subir imagen (PNG/JPG)</span>}
                <input id="split-img-input" type="file" accept="image/*" hidden onChange={handleSplitImageUpload} />
              </label>
              {splitImagePreview && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <label style={{ fontSize: 13, color: "var(--st-muted)", display: "flex", alignItems: "center", gap: 7 }}>
                      <input type="checkbox" checked={style.split_screen_enabled} onChange={(e) => setStyle(s => ({ ...s, split_screen_enabled: e.target.checked }))} style={{ accentColor: "var(--st-accent)" }} />
                      Activado
                    </label>
                    <button className="st-btn st-btn--ghost" style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11 }} onClick={handleRemoveSplitImage}>Quitar</button>
                  </div>
                  {style.split_screen_enabled && (
                    <StSlider label="Video / Imagen" display={`${Math.round(style.split_ratio * 100)}% / ${Math.round((1 - style.split_ratio) * 100)}%`} min={30} max={70} step={1}
                      value={Math.round(style.split_ratio * 100)} onChange={(e) => setStyle(s => ({ ...s, split_ratio: parseInt(e.target.value) / 100 }))} />
                  )}
                </>
              )}
            </StRow>

            {/* Formato IG (expandable) */}
            <StRow icon={<ImageIcon size={15} />} label="Formato IG" summary={style.ig_fill_mode}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                {["fit", "medium", "mini", "zoom", "fill", "small"].map((m) => (
                  <StChip key={m} active={style.ig_fill_mode === m} onClick={() => setStyle((s) => ({ ...s, ig_fill_mode: m }))}>{m.charAt(0).toUpperCase() + m.slice(1)}</StChip>
                ))}
              </div>
              <StSlider label="Posición del texto IG" display={style.ig_top_padding <= 100 ? "⬆ Arriba" : style.ig_top_padding >= 280 ? "⬇ Abajo" : "↕ Centro"} min={40} max={400} step={10} value={style.ig_top_padding} onChange={(e) => setStyle((s) => ({ ...s, ig_top_padding: parseInt(e.target.value) }))} />
              <StSlider label="Marca de agua IG" display={style.ig_watermark_y <= 0.25 ? "⬆ Arriba" : style.ig_watermark_y >= 0.75 ? "⬇ Abajo" : "↕ Centro"} min={0} max={1} step={0.05} value={style.ig_watermark_y} onChange={(e) => setStyle((s) => ({ ...s, ig_watermark_y: parseFloat(e.target.value) }))} />
            </StRow>

            {/* Opciones de texto (expandable) */}
            <StRow icon={<Type size={15} />} label="Opciones de texto" summary={style.no_text ? "sin texto" : style.no_emojis ? "sin emojis" : "default"}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <StChip active={style.no_text} onClick={() => setStyle((s) => ({ ...s, no_text: !s.no_text }))} style={{ textAlign: "left", padding: "10px 12px" }}>
                  {style.no_text ? "✓ Sin textos — video limpio" : "Mostrar caption + subtítulos"}
                </StChip>
                <StChip active={style.no_emojis} disabled={style.no_text} onClick={() => !style.no_text && setStyle((s) => ({ ...s, no_emojis: !s.no_emojis }))} style={{ textAlign: "left", padding: "10px 12px" }}>
                  {style.no_emojis ? "✓ Sin emojis en el caption" : "Mostrar emojis en caption"}
                </StChip>
              </div>
            </StRow>

            {/* Anti-Detect (expandable) */}
            <StRow icon={<Sparkles size={15} />} label="Anti-Detect" summary={(() => {
              const n = [style.strip_metadata, style.flip_horizontal, style.zoom_uniquify, style.boost_contrast,
                         style.mirror_cyclic_enabled, style.sway_enabled].filter(Boolean).length;
              return n > 0 ? `${n} activo${n > 1 ? "s" : ""}` : "off";
            })()}>
              <p style={{ fontSize: 11.5, color: "var(--st-muted)", margin: "0 0 10px" }}>Se aplican al exportar · no afectan el preview.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <StChip active={style.strip_metadata} onClick={() => setStyle(s => ({ ...s, strip_metadata: !s.strip_metadata }))} title="Elimina EXIF/MP4 metadata">{style.strip_metadata ? "✓ " : ""}Strip Metadata</StChip>
                <StChip active={style.flip_horizontal} onClick={() => setStyle(s => ({ ...s, flip_horizontal: !s.flip_horizontal }))} title="Espejo horizontal">{style.flip_horizontal ? "✓ " : ""}Flip</StChip>
                <StChip active={style.zoom_uniquify} onClick={() => setStyle(s => ({ ...s, zoom_uniquify: !s.zoom_uniquify }))} title="Zoom +2%">{style.zoom_uniquify ? "✓ " : ""}Zoom +2%</StChip>
                <StChip active={style.boost_contrast} onClick={() => setStyle(s => ({ ...s, boost_contrast: !s.boost_contrast }))} title="Contraste/brillo">{style.boost_contrast ? "✓ " : ""}Boost</StChip>
              </div>

              {/* Cyclic mirror — toggle + interval slider */}
              <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 9, background: "var(--st-soft)", border: "1px solid var(--st-line)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: style.mirror_cyclic_enabled ? 10 : 0 }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--st-text)" }}>🪞 Espejo cíclico</div>
                    <div style={{ fontSize: 11, color: "var(--st-faint)", marginTop: 2 }}>El video se invierte cada N segundos. Captions NO se mueven.</div>
                  </div>
                  <StChip active={!!style.mirror_cyclic_enabled}
                    onClick={() => setStyle(s => ({ ...s, mirror_cyclic_enabled: !s.mirror_cyclic_enabled }))}>
                    {style.mirror_cyclic_enabled ? "ON" : "OFF"}
                  </StChip>
                </div>
                {style.mirror_cyclic_enabled && (
                  <StSlider label="Intervalo" display={`${(style.mirror_cyclic_interval ?? 5).toFixed(1)}s`}
                    min={1} max={10} step={0.5}
                    value={style.mirror_cyclic_interval ?? 5}
                    onChange={(e) => setStyle(s => ({ ...s, mirror_cyclic_interval: parseFloat(e.target.value) }))} />
                )}
              </div>

              {/* Sway — toggle + period + amplitude */}
              <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 9, background: "var(--st-soft)", border: "1px solid var(--st-line)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: style.sway_enabled ? 10 : 0 }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--st-text)" }}>↔ Sway lateral</div>
                    <div style={{ fontSize: 11, color: "var(--st-faint)", marginTop: 2 }}>El video se balancea de un lado al otro. Captions NO se mueven.</div>
                  </div>
                  <StChip active={!!style.sway_enabled}
                    onClick={() => setStyle(s => ({ ...s, sway_enabled: !s.sway_enabled }))}>
                    {style.sway_enabled ? "ON" : "OFF"}
                  </StChip>
                </div>
                {style.sway_enabled && (
                  <>
                    <StSlider label="Velocidad (período)" display={`${(style.sway_period ?? 3).toFixed(1)}s`}
                      min={1} max={10} step={0.5}
                      value={style.sway_period ?? 3}
                      onChange={(e) => setStyle(s => ({ ...s, sway_period: parseFloat(e.target.value) }))} />
                    <StSlider label="Distancia (amplitud)" display={`${style.sway_amplitude ?? 40}px`}
                      min={10} max={100} step={5}
                      value={style.sway_amplitude ?? 40}
                      onChange={(e) => setStyle(s => ({ ...s, sway_amplitude: parseInt(e.target.value) }))} />
                  </>
                )}
              </div>
            </StRow>

            {/* Clips a exportar (expandable) */}
            <StRow icon={<Film size={15} />} label="Clips a exportar" summary={`${selectedClipIds.size} de ${clips.length}`} defaultOpen>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button className="st-btn st-btn--ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={selectAll}>Todos</button>
                <button className="st-btn st-btn--ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={selectNone}>Ninguno</button>
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {clips.map(c => {
                  const on = selectedClipIds.has(c.id);
                  return (
                    <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: on ? "var(--st-soft)" : "transparent", borderRadius: 8, cursor: "pointer", fontSize: 12, border: `1px solid ${on ? "var(--st-border)" : "var(--st-line)"}` }}>
                      <input type="checkbox" checked={on} onChange={() => toggleClipSelection(c.id)} style={{ accentColor: "var(--st-accent)" }} />
                      <span style={{ fontFamily: "var(--st-mono)", fontSize: 10.5, color: "var(--st-faint)" }}>{String(c.id).padStart(2, "0")}</span>
                      <span style={{ color: "var(--st-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{c.description}</span>
                      <span style={{ fontFamily: "var(--st-mono)", fontSize: 10.5, color: "var(--st-faint)", flexShrink: 0 }}>{c.duration.toFixed(0)}s</span>
                    </label>
                  );
                })}
              </div>
            </StRow>
          </div>

          {/* Inspector footer: export */}
          <div style={{ borderTop: "1px solid var(--st-line)", padding: "12px 16px", display: "flex", gap: 8 }}>
            <button onClick={() => handleExport("tiktok")} disabled={selectedClipIds.size === 0} className="st-btn st-btn--ghost" style={{ flex: 1, justifyContent: "center", padding: "9px 0" }}>
              <Download size={14} /> TikTok
            </button>
            <button onClick={() => handleExport("instagram")} disabled={selectedClipIds.size === 0} className="st-btn st-btn--primary" style={{ flex: 1, justifyContent: "center", padding: "9px 0" }}>
              <ImageIcon size={14} /> Instagram
            </button>
          </div>
        </div>
      </div>

      {/* Clip Editor Modal */}
      {editorClip && (
        <ClipEditorModal
          projectId={projectId}
          clip={editorClip}
          fillMode={style.fill_mode}
          backgroundStyle={style.background_style}
          onClose={() => setEditorClip(null)}
          onSaved={(updated) => {
            if (onUpdateClip) onUpdateClip(updated.id, updated);
            if (selectedClip && selectedClip.id === updated.id) {
              setSelectedClip({ ...selectedClip, ...updated });
              setPreviewUrl(null);
              setVideoPreviewUrl(null);
            }
            setEditorClip(null);
          }}
        />
      )}

      {/* Hidden file input for music upload — triggered by the "Subir música"
          button in the Música section of the inspector. */}
      <input ref={musicFileRef} type="file" accept="audio/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleMusicUpload(f); e.target.value = ""; }} />

      {/* Inline caption-text editor — Enter inserts a hard line break (\n)
          that the PIL renderer respects when laying out the white box. */}
      {editingCaption && (
        <div
          onClick={() => !savingCaption && setEditingCaption(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.55)",
            display: "grid", placeItems: "center", zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 460, background: "var(--st-surface)", border: "1px solid var(--st-line)",
              borderRadius: 14, padding: 20, boxShadow: "var(--st-shadow-modal)",
              fontFamily: "var(--st-ui)",
            }}
          >
            <h3 style={{ fontFamily: "var(--st-display)", fontSize: 17, fontWeight: 600, margin: "0 0 4px", color: "var(--st-text)" }}>
              Editar texto del caption
            </h3>
            <p style={{ fontSize: 12, color: "var(--st-faint)", margin: "0 0 12px" }}>
              Enter = nueva línea · Esc para cancelar
            </p>
            <textarea
              autoFocus
              value={editingCaption.text}
              onChange={(e) => setEditingCaption({ ...editingCaption, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingCaption(null);
              }}
              rows={4}
              style={{
                width: "100%", padding: "10px 12px",
                fontFamily: "var(--st-ui)", fontSize: 14, color: "var(--st-text)",
                background: "var(--st-alt)", border: "1px solid var(--st-line)",
                borderRadius: 8, outline: "none", resize: "vertical", minHeight: 80,
              }}
              placeholder="Escribí el caption. Apretá Enter para pasar palabras a la línea siguiente."
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button
                onClick={() => setEditingCaption(null)}
                disabled={savingCaption}
                className="st-btn st-btn--ghost"
                style={{ padding: "7px 14px" }}
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (!editingCaption) return;
                  setSavingCaption(true);
                  try {
                    await api.editCaption(projectId, editingCaption.id, editingCaption.text);
                    if (onUpdateClip) onUpdateClip(editingCaption.id, { viral_caption: editingCaption.text });
                    if (selectedClip && selectedClip.id === editingCaption.id) {
                      setSelectedClip({ ...selectedClip, viral_caption: editingCaption.text });
                      setPreviewUrl(null);          // force the preview to re-render
                      setVideoPreviewUrl(null);
                    }
                    setEditingCaption(null);
                  } catch (err) {
                    alert("No se pudo guardar el caption: " + err.message);
                  } finally {
                    setSavingCaption(false);
                  }
                }}
                disabled={savingCaption}
                className="st-btn st-btn--primary"
                style={{ padding: "7px 14px" }}
              >
                {savingCaption ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
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
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span style={{ width: 48, height: 4, borderRadius: 99, background: "var(--st-alt)", overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", height: "100%", borderRadius: 99, background: "var(--st-live)", width: `${pct}%`, transition: "width 1s linear" }} />
      </span>
      <span style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-muted)" }}>{fmt(remaining)}</span>
    </span>
  );
}

// Chart + top-peaks panel for the chat-velocity tab. Pure CSS bars, no SVG —
// so it scales with the modal and stays light. Hover a bar to see the time
// and exact count; click a top-peak row to autopopulate the HH:MM:SS inputs.
function ChatVelocityPanel({
  status, progress, totalMessages, error, buckets, peaks, duration,
  onRetry, onPickPeak, fmtHMS,
}) {
  // While running, show progress
  if (status === "running" || status === "idle") {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--st-muted)", fontSize: 13 }}>
        <div style={{ fontSize: 14, color: "var(--st-text)", marginBottom: 6 }}>
          Procesando chat del VOD…
        </div>
        <div style={{ fontSize: 12 }}>
          {totalMessages > 0 ? `${totalMessages.toLocaleString()} mensajes leídos` : "Conectando a Twitch…"}
        </div>
        <div style={{ width: "60%", margin: "16px auto 4px", background: "var(--st-alt)", borderRadius: 99, height: 6, overflow: "hidden" }}>
          <div style={{
            width: `${Math.max(5, progress || 5)}%`,
            background: "var(--st-accent)", height: "100%", borderRadius: 99,
            transition: "width 0.6s",
          }} />
        </div>
        <div style={{ fontSize: 11, color: "var(--st-faint)", marginTop: 4, fontFamily: "var(--st-mono)" }}>
          puede tardar 1-2 min en streams largos
        </div>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: "10px 13px", borderRadius: 9, background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.25)", color: "var(--st-live)", fontSize: 13, marginBottom: 12 }}>
          {error || "Falló el análisis del chat"}
        </div>
        <button onClick={onRetry} className="st-btn st-btn--ghost" style={{ padding: "8px 14px" }}>
          Reintentar
        </button>
      </div>
    );
  }
  // status === "ready"
  if (!buckets || buckets.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--st-muted)", fontSize: 13 }}>
        Este VOD no tiene chat replay disponible.
      </div>
    );
  }

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const peakTimes = new Set(peaks.map((p) => p.time));

  return (
    <div style={{ padding: "12px 18px 18px" }}>
      {/* Summary */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, fontSize: 12, color: "var(--st-muted)" }}>
        <span>
          <b style={{ color: "var(--st-text)" }}>{totalMessages.toLocaleString()}</b> mensajes ·
          duración del chat <b style={{ color: "var(--st-text)" }}>{fmtHMS(duration)}</b>
        </span>
        <span style={{ fontFamily: "var(--st-mono)", fontSize: 11 }}>
          Pico máximo: {maxCount} msgs / 10s
        </span>
      </div>

      {/* Chart — pure CSS bars. Peaks are highlighted in gold. */}
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 1,
        height: 110, padding: "6px 4px",
        background: "var(--st-soft)", border: "1px solid var(--st-line)",
        borderRadius: 8, marginBottom: 6, overflow: "hidden",
      }}>
        {buckets.map((b, i) => {
          const heightPct = Math.max(2, (b.count / maxCount) * 100);
          const isPeak = peakTimes.has(b.time);
          return (
            <div
              key={i}
              title={`${fmtHMS(b.time)} — ${b.count} msgs, ${b.emote_count} emote-spam`}
              style={{
                flex: 1, minWidth: 1, height: `${heightPct}%`,
                background: isPeak ? "var(--st-gold, #e6c270)" : "var(--st-accent)",
                opacity: isPeak ? 1 : 0.5,
                borderRadius: 1,
              }}
            />
          );
        })}
      </div>
      {/* X-axis time labels (4 evenly spaced) */}
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--st-mono)", fontSize: 10, color: "var(--st-faint)", marginBottom: 16, padding: "0 4px" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
          <span key={i}>{fmtHMS(Math.round(duration * p))}</span>
        ))}
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 6 }}>
        Top picos de chat
      </div>
      {peaks.map((p, idx) => (
        <div
          key={idx}
          onClick={() => onPickPeak(p)}
          style={{
            display: "flex", alignItems: "center", gap: 12, padding: "9px 12px",
            cursor: "pointer", borderRadius: 8,
            border: "1px solid var(--st-line)", marginBottom: 4,
            transition: "background .12s",
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--st-soft)"}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        >
          <span style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)", width: 22, textAlign: "right" }}>
            {String(idx + 1).padStart(2, "0")}
          </span>
          <span style={{ fontFamily: "var(--st-mono)", fontSize: 12, fontWeight: 600, color: "var(--st-text)", width: 76 }}>
            {fmtHMS(p.time)}
          </span>
          <span style={{ fontFamily: "var(--st-mono)", fontSize: 11.5, color: "var(--st-muted)", flex: 1 }}>
            {p.count} msgs/10s
          </span>
          <span style={{
            fontFamily: "var(--st-mono)", fontSize: 10.5,
            background: p.emote_pct > 50 ? "var(--st-gold, #e6c270)" : "var(--st-alt)",
            color: p.emote_pct > 50 ? "#15130e" : "var(--st-muted)",
            padding: "2px 7px", borderRadius: 99, fontWeight: 600,
          }}>
            {p.emote_pct}% emotes
          </span>
          <Download size={13} style={{ color: "var(--st-accent)", flexShrink: 0 }} />
        </div>
      ))}
      {peaks.length === 0 && (
        <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: "var(--st-faint)" }}>
          No se detectaron picos claros — el chat fue parejo durante todo el stream.
        </div>
      )}
    </div>
  );
}

// ================================================
// DOWNLOADER MODE — universal video downloader (yt-dlp)
// Supports YouTube, Instagram, TikTok (no watermark), Twitter, Twitch, Reddit, …
// ================================================
const PLATFORM_LABELS = {
  youtube: "📺 YouTube",
  tiktok: "🎵 TikTok",
  instagram: "📸 Instagram",
  twitter: "🐦 Twitter / X",
  twitch: "💜 Twitch",
  reddit: "🤖 Reddit",
  vimeo: "🎬 Vimeo",
  other: "🌐 Otro sitio",
};

function detectUrlPlatform(url) {
  const u = (url || "").toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("twitter.com") || u.includes("x.com")) return "twitter";
  if (u.includes("twitch.tv")) return "twitch";
  if (u.includes("reddit.com") || u.includes("redd.it")) return "reddit";
  if (u.includes("vimeo.com")) return "vimeo";
  return "other";
}

const fmtBytes = (n) => {
  if (!n) return "—";
  if (n > 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
};

const fmtSpeed = (bps) => {
  if (!bps) return "—";
  if (bps > 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(bps / 1024).toFixed(0)} KB/s`;
};

const fmtDuration = (sec) => {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};

function DownloaderStep({ onSendToClipper }) {
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState("max");     // "max" | "1080" | "720"
  const [audioOnly, setAudioOnly] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  const platform = detectUrlPlatform(url);

  // Load existing downloads on mount + poll while any job is active
  useEffect(() => {
    const loadJobs = async () => {
      try {
        const data = await api.listDownloads();
        setJobs(data || []);
      } catch (_) {}
    };
    loadJobs();
  }, []);

  useEffect(() => {
    const anyActive = jobs.some((j) => j.status === "queued" || j.status === "downloading" || j.status === "merging");
    if (!anyActive) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const data = await api.listDownloads();
        setJobs(data || []);
      } catch (_) {}
    }, 1500);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [jobs]);

  const handleStart = async () => {
    if (!url.trim()) { setError("Pegá un link"); return; }
    setError("");
    setStarting(true);
    try {
      const job = await api.startDownload(url.trim(), quality, audioOnly);
      setJobs((prev) => [job, ...prev]);
      setUrl("");
    } catch (e) {
      setError(e.message || "No se pudo iniciar la descarga");
    } finally {
      setStarting(false);
    }
  };

  const handleDelete = async (id) => {
    await api.deleteDownload(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  };

  return (
    <div style={{ padding: "30px 0", height: "100vh", overflowY: "auto" }}>
      <div style={{ maxWidth: 740, margin: "0 auto", padding: "0 32px" }}>
        <h1 style={{ margin: 0, fontFamily: "var(--st-display)", fontSize: 28, fontWeight: 600, letterSpacing: "-.025em" }}>
          Descargas
        </h1>
        <p style={{ margin: "6px 0 24px", fontSize: 14, color: "var(--st-muted)", lineHeight: 1.5 }}>
          Bajá videos de YouTube, Instagram, TikTok (sin watermark), Twitter, Twitch, Reddit y más. Calidad máxima por default.
        </p>

        {/* ── New download form ── */}
        <div className="st-card" style={{ padding: "22px 24px", marginBottom: 22 }}>
          <div className="st-eyebrow" style={{ marginBottom: 8 }}>URL del video</div>
          <div style={{
            display: "flex", alignItems: "center", gap: 9,
            background: "var(--st-soft)", border: `1px solid ${url ? "var(--st-accent)" : "var(--st-border)"}`,
            borderRadius: 10, padding: "11px 13px", marginBottom: 18, transition: "border-color .15s",
          }}>
            <Download size={16} style={{ color: "var(--st-muted)", flexShrink: 0 }} />
            <input
              type="text"
              placeholder="youtube.com/watch?v=... · tiktok.com/@user/video/... · instagram.com/reel/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleStart()}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--st-text)", fontFamily: "var(--st-mono)", fontSize: 12.5 }}
            />
            {url && (
              <span style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-accent)", flexShrink: 0, fontWeight: 700 }}>
                {PLATFORM_LABELS[platform] || platform}
              </span>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 8 }}>Calidad</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[["max", "Máxima"], ["1080", "1080p"], ["720", "720p"]].map(([v, label]) => {
                  const on = quality === v && !audioOnly;
                  return (
                    <span key={v} onClick={() => { setQuality(v); setAudioOnly(false); }} style={{
                      flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 8,
                      fontSize: 12, fontWeight: 600, cursor: "pointer",
                      border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`,
                      background: on ? "var(--st-soft)" : "transparent",
                      color: on ? "var(--st-text)" : "var(--st-muted)",
                    }}>{label}</span>
                  );
                })}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 8 }}>Formato</div>
              <span onClick={() => setAudioOnly((v) => !v)} style={{
                display: "block", textAlign: "center", padding: "8px 0", borderRadius: 8,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${audioOnly ? "var(--st-accent)" : "var(--st-border)"}`,
                background: audioOnly ? "var(--st-soft)" : "transparent",
                color: audioOnly ? "var(--st-text)" : "var(--st-muted)",
              }}>{audioOnly ? "🎵 Audio (MP3)" : "🎬 Video (MP4)"}</span>
            </div>
          </div>

          {error && (
            <div style={{ color: "var(--st-live)", fontSize: 13, marginBottom: 14, background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.25)", padding: "10px 13px", borderRadius: 9 }}>
              {error}
            </div>
          )}

          <button onClick={handleStart} disabled={starting || !url.trim()}
            className="st-btn st-btn--primary"
            style={{ width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 14 }}>
            {starting ? "Iniciando…" : <><Download size={15} /> Descargar</>}
          </button>

          {platform === "tiktok" && url && (
            <p style={{ fontSize: 11, color: "var(--st-faint)", margin: "10px 0 0", textAlign: "center" }}>
              TikTok: descargamos la versión <b style={{ color: "var(--st-text)" }}>sin watermark</b> automáticamente.
            </p>
          )}
        </div>

        {/* ── Downloads list ── */}
        {jobs.length > 0 && (
          <div className="st-card" style={{ padding: "16px 18px" }}>
            <div className="st-eyebrow" style={{ marginBottom: 12 }}>Descargas ({jobs.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {jobs.map((j) => (
                <DownloadRow
                  key={j.id} job={j}
                  onDelete={() => handleDelete(j.id)}
                  onSendToClipper={onSendToClipper}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DownloadRow({ job, onDelete, onSendToClipper }) {
  const isActive = job.status === "queued" || job.status === "downloading" || job.status === "merging";
  const isReady = job.status === "ready";
  const isError = job.status === "error";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 14px", borderRadius: 10,
      background: "var(--st-soft)", border: "1px solid var(--st-line)",
    }}>
      <span style={{ fontFamily: "var(--st-mono)", fontSize: 10.5, color: "var(--st-faint)", width: 76, flexShrink: 0 }}>
        {PLATFORM_LABELS[job.platform] || job.platform}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--st-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {job.title || job.url}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--st-muted)", marginTop: 2, display: "flex", gap: 10, fontFamily: "var(--st-mono)", flexWrap: "wrap" }}>
          {job.uploader && <span>{job.uploader}</span>}
          {job.duration_seconds > 0 && <><span>·</span><span>{fmtDuration(job.duration_seconds)}</span></>}
          {isActive && (
            <>
              <span>·</span>
              <span>
                {job.status === "merging" ? "Mergeando audio + video…" :
                 job.status === "queued" ? "En cola…" :
                 `${job.progress}% · ${fmtSpeed(job.speed_bps)} · ${fmtBytes(job.downloaded_bytes)} / ${fmtBytes(job.total_bytes)}`}
              </span>
            </>
          )}
          {isReady && job.filesize_mb > 0 && (
            <>
              <span>·</span>
              <span>{job.filesize_mb} MB</span>
            </>
          )}
          {isError && (
            <>
              <span>·</span>
              <span style={{ color: "var(--st-live)" }} title={job.error}>⚠ {job.error?.slice(0, 50) || "Error"}</span>
            </>
          )}
        </div>
        {isActive && job.progress > 0 && (
          <div style={{ background: "var(--st-alt)", borderRadius: 99, height: 4, marginTop: 6, overflow: "hidden" }}>
            <div style={{
              width: `${Math.max(2, job.progress)}%`,
              background: "var(--st-accent)", height: "100%", borderRadius: 99,
              transition: "width 0.3s",
            }} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {isReady && (
          <a href={api.getDownloadFileUrl(job.id)} download className="st-iconbtn"
             style={{ textDecoration: "none" }} title="Descargar archivo">
            <Download size={15} />
          </a>
        )}
        <button onClick={onDelete} className="st-iconbtn" title="Eliminar">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
// Compact HH:MM:SS triple-input used by the VOD slice picker.
function HmsInput({ label, value, onChange }) {
  const clamp = (v, max) => Math.max(0, Math.min(max, parseInt(v || 0) || 0));
  const cell = {
    width: "100%", padding: "8px 0", textAlign: "center",
    background: "var(--st-soft)", border: "1px solid var(--st-border)",
    borderRadius: 8, color: "var(--st-text)", fontFamily: "var(--st-mono)",
    fontSize: 14, fontWeight: 600, outline: "none",
  };
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 8 }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, alignItems: "center" }}>
        <input type="number" min={0} max={23} value={value.h}
          onChange={(e) => onChange({ ...value, h: clamp(e.target.value, 23) })} style={cell} />
        <input type="number" min={0} max={59} value={value.m}
          onChange={(e) => onChange({ ...value, m: clamp(e.target.value, 59) })} style={cell} />
        <input type="number" min={0} max={59} value={value.s}
          onChange={(e) => onChange({ ...value, s: clamp(e.target.value, 59) })} style={cell} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginTop: 4, fontFamily: "var(--st-mono)", fontSize: 10, color: "var(--st-faint)", textAlign: "center" }}>
        <span>HH</span><span>MM</span><span>SS</span>
      </div>
    </div>
  );
}

function LiveStreamStep({ onClipToProject }) {
  // Tab inside Live Stream: "record" (existing recording/VOD flow) or
  // "pescar" (live-clip pescador — polls platform every 60s, accumulates
  // every clip viewers create during the stream).
  const [liveTab, setLiveTab] = useState("record");

  // ── Pescador state ──────────────────────────────────────────────────────
  const [pescPlatform, setPescPlatform] = useState("kick");   // "kick" | "twitch"
  const [pescChannel, setPescChannel] = useState("");
  const [pescSession, setPescSession] = useState(null);       // {session_id, status, found_clips, ...}
  const [pescStarting, setPescStarting] = useState(false);
  const [pescError, setPescError] = useState("");
  const [pescSelected, setPescSelected] = useState(new Set());
  const [pescDownloading, setPescDownloading] = useState(new Set());  // clip ids being downloaded
  const [pescSort, setPescSort] = useState("recent");          // "recent" | "views"
  const [pescSearch, setPescSearch] = useState("");
  const [pescProcessing, setPescProcessing] = useState(null);  // {phase, name, progress} during batch
  const pescPollRef = useRef(null);

  const [url, setUrl] = useState("");
  const [segmentMinutes, setSegmentMinutes] = useState(10);
  const [resolution, setResolution] = useState("720p");
  const [startOffset, setStartOffset] = useState(0);
  const [sessionId, setSessionId] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // VOD slice inputs (HH:MM:SS) — used when the URL is a VOD (/videos/ or /video/)
  const [vodStart, setVodStart] = useState({ h: 0, m: 0, s: 0 });
  const [vodDur, setVodDur] = useState({ h: 0, m: 30, s: 0 });
  // Auto-detect VOD URLs as the user types
  const isVod = /\/videos?\/[a-zA-Z0-9]+/i.test(url);
  // Twitch is the only platform we can hit Helix on for "top viewer clips".
  const isTwitchVod = isVod && /twitch\.tv/i.test(url);
  // Kick mirrors Twitch with a different backend route — same UI flow.
  const isKickVod = isVod && /kick\.com/i.test(url);
  // Either platform → the viral-clips button is offered.
  const isViralClipVod = isTwitchVod || isKickVod;
  const vodPlatform = isKickVod ? "kick" : (isTwitchVod ? "twitch" : "");
  // Viral clips modal state
  const [viralOpen, setViralOpen] = useState(false);
  const [viralTab, setViralTab] = useState("clips");        // "clips" | "chat"
  const [viralClips, setViralClips] = useState([]);
  const [viralLoading, setViralLoading] = useState(false);
  const [viralError, setViralError] = useState("");
  // Chat-velocity state (Nivel 2)
  const [chatStatus, setChatStatus] = useState("idle");     // idle | running | ready | error
  const [chatProgress, setChatProgress] = useState(0);
  const [chatTotalMsgs, setChatTotalMsgs] = useState(0);
  const [chatBuckets, setChatBuckets] = useState([]);
  const [chatPeaks, setChatPeaks] = useState([]);
  const [chatDuration, setChatDuration] = useState(0);
  const [chatError, setChatError] = useState("");
  const chatPollRef = useRef(null);

  const fmtHMS = (totalSec) => {
    const t = Math.max(0, Math.floor(totalSec));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const loadViralClips = async () => {
    setViralLoading(true);
    setViralError("");
    setViralOpen(true);
    try {
      // Route to the right backend by platform — response shape matches so
      // the rest of the modal renders identically.
      const data = vodPlatform === "kick"
        ? await api.getKickClips(url.trim(), 500)
        : await api.getTwitchClips(url.trim(), 500);
      setViralClips(data.clips || []);
      if (!data.clips || data.clips.length === 0) {
        setViralError("Este VOD no tiene clips publicados por viewers (todavía).");
      }
    } catch (e) {
      setViralError(e.message || "No se pudieron cargar los clips");
      setViralClips([]);
    } finally {
      setViralLoading(false);
    }
  };

  // One-click pipeline: clip → Gemini project → Clipper editor.
  // Replaces the older "autopopulate HH:MM:SS inputs" behaviour.
  const [processingClip, setProcessingClip] = useState(null);  // { phase, name, progress } or null
  const [processingError, setProcessingError] = useState("");
  // Multi-select state — Set of clip.id, plus optional batch broadcaster
  const [selectedClips, setSelectedClips] = useState(new Set());
  const toggleClipSelected = (id) => {
    setSelectedClips((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Batch handler — send N selected clips into ClipsStep WITHOUT Gemini so the
  // user can re-analyze them (one or a few at a time) at their own pace.
  const processSelectedClips = async () => {
    if (selectedClips.size === 0) return;
    const picks = viralClips.filter((c) => selectedClips.has(c.id));
    if (picks.length === 0) return;
    setProcessingError("");
    setProcessingClip({
      phase: "downloading",
      name: `${picks.length} clips`,
      progress: `0/${picks.length}`,
    });
    try {
      const start = vodPlatform === "kick"
        ? await api.processKickClipsBatch(
            // Send the full URL too — yt-dlp's Kick extractor needs the
            // channel-prefixed form (kick.com/<channel>/clips/<id>) or it
            // routes the URL to the wrong extractor and 403s.
            picks.map((c) => ({ slug: c.id, title: c.title, url: c.url })),
            picks[0].broadcaster_name || "",
            "",
            false,   // analyze_with_gemini = false → land in Clips immediately
          )
        : await api.processTwitchClipsBatch(
            picks.map((c) => ({ slug: c.id, title: c.title })),
            picks[0].broadcaster_name || "",
            "",
            false,   // analyze_with_gemini = false → land in Clips immediately
          );
      const projectId = start.project_id;
      // No Gemini: the project is already "ready". Just grab the clips and go.
      const data = await api.getClips(projectId);
      if (onClipToProject) {
        onClipToProject(projectId, data.clips || [], `${picks.length} clips virales`);
      }
      setProcessingClip(null);
      setViralOpen(false);
      setSelectedClips(new Set());
    } catch (e) {
      setProcessingError(e.message || "No se pudo enviar el batch a Clips");
      setProcessingClip(null);
    }
  };

  const useViralClip = async (clip) => {
    if (!clip || !clip.id) return;
    setProcessingError("");
    setProcessingClip({ phase: "downloading", name: clip.title });
    try {
      const start = vodPlatform === "kick"
        ? await api.processKickClip(
            clip.id,
            clip.title,
            clip.broadcaster_name || "",
            "",
          )
        : await api.processTwitchClip(
            clip.id,
            clip.title,
            clip.broadcaster_name || "",
            "",     // gemini_model — backend will use project default
          );
      const projectId = start.project_id;
      setProcessingClip({ phase: "analyzing", name: clip.title });
      // Poll until ready or error
      const deadline = Date.now() + 5 * 60 * 1000;   // 5 min max
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const s = await api.getProjectStatus(projectId).catch(() => null);
        if (!s) continue;
        if (s.status === "ready") {
          const data = await api.getClips(projectId);
          if (onClipToProject) {
            onClipToProject(projectId, data.clips || [], clip.title);
          }
          setProcessingClip(null);
          setViralOpen(false);
          return;
        }
        if (s.status === "error") {
          throw new Error("Gemini falló al analizar el clip");
        }
      }
      throw new Error("Tiempo agotado esperando el análisis");
    } catch (e) {
      setProcessingError(e.message || "No se pudo procesar el clip");
      setProcessingClip(null);
    }
  };

  // Click on a chat-velocity peak → autopopulate inputs (15s lead, 60s total)
  const useChatPeak = (peak) => {
    const lead = 15;
    const total = 60;
    const startSec = Math.max(0, (peak.time || 0) - lead);
    setVodStart({
      h: Math.floor(startSec / 3600),
      m: Math.floor((startSec % 3600) / 60),
      s: startSec % 60,
    });
    setVodDur({ h: 0, m: 1, s: 0 });   // 1 minute default
    setViralOpen(false);
  };

  // ── Chat velocity download / polling ──────────────────────────────────────
  const loadChatVelocity = async () => {
    setChatError("");
    setChatStatus("running");
    setChatProgress(0);
    setChatBuckets([]);
    setChatPeaks([]);
    try {
      await api.startTwitchChatVelocity(url.trim());
    } catch (e) {
      setChatError(e.message || "No se pudo iniciar el análisis de chat");
      setChatStatus("error");
      return;
    }
    // Poll every 1.5s until ready or error
    const vid = (url.match(/\/videos?\/(\w+)/i) || [])[1];
    if (!vid) { setChatError("No se pudo extraer el video_id"); setChatStatus("error"); return; }
    const poll = async () => {
      try {
        const data = await api.getTwitchChatVelocity(vid);
        setChatProgress(data.progress || 0);
        setChatTotalMsgs(data.total_messages || 0);
        if (data.status === "ready") {
          setChatBuckets(data.buckets || []);
          setChatPeaks(data.peaks || []);
          setChatDuration(data.duration_seconds || 0);
          setChatStatus("ready");
          clearInterval(chatPollRef.current);
        } else if (data.status === "error") {
          setChatError(data.error || "Falló el análisis");
          setChatStatus("error");
          clearInterval(chatPollRef.current);
        }
      } catch (e) {
        setChatError(e.message);
        setChatStatus("error");
        clearInterval(chatPollRef.current);
      }
    };
    poll();
    chatPollRef.current = setInterval(poll, 1500);
  };

  // Clean up the poller if the modal closes mid-job
  useEffect(() => {
    if (!viralOpen && chatPollRef.current) {
      clearInterval(chatPollRef.current);
      chatPollRef.current = null;
    }
  }, [viralOpen]);
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
      const opts = {};
      if (isVod) {
        const startSec = vodStart.h * 3600 + vodStart.m * 60 + vodStart.s;
        const durSec = vodDur.h * 3600 + vodDur.m * 60 + vodDur.s;
        if (durSec <= 0) {
          setError("La duración debe ser mayor a 0");
          setLoading(false);
          return;
        }
        opts.singleShot = true;
        opts.startOffsetSeconds = startSec;
        opts.durationSeconds = durSec;
      }
      const res = await api.startStream(url.trim(), segmentMinutes, 5, resolution, startOffset, opts);
      setSessionId(res.session_id);
      setSessionData({ session_id: res.session_id, status: res.status, segments: [], ready_count: 0, is_vod: res.is_vod });
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

  // ── Pescador handlers ───────────────────────────────────────────────────
  const startPesc = async () => {
    const channel = pescChannel.trim();
    if (!channel) { setPescError("Ingresá un nombre de canal"); return; }
    setPescStarting(true);
    setPescError("");
    try {
      const snap = await api.startLiveClipsSession(pescPlatform, channel);
      setPescSession(snap);
    } catch (e) {
      setPescError(e.message || "No se pudo iniciar la sesión");
    } finally {
      setPescStarting(false);
    }
  };

  const stopPesc = async () => {
    if (!pescSession?.session_id) return;
    try {
      const snap = await api.stopLiveClipsSession(pescSession.session_id);
      setPescSession(snap);
    } catch (e) {
      setPescError(e.message);
    }
  };

  const resetPesc = () => {
    setPescSession(null);
    setPescChannel("");
    setPescSelected(new Set());
    setPescError("");
    setPescSearch("");
  };

  // Auto-refresh the session status every 5s while running.
  useEffect(() => {
    if (!pescSession?.session_id) return;
    if (pescSession.status === "stopped") return;
    const id = pescSession.session_id;
    pescPollRef.current = setInterval(async () => {
      try {
        const snap = await api.getLiveClipsStatus(id);
        setPescSession(snap);
        if (snap.status === "stopped") clearInterval(pescPollRef.current);
      } catch (_) { /* keep trying */ }
    }, 5000);
    return () => clearInterval(pescPollRef.current);
  }, [pescSession?.session_id, pescSession?.status]);

  const togglePescSel = (id) => {
    setPescSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const pescSelectAll = () => {
    const ids = (pescSession?.found_clips || []).map((c) => c.id);
    setPescSelected(new Set(ids));
  };
  const pescDeselectAll = () => setPescSelected(new Set());

  // Filtered + sorted list shown to the user.
  const pescFilteredClips = (() => {
    let arr = pescSession?.found_clips || [];
    if (pescSearch.trim()) {
      const q = pescSearch.toLowerCase();
      arr = arr.filter((c) => (c.title || "").toLowerCase().includes(q) ||
                              (c.creator_name || "").toLowerCase().includes(q));
    }
    if (pescSort === "views") {
      arr = [...arr].sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
    } else {
      arr = [...arr].sort((a, b) => (b.discovered_at || "").localeCompare(a.discovered_at || ""));
    }
    return arr;
  })();

  // Process selected pescador clips with the existing Kick/Twitch batch flow.
  // Download ONE pescador clip (raw MP4, no Gemini). Fetches the blob and
  // triggers a browser save.
  const downloadPescClip = async (c) => {
    if (!pescSession || pescDownloading.has(c.id)) return;
    setPescDownloading((s) => new Set(s).add(c.id));
    try {
      const blob = await api.downloadPescClipBlob(pescSession.platform, c.id, c.url, c.title);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `${(c.title || "clip").replace(/[^\w\-]+/g, "_").slice(0, 50) || "clip"}.mp4`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 15000);
    } catch (e) {
      alert("No se pudo descargar el clip: " + e.message);
    } finally {
      setPescDownloading((s) => { const n = new Set(s); n.delete(c.id); return n; });
    }
  };

  // Send selected pescador clips into ClipsStep WITHOUT Gemini — the user
  // re-analyzes them (one or a few at a time) at their own pace from Clips.
  const processPescSelected = async () => {
    if (!pescSession || pescSelected.size === 0) return;
    const platform = pescSession.platform;
    const picks = (pescSession.found_clips || []).filter((c) => pescSelected.has(c.id));
    if (picks.length === 0) return;
    setPescProcessing({
      phase: "downloading",
      name: `${picks.length} clips`,
      progress: `0/${picks.length}`,
    });
    try {
      const items = picks.map((c) => ({ slug: c.id, title: c.title, url: c.url }));
      const start = platform === "kick"
        ? await api.processKickClipsBatch(items, picks[0].broadcaster_name || "", "", false)
        : await api.processTwitchClipsBatch(items, picks[0].broadcaster_name || "", "", false);
      const projectId = start.project_id;
      // No Gemini: the project is already "ready". Just grab the clips and go.
      const data = await api.getClips(projectId);
      if (onClipToProject) {
        onClipToProject(projectId, data.clips || [], `${picks.length} clips pescados`);
      }
      setPescProcessing(null);
      setPescSelected(new Set());
      setPescSession({ ...pescSession, found_clips: (pescSession.found_clips || []).filter((c) => !pescSelected.has(c.id)) });
    } catch (e) {
      setPescError(e.message || "No se pudo enviar a Clips");
      setPescProcessing(null);
    }
  };

  const isActive = sessionData && (sessionData.status === "recording" || sessionData.status === "starting");
  const segments = sessionData?.segments ?? [];
  const readyCount = sessionData?.ready_count ?? 0;

  return (
    <div style={{ padding: "30px 0", height: "100vh", overflowY: "auto" }}>
      <div style={{ maxWidth: 620, margin: "0 auto", padding: "0 32px" }}>
        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--st-display)", fontSize: 28, fontWeight: 600, letterSpacing: "-.025em" }}>Live Stream Clipper</h1>
          {isActive && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--st-mono)", fontSize: 11, fontWeight: 600, color: "var(--st-text)", border: "1px solid var(--st-border)", padding: "3px 9px", borderRadius: 99 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--st-live)" }} /> REC
            </span>
          )}
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 14, color: "var(--st-muted)", lineHeight: 1.5 }}>
          Graba un stream de Twitch o Kick en segmentos. Descargalos y subilos al Clipper para extraer clips con Gemini.
        </p>

        {/* Tabs inside Live Stream — "Grabar" (existing flow) and
            "Pescar" (live-clip pescador, polls every ~60s). */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--st-line)", marginBottom: 22 }}>
          {[["record", "🔴 Grabar stream"], ["pescar", "👀 Pescar clips en vivo"]].map(([k, label]) => {
            const active = liveTab === k;
            return (
              <div key={k} onClick={() => setLiveTab(k)}
                style={{
                  padding: "9px 16px", cursor: "pointer",
                  fontFamily: "var(--st-ui)", fontSize: 13, fontWeight: active ? 600 : 500,
                  color: active ? "var(--st-text)" : "var(--st-muted)",
                  borderBottom: `2px solid ${active ? "var(--st-accent)" : "transparent"}`,
                  marginBottom: -1, transition: "color .12s, border-color .12s",
                }}>{label}</div>
            );
          })}
        </div>

        {liveTab === "record" && (
          <>
        {!sessionId ? (
          /* ── Config card ── */
          <div className="st-card" style={{ padding: "22px 24px" }}>
            <div className="st-eyebrow" style={{ marginBottom: 8 }}>URL del stream</div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--st-soft)", border: `1px solid ${url ? "var(--st-accent)" : "var(--st-border)"}`, borderRadius: 10, padding: "11px 13px", marginBottom: 20, transition: "border-color .15s" }}>
              <Radio size={16} style={{ color: "var(--st-muted)", flexShrink: 0 }} />
              <input
                type="text"
                placeholder="twitch.tv/canal · twitch.tv/videos/123456 · kick.com/canal"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStart()}
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--st-text)", fontFamily: "var(--st-mono)", fontSize: 12.5 }}
              />
              <span style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: isVod ? "var(--st-accent)" : "var(--st-faint)", flexShrink: 0, fontWeight: isVod ? 700 : 400 }}>
                {isVod ? "VOD ✓" : "kick · twitch"}
              </span>
            </div>

            {isVod ? (
              /* ── VOD mode: HH:MM:SS slice inputs (single-shot, -c copy) ── */
              <>
                <div style={{ padding: "10px 12px", marginBottom: 12, borderRadius: 9, background: "var(--st-soft)", border: "1px solid var(--st-line)", fontSize: 12.5, color: "var(--st-muted)", lineHeight: 1.5 }}>
                  Detectamos un <b style={{ color: "var(--st-text)" }}>VOD</b>. Vamos a descargar solo el rango que pidas, sin re-encodear. Sale rápido.
                </div>

                {isViralClipVod && (
                  <button
                    onClick={loadViralClips}
                    className="st-btn st-btn--ghost"
                    style={{ width: "100%", justifyContent: "center", padding: "10px 0", fontSize: 13, marginBottom: 16, gap: 8 }}
                    title="Lista los clips que más views tienen entre los que hicieron los viewers"
                  >
                    🔍 Ver momentos virales del VOD {vodPlatform === "kick" ? "(Kick)" : "(Twitch)"}
                  </button>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                  <HmsInput label="Empezar en" value={vodStart} onChange={setVodStart} />
                  <HmsInput label="Duración" value={vodDur} onChange={setVodDur} />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 8 }}>Calidad</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {["480p", "720p", "1080p"].map((r) => {
                      const on = resolution === r;
                      return (
                        <span key={r} onClick={() => setResolution(r)} style={{
                          flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                          border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`, background: on ? "var(--st-soft)" : "transparent", color: on ? "var(--st-text)" : "var(--st-muted)",
                        }}>{r}</span>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              /* ── Live mode: continuous segment recording (original UI) ── */
              <>
                <div className="st-eyebrow" style={{ marginBottom: 10 }}>Duración por segmento</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
                  {[5, 7, 10, 15, 20, 30].map((m) => {
                    const on = segmentMinutes === m;
                    return (
                      <span key={m} onClick={() => setSegmentMinutes(m)} style={{
                        flex: 1, textAlign: "center", padding: "9px 0", borderRadius: 9, fontFamily: "var(--st-mono)", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                        border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`, background: on ? "var(--st-soft)" : "transparent", color: on ? "var(--st-text)" : "var(--st-muted)",
                      }}>{m}m</span>
                    );
                  })}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 8 }}>Resolución</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {["480p", "720p", "1080p"].map((r) => {
                        const on = resolution === r;
                        return (
                          <span key={r} onClick={() => setResolution(r)} style={{
                            flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                            border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`, background: on ? "var(--st-soft)" : "transparent", color: on ? "var(--st-text)" : "var(--st-muted)",
                          }}>{r}</span>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 8 }}>Empezar desde</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {[[0, "live"], [10, "−10"], [20, "−20"], [30, "−30"]].map(([mins, label]) => {
                        const on = startOffset === mins;
                        return (
                          <span key={mins} onClick={() => setStartOffset(mins)} title={mins === 0 ? "En vivo" : `${mins} min atrás`} style={{
                            flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 8, fontFamily: "var(--st-mono)", fontSize: 11, fontWeight: 600, cursor: "pointer",
                            border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`, background: on ? "var(--st-soft)" : "transparent", color: on ? "var(--st-text)" : "var(--st-muted)",
                          }}>{label}</span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            )}

            {error && (
              <div style={{ color: "var(--st-live)", fontSize: 13, marginBottom: 14, background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.25)", padding: "10px 13px", borderRadius: 9 }}>
                {error}
              </div>
            )}

            <button onClick={handleStart} disabled={loading || !url.trim()} className="st-btn st-btn--primary" style={{ width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 14 }}>
              {loading
                ? (isVod ? "Conectando…" : "Conectando...")
                : isVod
                  ? <><Download size={15} /> Descargar slice del VOD</>
                  : <><Play size={15} fill="currentColor" /> Iniciar grabación</>}
            </button>
          </div>
        ) : (
          /* ── Status + segments ── */
          <div className="st-card" style={{ padding: "18px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: isActive ? "var(--st-live)" : "var(--st-faint)", animation: isActive ? "pulse 1.5s infinite" : "none" }} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {isActive ? "Grabando" : sessionData?.status === "stopping" ? "Deteniendo…" : "Finalizado"}
                </span>
              </div>
              {isActive && <span style={{ fontFamily: "var(--st-mono)", fontSize: 12.5, color: "var(--st-muted)" }}>{formatElapsed(elapsed)}</span>}
              <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--st-muted)" }}>{readyCount} de {segments.length} listos</span>
              {isActive ? (
                <button onClick={handleStop} className="st-btn st-btn--ghost" style={{ padding: "6px 11px" }}>
                  <X size={13} /> Detener
                </button>
              ) : (
                <button onClick={handleReset} className="st-btn st-btn--primary" style={{ padding: "6px 11px" }}>
                  <RefreshCw size={13} /> Nueva sesión
                </button>
              )}
            </div>

            {sessionData?.error && (
              <div style={{ background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.25)", borderRadius: 9, padding: "10px 13px", marginBottom: 12, fontSize: 13, color: "var(--st-live)" }}>
                {sessionData.error}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {segments.map((seg) => (
                <div key={seg.index} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 10, background: "var(--st-soft)", border: "1px solid var(--st-line)" }}>
                  <span style={{ fontFamily: "var(--st-mono)", fontSize: 11.5, color: "var(--st-faint)", flexShrink: 0 }}>{String(seg.index + 1).padStart(2, "0")}</span>
                  <Film size={16} style={{ color: "var(--st-muted)", flexShrink: 0 }} />
                  <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>segmento_{String(seg.index + 1).padStart(2, "0")}.mp4</span>
                  {seg.status === "recording" && seg.started_at ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-muted)" }}>
                      <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--st-live)" }} />
                      <SegmentTimer startedAt={seg.started_at} totalMinutes={segmentMinutes} />
                    </span>
                  ) : seg.status === "ready" ? (
                    <>
                      <span style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)" }}>
                        {seg.duration_recorded > 0 ? `${Math.round(seg.duration_recorded / 60)}m` : ""}{seg.file_size_mb > 0 ? ` · ${seg.file_size_mb}MB` : ""}
                      </span>
                      <a href={`http://localhost:8000/api/stream/download/${sessionData.session_id}/${seg.index}`} download
                        title="Descargar" className="st-iconbtn" style={{ textDecoration: "none" }}>
                        <Download size={15} />
                      </a>
                    </>
                  ) : seg.status === "skipped" ? (
                    <span title={seg.error || ""} style={{ fontSize: 11.5, color: "var(--st-faint)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {seg.error ? `⚠ ${seg.error}` : "muy corto"}
                    </span>
                  ) : seg.status === "failed" ? (
                    <span title={seg.error || ""} style={{ fontSize: 11.5, color: "var(--st-live)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      ⚠ {seg.error || "Falló la descarga"}
                    </span>
                  ) : null}
                </div>
              ))}

              {isActive && segments.length === 0 && (
                <div style={{ padding: 18, textAlign: "center", fontSize: 13, color: "var(--st-faint)" }}>
                  Conectando al stream…
                </div>
              )}
            </div>

            {readyCount > 0 && (
              <div style={{ marginTop: 14, padding: "10px 13px", borderRadius: 10, background: "var(--st-soft)", border: "1px solid var(--st-line)", fontSize: 12.5, color: "var(--st-muted)", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--st-ok)", flexShrink: 0 }} />
                {readyCount} segmento{readyCount > 1 ? "s" : ""} listo{readyCount > 1 ? "s" : ""} — subilo{readyCount > 1 ? "s" : ""} al Video Clipper para extraer clips.
              </div>
            )}
          </div>
        )}

        {/* ─── Viral clips modal (Twitch Helix /clips) ─── */}
        {viralOpen && (
          <div
            onClick={() => setViralOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "grid", placeItems: "center", zIndex: 100, padding: 20 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%", maxWidth: 740, maxHeight: "85vh", display: "flex", flexDirection: "column",
                background: "var(--st-surface)", border: "1px solid var(--st-line)",
                borderRadius: 14, boxShadow: "var(--st-shadow-modal)", overflow: "hidden",
                fontFamily: "var(--st-ui)",
              }}
            >
              <div style={{ padding: "14px 18px 0", borderBottom: "1px solid var(--st-line)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <h3 style={{ fontFamily: "var(--st-display)", fontSize: 17, fontWeight: 600, margin: 0, color: "var(--st-text)" }}>
                      Momentos virales del VOD
                    </h3>
                    <p style={{ fontSize: 12, color: "var(--st-faint)", margin: "3px 0 0" }}>
                      Click en uno para autopopular los inputs HH:MM:SS
                    </p>
                  </div>
                  <X size={18} style={{ cursor: "pointer", color: "var(--st-muted)" }} onClick={() => setViralOpen(false)} />
                </div>
                {/* Tabs — "Hype del chat" only on Twitch (it uses Twitch's
                    chat replay endpoint). Kick doesn't expose chat in the
                    same way, so we hide the tab cleanly. */}
                <div style={{ display: "flex", gap: 4, marginTop: 14 }}>
                  {[
                    ["clips", "Top clips (viewers)"],
                    ...(vodPlatform === "twitch" ? [["chat", "★ Hype del chat"]] : []),
                  ].map(([k, label]) => {
                    const active = viralTab === k;
                    return (
                      <div
                        key={k}
                        onClick={() => {
                          setViralTab(k);
                          if (k === "chat" && chatStatus === "idle") loadChatVelocity();
                        }}
                        style={{
                          padding: "8px 14px",
                          fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                          color: active ? "var(--st-text)" : "var(--st-muted)",
                          borderBottom: `2px solid ${active ? "var(--st-accent)" : "transparent"}`,
                          marginBottom: -1,
                          transition: "color .12s, border-color .12s",
                        }}
                      >
                        {label}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ flex: 1, overflowY: "auto", position: "relative" }}>
                {/* ─── Processing overlay (one-click clip → project flow) ─── */}
                {processingClip && (
                  <div style={{
                    position: "absolute", inset: 0, zIndex: 5,
                    background: "rgba(13, 12, 11, 0.92)",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    gap: 14, padding: 30, textAlign: "center",
                  }}>
                    <div style={{ width: 38, height: 38, borderRadius: "50%",
                      border: "3px solid rgba(255,255,255,.15)",
                      borderTopColor: "var(--st-accent)",
                      animation: "spin 0.9s linear infinite",
                    }} />
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--st-text)" }}>
                      {processingClip.phase === "downloading"
                        ? `Bajando los clips de ${vodPlatform === "kick" ? "Kick" : "Twitch"} y armando el proyecto…`
                        : "Preparando…"}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--st-muted)", maxWidth: 340 }}>
                      {processingClip.name}
                    </div>
                    {processingClip.progress && (
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--st-accent)", fontFamily: "var(--st-mono)" }}>
                        {processingClip.progress}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--st-faint)", fontFamily: "var(--st-mono)" }}>
                      sin Gemini · los re-analizás de a pocos en Clips
                    </div>
                  </div>
                )}
                {processingError && (
                  <div style={{ margin: "12px 18px", padding: "10px 13px", borderRadius: 9, background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.25)", color: "var(--st-live)", fontSize: 13 }}>
                    {processingError}
                  </div>
                )}

                {/* ─── Tab: Clips (viewers) ─── */}
                {viralTab === "clips" && (
                  <div style={{ padding: "8px 0" }}>
                    {viralLoading && (
                      <div style={{ padding: 40, textAlign: "center", color: "var(--st-muted)", fontSize: 13 }}>
                        Cargando clips de {vodPlatform === "kick" ? "Kick" : "Twitch"}…
                      </div>
                    )}
                    {!viralLoading && viralError && (
                      <div style={{ margin: "12px 18px", padding: "10px 13px", borderRadius: 9, background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.25)", color: "var(--st-live)", fontSize: 13 }}>
                        {viralError}
                      </div>
                    )}
                    {!viralLoading && !viralError && viralClips.map((c, idx) => {
                      const selected = selectedClips.has(c.id);
                      return (
                      <div
                        key={c.id || idx}
                        onClick={() => toggleClipSelected(c.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 12, padding: "10px 18px",
                          cursor: "pointer", borderBottom: "1px solid var(--st-line)",
                          background: selected ? "var(--st-soft)" : "transparent",
                        }}
                        onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--st-soft)"; }}
                        onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) => { e.stopPropagation(); toggleClipSelected(c.id); }}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: 16, height: 16, accentColor: "var(--st-accent)", cursor: "pointer", flexShrink: 0 }}
                        />
                        <span style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)", width: 24, textAlign: "right" }}>
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        {c.thumbnail_url && (
                          <img src={c.thumbnail_url.replace("%{width}", "120").replace("%{height}", "68")}
                               alt="" style={{ width: 80, height: 45, objectFit: "cover", borderRadius: 5, flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--st-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.title}
                          </div>
                          <div style={{ fontSize: 11.5, color: "var(--st-muted)", marginTop: 2, display: "flex", gap: 10, fontFamily: "var(--st-mono)" }}>
                            <span>{fmtHMS(c.vod_offset_seconds)}</span>
                            <span>·</span>
                            <span>{c.view_count.toLocaleString()} views</span>
                            <span>·</span>
                            <span>{Math.round(c.duration)}s</span>
                            {c.creator_name && <><span>·</span><span style={{ color: "var(--st-faint)" }}>{c.creator_name}</span></>}
                          </div>
                        </div>
                      </div>
                      );
                    })}
                    {!viralLoading && !viralError && viralClips.length === 0 && (
                      <div style={{ padding: 40, textAlign: "center", color: "var(--st-muted)", fontSize: 13 }}>
                        Sin clips disponibles para este VOD.
                      </div>
                    )}
                  </div>
                )}

                {/* ─── Tab: Chat velocity ─── */}
                {viralTab === "chat" && (
                  <ChatVelocityPanel
                    status={chatStatus}
                    progress={chatProgress}
                    totalMessages={chatTotalMsgs}
                    error={chatError}
                    buckets={chatBuckets}
                    peaks={chatPeaks}
                    duration={chatDuration}
                    onRetry={loadChatVelocity}
                    onPickPeak={useChatPeak}
                    fmtHMS={fmtHMS}
                  />
                )}
              </div>

              {/* ─── Footer: batch action ─── */}
              {viralTab === "clips" && viralClips.length > 0 && !processingClip && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 18px", borderTop: "1px solid var(--st-line)",
                  background: "var(--st-soft)",
                }}>
                  <span style={{ fontSize: 12.5, color: "var(--st-muted)" }}>
                    <b style={{ color: "var(--st-text)" }}>{selectedClips.size}</b>
                    {" / "}{viralClips.length} seleccionados
                  </span>
                  {selectedClips.size > 0 && (
                    <button
                      onClick={() => setSelectedClips(new Set())}
                      className="st-btn st-btn--ghost"
                      style={{ padding: "6px 12px", fontSize: 12 }}
                    >
                      Deseleccionar
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const all = new Set(viralClips.map((c) => c.id));
                      setSelectedClips(all);
                    }}
                    className="st-btn st-btn--ghost"
                    style={{ padding: "6px 12px", fontSize: 12 }}
                  >
                    Seleccionar todos
                  </button>
                  <button
                    onClick={processSelectedClips}
                    disabled={selectedClips.size === 0}
                    className="st-btn st-btn--primary"
                    style={{ marginLeft: "auto", padding: "8px 16px", fontSize: 13, gap: 6 }}
                  >
                    <Download size={14} /> Enviar a Clips{selectedClips.size > 0 ? ` (${selectedClips.size})` : ""}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        </>
        )}

        {liveTab === "pescar" && (
          <>
            {/* Empty state: ask for platform + channel */}
            {!pescSession ? (
              <div className="st-card" style={{ padding: "22px 24px" }}>
                <div className="st-eyebrow" style={{ marginBottom: 8 }}>Plataforma</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 18 }}>
                  {[["kick", "🟢 Kick"], ["twitch", "💜 Twitch"]].map(([k, label]) => {
                    const on = pescPlatform === k;
                    return (
                      <button key={k} onClick={() => setPescPlatform(k)}
                        style={{
                          fontSize: 13, padding: "9px 0",
                          background: on ? "var(--st-accent)" : "transparent",
                          color: on ? "var(--st-on-accent)" : "var(--st-muted)",
                          border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`,
                          borderRadius: 8, cursor: "pointer", fontWeight: 600,
                        }}>{label}</button>
                    );
                  })}
                </div>
                <div className="st-eyebrow" style={{ marginBottom: 8 }}>Canal</div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--st-soft)", border: `1px solid ${pescChannel ? "var(--st-accent)" : "var(--st-border)"}`, borderRadius: 10, padding: "11px 13px", marginBottom: 18, transition: "border-color .15s" }}>
                  <Radio size={16} style={{ color: "var(--st-muted)", flexShrink: 0 }} />
                  <input type="text"
                    placeholder={pescPlatform === "kick" ? "ej. adinross" : "ej. shroud"}
                    value={pescChannel}
                    onChange={(e) => {
                      let v = e.target.value.trim();
                      v = v.replace(/^@/, "");
                      v = v.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
                      v = v.replace(/^(m\.)?(twitch\.tv|kick\.com)\//i, "");
                      v = v.split(/[\/?#]/)[0];
                      setPescChannel(v.toLowerCase());
                    }}
                    onKeyDown={(e) => e.key === "Enter" && startPesc()}
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--st-text)", fontFamily: "var(--st-mono)", fontSize: 13 }} />
                </div>
                <button onClick={startPesc} disabled={pescStarting || !pescChannel.trim()}
                  className="st-btn st-btn--primary"
                  style={{ width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 14, fontWeight: 600 }}>
                  {pescStarting ? "Iniciando…" : "🎣 Empezar a pescar"}
                </button>
                {pescError && (
                  <p style={{ color: "var(--st-live)", fontSize: 12, margin: "10px 0 0" }}>{pescError}</p>
                )}
                <p style={{ fontSize: 11.5, color: "var(--st-faint)", margin: "14px 0 0", lineHeight: 1.5 }}>
                  Polea cada 60s y suma cada clip nuevo que aparezca. Los clips suelen tardar 1-5 min en aparecer después de que el viewer los crea — esto es de la plataforma, no del sistema.
                </p>
              </div>
            ) : (
              <>
                {/* Running session header */}
                <div className="st-card" style={{ padding: "16px 20px", marginBottom: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{
                      display: "inline-block", width: 9, height: 9, borderRadius: 99,
                      background: pescSession.status === "running" ? "#22c55e" : "#888",
                      animation: pescSession.status === "running" ? "pulse 2s infinite" : "none",
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--st-text)" }}>
                      {pescSession.platform === "kick" ? "🟢" : "💜"} {pescSession.channel}
                    </span>
                  </div>
                  <span style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)" }}>
                    {pescSession.polls_done} poll{pescSession.polls_done !== 1 ? "s" : ""} ·
                    {" "}{(pescSession.found_clips || []).length} clip{(pescSession.found_clips || []).length !== 1 ? "s" : ""} pescado{(pescSession.found_clips || []).length !== 1 ? "s" : ""}
                  </span>
                  <div style={{ flex: 1 }} />
                  {pescSession.status !== "stopped" ? (
                    <button onClick={stopPesc} className="st-btn st-btn--ghost"
                      style={{ padding: "6px 12px", fontSize: 12 }}>
                      Detener pesca
                    </button>
                  ) : (
                    <span style={{ fontFamily: "var(--st-mono)", fontSize: 10.5, color: "var(--st-faint)" }}>DETENIDO</span>
                  )}
                  <button onClick={resetPesc} className="st-btn st-btn--ghost"
                    style={{ padding: "6px 12px", fontSize: 12 }}>
                    Nueva sesión
                  </button>
                </div>

                {/* Live-stream anchor banner */}
                {pescSession.is_live ? (
                  <div style={{
                    padding: "11px 14px", marginBottom: 12, borderRadius: 9,
                    background: "rgba(34, 197, 94, 0.08)",
                    border: "1px solid rgba(34, 197, 94, 0.25)",
                    color: "var(--st-text)", fontSize: 12.5,
                    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                  }}>
                    <span style={{ fontSize: 14 }}>🔴</span>
                    <span>
                      <b>En vivo desde hace {(() => {
                        if (!pescSession.stream_started_at) return "—";
                        const ms = Date.now() - new Date(pescSession.stream_started_at).getTime();
                        if (ms < 0) return "ahora";
                        const m = Math.floor(ms / 60000);
                        const h = Math.floor(m / 60);
                        return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
                      })()}</b>
                      {" · pescando del stream completo"}
                    </span>
                    {pescSession.stream_title && (
                      <span style={{ color: "var(--st-muted)", fontStyle: "italic", marginLeft: 4 }}>
                        “{pescSession.stream_title.slice(0, 70)}{pescSession.stream_title.length > 70 ? "…" : ""}”
                      </span>
                    )}
                  </div>
                ) : (
                  <div style={{
                    padding: "10px 14px", marginBottom: 12, borderRadius: 9,
                    background: "var(--st-soft)",
                    border: "1px solid var(--st-border)",
                    color: "var(--st-muted)", fontSize: 12.5,
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    <span>⚪</span>
                    <span>Canal offline o no detectable · solo pescaré clips creados de ahora en adelante</span>
                  </div>
                )}

                {pescError && (
                  <div style={{ padding: "10px 13px", marginBottom: 12, borderRadius: 9, background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.25)", color: "var(--st-live)", fontSize: 12 }}>
                    {pescError}
                  </div>
                )}

                {/* Sort + search */}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "inline-flex", border: "1px solid var(--st-border)", borderRadius: 7, padding: 2 }}>
                    {[["recent", "Recientes"], ["views", "Más vistos"]].map(([k, label]) => {
                      const on = pescSort === k;
                      return (
                        <button key={k} onClick={() => setPescSort(k)} style={{
                          fontSize: 11, padding: "5px 10px",
                          background: on ? "var(--st-accent)" : "transparent",
                          color: on ? "var(--st-on-accent)" : "var(--st-muted)",
                          border: "none", borderRadius: 5, cursor: "pointer",
                        }}>{label}</button>
                      );
                    })}
                  </div>
                  <input type="text" placeholder="Buscar por título o creador…"
                    value={pescSearch} onChange={(e) => setPescSearch(e.target.value)}
                    style={{
                      flex: 1, minWidth: 180,
                      background: "var(--st-soft)", border: "1px solid var(--st-border)",
                      color: "var(--st-text)", borderRadius: 7, padding: "5px 11px",
                      fontSize: 12, outline: "none",
                    }} />
                  {pescSelected.size > 0 && (
                    <button onClick={pescDeselectAll} className="st-btn st-btn--ghost"
                      style={{ padding: "5px 11px", fontSize: 11.5 }}>
                      Deseleccionar
                    </button>
                  )}
                  <button onClick={pescSelectAll} className="st-btn st-btn--ghost"
                    style={{ padding: "5px 11px", fontSize: 11.5 }}>
                    Seleccionar todos
                  </button>
                </div>

                {/* Clip list */}
                {pescFilteredClips.length === 0 ? (
                  <div style={{ padding: 30, textAlign: "center", color: "var(--st-muted)", fontSize: 13 }}>
                    {pescSession.polls_done === 0
                      ? "Buscando clips… el primer poll demora hasta 60 segundos."
                      : "Aún no apareció ningún clip nuevo. Esperá al próximo poll."}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                    {pescFilteredClips.map((c) => {
                      const sel = pescSelected.has(c.id);
                      return (
                        <div key={c.id} onClick={() => togglePescSel(c.id)}
                          style={{
                            display: "flex", alignItems: "center", gap: 11,
                            padding: "8px 11px", cursor: "pointer",
                            background: sel ? "var(--st-soft)" : "transparent",
                            border: `1px solid ${sel ? "var(--st-accent)" : "var(--st-line)"}`,
                            borderRadius: 8,
                          }}>
                          <input type="checkbox" checked={sel} onChange={() => togglePescSel(c.id)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ accentColor: "var(--st-accent)", flexShrink: 0 }} />
                          {c.thumbnail_url && (
                            <img src={c.thumbnail_url} alt="" style={{
                              width: 64, height: 36, objectFit: "cover", borderRadius: 4, flexShrink: 0,
                              background: "#000",
                            }} />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: "var(--st-text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {c.title}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--st-faint)", fontFamily: "var(--st-mono)", marginTop: 2 }}>
                              👁 {c.view_count} · ⏱ {Math.round(c.duration)}s · {c.creator_name || "—"}
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); downloadPescClip(c); }}
                            disabled={pescDownloading.has(c.id)}
                            title="Descargar este clip (MP4, sin Gemini)"
                            className="st-btn st-btn--ghost"
                            style={{ flexShrink: 0, padding: "6px 9px", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                            {pescDownloading.has(c.id)
                              ? <Loader2 size={14} style={{ animation: "st-spin 1s linear infinite" }} />
                              : <Download size={14} />}
                            {pescDownloading.has(c.id) ? "Bajando…" : "MP4"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Process selected (sticky bottom action) */}
                {pescSelected.size > 0 && (
                  <div style={{ position: "sticky", bottom: 0, padding: "12px 0", background: "var(--st-bg)", borderTop: "1px solid var(--st-line)", marginTop: 8 }}>
                    <button onClick={processPescSelected} disabled={!!pescProcessing}
                      className="st-btn st-btn--primary"
                      style={{ width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 14, fontWeight: 600 }}>
                      {pescProcessing
                        ? `Bajando ${pescProcessing.name}… ${pescProcessing.progress || ""}`
                        : `📥 Enviar ${pescSelected.size} a Clips (sin Gemini)`}
                    </button>
                  </div>
                )}
              </>
            )}
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
function MemeItemCard({ item, batchId, index, statusLabel, globalPreset, globalCropTopPct = 0, globalCropBottomPct = 0, globalCropLeftPct = 0, globalCropRightPct = 0, globalCornerRadius = 0, globalTextAlign = "left" }) {
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

  // ── Extended editor controls (parity with Visual Editor) ───────────────
  // All default to "preserve the old meme look" so cards that never open
  // the Ajustes panel come out identical to before.
  const [bgMode, setBgMode] = useState("color");          // "color" | "blur"
  const [fontFamily, setFontFamily] = useState("calibri");
  const [textColor, setTextColor] = useState("");         // "" = derive from bg
  const [strokeColor, setStrokeColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(0);
  // Text horizontal alignment — "left" preserves the legacy meme look,
  // "center" is what most users actually want for memes. Default left here
  // so existing cards don't shift; the picker lets the user switch.
  const [textAlign, setTextAlign] = useState("left");     // "left" | "center" | "right"
  const [visualFilter, setVisualFilter] = useState("none");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [mirrorCyclic, setMirrorCyclic] = useState(false);
  const [boostContrast, setBoostContrast] = useState(false);
  // Live edit overlay over the baked video preview:
  // - showGuides: dashed cross-hair at center
  // - the ghost text follows textX/textY and is draggable to update them.
  // The drag math reads previewBoxRef.getBoundingClientRect() so the math
  // stays accurate regardless of the actual rendered preview size.
  const [showGuides, setShowGuides] = useState(false);
  const memePreviewRef = useRef(null);
  const memeDragRef = useRef(null);   // {startX, startY, startTextX, startTextY}

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

  useEffect(() => {
    setTextAlign(globalTextAlign);
  }, [globalTextAlign]);

  // Apply global preset whenever parent changes it
  useEffect(() => {
    if (!globalPreset) return;
    setTextY(globalPreset.textY);
    setTextX(globalPreset.textX);
    setVideoY(globalPreset.videoY);
    setVideoScale(globalPreset.videoScale);
    setFontSize(globalPreset.fontSize);
  }, [globalPreset]);

  // Drag the ghost-text overlay on the preview to update textX/textY in real
  // time. Listener lives at window level so the drag survives leaving the
  // text element (mouse can move faster than React re-renders).
  useEffect(() => {
    const onMove = (e) => {
      const d = memeDragRef.current;
      if (!d) return;
      const box = memePreviewRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dx = (e.clientX - d.startX) / rect.width;
      const dy = (e.clientY - d.startY) / rect.height;
      // Clamp to the same ranges as the sliders so the result is always valid.
      // `axis: "y"` skips the X update (used by the horizontal text-row
      // handle); without it, both axes update.
      if (d.axis !== "y") setTextX(Math.max(0.02, Math.min(0.95, d.startTextX + dx)));
      if (d.axis !== "x") setTextY(Math.max(0.02, Math.min(0.95, d.startTextY + dy)));
    };
    const onUp = () => { memeDragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const handleReexport = async () => {
    setReexporting(true);
    try {
      await api.reexportMeme(
        batchId, index, textY, textX, videoScale, videoY, fontSize, customText,
        cropTopPct / 100, cropBottomPct / 100, cornerRadius,
        cropLeftPct / 100, cropRightPct / 100,
        {
          bg_mode: bgMode,
          font_family: fontFamily,
          text_color: textColor,
          stroke_color: strokeColor,
          stroke_width: strokeWidth,
          visual_filter: visualFilter,
          trim_start: trimStart,
          trim_end: trimEnd,
          mirror_cyclic_enabled: mirrorCyclic,
          mirror_cyclic_interval: 5.0,
          boost_contrast: boostContrast,
          text_align: textAlign,
        },
      );
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
  const isWorking = !isReady && !isError;   // pending/uploading/analyzing/exporting…
  const dotColor = isReady ? "var(--st-ok)" : isError ? "var(--st-live)" : "var(--st-faint)";

  const [retrying, setRetrying] = useState(false);
  // Track the meme_text we had at the moment of clicking Retry. The
  // spinner stays up until the parent's poll surfaces a DIFFERENT text
  // (or an error), confirming Gemini actually regenerated.
  const retryStartTextRef = useRef(null);
  const handleRetry = async () => {
    retryStartTextRef.current = item.meme_text || "";
    setRetrying(true);
    try {
      await api.retryMeme(batchId, index);
      // No fixed timeout — the effect below clears `retrying` when the
      // parent's poll picks up a new meme_text or an error.
    } catch (e) {
      alert(e.message || "No se pudo reintentar");
      setRetrying(false);
    }
  };

  // Clear the retry spinner once the item shows a NEW text or an error.
  useEffect(() => {
    if (!retrying) return;
    if (item.status === "error") {
      setRetrying(false);
      return;
    }
    if (item.status === "ready" && (item.meme_text || "") !== (retryStartTextRef.current || "")) {
      setRetrying(false);
    }
  }, [retrying, item.status, item.meme_text]);

  return (
    <div className="st-card" style={{ overflow: "hidden", borderColor: isReady ? "var(--st-border)" : "var(--st-line)" }}>
      {/* Header */}
      <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: dotColor, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--st-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.filename}</div>
          <div style={{ fontSize: 11, color: "var(--st-muted)", marginTop: 2 }}>{statusLabel(item)}</div>
        </div>
        <span style={{ fontFamily: "var(--st-mono)", fontSize: 9.5, fontWeight: 600, padding: "3px 8px", borderRadius: 99, background: "var(--st-alt)", color: isReady ? "var(--st-ok)" : isError ? "var(--st-live)" : "var(--st-muted)", flexShrink: 0, textTransform: "uppercase", letterSpacing: ".05em" }}>
          {isReady ? "Listo" : isError ? "Error" : "..."}
        </span>
      </div>

      {/* Meme / vibe text */}
      {item.meme_text && (
        <div style={{ margin: "0 14px 12px", padding: "10px 13px", background: "var(--st-soft)", borderRadius: 9, border: "1px solid var(--st-line)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span className="st-eyebrow" style={{ fontSize: 10 }}>{item.artist_info !== undefined ? "Vibe text" : "Meme text"}</span>
            {isReady && (
              <button onClick={() => { setEditingText(v => !v); setCustomText(item.meme_text); }}
                className="st-btn st-btn--quiet" style={{ padding: "2px 8px", fontSize: 11, border: editingText ? "1px solid var(--st-accent)" : "1px solid var(--st-border)" }}>
                <Pencil size={11} /> Editar
              </button>
            )}
          </div>
          {editingText ? (
            <textarea value={customText} onChange={e => setCustomText(e.target.value)} rows={3} placeholder="Texto personalizado…"
              className="st-textarea" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5, resize: "vertical" }} />
          ) : (
            <div style={{ fontSize: 14, color: "var(--st-text)", fontWeight: 600, lineHeight: 1.5 }}>
              {customText && customText !== item.meme_text ? customText : item.meme_text}
            </div>
          )}
        </div>
      )}

      {/* Artist info (music) */}
      {item.artist_info?.artist && (
        <div style={{ margin: "-4px 14px 12px", padding: "8px 13px", background: "var(--st-soft)", borderRadius: 9, border: "1px solid var(--st-line)" }}>
          <div style={{ fontFamily: "var(--st-mono)", fontSize: 12, fontWeight: 600, color: "var(--st-gold)" }}>{item.artist_info.artist}</div>
          {item.artist_info.instagram && <div style={{ fontSize: 11.5, color: "var(--st-muted)", marginTop: 1 }}>{item.artist_info.instagram}</div>}
        </div>
      )}

      {/* Actions */}
      {isReady && (
        <div style={{ padding: "0 14px 14px", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <a href={api.getMemeDownloadUrl(batchId, index, bust)} download className="st-btn st-btn--ghost" style={{ padding: "6px 11px", textDecoration: "none" }}>
            <Download size={13} /> Video
          </a>
          <a href={api.getMemeDescriptionUrl(batchId, index)} download className="st-btn st-btn--ghost" style={{ padding: "6px 11px", textDecoration: "none" }}>
            <Type size={13} /> .txt
          </a>
          <button onClick={handleCopyDesc} className="st-btn st-btn--ghost" style={{ padding: "6px 11px" }}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copiado" : "Desc"}
          </button>
          <button onClick={() => setShowVideo(v => !v)} className="st-btn st-btn--ghost" style={{ padding: "6px 11px" }}>
            <Play size={13} /> {showVideo ? "Ocultar" : "Preview"}
          </button>
          <button onClick={() => setShowSliders(v => !v)} className="st-btn st-btn--ghost" style={{ padding: "6px 11px" }}>
            <Settings size={13} /> {showSliders ? "Cerrar" : "Ajustes"}
          </button>
          <button onClick={handleRetry} disabled={retrying} className="st-btn st-btn--ghost" style={{ padding: "6px 11px" }}
            title="Volver a analizar y generar este meme">
            <RefreshCw size={13} /> {retrying ? "Reintentando…" : "Reintentar"}
          </button>
        </div>
      )}

      {/* Error / retry block */}
      {isError && (
        <div style={{ padding: "0 14px 14px" }}>
          <div style={{ padding: "10px 13px", background: "var(--st-soft)", borderRadius: 9, border: "1px solid var(--st-live)", marginBottom: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--st-live)", marginBottom: 2 }}>Falló este meme</div>
            <div style={{ fontSize: 11.5, color: "var(--st-muted)", lineHeight: 1.45, wordBreak: "break-word" }}>
              {item.error || "Gemini devolvió un error. Probá de nuevo."}
            </div>
          </div>
          <button onClick={handleRetry} disabled={retrying} className="st-btn st-btn--primary"
            style={{ width: "100%", justifyContent: "center", padding: "9px 0" }}>
            <RefreshCw size={14} /> {retrying ? "Reintentando…" : "Reintentar este meme"}
          </button>
        </div>
      )}

      {/* While working — show a subtle retry in case it's stuck */}
      {isWorking && (
        <div style={{ padding: "0 14px 14px" }}>
          <button onClick={handleRetry} disabled={retrying} className="st-btn st-btn--ghost"
            style={{ width: "100%", justifyContent: "center", padding: "7px 0" }}
            title="Si se quedó pegado, reinicia el análisis de este meme">
            <RefreshCw size={13} /> {retrying ? "Reintentando…" : "Reintentar"}
          </button>
        </div>
      )}

      {/* Video preview — wraps the baked <video> with an interactive layer:
          a dashed centre cross-hair (toggle) and a "ghost text" at the current
          textX/textY that the user can drag to update those sliders. The text
          you see DURING drag is the SAME text that will be baked on the next
          re-export, so positioning is WYSIWYG. The actual baked text in the
          video below stays put until you click "Re-exportar". */}
      {isReady && showVideo && (
        <div style={{ padding: "0 14px 14px" }}>
          {/* Edit toolbar: always visible while Preview is open so the user
              can toggle Guías / read the drag hint without first opening the
              Ajustes panel. */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <button onClick={() => setShowGuides(g => !g)}
              title="Líneas de guía en el centro"
              className="st-btn st-btn--ghost"
              style={{
                padding: "4px 9px", fontSize: 11,
                border: `1px solid ${showGuides ? "var(--st-accent)" : "var(--st-border)"}`,
                background: showGuides ? "var(--st-soft)" : "transparent",
                color: showGuides ? "var(--st-text)" : "var(--st-muted)",
              }}>
              <Crosshair size={11} /> Guías
            </button>
            <span style={{ fontSize: 10.5, color: "var(--st-faint)", fontFamily: "var(--st-mono)" }}>
              Arrastrá la línea dorada para altura · usá "Alineación" en Ajustes para centrar
            </span>
          </div>
          <div ref={memePreviewRef} style={{
            // Wrapper LOCKED to the meme canvas 9:16 aspect so cqw lines up
            // with the actual displayed video width. Without this, the
            // wrapper was full column width but the video kept its 9:16
            // shape inside — leaving black bars and making the ghost-text
            // overlay (which uses cqw) ~2× bigger than the baked text.
            position: "relative",
            width: "min(100%, 220px)",
            aspectRatio: "9 / 16",
            margin: "0 auto",
            borderRadius: 9, overflow: "hidden", background: "#000",
            containerType: "inline-size",
          }}>
            <video key={`bg${bust}`} src={api.getMemeBackgroundUrl(batchId, index, bust)} controls
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 9, background: "#000", display: "block" }} />

            {/* Centre guides */}
            {showGuides && (
              <>
                <div style={{
                  position: "absolute", left: "50%", top: 0, bottom: 0,
                  width: 0, borderLeft: "1px dashed var(--st-accent, #e6c270)",
                  pointerEvents: "none", zIndex: 5, opacity: 0.7,
                }} />
                <div style={{
                  position: "absolute", top: "50%", left: 0, right: 0,
                  height: 0, borderTop: "1px dashed var(--st-accent, #e6c270)",
                  pointerEvents: "none", zIndex: 5, opacity: 0.7,
                }} />
                <span style={{
                  position: "absolute", left: "50%", top: "50%",
                  transform: "translate(-50%, -50%)",
                  fontFamily: "var(--st-mono)", fontSize: 9, color: "var(--st-on-accent)",
                  background: "var(--st-accent, #e6c270)", padding: "1px 5px", borderRadius: 4,
                  pointerEvents: "none", zIndex: 6,
                }}>centro</span>
              </>
            )}

            {/* Horizontal line at the current textY — marks WHERE the row of
                text will land vertically. Drag it up/down to change textY.
                No more confusing "POS" dot; the user just sees a thin gold
                line aligned with the future text row. */}
            <div
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                memeDragRef.current = {
                  startX: e.clientX, startY: e.clientY,
                  startTextX: textX, startTextY: textY,
                  axis: "y",   // only update textY for this handle
                };
              }}
              title="Arrastrá arriba/abajo para mover la altura del texto"
              style={{
                position: "absolute",
                left: 0, right: 0,
                top: `${textY * 100}%`,
                height: 12,
                marginTop: -6,            // centre the hit-area on the line
                cursor: "ns-resize",
                touchAction: "none",
                zIndex: 7,
                display: "grid", placeItems: "center",
              }}
            >
              <div style={{
                width: "92%", height: 0,
                borderTop: "2px dashed var(--st-accent, #e6c270)",
                pointerEvents: "none",
              }} />
              <span style={{
                position: "absolute", left: "50%", top: "50%",
                transform: "translate(-50%, -50%)",
                fontFamily: "var(--st-mono)", fontSize: 9, fontWeight: 700,
                color: "#15130e",
                background: "var(--st-accent, #e6c270)",
                padding: "1px 5px", borderRadius: 4,
                pointerEvents: "none",
                whiteSpace: "nowrap",
                boxShadow: "0 1px 3px rgba(0,0,0,.5)",
              }}>altura del texto</span>
            </div>

            {/* Draggable WYSIWYG text overlay — renders the SAME text/colour/
                size/alignment that gets baked, positioned at textX/textY, and
                drags over the preview to update BOTH sliders live without any
                re-export. Width is set in cqw (container-query %) so the
                wrapped lines match the 1080x1920 baked canvas at any preview
                size. */}
{(() => {
              const displayText = (customText && customText !== item.meme_text) ? customText : (item.meme_text || "");
              if (!displayText) return null;
              const isLeft = (textAlign || "left") === "left";
              const isCenter = (textAlign || "left") === "center";
              const isRight = (textAlign || "left") === "right";
              // CSS font stacks mirroring the backend font map keys.
              const fontMap = {
                calibri: "Calibri, 'Segoe UI', sans-serif",
                arial: "Arial, Helvetica, sans-serif",
                arial_black: "'Arial Black', Arial, sans-serif",
                segoe: "'Segoe UI', 'Segoe', sans-serif",
                trebuchet: "'Trebuchet MS', 'Trebuchet', sans-serif",
                impact: "Impact, 'Arial Black', sans-serif",
                comic: "'Comic Sans MS', 'Comic Sans', sans-serif",
              };
              // The baked text is font_size px in a 1080px-wide canvas → in
              // container-query % units: fontSize / 1080 * 100.
              const fsCqw = (fontSize || 60) / 1080 * 100;
              const fillC = textColor || (bgMode === "blur" ? "rgba(255,255,255,.92)" : "#ffffff");
              const hasStroke = (strokeWidth || 0) > 0;
              const strokeClr = strokeColor || "#000000";
              // Backend geometry (meme_service.create_meme_bg_png): text starts
              // at x=W*text_x_ratio, y=H*text_y_ratio, wraps up to
              // W - x_start - 5%, align left/center/right on the canvas.
              const dragStart = (e) => {
                e.preventDefault();
                e.stopPropagation();
                memeDragRef.current = {
                  startX: e.clientX, startY: e.clientY,
                  startTextX: textX, startTextY: textY,
                };
              };
              return (
                <div
                  onPointerDown={dragStart}
                  title={`Arrastrá el texto para moverlo en vivo (sin exportar) · ${Math.round(textX * 100)}% / ${Math.round(textY * 100)}%`}
                  style={{
                    position: "absolute",
                    top: `${textY * 100}%`,
                    left: isLeft ? `${textX * 100}%` : 0,
                    width: isLeft ? `calc(100% - ${textX * 100}% - 5%)` : "100%",
                    cursor: "grab",
                    touchAction: "none",
                    zIndex: 8,
                    textAlign: isCenter ? "center" : isRight ? "right" : "left",
                    paddingRight: isRight ? "5%" : 0,
                    boxSizing: "border-box",
                    outline: "1.5px dashed rgba(230,194,112,.85)",
                    outlineOffset: 2,
                    borderRadius: 3,
                  }}
                >
                  <div style={{
                    fontSize: `${fsCqw}cqw`,
                    lineHeight: 1.35,
                    fontFamily: fontMap[fontFamily] || fontMap.calibri,
                    fontWeight: fontFamily === "arial_black" || fontFamily === "impact" ? 800 : 700,
                    color: fillC,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    userSelect: "none",
                    textShadow: hasStroke
                      ? `-1px -1px 0 ${strokeClr}, 1px -1px 0 ${strokeClr}, -1px 1px 0 ${strokeClr}, 1px 1px 0 ${strokeClr}`
                      : "none",
                    WebkitTextStroke: hasStroke ? `${Math.max(1, Math.round(strokeWidth / 6))}px ${strokeClr}` : undefined,
                    pointerEvents: "none",
                  }}>
                    {displayText}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Sliders */}
      {isReady && showSliders && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--st-line)" }}>
          <div style={{ paddingTop: 12 }}>
            <div style={{ marginBottom: 12, padding: 12, background: "var(--st-soft)", borderRadius: 9, border: "1px solid var(--st-gold)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--st-text)", marginBottom: 10, letterSpacing: ".05em", textTransform: "uppercase" }}>Crop individual</div>
              {[
                { label: "Crop superior", value: cropTopPct, setValue: v => { setCropTopPct(v); setCropPreviewUrl(null); }, min: 0, max: 70 },
                { label: "Crop inferior", value: cropBottomPct, setValue: v => { setCropBottomPct(v); setCropPreviewUrl(null); }, min: 0, max: 40 },
                { label: "Crop izquierdo", value: cropLeftPct, setValue: v => { setCropLeftPct(v); setCropPreviewUrl(null); }, min: 0, max: 40 },
                { label: "Crop derecho", value: cropRightPct, setValue: v => { setCropRightPct(v); setCropPreviewUrl(null); }, min: 0, max: 40 },
              ].map(({ label, value, setValue, min, max }) => (
                <div key={label} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--st-muted)", marginBottom: 3 }}>
                    <span>{label}</span><span style={{ fontFamily: "var(--st-mono)", color: "var(--st-text)" }}>{value}%</span>
                  </div>
                  <input type="range" min={min} max={max} step={1} value={value} onChange={e => setValue(Number(e.target.value))} style={{ width: "100%" }} />
                </div>
              ))}
              {(cropTopPct > 0 || cropBottomPct > 0 || cropLeftPct > 0 || cropRightPct > 0) && (
                <button onClick={() => setCropPreviewUrl(api.getCropPreviewUrl(batchId, index, cropTopPct / 100, cropBottomPct / 100, cropLeftPct / 100, cropRightPct / 100))}
                  className="st-btn st-btn--ghost" style={{ width: "100%", justifyContent: "center", padding: "6px 0", marginBottom: 8 }}>
                  Ver preview del crop
                </button>
              )}
              {cropPreviewUrl && (
                <div style={{ borderRadius: 7, overflow: "hidden", marginBottom: 8, border: "1px solid var(--st-border)" }}>
                  <img src={cropPreviewUrl} alt="crop preview" style={{ width: "100%", display: "block" }} onError={() => setCropPreviewUrl(null)} />
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
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--st-muted)", marginBottom: 4 }}>
                  <span>{label}</span><span style={{ fontFamily: "var(--st-mono)", color: "var(--st-text)" }}>{fmt(value)}</span>
                </div>
                <input type="range" min={min} max={max} step={step} value={value} onChange={e => setValue(e.target.value)} style={{ width: "100%" }} />
              </div>
            ))}

            {/* ── Tipografía ─────────────────────────────────────────── */}
            <div style={{ marginTop: 14, padding: 12, background: "var(--st-soft)", borderRadius: 9, border: "1px solid var(--st-line)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--st-text)", marginBottom: 10, letterSpacing: ".05em", textTransform: "uppercase" }}>Texto</div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "var(--st-muted)", marginBottom: 4 }}>Fuente</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  {[["calibri", "Calibri"], ["arial", "Arial (meme)"], ["segoe", "Segoe UI"], ["arial_black", "Arial Black"], ["trebuchet", "Trebuchet"], ["impact", "Impact"]].map(([k, label]) => {
                    const on = fontFamily === k;
                    return (
                      <button key={k} onClick={() => setFontFamily(k)} style={{
                        fontSize: 11, padding: "5px 0",
                        background: on ? "var(--st-accent)" : "transparent",
                        color: on ? "var(--st-on-accent)" : "var(--st-muted)",
                        border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`,
                        borderRadius: 5, cursor: "pointer",
                      }}>{label}</button>
                    );
                  })}
                </div>
              </div>

              {/* Text alignment — this is what most users actually want for
                  "centrar el texto". Left preserves the old look. */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "var(--st-muted)", marginBottom: 4 }}>Alineación horizontal</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                  {[["left", "⬅ Izquierda"], ["center", "↔ Centro"], ["right", "Derecha ➡"]].map(([k, label]) => {
                    const on = textAlign === k;
                    return (
                      <button key={k} onClick={() => setTextAlign(k)} style={{
                        fontSize: 11, padding: "6px 0",
                        background: on ? "var(--st-accent)" : "transparent",
                        color: on ? "var(--st-on-accent)" : "var(--st-muted)",
                        border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`,
                        borderRadius: 5, cursor: "pointer", fontWeight: 600,
                      }}>{label}</button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <label style={{ flex: 1, fontSize: 11, color: "var(--st-muted)" }}>
                  <span style={{ display: "block", marginBottom: 3 }}>Color texto</span>
                  <input type="color" value={textColor || "#ffffff"} onChange={e => setTextColor(e.target.value)}
                    style={{ width: "100%", height: 28, border: "1px solid var(--st-border)", borderRadius: 5, background: "transparent" }} />
                </label>
                <label style={{ flex: 1, fontSize: 11, color: "var(--st-muted)" }}>
                  <span style={{ display: "block", marginBottom: 3 }}>Color borde</span>
                  <input type="color" value={strokeColor} onChange={e => setStrokeColor(e.target.value)}
                    style={{ width: "100%", height: 28, border: "1px solid var(--st-border)", borderRadius: 5, background: "transparent" }} />
                </label>
              </div>
              <div style={{ marginBottom: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--st-muted)", marginBottom: 4 }}>
                  <span>Grosor borde</span><span style={{ fontFamily: "var(--st-mono)", color: "var(--st-text)" }}>{strokeWidth}px</span>
                </div>
                <input type="range" min={0} max={12} step={1} value={strokeWidth} onChange={e => setStrokeWidth(parseInt(e.target.value))} style={{ width: "100%" }} />
              </div>
            </div>

            {/* ── Fondo + filtro ─────────────────────────────────────── */}
            <div style={{ marginTop: 10, padding: 12, background: "var(--st-soft)", borderRadius: 9, border: "1px solid var(--st-line)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--st-text)", marginBottom: 10, letterSpacing: ".05em", textTransform: "uppercase" }}>Fondo y filtro</div>
              <div style={{ fontSize: 11, color: "var(--st-muted)", marginBottom: 4 }}>Fondo</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 10 }}>
                {[["color", "🎨 Color"], ["blur", "🌫 Blur del video"]].map(([k, label]) => {
                  const on = bgMode === k;
                  return (
                    <button key={k} onClick={() => setBgMode(k)} style={{
                      fontSize: 11.5, padding: "6px 0",
                      background: on ? "var(--st-accent)" : "transparent",
                      color: on ? "var(--st-on-accent)" : "var(--st-muted)",
                      border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`,
                      borderRadius: 5, cursor: "pointer",
                    }}>{label}</button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: "var(--st-muted)", marginBottom: 4 }}>Filtro</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                {[["none", "Ninguno"], ["cinematic", "Cine"], ["warm", "Cálido"], ["vivid", "Vivo"], ["moody", "Moody"], ["bw", "B/N"]].map(([k, label]) => {
                  const on = visualFilter === k;
                  return (
                    <button key={k} onClick={() => setVisualFilter(k)} style={{
                      fontSize: 11, padding: "5px 0",
                      background: on ? "var(--st-accent)" : "transparent",
                      color: on ? "var(--st-on-accent)" : "var(--st-muted)",
                      border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`,
                      borderRadius: 5, cursor: "pointer",
                    }}>{label}</button>
                  );
                })}
              </div>
            </div>

            {/* ── Trim del video fuente ──────────────────────────────── */}
            <div style={{ marginTop: 10, padding: 12, background: "var(--st-soft)", borderRadius: 9, border: "1px solid var(--st-line)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--st-text)", marginBottom: 10, letterSpacing: ".05em", textTransform: "uppercase" }}>Trim · usá solo el pedazo gracioso</div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--st-muted)", marginBottom: 4 }}>
                  <span>Inicio</span><span style={{ fontFamily: "var(--st-mono)", color: "var(--st-text)" }}>{trimStart.toFixed(1)}s</span>
                </div>
                <input type="range" min={0} max={30} step={0.1} value={trimStart}
                  onChange={e => setTrimStart(Math.min(parseFloat(e.target.value), trimEnd > 0 ? trimEnd - 0.1 : 99))}
                  style={{ width: "100%" }} />
              </div>
              <div style={{ marginBottom: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--st-muted)", marginBottom: 4 }}>
                  <span>Fin</span><span style={{ fontFamily: "var(--st-mono)", color: "var(--st-text)" }}>{trimEnd === 0 ? "fin del video" : `${trimEnd.toFixed(1)}s`}</span>
                </div>
                <input type="range" min={0} max={60} step={0.1} value={trimEnd}
                  onChange={e => setTrimEnd(parseFloat(e.target.value))}
                  style={{ width: "100%" }} />
                <div style={{ fontSize: 10, color: "var(--st-faint)", marginTop: 3, fontFamily: "var(--st-mono)" }}>
                  Fin = 0 → hasta el final natural
                </div>
              </div>
            </div>

            {/* ── Anti-detect ────────────────────────────────────────── */}
            <div style={{ marginTop: 10, padding: 12, background: "var(--st-soft)", borderRadius: 9, border: "1px solid var(--st-line)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--st-text)", marginBottom: 8, letterSpacing: ".05em", textTransform: "uppercase" }}>🛡 Anti-detect</div>
              {[
                { label: "Espejo cíclico", value: mirrorCyclic, setValue: setMirrorCyclic, hint: "El video se invierte cada 5s" },
                { label: "Boost contraste", value: boostContrast, setValue: setBoostContrast, hint: "Sube contraste + saturación" },
              ].map(({ label, value, setValue, hint }) => (
                <label key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer" }}>
                  <input type="checkbox" checked={value} onChange={e => setValue(e.target.checked)}
                    style={{ accentColor: "var(--st-accent)", width: 14, height: 14 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "var(--st-text)" }}>{label}</div>
                    <div style={{ fontSize: 10.5, color: "var(--st-faint)" }}>{hint}</div>
                  </div>
                </label>
              ))}
            </div>

            <button onClick={handleReexport} disabled={reexporting} className="st-btn st-btn--primary" style={{ width: "100%", justifyContent: "center", padding: "10px 0", marginTop: 12 }}>
              {reexporting ? "Re-exportando…" : "Re-exportar con estos ajustes"}
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
  const { model: memeModel, setModel: setMemeModel } = useModel(); // global model (synced w/ sidebar + Ajustes)
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
  // Extended global controls (apply to all)
  const [gBgMode, setGBgMode] = useState("color");
  const [gFontFamily, setGFontFamily] = useState("calibri");
  const [gTextColor, setGTextColor] = useState("");
  const [gStrokeColor, setGStrokeColor] = useState("#000000");
  const [gStrokeWidth, setGStrokeWidth] = useState(0);
  const [gTextAlign, setGTextAlign] = useState("left"); // "left" | "center" | "right"
  const [gVisualFilter, setGVisualFilter] = useState("none");
  const [gMirrorCyclic, setGMirrorCyclic] = useState(false);
  const [gBoostContrast, setGBoostContrast] = useState(false);
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

  // Poll batch status every 2s while the modal is open. We DON'T stop on
  // "completed" — if we did, the per-item Retry button would fire but the
  // resulting "pending → ready" transition would never reach the UI. A
  // request every 2s is cheap and stops when the user closes the modal.
  useEffect(() => {
    if (!batchId) return;
    pollRef.current = setInterval(async () => {
      try {
        const data = await api.getMemeStatus(batchId);
        setBatch(data);
      } catch (e) {
        // ignore transient poll errors
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
      const result = await api.processMemes(files, bgColor, 0.08, 0.9, setUploadPct, contentType, topPct, bottomPct, leftPct, rightPct, memeModel);
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
    const extras = {
      bg_mode: gBgMode,
      font_family: gFontFamily,
      text_color: gTextColor,
      stroke_color: gStrokeColor,
      stroke_width: gStrokeWidth,
      visual_filter: gVisualFilter,
      mirror_cyclic_enabled: gMirrorCyclic,
      mirror_cyclic_interval: 5.0,
      boost_contrast: gBoostContrast,
      text_align: gTextAlign,
    };
    await Promise.all(readyItems.map(({ i }) =>
      api.reexportMeme(
        batchId, i, gTextY, gTextX, gVideoScale, gVideoY, gFontSize, "",
        gCropTopPct / 100, gCropBottomPct / 100, gCornerRadius,
        gCropLeftPct / 100, gCropRightPct / 100, extras,
      ).catch(() => {})
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
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 30px", borderBottom: "1px solid var(--st-line)", flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--st-display)", fontSize: 24, fontWeight: 600, letterSpacing: "-.02em" }}>
            {contentType === "music" ? "Music Vibe" : "Meme Generator"}
          </h1>
          <div style={{ fontSize: 13, color: "var(--st-muted)", marginTop: 3 }}>
            {contentType === "music"
              ? "Texto de ambiente sobre clips musicales — artista, track y mood generados por IA."
              : "Texto gracioso y relatable, generado por IA sobre tus videos verticales."}
          </div>
        </div>
        <PromptEditButton
          promptKeys={contentType === "music"
            ? ["music_artist", "music_vibe", "ig_description_music"]
            : ["meme_text", "meme_crop", "ig_description_meme"]}
          title={contentType === "music" ? "Prompts · Music Vibe" : "Prompts · Meme Generator"} />
        <div style={{ display: "flex", background: "var(--st-alt)", borderRadius: 9, padding: 3 }}>
          {[["meme", "Meme"], ["music", "Music Vibe"]].map(([k, label]) => {
            const on = contentType === k;
            return (
              <span key={k} onClick={() => !batchId && setContentType(k)} style={{
                fontSize: 12.5, fontWeight: on ? 600 : 500, padding: "6px 13px", borderRadius: 6,
                cursor: batchId ? "default" : "pointer", opacity: batchId && !on ? 0.5 : 1,
                background: on ? "var(--st-surface)" : "transparent", color: on ? "var(--st-text)" : "var(--st-muted)",
              }}>{label}</span>
            );
          })}
        </div>
        {batchId && batch?.status === "completed" && doneCount > 0 && (
          <button onClick={handleDownloadAllDescriptions} className="st-btn st-btn--ghost" style={{ padding: "7px 12px" }}>
            <Type size={14} /> Descripciones
          </button>
        )}
        {batchId && (
          <button onClick={handleReset} className="st-btn st-btn--primary" style={{ padding: "8px 14px" }}>
            <RefreshCw size={14} /> Nuevo batch
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 30px" }}>
        {!batchId ? (
          <div style={{ maxWidth: 620, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Modelo de IA */}
            <div className="st-card" style={{ padding: "16px 18px" }}>
              <div className="st-eyebrow" style={{ marginBottom: 10 }}>Modelo de IA</div>
              <ModelSelector value={memeModel} onChange={setMemeModel} health={modelHealth} checking={checkingModels} onCheck={handleCheckModels} disabled={!!batchId} />
            </div>

            {/* Dropzone */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `1.5px dashed ${files.length ? "var(--st-accent)" : "var(--st-border)"}`,
                borderRadius: 14, padding: "40px 20px", textAlign: "center", cursor: "pointer",
                background: files.length ? "var(--st-soft)" : "transparent", transition: "all 0.15s",
              }}
            >
              <input ref={fileInputRef} type="file" accept="video/*" multiple style={{ display: "none" }} onChange={handleFiles} />
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--st-alt)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
                <ImageIcon size={20} style={{ color: "var(--st-muted)" }} />
              </div>
              {files.length ? (
                <>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{files.length} video{files.length > 1 ? "s" : ""} listo{files.length > 1 ? "s" : ""}</div>
                  <div style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)" }}>clic para cambiar</div>
                  <div style={{ maxHeight: 96, overflowY: "auto", textAlign: "left", marginTop: 12, display: "flex", flexDirection: "column", gap: 3 }}>
                    {files.map((f, i) => (
                      <div key={i} style={{ fontFamily: "var(--st-mono)", fontSize: 10.5, color: "var(--st-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Arrastrá videos aquí</div>
                  <div style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)" }}>o clickeá para seleccionar · máx ~20</div>
                </>
              )}
            </div>

            {/* Crop section */}
            {files.length > 0 && (
              <div className="st-card" style={{ padding: "16px 18px", borderColor: cropEnabled ? "var(--st-gold)" : "var(--st-line)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: cropEnabled ? 16 : 0 }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>Recortar memes de Instagram</div>
                    <div style={{ fontSize: 11.5, color: "var(--st-muted)", marginTop: 2 }}>Elimina el tweet de arriba y la UI de abajo antes de procesar.</div>
                  </div>
                  <button onClick={() => { setCropEnabled(v => !v); if (!cropEnabled) handleLoadFrameOnly(); }}
                    className={cropEnabled ? "st-btn st-btn--primary" : "st-btn st-btn--ghost"} style={{ padding: "6px 13px" }}>
                    {cropEnabled ? "ON" : "OFF"}
                  </button>
                </div>

                {cropEnabled && (
                  <div>
                    <button onClick={handleAutoDetectCrop} disabled={detectingCrop}
                      className="st-btn st-btn--ghost" style={{ width: "100%", justifyContent: "center", padding: "9px 0", marginBottom: 14 }}>
                      {detectingCrop ? "Analizando con Gemini…" : <><Sparkles size={14} /> Auto-detectar crop (Gemini)</>}
                    </button>

                    {cropDetectError && (
                      <div style={{ color: "var(--st-live)", fontSize: 12, marginBottom: 12, background: "rgba(192,57,43,0.08)", padding: "8px 12px", borderRadius: 8 }}>{cropDetectError}</div>
                    )}

                    {cropFrameUrl && (
                      <div style={{ position: "relative", marginBottom: 16, borderRadius: 10, overflow: "hidden", border: "1px solid var(--st-border)" }}>
                        <img src={cropFrameUrl} alt="frame" style={{ width: "100%", display: "block" }} />
                        {cropTopPct > 0 && (
                          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: `${cropTopPct}%`, background: "rgba(192,57,43,0.4)", borderBottom: "2px solid var(--st-live)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>top {cropTopPct}%</div>
                        )}
                        {cropBottomPct > 0 && (
                          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${cropBottomPct}%`, background: "rgba(192,57,43,0.4)", borderTop: "2px solid var(--st-live)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>bottom {cropBottomPct}%</div>
                        )}
                      </div>
                    )}

                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {[
                        { label: "Crop superior (tweet)", value: cropTopPct, setValue: setCropTopPct, max: 60 },
                        { label: "Crop inferior (UI)", value: cropBottomPct, setValue: setCropBottomPct, max: 40 },
                        { label: "Crop izquierdo", value: cropLeftPct, setValue: setCropLeftPct, max: 40 },
                        { label: "Crop derecho", value: cropRightPct, setValue: setCropRightPct, max: 40 },
                      ].map(({ label, value, setValue, max }) => (
                        <div key={label}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--st-muted)", marginBottom: 6 }}>
                            <span>{label}</span><span style={{ fontFamily: "var(--st-mono)", color: "var(--st-text)" }}>{value}%</span>
                          </div>
                          <input type="range" min={0} max={max} value={value} onChange={e => setValue(Number(e.target.value))} style={{ width: "100%" }} />
                        </div>
                      ))}
                    </div>

                    {!cropFrameUrl && (
                      <button onClick={handleLoadFrameOnly} className="st-btn st-btn--ghost" style={{ marginTop: 12, width: "100%", justifyContent: "center", padding: "8px 0" }}>
                        Cargar frame de preview
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Background swatches */}
            <div className="st-card" style={{ padding: "16px 18px" }}>
              <div className="st-eyebrow" style={{ marginBottom: 12 }}>Fondo del meme</div>
              <div style={{ display: "flex", gap: 10 }}>
                {[["black", "#000000"], ["white", "#ffffff"]].map(([val, hex]) => (
                  <button key={val} onClick={() => setBgColor(val)} title={val === "black" ? "Negro · texto blanco" : "Blanco · texto negro"}
                    style={{
                      width: 38, height: 38, borderRadius: 8, background: hex, cursor: "pointer",
                      border: bgColor === val ? "2px solid var(--st-accent)" : "1px solid var(--st-border)",
                      outline: bgColor === val ? "2px solid var(--st-bg)" : "none", outlineOffset: -4,
                    }} />
                ))}
              </div>
            </div>

            {error && (
              <div style={{ color: "var(--st-live)", fontSize: 13, background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.25)", padding: "10px 13px", borderRadius: 9 }}>{error}</div>
            )}

            {uploading ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, color: "var(--st-muted)" }}>Subiendo videos…</span>
                  <span style={{ fontFamily: "var(--st-mono)", fontSize: 12, color: "var(--st-text)" }}>{uploadPct}%</span>
                </div>
                <div style={{ background: "var(--st-alt)", borderRadius: 99, height: 5 }}>
                  <div style={{ background: "var(--st-accent)", borderRadius: 99, height: 5, width: `${uploadPct}%`, transition: "width 0.3s" }} />
                </div>
              </div>
            ) : (
              <button onClick={handleStart} disabled={!files.length} className="st-btn st-btn--primary" style={{ width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 14 }}>
                <Sparkles size={16} /> Generar {contentType === "music" ? "vibes" : "memes"} ({files.length})
              </button>
            )}
          </div>
        ) : (
          <div style={{ maxWidth: 920, margin: "0 auto" }}>
            {/* Progress */}
            <div className="st-card" style={{ padding: "16px 20px", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {batch?.status === "completed" ? `Completado — ${doneCount}/${totalCount} listos` : `Procesando… ${doneCount}/${totalCount}`}
                </span>
                <span style={{ fontFamily: "var(--st-mono)", fontSize: 12, color: "var(--st-text)" }}>{totalCount ? Math.round((doneCount / totalCount) * 100) : 0}%</span>
              </div>
              <div style={{ height: 5, borderRadius: 99, background: "var(--st-alt)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${totalCount ? (doneCount / totalCount) * 100 : 0}%`, borderRadius: 99, background: "var(--st-accent)", transition: "width 0.5s" }} />
              </div>
              {batch?.status !== "completed" && (
                <div style={{ fontSize: 12, color: "var(--st-muted)", marginTop: 8 }}>Gemini analiza cada video secuencialmente.</div>
              )}
            </div>

            {/* Crop panel (completed) */}
            {batch?.status === "completed" && doneCount > 0 && (
              <div className="st-card" style={{ padding: "14px 16px", marginBottom: 12, borderColor: "var(--st-gold)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Recortar tweet card / UI — aplica a todos</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                  {[
                    { label: "Crop superior", value: gCropTopPct, setValue: setGCropTopPct, min: 0, max: 70 },
                    { label: "Crop inferior", value: gCropBottomPct, setValue: setGCropBottomPct, min: 0, max: 40 },
                    { label: "Crop izquierdo", value: gCropLeftPct, setValue: setGCropLeftPct, min: 0, max: 40 },
                    { label: "Crop derecho", value: gCropRightPct, setValue: setGCropRightPct, min: 0, max: 40 },
                  ].map(({ label, value, setValue, min, max }) => (
                    <div key={label}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--st-muted)", marginBottom: 5 }}>
                        <span>{label}</span><span style={{ fontFamily: "var(--st-mono)", color: value > 0 ? "var(--st-text)" : "var(--st-faint)" }}>{value}%</span>
                      </div>
                      <input type="range" min={min} max={max} step={1} value={value} onChange={e => { setValue(Number(e.target.value)); setCropPreviewImg(null); }} style={{ width: "100%" }} />
                    </div>
                  ))}
                </div>

                {(gCropTopPct > 0 || gCropBottomPct > 0 || gCropLeftPct > 0 || gCropRightPct > 0) && batchId && batch?.items?.length > 0 && (
                  <button onClick={() => setCropPreviewImg(api.getCropPreviewUrl(batchId, 0, gCropTopPct / 100, gCropBottomPct / 100, gCropLeftPct / 100, gCropRightPct / 100))}
                    className="st-btn st-btn--ghost" style={{ width: "100%", justifyContent: "center", padding: "8px 0", marginBottom: 10 }}>
                    Ver preview del crop (primer video)
                  </button>
                )}
                {cropPreviewImg && (
                  <div style={{ marginBottom: 12, borderRadius: 8, overflow: "hidden", border: "1px solid var(--st-border)" }}>
                    <div style={{ fontSize: 11, color: "var(--st-muted)", padding: "5px 9px", background: "var(--st-soft)" }}>Así quedará — si aún se ve el tweet, subí el % superior.</div>
                    <img src={cropPreviewImg} alt="crop preview" style={{ width: "100%", display: "block" }} onError={() => setCropPreviewImg(null)} />
                  </div>
                )}

                <button onClick={handleReexportAll} disabled={reexportingAll || (gCropTopPct === 0 && gCropBottomPct === 0 && gCropLeftPct === 0 && gCropRightPct === 0)}
                  className="st-btn st-btn--primary" style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}>
                  {reexportingAll ? "Re-exportando…" : "Re-exportar todos"}
                </button>
              </div>
            )}

            {/* Global adjustments (collapsible) */}
            <div className="st-card" style={{ marginBottom: 16, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setShowGlobalSliders(v => !v)}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Ajustes globales — aplica a todos</span>
                <ChevronDown size={15} style={{ color: "var(--st-faint)", transform: showGlobalSliders ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
              </div>
              {showGlobalSliders && (
                <div style={{ padding: "0 16px 16px", borderTop: "1px solid var(--st-line)" }}>
                  <div style={{ paddingTop: 14 }}>
                    {[
                      { label: "Texto vertical", value: gTextY, setValue: setGTextY, min: 0.02, max: 0.45, step: 0.01, fmt: v => +v <= 0.12 ? "⬆ Arriba" : +v <= 0.28 ? "↕ Centro" : "⬇ Abajo" },
                      { label: "Texto horizontal", value: gTextX, setValue: setGTextX, min: 0.03, max: 0.7, step: 0.01, fmt: v => +v <= 0.08 ? "← Izq" : +v <= 0.42 ? "↔ Centro" : "→ Der" },
                      { label: "Posición video", value: gVideoY, setValue: setGVideoY, min: 0.25, max: 0.85, step: 0.01, fmt: v => +v <= 0.38 ? "⬆ Arriba" : +v <= 0.62 ? "↕ Centro" : "⬇ Abajo" },
                      { label: "Tamaño video", value: gVideoScale, setValue: setGVideoScale, min: 0.4, max: 1.0, step: 0.05, fmt: v => `${Math.round(+v * 100)}%` },
                      { label: "Tamaño letra", value: gFontSize, setValue: v => setGFontSize(parseInt(v)), min: 40, max: 140, step: 5, fmt: v => `${v}px` },
                    ].map(({ label, value, setValue, min, max, step, fmt }) => (
                      <div key={label} style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--st-muted)", marginBottom: 4 }}>
                          <span>{label}</span><span style={{ fontFamily: "var(--st-mono)", color: "var(--st-text)" }}>{fmt(value)}</span>
                        </div>
                        <input type="range" min={min} max={max} step={step} value={value} onChange={e => setValue(e.target.value)} style={{ width: "100%" }} />
                      </div>
                    ))}

                    {/* Tipografía global */}
                    <div style={{ marginTop: 14, padding: 12, background: "var(--st-soft)", borderRadius: 9, border: "1px solid var(--st-line)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--st-text)", marginBottom: 10, letterSpacing: ".05em", textTransform: "uppercase" }}>Texto</div>
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11.5, color: "var(--st-muted)", marginBottom: 4 }}>Fuente</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                          {[["calibri", "Calibri"], ["arial", "Arial (meme)"], ["segoe", "Segoe UI"], ["arial_black", "Arial Black"], ["trebuchet", "Trebuchet"], ["impact", "Impact"]].map(([k, label]) => {
                            const on = gFontFamily === k;
                            return (
                              <button key={k} onClick={() => setGFontFamily(k)} style={{
                                fontSize: 11, padding: "5px 0",
                                background: on ? "var(--st-accent)" : "transparent",
                                color: on ? "var(--st-on-accent)" : "var(--st-muted)",
                                border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`,
                                borderRadius: 5, cursor: "pointer",
                              }}>{label}</button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Text alignment — global "centrar el texto" like crop */}
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, color: "var(--st-muted)", marginBottom: 4 }}>Centrar texto (alineación)</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                          {[["left", "⬅ Izquierda"], ["center", "↔ Centro"], ["right", "Derecha ➡"]].map(([k, label]) => {
                            const on = gTextAlign === k;
                            return (
                              <button key={k} onClick={() => setGTextAlign(k)} style={{
                                fontSize: 11, padding: "6px 0",
                                background: on ? "var(--st-accent)" : "transparent",
                                color: on ? "var(--st-on-accent)" : "var(--st-muted)",
                                border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`,
                                borderRadius: 5, cursor: "pointer", fontWeight: 600,
                              }}>{label}</button>
                            );
                          })}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                        <label style={{ flex: 1, fontSize: 11.5, color: "var(--st-muted)" }}>
                          <span style={{ display: "block", marginBottom: 3 }}>Color texto</span>
                          <input type="color" value={gTextColor || "#ffffff"} onChange={e => setGTextColor(e.target.value)}
                            style={{ width: "100%", height: 28, border: "1px solid var(--st-border)", borderRadius: 5, background: "transparent" }} />
                        </label>
                        <label style={{ flex: 1, fontSize: 11.5, color: "var(--st-muted)" }}>
                          <span style={{ display: "block", marginBottom: 3 }}>Color borde</span>
                          <input type="color" value={gStrokeColor} onChange={e => setGStrokeColor(e.target.value)}
                            style={{ width: "100%", height: 28, border: "1px solid var(--st-border)", borderRadius: 5, background: "transparent" }} />
                        </label>
                      </div>
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--st-muted)", marginBottom: 4 }}>
                          <span>Grosor borde</span><span style={{ fontFamily: "var(--st-mono)", color: "var(--st-text)" }}>{gStrokeWidth}px</span>
                        </div>
                        <input type="range" min={0} max={12} step={1} value={gStrokeWidth} onChange={e => setGStrokeWidth(parseInt(e.target.value))} style={{ width: "100%" }} />
                      </div>
                    </div>

                    {/* Fondo + filtro global */}
                    <div style={{ marginTop: 10, padding: 12, background: "var(--st-soft)", borderRadius: 9, border: "1px solid var(--st-line)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--st-text)", marginBottom: 10, letterSpacing: ".05em", textTransform: "uppercase" }}>Fondo y filtro</div>
                      <div style={{ fontSize: 11.5, color: "var(--st-muted)", marginBottom: 4 }}>Fondo</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 10 }}>
                        {[["color", "🎨 Color"], ["blur", "🌫 Blur del video"]].map(([k, label]) => {
                          const on = gBgMode === k;
                          return (
                            <button key={k} onClick={() => setGBgMode(k)} style={{
                              fontSize: 11.5, padding: "6px 0",
                              background: on ? "var(--st-accent)" : "transparent",
                              color: on ? "var(--st-on-accent)" : "var(--st-muted)",
                              border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`,
                              borderRadius: 5, cursor: "pointer",
                            }}>{label}</button>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--st-muted)", marginBottom: 4 }}>Filtro</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                        {[["none", "Ninguno"], ["cinematic", "Cine"], ["warm", "Cálido"], ["vivid", "Vivo"], ["moody", "Moody"], ["bw", "B/N"]].map(([k, label]) => {
                          const on = gVisualFilter === k;
                          return (
                            <button key={k} onClick={() => setGVisualFilter(k)} style={{
                              fontSize: 11, padding: "5px 0",
                              background: on ? "var(--st-accent)" : "transparent",
                              color: on ? "var(--st-on-accent)" : "var(--st-muted)",
                              border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`,
                              borderRadius: 5, cursor: "pointer",
                            }}>{label}</button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Anti-detect global */}
                    <div style={{ marginTop: 10, padding: 12, background: "var(--st-soft)", borderRadius: 9, border: "1px solid var(--st-line)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--st-text)", marginBottom: 8, letterSpacing: ".05em", textTransform: "uppercase" }}>🛡 Anti-detect</div>
                      {[
                        { label: "Espejo cíclico", value: gMirrorCyclic, setValue: setGMirrorCyclic, hint: "El video se invierte cada 5s" },
                        { label: "Boost contraste", value: gBoostContrast, setValue: setGBoostContrast, hint: "Sube contraste + saturación" },
                      ].map(({ label, value, setValue, hint }) => (
                        <label key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer" }}>
                          <input type="checkbox" checked={value} onChange={e => setValue(e.target.checked)}
                            style={{ accentColor: "var(--st-accent)", width: 14, height: 14 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, color: "var(--st-text)" }}>{label}</div>
                            <div style={{ fontSize: 10.5, color: "var(--st-faint)" }}>{hint}</div>
                          </div>
                        </label>
                      ))}
                    </div>

                    <button onClick={handleReexportAll} disabled={reexportingAll} className="st-btn st-btn--primary" style={{ width: "100%", justifyContent: "center", padding: "10px 0", marginTop: 12 }}>
                      {reexportingAll ? "Re-exportando todos…" : "Re-exportar todos con estos ajustes"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Items grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
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
                  globalTextAlign={gTextAlign}
                />
              ))}
            </div>
          </div>
        )}
      </div>
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
  const { model: analyzerModel, setModel: setAnalyzerModel } = useModel(); // global model (synced w/ sidebar + Ajustes)
  const [sortByScore, setSortByScore] = useState(false);
  const [modelHealth, setModelHealth] = useState({});
  const [checkingModels, setCheckingModels] = useState(false);
  const [analyzerLang, setAnalyzerLang] = useState("en"); // caption language: "en" | "es"

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
        file, clipCount, 15, "", (pct) => setUploadPct(pct), analyzerModel, "", 0, 0, 90, analyzerLang
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
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 30px", borderBottom: "1px solid var(--st-line)", flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--st-display)", fontSize: 24, fontWeight: 600, letterSpacing: "-.02em" }}>
            Analyzer {phase === "done" && <span style={{ color: "var(--st-faint)", fontWeight: 500 }}>· {moments.length} momentos</span>}
          </h1>
          <div style={{ fontSize: 13, color: "var(--st-muted)", marginTop: 3 }}>
            Momentos virales como texto y guion — para planear, copiar o reanalizar.
          </div>
        </div>
        <PromptEditButton
          promptKeys={["analysis_system", "verify_timestamps", "reanalyze_clip"]}
          title="Prompts · Analyzer" />
        {phase === "done" && (
          <>
            <div style={{ display: "flex", background: "var(--st-alt)", borderRadius: 9, padding: 3 }}>
              {[["score", "Por score"], ["orig", "Original"]].map(([k, label]) => {
                const on = (k === "score") === sortByScore;
                return (
                  <span key={k} onClick={() => setSortByScore(k === "score")} style={{
                    fontSize: 12.5, fontWeight: on ? 600 : 500, padding: "6px 12px", borderRadius: 6, cursor: "pointer",
                    background: on ? "var(--st-surface)" : "transparent", color: on ? "var(--st-text)" : "var(--st-muted)",
                  }}>{label}</span>
                );
              })}
            </div>
            <button onClick={handleCopyAll} className="st-btn st-btn--ghost" style={{ padding: "7px 13px" }}>
              {copiedAll ? <Check size={14} /> : <Copy size={14} />} {copiedAll ? "Copiado" : "Copiar todo"}
            </button>
            <button onClick={handleReset} className="st-btn st-btn--primary" style={{ padding: "8px 14px" }}>
              <RefreshCw size={14} /> Nuevo video
            </button>
          </>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 30px" }}>
        {/* ── IDLE: config ── */}
        {phase === "idle" && (
          <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById("analyzer-file-input").click()}
              style={{
                border: `1.5px dashed ${dragging ? "var(--st-accent)" : file ? "var(--st-ok)" : "var(--st-border)"}`,
                borderRadius: 14, padding: "44px 20px", textAlign: "center", cursor: "pointer",
                background: dragging ? "var(--st-soft)" : "transparent", transition: "all 0.15s",
              }}
            >
              <input id="analyzer-file-input" type="file" accept="video/*" style={{ display: "none" }}
                onChange={(e) => handleFile(e.target.files[0])} />
              <div style={{ width: 40, height: 40, borderRadius: 10, background: file ? "var(--st-soft)" : "var(--st-alt)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
                {file ? <Check size={20} style={{ color: "var(--st-ok)" }} /> : <Sparkles size={20} style={{ color: "var(--st-muted)" }} />}
              </div>
              {file ? (
                <>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{file.name}</div>
                  <div style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)" }}>
                    {(file.size / 1024 / 1024).toFixed(1)} MB · clic para cambiar
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Arrastrá un video aquí</div>
                  <div style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)" }}>o clickeá para seleccionar</div>
                </>
              )}
            </div>

            <div className="st-card" style={{ padding: "16px 18px" }}>
              <div className="st-eyebrow" style={{ marginBottom: 10 }}>Modelo de IA</div>
              <ModelSelector value={analyzerModel} onChange={setAnalyzerModel} health={modelHealth} checking={checkingModels} onCheck={handleCheckModels} />
            </div>

            <div className="st-card" style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)" }}>¿Cuántos momentos buscar?</span>
                <span style={{ fontFamily: "var(--st-mono)", fontSize: 12, color: "var(--st-text)" }}>{clipCount}</span>
              </div>
              <input type="range" min={5} max={30} value={clipCount} onChange={(e) => setClipCount(Number(e.target.value))} style={{ width: "100%" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--st-mono)", fontSize: 10.5, color: "var(--st-faint)", marginTop: 4 }}>
                <span>5 · rápido</span><span>30 · completo</span>
              </div>
            </div>

            <div className="st-card" style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 10 }}>Idioma de los captions</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { val: "en", label: "🇺🇸 English" },
                  { val: "es", label: "🇪🇸 Español" },
                ].map(({ val, label }) => (
                  <StChip key={val} active={analyzerLang === val}
                    onClick={() => setAnalyzerLang(val)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 14px", fontSize: 13 }}>
                    {label}
                  </StChip>
                ))}
              </div>
            </div>

            <button onClick={handleAnalyze} disabled={!file} className="st-btn st-btn--primary" style={{ justifyContent: "center", padding: "12px 0", fontSize: 14 }}>
              <Sparkles size={16} /> Analizar video
            </button>
          </div>
        )}

        {/* ── UPLOADING / ANALYZING ── */}
        {(phase === "uploading" || phase === "analyzing") && (
          <div style={{ maxWidth: 460, margin: "60px auto 0" }}>
            <div className="st-card" style={{ padding: "30px 28px", textAlign: "center" }}>
              <div style={{ width: 54, height: 54, borderRadius: 14, background: "var(--st-soft)", border: "1px solid var(--st-border)", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
                <Loader2 size={24} style={{ color: "var(--st-text)", animation: "st-spin 1s linear infinite" }} />
              </div>
              <h3 style={{ margin: "0 0 6px", fontFamily: "var(--st-display)", fontSize: 21, fontWeight: 600, letterSpacing: "-.02em" }}>
                {phase === "uploading" ? "Subiendo video" : "Analizando con Gemini"}
              </h3>
              <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "var(--st-muted)", lineHeight: 1.5 }}>
                {phase === "uploading" ? "Enviando el archivo al servidor local." : "Gemini está viendo tu video. Puede tardar 1–3 minutos."}
              </p>
              {phase === "uploading" && (
                <>
                  <div style={{ height: 6, borderRadius: 99, background: "var(--st-alt)", overflow: "hidden", marginBottom: 8 }}>
                    <div style={{ height: "100%", width: `${uploadPct}%`, borderRadius: 99, background: "var(--st-accent)", transition: "width 0.3s" }} />
                  </div>
                  <p style={{ margin: 0, fontFamily: "var(--st-mono)", fontSize: 12, color: "var(--st-muted)", textAlign: "right" }}>{uploadPct}%</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── ERROR ── */}
        {phase === "error" && (
          <div style={{ maxWidth: 460, margin: "60px auto 0" }}>
            <div className="st-card" style={{ padding: "36px 30px", textAlign: "center" }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: "var(--st-soft)", border: "1px solid var(--st-border)", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
                <AlertCircle size={24} style={{ color: "var(--st-text)" }} />
              </div>
              <h3 style={{ margin: "0 0 6px", fontFamily: "var(--st-display)", fontSize: 19, fontWeight: 600 }}>No se pudo procesar</h3>
              <p style={{ margin: "0 0 20px", fontSize: 13.5, color: "var(--st-muted)", lineHeight: 1.55 }}>{errorMsg}</p>
              <button onClick={handleReset} className="st-btn st-btn--primary" style={{ margin: "0 auto" }}>
                <RefreshCw size={14} /> Intentar de nuevo
              </button>
            </div>
          </div>
        )}

        {/* ── DONE: moments list ── */}
        {phase === "done" && (
          <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
            {(sortByScore ? [...moments].sort((a, b) => (b.viral_score || 5) - (a.viral_score || 5)) : moments).map((m) => (
              <div key={m.id} className="st-card" style={{ display: "flex", gap: 16, padding: "16px 18px" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flexShrink: 0, width: 56 }}>
                  <ScoreBadge score={m.viral_score ?? "-"} />
                  <span style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)" }}>{formatTime(m.start_time)}</span>
                  <span style={{ fontFamily: "var(--st-mono)", fontSize: 9.5, color: "var(--st-faint)" }}>{(m.end_time - m.start_time).toFixed(0)}s</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, fontStyle: "italic", marginBottom: 6, color: "var(--st-text)" }}>“{m.viral_caption}”</div>
                  {m.description && <div style={{ fontSize: 12.5, color: "var(--st-text)", marginBottom: 4 }}>{m.description}</div>}
                  <div style={{ fontSize: 13, color: "var(--st-muted)", lineHeight: 1.55 }}>{m.viral_reason}</div>
                  {m.transcript_snippet ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--st-line)" }}>
                      <span style={{ marginTop: 5 }}><ConfDot conf={m.match_confidence} /></span>
                      <span style={{ fontFamily: "var(--st-mono)", fontSize: 11.5, color: "var(--st-faint)", fontStyle: "italic", lineHeight: 1.5 }}>{m.transcript_snippet}</span>
                    </div>
                  ) : null}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                  <button onClick={() => handleCopy(m)} title="Copiar momento" className="st-iconbtn">
                    {copied === m.id ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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

function SubtitleOverlay({ words, currentTime, style, sizeScale, yOffset, onYOffsetChange, containerRef }) {
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

  // Drag-to-position: when onYOffsetChange is provided, the subtitle can be
  // grabbed and dragged up/down in the preview. Maps Δy pixels → Δ yOffset by
  // dividing by the container height (matches how bottomFrac is rendered).
  // Hard-clamped to [-0.5, +0.5] just like the slider, so they stay in sync.
  const draggable = typeof onYOffsetChange === "function";
  const onPointerDown = (e) => {
    if (!draggable) return;
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef?.current || e.currentTarget.parentElement;
    const rect = container?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    const startY = e.clientY;
    const startOffset = yOffset || 0;
    const onMove = (ev) => {
      const dy = ev.clientY - startY;            // px moved DOWN
      const dFrac = dy / rect.height;            // fraction of container height
      // yOffset positive = subtitle UP, so dragging DOWN subtracts from offset.
      const next = Math.max(-0.5, Math.min(0.5, startOffset - dFrac));
      onYOffsetChange(parseFloat(next.toFixed(3)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Common positioning wrapper. When draggable, captures pointer events on the
  // text itself (rest of the wrapper stays pointerEvents:none so the user can
  // still scrub video / click overlays through the empty area).
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
  // Style additions + handlers merged into each style branch's outer text span.
  // Kept as two separate objects so the existing per-style `style` can spread
  // them cleanly: <span {...dragHandlers} style={{...existing, ...dragStyle}}>.
  const dragStyle = draggable
    ? { pointerEvents: "auto", cursor: "ns-resize", touchAction: "none" }
    : {};
  const dragHandlers = draggable
    ? { onPointerDown, title: "Arrastrá arriba/abajo para mover el subtítulo" }
    : {};

  // Mirror the heavy black outline ASS uses — stack drop-shadows for crispness
  const outline = "2px 2px 0 #000, -2px 2px 0 #000, 2px -2px 0 #000, -2px -2px 0 #000, 0 0 4px #000";

  // ── Style-specific rendering ──
  if (style === "clean") {
    const text = group.map((w) => w.word).join(" ");
    return (
      <div style={wrapStyle}>
        <span {...dragHandlers} style={{ color: "#fff", fontSize: `${fontCqh}cqh`, textShadow: outline, padding: "0 0.4cqh", ...dragStyle }}>{text}</span>
      </div>
    );
  }

  if (style === "karaoke") {
    return (
      <div style={wrapStyle}>
        <span {...dragHandlers} style={{ fontSize: `${fontCqh}cqh`, textShadow: outline, padding: "0 0.4cqh", ...dragStyle }}>
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
          {...dragHandlers}
          style={{
            display: "inline-block",
            color: "#fff", fontSize: `${fontCqh}cqh`,
            textShadow: outline,
            animation: "subPopup 180ms cubic-bezier(.34,1.56,.64,1)",
            ...dragStyle,
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
        <span {...dragHandlers} style={{ fontSize: `${fontCqh}cqh`, padding: "0 0.4cqh", textShadow: outline, ...dragStyle }}>
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
        <span key={`${active.start}`} {...dragHandlers} style={{
          color: "#fff", fontSize: `${fontCqh}cqh`, textShadow: outline,
          display: "inline-block", animation: "subPopup 150ms ease-out",
          ...dragStyle,
        }}>{active?.word || ""}</span>
      </div>
    );
  }

  if (style === "twoword") {
    const text = group.map((w) => w.word).join(" ");
    return (
      <div style={wrapStyle}>
        <span key={`${cur.gStart}`} {...dragHandlers} style={{
          color: "#fff", fontSize: `${fontCqh}cqh`, textShadow: outline,
          display: "inline-block", animation: "subPopup 140ms ease-out",
          ...dragStyle,
        }}>{text}</span>
      </div>
    );
  }

  if (style === "bounce") {
    return (
      <div style={wrapStyle}>
        <span key={`${active.start}`} {...dragHandlers} style={{
          color: "#fff", fontSize: `${fontCqh}cqh`, textShadow: outline,
          display: "inline-block", animation: "subBounce 320ms cubic-bezier(.5,1.6,.4,1)",
          ...dragStyle,
        }}>{active?.word || ""}</span>
        <style>{`@keyframes subBounce { 0%{transform:translateY(40%) scale(0.6);opacity:0} 60%{transform:translateY(-12%) scale(1.18)} 80%{transform:translateY(4%) scale(0.96)} 100%{transform:translateY(0) scale(1);opacity:1} }`}</style>
      </div>
    );
  }

  if (style === "typewriter") {
    // Show full group, but the active word reveals letter-by-letter
    return (
      <div style={wrapStyle}>
        <span {...dragHandlers} style={{ fontSize: `${fontCqh}cqh`, color: "#fff", textShadow: outline, padding: "0 0.4cqh", ...dragStyle }}>
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
// Catalog of transitions exposed to the UI. Keep keys in sync with the
// backend XFADE_TRANSITIONS whitelist in video_service.py.
const TRANSITIONS = [
  { key: "cut",         label: "Corte",     hint: "Sin transición (default)" },
  { key: "fade",        label: "Fade",      hint: "Crossfade suave" },
  { key: "fadeblack",   label: "→ Negro",   hint: "Dip-to-black" },
  { key: "fadewhite",   label: "→ Blanco",  hint: "Dip-to-white" },
  { key: "dissolve",    label: "Dissolve",  hint: "Disolución granular" },
  { key: "slideleft",   label: "Slide ←",   hint: "Desliza desde la derecha" },
  { key: "slideright",  label: "Slide →",   hint: "Desliza desde la izquierda" },
  { key: "slideup",     label: "Slide ↑",   hint: "Desliza desde abajo" },
  { key: "slidedown",   label: "Slide ↓",   hint: "Desliza desde arriba" },
  { key: "wipeleft",    label: "Wipe ←",    hint: "Limpia hacia la izquierda" },
  { key: "wiperight",   label: "Wipe →",    hint: "Limpia hacia la derecha" },
  { key: "circleopen",  label: "Iris ◯",    hint: "Círculo se abre" },
  { key: "circleclose", label: "Iris ●",    hint: "Círculo se cierra" },
  { key: "zoomin",      label: "Zoom",      hint: "Acerca" },
  { key: "pixelize",    label: "Pixelize",  hint: "Pixelado" },
  { key: "radial",      label: "Radial",    hint: "Barrido radial" },
];

// Build the inline style for the live preview overlay that simulates a
// transition. p ∈ [0,1] is the progress through the transition window.
// These are CSS approximations of FFmpeg's xfade — not pixel-accurate but
// enough for the user to confirm the effect is configured before exporting.
function buildTransitionFx(type, p) {
  const bell = Math.sin(Math.PI * Math.max(0, Math.min(1, p)));  // 0→1→0
  switch (type) {
    case "fade":       return { background: "#000", opacity: bell * 0.6 };
    case "fadeblack":  return { background: "#000", opacity: bell };
    case "fadewhite":  return { background: "#fff", opacity: bell };
    case "dissolve":   return { background: "rgba(160,160,160,.45)", opacity: bell, backdropFilter: "blur(3px)" };
    case "pixelize":   return { backdropFilter: `blur(${bell * 14}px)`, opacity: 1 };
    case "zoomin":     return { background: "#000", opacity: bell * 0.35, transform: `scale(${1 + bell * 0.35})`, transformOrigin: "center" };
    case "slideleft":  return { background: "#000", clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` };
    case "slideright": return { background: "#000", clipPath: `inset(0 0 0 ${(1 - p) * 100}%)` };
    case "slideup":    return { background: "#000", clipPath: `inset(${(1 - p) * 100}% 0 0 0)` };
    case "slidedown":  return { background: "#000", clipPath: `inset(0 0 ${(1 - p) * 100}% 0)` };
    case "wipeleft":   return { background: "#000", clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` };
    case "wiperight":  return { background: "#000", clipPath: `inset(0 0 0 ${(1 - p) * 100}%)` };
    case "wipeup":     return { background: "#000", clipPath: `inset(${(1 - p) * 100}% 0 0 0)` };
    case "wipedown":   return { background: "#000", clipPath: `inset(0 0 ${(1 - p) * 100}% 0)` };
    case "circleopen": return { background: "#000", clipPath: `circle(${(1 - p) * 75}% at 50% 50%)` };
    case "circleclose":return { background: "#000", clipPath: `circle(${p * 75}% at 50% 50%)` };
    case "radial":     return { background: `conic-gradient(from -90deg, transparent 0deg, transparent ${p * 360}deg, #000 ${p * 360}deg, #000 360deg)` };
    case "smoothleft": return { background: "#000", clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`, transition: "clip-path 80ms linear" };
    case "smoothright":return { background: "#000", clipPath: `inset(0 0 0 ${(1 - p) * 100}%)`, transition: "clip-path 80ms linear" };
    default:           return { background: "#000", opacity: bell * 0.5 };
  }
}

function TransitionPicker({ value, duration, onChange, onClose, anchorRect }) {
  // Floating popover anchored to the boundary handle. Position above by
  // default; clamp to viewport.
  const W = 340, H = 290;
  const left = anchorRect
    ? Math.max(8, Math.min(window.innerWidth - W - 8, anchorRect.left + anchorRect.width / 2 - W / 2))
    : 100;
  const top = anchorRect
    ? Math.max(8, anchorRect.top - H - 10)
    : 100;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
      <div style={{
        position: "fixed", left, top, width: W, zIndex: 61,
        background: "var(--st-surface)", border: "1px solid var(--st-line)",
        borderRadius: 12, padding: 12, boxShadow: "var(--st-shadow-modal)",
        fontFamily: "var(--st-ui)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--st-text)" }}>Transición</span>
          <X size={14} style={{ cursor: "pointer", color: "var(--st-muted)" }} onClick={onClose} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
          {TRANSITIONS.map((t) => {
            const sel = value === t.key || (t.key === "cut" && (!value || value === "cut"));
            return (
              <button
                key={t.key}
                onClick={() => onChange(t.key, t.key === "cut" ? 0 : (duration || 0.4))}
                title={t.hint}
                style={{
                  fontFamily: "var(--st-ui)", fontSize: 10.5, padding: "8px 4px",
                  background: sel ? "var(--st-accent)" : "var(--st-alt)",
                  color: sel ? "var(--st-on-accent)" : "var(--st-text)",
                  border: `1px solid ${sel ? "var(--st-accent)" : "var(--st-line)"}`,
                  borderRadius: 7, cursor: "pointer", textAlign: "center",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 12, opacity: value === "cut" ? 0.4 : 1, pointerEvents: value === "cut" ? "none" : "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: "var(--st-muted)" }}>Duración</span>
            <span style={{ fontSize: 11, color: "var(--st-text)", fontFamily: "var(--st-mono)" }}>
              {(duration || 0.4).toFixed(2)}s
            </span>
          </div>
          <input
            type="range" min={0.1} max={2.0} step={0.05}
            value={duration || 0.4}
            onChange={(e) => onChange(value && value !== "cut" ? value : "fade", parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>
      </div>
    </>
  );
}

function TimelineEditor({
  thumbnails, segments, selectedIdx, outputTime, outputDuration,
  onSeekOutput, onSelectSegment, onSplit, onDeleteSegment, onReorder, onResizeSegment,
  loadingThumbs,
  onSpeedChange, onTransitionChange, onImageDurationChange, onInsertImageClick, uploadingOverlay,
  music, onAddMusic, onRemoveMusic, onMusicVol, onOrigVol, uploadingMusic,
}) {
  const [transPicker, setTransPicker] = useState(null);  // { idx, rect } or null
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "10px 18px 0" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexShrink: 0 }}>
        <button onClick={onSplit} title="Cortar aquí"
          className="st-btn st-btn--ghost" style={{ padding: "5px 10px", fontSize: 12 }}>
          <Scissors size={13} /> Cortar
        </button>
        <button onClick={onDeleteSegment}
          disabled={selectedIdx === null || segments.length <= 1}
          className="st-btn st-btn--ghost" style={{ padding: "5px 10px", fontSize: 12 }}>
          Borrar
        </button>
        {onInsertImageClick && (
          <button onClick={onInsertImageClick} disabled={uploadingOverlay}
            className="st-btn st-btn--ghost" style={{ padding: "5px 10px", fontSize: 12 }}>
            <ImageIcon size={13} /> Insertar imagen
          </button>
        )}
        {/* Speed control for the selected VIDEO segment */}
        {selectedIdx !== null && segments[selectedIdx] && segments[selectedIdx].type !== "image" && onSpeedChange && (
          <>
            <div style={{ width: 1, height: 18, background: "var(--st-line)", margin: "0 2px" }} />
            <span style={{ fontSize: 12, color: "var(--st-muted)" }}>Velocidad</span>
            {[0.5, 1, 1.5, 2, 4].map((sp) => (
              <span key={sp} onClick={() => onSpeedChange(selectedIdx, sp)}
                style={{
                  fontFamily: "var(--st-mono)", fontSize: 11, fontWeight: 600,
                  padding: "3px 7px", borderRadius: 6, cursor: "pointer",
                  background: (segments[selectedIdx].speed || 1) === sp ? "var(--st-accent)" : "var(--st-alt)",
                  color: (segments[selectedIdx].speed || 1) === sp ? "var(--st-on-accent)" : "var(--st-muted)",
                }}>{sp}×</span>
            ))}
          </>
        )}
        {/* Duration control for the selected IMAGE segment */}
        {selectedIdx !== null && segments[selectedIdx] && segments[selectedIdx].type === "image" && onImageDurationChange && (
          <>
            <div style={{ width: 1, height: 18, background: "var(--st-line)", margin: "0 2px" }} />
            <span style={{ fontSize: 12, color: "var(--st-muted)" }}>Duración</span>
            <input type="range" min={0.5} max={30} step={0.5}
              value={segments[selectedIdx].duration || 3}
              onChange={(e) => onImageDurationChange(selectedIdx, parseFloat(e.target.value))}
              style={{ width: 120 }} />
            <span style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-text)" }}>
              {(segments[selectedIdx].duration || 3).toFixed(1)}s
            </span>
          </>
        )}
        <span style={{ marginLeft: "auto", fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)" }}>
          {fmt(outputTime)} / {fmt(outputDuration)}
        </span>
      </div>

      {/* Ruler + time labels */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "0 2px", marginBottom: 3 }}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <span key={f} style={{ fontFamily: "var(--st-mono)", fontSize: 9.5, color: "var(--st-faint)" }}>
              {fmt(f * outputDuration)}
            </span>
          ))}
        </div>
        <div
          ref={rulerRef}
          onMouseDown={(e) => { setScrubbing(true); seekFromClientX(e.clientX); }}
          style={{
            position: "relative", height: 14,
            background: "var(--st-alt)", borderRadius: "5px 5px 0 0",
            border: "1px solid var(--st-line)", borderBottom: "none",
            cursor: "pointer", userSelect: "none",
          }}
        >
          {outputDuration > 0 && (
            <div style={{
              position: "absolute", top: 0, bottom: -62, left: `${pctOut(outputTime)}%`,
              width: 2, background: "var(--st-text)",
              pointerEvents: "none", zIndex: 6,
            }}>
              <div style={{
                position: "absolute", top: -3, left: "50%", transform: "translateX(-50%)",
                width: 9, height: 9, background: "var(--st-text)", borderRadius: 2,
              }} />
            </div>
          )}
        </div>
      </div>

      {/* Blocks row */}
      <div
        ref={blocksRef}
        style={{
          position: "relative", flex: 1,
          background: "#0d0c0b",
          borderRadius: "0 0 8px 8px", border: "1px solid var(--st-line)", userSelect: "none",
          display: "flex", overflow: "hidden",
        }}
      >
        {loadingThumbs ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--st-faint)", fontSize: 12, fontFamily: "var(--st-ui)" }}>
            Generando miniaturas...
          </div>
        ) : segments.map((seg, i) => {
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
                borderRight: i < segments.length - 1 ? "1px solid rgba(0,0,0,.5)" : "none",
                outline: isSel ? "2px solid var(--st-accent)" : "none",
                outlineOffset: "-2px",
                opacity: dragIdx === i ? 0.4 : 1,
                boxShadow: dropIdx === i && dragIdx !== null ? "inset 4px 0 0 var(--st-ok)" : "none",
                background: isImage ? "#1a2030" : "transparent",
              }}
            >
              {isImage ? (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {seg.url
                    ? <img src={seg.url} alt="" draggable={false} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", opacity: 0.9 }} />
                    : <ImageIcon size={16} style={{ color: "rgba(255,255,255,.3)" }} />}
                </div>
              ) : (
                <div style={{ position: "absolute", inset: 0, display: "flex" }}>
                  {thumbsFor(seg).map((t, k) => (
                    <img key={k} src={t.url} alt="" draggable={false}
                      style={{ flex: 1, height: "100%", objectFit: "cover", minWidth: 0, opacity: 0.85 }} />
                  ))}
                </div>
              )}
              {isSel && <div style={{ position: "absolute", inset: 0, background: "rgba(242,239,233,0.08)", pointerEvents: "none" }} />}
              {/* Index + speed badge */}
              <span style={{ position: "absolute", top: 3, left: 5, fontFamily: "var(--st-mono)", fontSize: 9, color: "rgba(255,255,255,.7)", textShadow: "0 1px 2px rgba(0,0,0,.8)", pointerEvents: "none" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              {!isImage && seg.speed && seg.speed !== 1 && (
                <span style={{ position: "absolute", bottom: 4, right: 6, fontFamily: "var(--st-mono)", fontSize: 9, fontWeight: 600, color: "var(--st-text)", background: "var(--st-surface)", padding: "1px 4px", borderRadius: 4 }}>
                  {seg.speed}×
                </span>
              )}
              {/* Resize handle */}
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
                  background: "linear-gradient(90deg, transparent, rgba(242,239,233,0.18))",
                  display: "flex", alignItems: "center", justifyContent: "flex-end",
                }}
                title="Arrastrá para estirar"
              >
                <div style={{ width: 3, height: "40%", background: "rgba(242,239,233,.5)", borderRadius: 2, marginRight: 2 }} />
              </div>
            </div>
          );
        })}

        {/* Transition handles at each segment boundary (i = 1..N-1) */}
        {!loadingThumbs && outputDuration > 0 && segments.slice(1).map((seg, j) => {
          const idx = j + 1;
          // Cumulative output duration up to (but not including) idx
          let cum = 0;
          for (let k = 0; k < idx; k++) {
            const s = segments[k];
            cum += s.type === "image" ? (s.duration || 3) : (s.end - s.start) / (s.speed || 1);
          }
          const leftPct = (cum / outputDuration) * 100;
          const tname = (seg.transition_in && seg.transition_in !== "cut") ? seg.transition_in : null;
          const tdur = seg.transition_duration || 0;
          return (
            <button
              key={`tr-${idx}`}
              onMouseDown={(e) => { e.stopPropagation(); }}
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setTransPicker({ idx, rect });
              }}
              title={tname ? `${tname} · ${tdur.toFixed(2)}s` : "Agregar transición"}
              style={{
                position: "absolute", top: "50%", left: `${leftPct}%`,
                transform: "translate(-50%, -50%)",
                width: 22, height: 22, borderRadius: 11, padding: 0,
                background: tname ? "var(--st-accent)" : "rgba(20,20,20,.85)",
                color: tname ? "var(--st-on-accent)" : "var(--st-text)",
                border: `1.5px solid ${tname ? "var(--st-accent)" : "rgba(255,255,255,.45)"}`,
                cursor: "pointer", zIndex: 5,
                fontSize: 12, fontWeight: 700, lineHeight: 1,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 1px 4px rgba(0,0,0,.55)",
              }}
            >
              {tname ? "✦" : "+"}
            </button>
          );
        })}
      </div>

      {transPicker && (
        <TransitionPicker
          value={segments[transPicker.idx]?.transition_in || "cut"}
          duration={segments[transPicker.idx]?.transition_duration || 0.4}
          anchorRect={transPicker.rect}
          onClose={() => setTransPicker(null)}
          onChange={(type, dur) => onTransitionChange?.(transPicker.idx, type, dur)}
        />
      )}

      {/* Audio track — below the video, aligned at full width (CapCut style) */}
      <div style={{
        marginTop: 5, height: 40, flexShrink: 0, position: "relative",
        borderRadius: 6, overflow: "hidden", border: "1px solid var(--st-line)",
        background: music ? "var(--st-accent)" : "transparent",
        display: "flex", alignItems: "center",
      }}>
        {music ? (
          <>
            {/* waveform bars (normalized) */}
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 1, padding: "0 4px" }}>
              {(() => {
                const pk = (music.peaks && music.peaks.length) ? music.peaks : Array(120).fill(0.12);
                const mx = Math.max(0.06, ...pk);
                return pk.map((p, i) => (
                  <div key={i} style={{ flex: 1, minWidth: 1, height: `${Math.max(3, Math.min(100, (p / mx) * 100))}%`, background: "var(--st-on-accent)", opacity: 0.45, borderRadius: 1 }} />
                ));
              })()}
            </div>
            {/* name + volume + remove */}
            <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 8, padding: "0 9px", width: "100%", color: "var(--st-on-accent)" }}>
              <Play size={11} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textShadow: "0 1px 3px rgba(0,0,0,.45)", maxWidth: 200 }}>{music.name}</span>
              <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, background: "rgba(0,0,0,.28)", borderRadius: 6, padding: "3px 9px" }}>
                <span style={{ fontSize: 10 }}>Música</span>
                <input type="range" min={0} max={2} step={0.05} value={music.volume} onChange={(e) => onMusicVol(parseFloat(e.target.value))} style={{ width: 66 }} />
                <span style={{ fontSize: 10, marginLeft: 4 }}>Orig</span>
                <input type="range" min={0} max={2} step={0.05} value={music.originalVolume} onChange={(e) => onOrigVol(parseFloat(e.target.value))} style={{ width: 52 }} />
                <X size={13} onClick={onRemoveMusic} style={{ cursor: "pointer", marginLeft: 2 }} />
              </span>
            </div>
          </>
        ) : (
          <button onClick={onAddMusic} disabled={uploadingMusic}
            className="st-btn st-btn--ghost" style={{ margin: "0 auto", padding: "5px 12px", fontSize: 12 }}>
            <Plus size={13} /> {uploadingMusic ? "Subiendo…" : "Agregar audio"}
          </button>
        )}
      </div>
    </div>
  );
}


// CSS approximations of the backend cinematic filters
// (video_service.get_visual_filter_chain) — preview only; the real look is
// applied by FFmpeg on export, so these just need to read the same direction.
const VF_CSS = {
  none: "none",
  cinematic: "contrast(1.08) saturate(1.12)",
  warm: "sepia(0.28) saturate(1.18) brightness(1.02)",
  vivid: "saturate(1.45) contrast(1.06)",
  moody: "contrast(1.16) brightness(0.9) saturate(0.85)",
  bw: "grayscale(1)",
};
const VF_LABELS = [
  ["none", "Normal"], ["cinematic", "Cine"], ["warm", "Cálido"],
  ["vivid", "Vívido"], ["moody", "Moody"], ["bw", "B/N"],
];

// Visual preview thumbnail for a subtitle style (CapCut-style picker). Mirrors
// the real look: Arial Black, white text + black outline, yellow highlight for
// karaoke/highlight. Animation can't show statically, so we hint the look.
const _SUB_OUTLINE = "1.4px 1.4px 0 #000,-1.4px 1.4px 0 #000,1.4px -1.4px 0 #000,-1.4px -1.4px 0 #000,0 2px 4px rgba(0,0,0,.55)";
// active-word highlight colors per karaoke variant, and [box, text] per box variant
const _SUB_KARA = { karaoke: "#ffe14d", karaoke_green: "#37e06a", karaoke_blue: "#3dd6ff", karaoke_pink: "#ff5db1", karaoke_red: "#ff4d4d", karaoke_orange: "#ff9f3d", karaoke_purple: "#c77dff" };
const _SUB_BOX = { highlight: ["#ffe14d", "#000"], box_green: ["#37e06a", "#000"], box_blue: ["#2f7bff", "#fff"], box_pink: ["#ff5db1", "#000"], box_red: ["#ff3b3b", "#fff"] };
function SubThumb({ styleKey, label, selected, onClick }) {
  const base = {
    fontFamily: '"Arial Black", Impact, system-ui, sans-serif', fontWeight: 900,
    color: "#fff", lineHeight: 1.04, textShadow: _SUB_OUTLINE, letterSpacing: ".3px",
    textAlign: "center", whiteSpace: "nowrap",
  };
  let body;
  if (styleKey === "none")
    body = <span style={{ fontFamily: "var(--st-ui)", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,.5)" }}>Sin subs</span>;
  else if (styleKey === "standard")
    // Netflix / documentary look — Arial Bold (NOT Arial Black), all caps, thin outline
    body = <span style={{
      fontFamily: '"Arial", "Helvetica Neue", "Helvetica", sans-serif',
      fontWeight: 700, fontSize: 13, color: "#fff",
      textShadow: "1px 1px 0 #000,-1px 1px 0 #000,1px -1px 0 #000,-1px -1px 0 #000",
      letterSpacing: "1.5px", textTransform: "uppercase", whiteSpace: "nowrap",
    }}>YOUR MOTHER DIED</span>;
  else if (_SUB_KARA[styleKey])
    body = <span style={{ ...base, fontSize: 13 }}>are <span style={{ color: _SUB_KARA[styleKey] }}>you</span> ready</span>;
  else if (_SUB_BOX[styleKey])
    body = <span style={{ ...base, fontSize: 13 }}>this <span style={{ background: _SUB_BOX[styleKey][0], color: _SUB_BOX[styleKey][1], textShadow: "none", padding: "1px 4px", borderRadius: 4 }}>word</span></span>;
  else if (styleKey === "neon")
    body = <span style={{ ...base, fontSize: 15, textShadow: "0 0 6px #3dd6ff,0 0 11px #3dd6ff,1.2px 1.2px 0 #000,-1.2px 1.2px 0 #000,1.2px -1.2px 0 #000,-1.2px -1.2px 0 #000" }}>neon</span>;
  else if (styleKey === "line_box")
    body = <span style={{ ...base, fontSize: 12.5, textShadow: "none", background: "#000", color: "#fff", padding: "3px 7px", borderRadius: 4 }}>line box</span>;
  else if (styleKey === "underline")
    body = <span style={{ ...base, fontSize: 13 }}>this <span style={{ textDecoration: "underline", textDecorationThickness: "2.5px", textUnderlineOffset: "2px" }}>word</span></span>;
  else if (styleKey === "bubble")
    body = <span style={{ ...base, textShadow: "none", background: "#fff", color: "#000", padding: "3px 8px", borderRadius: 6, fontSize: 12.5 }}>bubble</span>;
  else if (styleKey === "reveal")
    body = <span style={{ ...base, fontSize: 13 }}>one two <span style={{ display: "inline-block", fontSize: 16.5 }}>three</span></span>;
  else if (styleKey === "stack")
    body = <span style={{ ...base, fontSize: 10.5, lineHeight: 1.0, display: "flex", flexDirection: "column", gap: 1 }}><span>ARE</span><span style={{ color: "#ffe14d" }}>YOU</span><span>GO</span></span>;
  else if (styleKey === "hollow")
    body = <span style={{ fontFamily: '"Arial Black", Impact, system-ui, sans-serif', fontWeight: 900, fontSize: 15, color: "transparent", WebkitTextStroke: "1.6px #fff", letterSpacing: ".3px" }}>hollow</span>;
  else if (styleKey === "retro")
    body = <span style={{ ...base, fontSize: 15, textShadow: "3px 3px 0 #ff2db8,1.2px 1.2px 0 #000,-1.2px -1.2px 0 #000,1.2px -1.2px 0 #000,-1.2px 1.2px 0 #000" }}>retro</span>;
  else if (styleKey === "popup")
    body = <span style={{ ...base, fontSize: 21 }}>BOOM</span>;
  else if (styleKey === "big_center")
    body = <span style={{ ...base, fontSize: 24 }}>HUGE</span>;
  else if (styleKey === "twoword")
    body = <span style={{ ...base, fontSize: 17 }}>two words</span>;
  else if (styleKey === "bounce")
    body = <span style={{ ...base, fontSize: 18, display: "inline-block", transform: "rotate(-3deg)" }}>bounce!</span>;
  else if (styleKey === "typewriter")
    body = <span style={{ ...base, fontSize: 13 }}>typing<span style={{ opacity: 0.65 }}>|</span></span>;
  else if (styleKey === "word_zoom")
    body = <span style={{ ...base, fontSize: 25, letterSpacing: ".5px" }}>ZOOM</span>;
  else if (styleKey === "word_yellow")
    body = <span style={{ ...base, fontSize: 22, color: "#ffe14d" }}>WORD</span>;
  else if (styleKey === "word_box")
    body = <span style={{ ...base, textShadow: "none", background: "#fff", color: "#000", padding: "3px 9px", borderRadius: 6, fontSize: 18 }}>WORD</span>;
  else if (styleKey === "word_neon")
    body = <span style={{ ...base, fontSize: 21, textShadow: "0 0 7px #3dd6ff,0 0 13px #3dd6ff,1.3px 1.3px 0 #000,-1.3px 1.3px 0 #000,1.3px -1.3px 0 #000,-1.3px -1.3px 0 #000" }}>WORD</span>;
  else if (styleKey === "word_3d")
    body = <span style={{ ...base, fontSize: 22, textShadow: "4px 4px 0 #ff2db8,1.3px 1.3px 0 #000,-1.3px -1.3px 0 #000,1.3px -1.3px 0 #000,-1.3px 1.3px 0 #000" }}>WORD</span>;
  else if (styleKey === "word_rotate")
    body = <span style={{ ...base, fontSize: 21, display: "inline-block", transform: "rotate(-12deg)" }}>SPIN</span>;
  else if (styleKey === "word_glitch")
    body = <span style={{ ...base, fontSize: 21, textShadow: "-2px 0 #ff2d2d, 2px 0 #00e5ff, 1.3px 1.3px 0 #000,-1.3px -1.3px 0 #000" }}>WORD</span>;
  else if (styleKey === "word_outline")
    body = <span style={{ fontFamily: '"Arial Black", Impact, sans-serif', fontWeight: 900, fontSize: 20, color: "#fff", WebkitTextStroke: "3px #ffe14d", textShadow: "0 0 4px #000, 2px 2px 0 #000" }}>WORD</span>;
  else if (styleKey === "word_gold")
    body = <span style={{ ...base, fontSize: 21, color: "#e6b422", textShadow: "1.3px 1.3px 0 #3a2a08,-1.3px -1.3px 0 #3a2a08,1.3px -1.3px 0 #3a2a08,-1.3px 1.3px 0 #3a2a08" }}>GOLD</span>;
  else if (styleKey === "word_comic")
    body = <span style={{ fontFamily: '"Arial Black", Impact, sans-serif', fontWeight: 900, fontSize: 21, color: "#fff", WebkitTextStroke: "3px #e0301f" }}>BOOM</span>;
  else if (styleKey === "word_italic")
    body = <span style={{ ...base, fontSize: 21, fontStyle: "italic", display: "inline-block", transform: "skewX(-9deg)" }}>WORD</span>;
  else if (styleKey === "word_strip")
    body = <span style={{ ...base, textShadow: "none", background: "rgba(0,0,0,.55)", padding: "3px 10px", fontSize: 18 }}>WORD</span>;
  else if (styleKey === "word_minimal")
    body = <span style={{ fontFamily: '"Arial", "Helvetica Neue", sans-serif', fontWeight: 700, fontSize: 17, color: "#fff", letterSpacing: ".5px", textTransform: "lowercase" }}>word</span>;
  else if (styleKey === "word_longshadow")
    body = <span style={{ ...base, fontSize: 20, textShadow: "2px 2px 0 #111,4px 4px 0 #111,6px 6px 0 #111,8px 8px 0 #111,10px 10px 0 #111" }}>WORD</span>;
  else
    body = <span style={{ ...base, fontSize: 12.5 }}>clean caption</span>;
  return (
    <div onClick={onClick} title={label} style={{
      cursor: "pointer", borderRadius: 9, overflow: "hidden", position: "relative",
      height: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px",
      background: "radial-gradient(120% 120% at 50% 30%, #232323, #0b0b0b)",
      border: `2px solid ${selected ? "var(--st-accent)" : "transparent"}`,
      boxShadow: selected ? "0 0 0 1px var(--st-accent)" : "inset 0 0 0 1px rgba(255,255,255,.05)",
    }}>
      {body}
      <span style={{ position: "absolute", bottom: 3, left: 0, right: 0, textAlign: "center", fontSize: 8.5, color: "rgba(255,255,255,.5)", fontFamily: "var(--st-mono)", letterSpacing: ".4px", pointerEvents: "none" }}>{label}</span>
    </div>
  );
}

// ================================================
// EDITOR MODE — standalone manual editor (no AI clip detection)
// Upload → cut timeline → on-demand Whisper → subtitles → export
// ================================================
// ReframeViewfinder — paints the auto-reframe crop window as a rectangle on
// top of the raw video preview. Reads faceSamples and interpolates between
// adjacent samples for smooth motion. Source-pixel coords are normalized to
// the preview box via faceSrcSize. Pure CSS, no canvas.
function ReframeViewfinder({ samples, srcSize, currentTime, mode, followId, padding, smoothing }) {
  if (!samples || samples.length === 0 || !srcSize?.w || !srcSize?.h) return null;
  const t = Math.max(0, currentTime || 0);
  // Find the bracketing samples for `t`
  let i = 0;
  while (i < samples.length - 1 && samples[i + 1].t <= t) i++;
  const s = samples[i];
  if (!s) return null;

  // Pick the relevant faces by mode
  let faces = s.faces || [];
  if (mode === "follow" && followId != null) {
    faces = faces.filter((f) => f.id === followId);
  } else if (mode === "biggest" && faces.length > 0) {
    faces = [faces.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b))];
  }
  if (faces.length === 0) {
    // Show a faint hint that nothing is detected at this moment
    return (
      <span style={{
        position: "absolute", left: 8, bottom: 8, zIndex: 6,
        fontFamily: "var(--st-mono)", fontSize: 9, color: "rgba(255,255,255,.65)",
        background: "rgba(0,0,0,.5)", padding: "2px 6px", borderRadius: 4,
      }}>sin cara</span>
    );
  }

  // Union bbox of selected faces
  const x1 = Math.min(...faces.map((f) => f.x));
  const y1 = Math.min(...faces.map((f) => f.y));
  const x2 = Math.max(...faces.map((f) => f.x + f.w));
  const y2 = Math.max(...faces.map((f) => f.y + f.h));
  const bw = x2 - x1, bh = y2 - y1;
  const pad = (padding || 0.30) * Math.max(bw, bh);
  let px1 = x1 - pad, py1 = y1 - pad, px2 = x2 + pad, py2 = y2 + pad;
  // Expand to 9:16 (always grow, never shrink)
  const targetAr = 9 / 16;
  const pw = px2 - px1, ph = py2 - py1;
  const curAr = pw / Math.max(1, ph);
  if (curAr < targetAr) {
    const newW = ph * targetAr;
    const cx = (px1 + px2) / 2;
    px1 = cx - newW / 2; px2 = cx + newW / 2;
  } else if (curAr > targetAr) {
    const newH = pw / targetAr;
    const cy = (py1 + py2) / 2;
    py1 = cy - newH / 2; py2 = cy + newH / 2;
  }
  // Clamp to source frame
  const W = srcSize.w, H = srcSize.h;
  let cw = px2 - px1, ch = py2 - py1;
  if (cw > W) { const k = W / cw; cw *= k; ch *= k; }
  if (ch > H) { const k = H / ch; cw *= k; ch *= k; }
  let cx = (px1 + px2) / 2, cy = (py1 + py2) / 2;
  cx = Math.max(cw / 2, Math.min(W - cw / 2, cx));
  cy = Math.max(ch / 2, Math.min(H - ch / 2, cy));
  const left = (cx - cw / 2) / W * 100;
  const top = (cy - ch / 2) / H * 100;
  const wPct = cw / W * 100;
  const hPct = ch / H * 100;

  return (
    <>
      {/* Crop window outline */}
      <div style={{
        position: "absolute",
        left: `${left}%`, top: `${top}%`,
        width: `${wPct}%`, height: `${hPct}%`,
        border: "2px solid var(--st-accent, #e6c270)",
        borderRadius: 4,
        boxShadow: "0 0 0 9999px rgba(0,0,0,.35)",
        pointerEvents: "none",
        zIndex: 6,
        transition: "all .12s linear",
      }} />
      {/* Faint face boxes so the user sees what's detected */}
      {faces.map((f, k) => (
        <div key={k} style={{
          position: "absolute",
          left: `${f.x / W * 100}%`, top: `${f.y / H * 100}%`,
          width: `${f.w / W * 100}%`, height: `${f.h / H * 100}%`,
          border: "1px solid rgba(230,194,112,.55)",
          borderRadius: 2,
          pointerEvents: "none",
          zIndex: 6,
        }} />
      ))}
    </>
  );
}


function EditorMode({ onExit }) {
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
  const [activeRailTool, setActiveRailTool] = useState("frame");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [bgStyle, setBgStyle] = useState("blur");   // background fill: blur | black | white
  const [visualFilter, setVisualFilter] = useState("none"); // none|cinematic|warm|vivid|moody|bw
  // Background music track (the 2nd timeline bar): {path,url,name,volume,originalVolume}
  const [music, setMusic] = useState(null);
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const musicInputRef = useRef(null);
  const musicRef = useRef(null);
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

  // ─── Video overlays (B-roll picture-in-picture) state ─────────────────────
  // Each: {url, path, x, y, scale, opacity, start, end, broll_in, broll_out,
  // audio_mode, name, duration}. The full source duration is cached from upload
  // so the timing sliders can clamp properly.
  const [brolls, setBrolls] = useState([]);
  const [selectedBrollIdx, setSelectedBrollIdx] = useState(null);
  const [uploadingBroll, setUploadingBroll] = useState(false);
  const [brollUploadPct, setBrollUploadPct] = useState(0);
  const brollFileRef = useRef(null);
  // Refs to each B-roll <video> element so we can sync playback to the playhead
  const brollVideoRefs = useRef({});

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
  // Subtitle language: "en" = original Whisper words, "es" = Gemini-translated.
  // SubtitleOverlay always reads from `activeWords` below (derived).
  // Toggle does not touch any other style — only swaps which array is rendered
  // and what `language` is passed to the export call.
  const [subLanguage, setSubLanguage] = useState("en");
  const [transcriptWordsEs, setTranscriptWordsEs] = useState([]);
  const [translatingSubs, setTranslatingSubs] = useState(false);
  const [translateSubsError, setTranslateSubsError] = useState(null);

  // ── Auto-reframe (face tracking) state ──────────────────────────────────
  // After "Analizar caras" runs once, faceSamples + facePeople are populated.
  // The live viewfinder reads faceSamples; the Manual-pick grid reads facePeople.
  // Knobs (enabled/mode/padding/smoothing/follow_id) live as separate state +
  // sync to the backend style on debounce so export/preview see them.
  const [analyzingFaces, setAnalyzingFaces] = useState(false);
  const [analyzeFacesError, setAnalyzeFacesError] = useState(null);
  const [faceSamples, setFaceSamples] = useState([]);    // [{t, faces: [...]}]
  const [facePeople, setFacePeople] = useState([]);      // [{id, thumb_t, thumb_box, ...}]
  const [faceSrcSize, setFaceSrcSize] = useState({ w: 0, h: 0 });
  const [reframeOn, setReframeOn] = useState(false);
  const [reframeMode, setReframeMode] = useState("all");      // "all" | "biggest" | "follow"
  const [reframeFollowId, setReframeFollowId] = useState(null);
  const [reframePadding, setReframePadding] = useState(0.30);
  const [reframeSmoothing, setReframeSmoothing] = useState(0.85);
  // Preview-MP4 modal state (the 10-second exported sample, kept separate
  // from the inline live preview overlay)
  const [reframePreviewing, setReframePreviewing] = useState(false);
  const [reframePreviewUrl, setReframePreviewUrl] = useState(null);
  const [reframePreviewLoading, setReframePreviewLoading] = useState(false);

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

  // Active transition under the playhead, if any. Window is centered on the
  // boundary between segments i and i+1. progress p ∈ [0,1] sweeps the window.
  const activeTransition = (() => {
    if (segments.length < 2) return null;
    let cum = 0;
    for (let i = 0; i < segments.length - 1; i++) {
      const s = segments[i];
      const segDur = s.type === "image" ? (s.duration || 3) : (s.end - s.start) / (s.speed || 1);
      cum += segDur;
      const next = segments[i + 1];
      const t = next.transition_in || "cut";
      const T = (t && t !== "cut") ? (next.transition_duration || 0.4) : 0;
      if (T <= 0) continue;
      const halfT = T / 2;
      const winStart = cum - halfT;
      const winEnd = cum + halfT;
      if (outputTime >= winStart && outputTime <= winEnd) {
        const p = Math.max(0, Math.min(1, (outputTime - winStart) / T));
        return { type: t, progress: p, duration: T, boundary: i + 1 };
      }
    }
    return null;
  })();

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
          fill_mode: "fit", fill_mode_scale: 1.0, background_style: "blur",
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
    transition_in: s.transition_in || "cut",
    transition_duration: s.transition_duration || 0,
  });

  // Set the transition INTO segment idx (idx >= 1). type="cut" clears it.
  const setSegmentTransition = (idx, type, duration) => {
    setSegments((prev) => prev.map((s, i) => i === idx
      ? { ...s, transition_in: type || "cut", transition_duration: type === "cut" ? 0 : (duration ?? 0.4) }
      : s));
  };

  // ─── Undo / redo ────────────────────────────────────────────────────────
  // Snapshot the whole editable "document" (everything the user can change)
  // into a JSON string; a debounced effect records changes into a past/future
  // stack. Setting lastDocRef BEFORE restoring keeps undo/redo from recording
  // themselves as new history entries.
  const captureDoc = () => JSON.stringify({
    segments,
    bgStyle, visualFilter, aspectRatio, music,
    subtitlesOn, subStyle, subSize, subY,
    overlays,
    ez: clipObj?.edit_zoom ?? 1, epx: clipObj?.edit_pan_x ?? 0, epy: clipObj?.edit_pan_y ?? 0,
    keyframes: clipObj?.keyframes ?? [],
  });

  const restoreDoc = (json) => {
    let d; try { d = JSON.parse(json); } catch { return; }
    setSegments(d.segments || []);
    setBgStyle(d.bgStyle); setVisualFilter(d.visualFilter); setAspectRatio(d.aspectRatio);
    setMusic(d.music ?? null);
    setSubtitlesOn(d.subtitlesOn); setSubStyle(d.subStyle); setSubSize(d.subSize); setSubY(d.subY);
    setOverlays(d.overlays || []);
    setClipObj((c) => c ? { ...c, edit_zoom: d.ez, edit_pan_x: d.epx, edit_pan_y: d.epy, keyframes: d.keyframes || [] } : c);
    // Style + overlays + subtitles re-persist via the buildEditorStyle effect.
    // Segments and transform/keyframes have no such effect on a non-slider
    // change, so persist them explicitly.
    if (projectId) {
      api.saveEditorSegments(projectId, (d.segments || []).map(segToPayload)).catch(() => {});
      if (clipObj) api.editClipTransform(projectId, clipObj.id, {
        edit_zoom: d.ez, edit_pan_x: d.epx, edit_pan_y: d.epy, keyframes: d.keyframes || [],
      }).catch(() => {});
    }
  };

  const histRef = useRef({ past: [], future: [] });
  const lastDocRef = useRef(null);
  const [, setHistTick] = useState(0);
  const bumpHist = () => setHistTick((t) => t + 1);

  // Record settled changes (debounced) into the past stack.
  useEffect(() => {
    if (!projectId || !clipObj) return;
    const doc = captureDoc();
    if (lastDocRef.current === null) { lastDocRef.current = doc; return; }
    if (doc === lastDocRef.current) return;
    const t = setTimeout(() => {
      const h = histRef.current;
      h.past.push(lastDocRef.current);
      if (h.past.length > 80) h.past.shift();
      h.future = [];
      lastDocRef.current = doc;
      bumpHist();
    }, 450);
    return () => clearTimeout(t);
  }, [segments, bgStyle, visualFilter, aspectRatio, music, subtitlesOn, subStyle, subSize, subY, overlays, clipObj]); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = () => {
    const h = histRef.current;
    if (!h.past.length) return;
    h.future.unshift(lastDocRef.current ?? captureDoc());
    const target = h.past.pop();
    lastDocRef.current = target;
    restoreDoc(target);
    bumpHist();
  };
  const redo = () => {
    const h = histRef.current;
    if (!h.future.length) return;
    h.past.push(lastDocRef.current ?? captureDoc());
    const target = h.future.shift();
    lastDocRef.current = target;
    restoreDoc(target);
    bumpHist();
  };
  const canUndo = histRef.current.past.length > 0;
  const canRedo = histRef.current.future.length > 0;

  // Keyboard: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl+Y = redo.
  const undoRef = useRef(undo); undoRef.current = undo;
  const redoRef = useRef(redo); redoRef.current = redo;
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
      const z = e.key.toLowerCase() === "z";
      if ((e.ctrlKey || e.metaKey) && z && !e.shiftKey) { e.preventDefault(); undoRef.current(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (z && e.shiftKey))) { e.preventDefault(); redoRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  // ── B-roll handlers ────────────────────────────────────────────────────
  const handleBrollUpload = async (file) => {
    if (!file || !projectId) return;
    setUploadingBroll(true);
    setBrollUploadPct(0);
    try {
      const res = await api.uploadEditorBroll(projectId, file, (pct) => setBrollUploadPct(pct));
      const dur = Math.max(0.5, Number(res.duration) || 5);
      const visible = Math.min(dur, Math.max(2, Math.round(outputDuration * 0.25) || 5));
      const newBroll = {
        url: res.url, path: res.path, name: res.filename,
        duration: dur,
        x: 0.80, y: 0.18, scale: 0.30, opacity: 1.0,
        start: 0, end: visible,
        broll_in: 0, broll_out: Math.min(dur, visible),
        audio_mode: "mute",
      };
      setBrolls((prev) => {
        const next = [...prev, newBroll];
        setSelectedBrollIdx(next.length - 1);
        return next;
      });
    } catch (e) {
      alert(`Error subiendo B-roll: ${e.message}`);
    } finally {
      setUploadingBroll(false);
      setBrollUploadPct(0);
    }
  };

  const updateBroll = (idx, patch) => {
    setBrolls((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };
  const removeBroll = (idx) => {
    setBrolls((prev) => prev.filter((_, i) => i !== idx));
    setSelectedBrollIdx((cur) => (cur === idx ? null : cur > idx ? cur - 1 : cur));
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
    fill_mode: "fit", fill_mode_scale: 1.0, background_style: bgStyle,
    caption_style: "tiktok", aspect_ratio: aspectRatio,
    subtitle_style: subtitlesOn ? subStyle : "none",
    subtitle_size_scale: subSize, subtitle_y: subY,
    no_text: false, no_emojis: true, visual_filter: visualFilter,
    music_path: music?.path || null,
    music_volume: music?.volume ?? 0.8,
    original_volume: music?.originalVolume ?? 1.0,
    image_overlays: overlays.map((o) => ({
      path: o.path, x: o.x, y: o.y, scale: o.scale,
      start: o.start, end: o.end, opacity: o.opacity,
    })),
    video_overlays: brolls.map((b) => ({
      path: b.path, x: b.x, y: b.y, scale: b.scale, opacity: b.opacity,
      start: b.start, end: b.end,
      broll_in: b.broll_in, broll_out: b.broll_out,
      audio_mode: b.audio_mode,
    })),
  });

  // Single debounced persist whenever ANY style-affecting field changes.
  useEffect(() => {
    if (!projectId) return;
    const t = setTimeout(() => {
      api.updateStyle(projectId, buildEditorStyle()).catch((e) => console.error("style save failed:", e));
    }, 350);
    return () => clearTimeout(t);
  }, [aspectRatio, bgStyle, visualFilter, music, subtitlesOn, subStyle, subSize, subY, overlays, brolls]); // eslint-disable-line react-hooks/exhaustive-deps

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
      } else if (d.mode === "moveBroll") {
        updateBroll(d.idx, {
          x: Math.max(0, Math.min(1, d.ox + dx)),
          y: Math.max(0, Math.min(1, d.oy + dy)),
        });
      } else if (d.mode === "resizeBroll") {
        updateBroll(d.idx, { scale: Math.max(0.1, Math.min(1.0, d.oscale + dx)) });
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

  // ─── Background music ──────────────────────────────────────────────────
  const handleMusicUpload = async (file) => {
    if (!projectId || !file) return;
    setUploadingMusic(true);
    try {
      const res = await api.uploadEditorMusic(projectId, file);
      setMusic({ path: res.path, url: res.url, name: res.filename || file.name, volume: 0.8, originalVolume: 1.0, peaks: res.peaks || [] });
    } catch (e) {
      console.error("music upload failed:", e);
    } finally {
      setUploadingMusic(false);
    }
  };

  // Music <audio> volume (HTML is 0..1; export uses 0..2 so we clamp the preview).
  useEffect(() => {
    if (musicRef.current) musicRef.current.volume = music ? Math.min(1, music.volume) : 0;
  }, [music]);

  // Play / pause the music together with the video, anchored to the output time.
  useEffect(() => {
    const a = musicRef.current;
    if (!a || !music) return;
    if (playing) { try { a.currentTime = outputTime; } catch (_) {} a.play().catch(() => {}); }
    else a.pause();
  }, [playing, music]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-anchor the music if it drifts from the output timeline (seek / segment jump).
  useEffect(() => {
    const a = musicRef.current;
    if (!a || !music || !playing) return;
    if (Math.abs(a.currentTime - outputTime) > 0.3) { try { a.currentTime = outputTime; } catch (_) {} }
  }, [outputTime, music, playing]);

  // ─── Sync each B-roll <video> element with the playhead. ─────────────────
  // When outputTime is inside [start..end] the B-roll should be playing at
  // time `broll_in + (outputTime - start)`. Outside that window or when the
  // main video is paused, the B-roll is paused. Drift > 0.3s = hard reseek.
  useEffect(() => {
    for (const b of brolls) {
      const i = brolls.indexOf(b);
      const el = brollVideoRefs.current[i];
      if (!el) continue;
      const inWindow = outputTime >= b.start && outputTime <= b.end;
      if (!inWindow) {
        if (!el.paused) try { el.pause(); } catch (_) {}
        continue;
      }
      const wantedT = Math.max(0, b.broll_in + (outputTime - b.start));
      if (Math.abs(el.currentTime - wantedT) > 0.3) {
        try { el.currentTime = wantedT; } catch (_) {}
      }
      if (playing && el.paused) {
        const p = el.play();
        if (p && p.catch) p.catch(() => {});
      } else if (!playing && !el.paused) {
        try { el.pause(); } catch (_) {}
      }
    }
  }, [outputTime, playing, brolls]);

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
      // Invalidate any stale ES translation — the user just re-ran Whisper, so
      // word boundaries may have changed. They can re-translate on demand.
      setTranscriptWordsEs([]);
      setSubLanguage("en");
    } catch (e) {
      setTranscribeError(e.message || "Transcription failed");
    } finally {
      setTranscribing(false);
    }
  };

  // Translate the current Whisper transcript to Spanish via Gemini and cache
  // the resulting word list locally so SubtitleOverlay can switch to it.
  // Idempotent on the backend — re-clicking after a successful translation
  // returns the cache instantly.
  const handleTranslateSubsEs = async () => {
    if (!projectId || translatingSubs) return;
    setTranslatingSubs(true);
    setTranslateSubsError(null);
    try {
      const result = await api.editorTranslateSpanish(projectId);
      setTranscriptWordsEs(result.words || []);
      setSubLanguage("es");
    } catch (e) {
      setTranslateSubsError(e.message || "Translation failed");
    } finally {
      setTranslatingSubs(false);
    }
  };

  const deactivateSubtitles = () => {
    setSubtitlesOn(false);  // central style useEffect persists subtitle_style:none
    setTranscriptWords([]);
    setTranscriptWordsEs([]);
    setSubLanguage("en");
  };

  // ── Auto-reframe handlers ───────────────────────────────────────────────
  const handleAnalyzeFaces = async () => {
    if (!projectId || analyzingFaces) return;
    setAnalyzingFaces(true);
    setAnalyzeFacesError(null);
    try {
      const r = await api.editorAnalyzeFaces(projectId);
      setFaceSamples(r.samples || []);
      setFacePeople(r.people || []);
      setFaceSrcSize({ w: r.width || 0, h: r.height || 0 });
      // If exactly one person detected, default-pick them for follow mode.
      if ((r.people || []).length === 1) setReframeFollowId(r.people[0].id);
    } catch (e) {
      setAnalyzeFacesError(e.message || "Falló el análisis de caras");
    } finally {
      setAnalyzingFaces(false);
    }
  };

  // Push reframe knobs to backend on debounced change so export + preview
  // see them. Uses a ref to skip the initial mount call.
  const _reframeFirstRunRef = useRef(true);
  useEffect(() => {
    if (!projectId || faceSamples.length === 0) return;
    if (_reframeFirstRunRef.current) { _reframeFirstRunRef.current = false; return; }
    const timer = setTimeout(() => {
      api.editorUpdateReframeStyle(projectId, {
        auto_reframe_enabled: reframeOn,
        auto_reframe_mode: reframeMode,
        auto_reframe_follow_id: reframeFollowId,
        auto_reframe_padding: reframePadding,
        auto_reframe_smoothing: reframeSmoothing,
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [projectId, faceSamples.length, reframeOn, reframeMode, reframeFollowId, reframePadding, reframeSmoothing]);

  const openReframePreview = async () => {
    if (!projectId || faceSamples.length === 0) return;
    setReframePreviewing(true);
    setReframePreviewLoading(true);
    setReframePreviewUrl(api.getReframePreviewUrl(projectId, 10));
  };
  const closeReframePreview = () => {
    setReframePreviewing(false);
    setReframePreviewUrl(null);
    setReframePreviewLoading(false);
  };

  // Words actually rendered by SubtitleOverlay — derives from the language
  // toggle so the live preview switches instantly without re-fetching.
  const activeWords = subLanguage === "es" && transcriptWordsEs.length > 0
    ? transcriptWordsEs
    : transcriptWords;

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
  // Routes to the Spanish export endpoint when the ES toggle is active AND
  // there's a cached translation — that produces a {clip}_es.mp4 with
  // translated subtitles burned in. Otherwise normal English export.
  const handleExport = async () => {
    if (!projectId) return;
    setExporting(true);
    setExportFiles([]);
    const useEs = subLanguage === "es" && transcriptWordsEs.length > 0;
    try {
      if (useEs) {
        await api.startSpanishExport(projectId, [clipObj.id]);
      } else {
        await api.startExport(projectId, [clipObj.id]);
      }
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
    setBrolls([]); setSelectedBrollIdx(null); setUploadingBroll(false); setBrollUploadPct(0);
    setMusic(null); setBgStyle("blur"); setVisualFilter("none");
    histRef.current = { past: [], future: [] }; lastDocRef.current = null;
    setAspectRatio("9:16");
    setSubtitlesOn(false); setTranscribedRange(null); setSubWordCount(0);
    setTranscriptWords([]); setTranscriptWordsEs([]); setSubLanguage("en"); setTranslateSubsError(null);
    setFaceSamples([]); setFacePeople([]); setFaceSrcSize({ w: 0, h: 0 });
    setReframeOn(false); setReframeMode("all"); setReframeFollowId(null);
    setReframePadding(0.30); setReframeSmoothing(0.85);
    setReframePreviewing(false); setReframePreviewUrl(null); setAnalyzeFacesError(null);
    _reframeFirstRunRef.current = true;
    setExporting(false); setExportFiles([]); setExportProgress({ current: 0, total: 0 });
  };

  // ─── RENDER ─────────────────────────────────────────────────────────────
  // Upload screen
  if (!projectId) {
    return (
      <div style={{ padding: "32px", maxWidth: 560, margin: "0 auto" }}>
        {onExit && (
          <button onClick={onExit} className="st-btn st-btn--quiet" style={{ padding: "6px 10px", marginBottom: 18, marginLeft: -10 }}>
            <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} /> Volver
          </button>
        )}
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontFamily: "var(--st-display)", fontSize: 24, fontWeight: 700, letterSpacing: "-.02em", margin: "0 0 6px" }}>Editor</h2>
          <p style={{ color: "var(--st-muted)", fontSize: 13.5, margin: 0 }}>
            Sube un video, recórtalo, agrégale subtítulos y exporta. Sin IA — todo manual.
          </p>
        </div>
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
            border: `1.5px dashed ${draggingFile ? "var(--st-accent)" : "var(--st-border)"}`,
            borderRadius: 14, padding: "52px 20px",
            textAlign: "center", cursor: "pointer",
            background: draggingFile ? "var(--st-soft)" : "transparent",
            transition: "all 0.15s",
          }}
        >
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--st-alt)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
            <Upload size={20} style={{ color: "var(--st-muted)" }} />
          </div>
          <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 14, color: "var(--st-text)" }}>Arrastrá un video aquí o clickeá para elegir</p>
          <p style={{ margin: 0, fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)" }}>mp4 · mov · mkv — cualquier duración</p>
          <input
            ref={fileInputRef} type="file" accept="video/*" style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </div>
        {uploadingProgress > 0 && uploadingProgress < 100 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ background: "var(--st-alt)", borderRadius: 99, height: 4, overflow: "hidden" }}>
              <div style={{ width: `${uploadingProgress}%`, background: "var(--st-accent)", height: "100%", borderRadius: 99, transition: "width 0.2s" }} />
            </div>
            <p style={{ fontFamily: "var(--st-mono)", fontSize: 11.5, color: "var(--st-muted)", marginTop: 8, textAlign: "center" }}>Subiendo... {uploadingProgress}%</p>
          </div>
        )}
        {uploadError && (
          <div style={{ marginTop: 16, padding: "12px 14px", background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.25)", borderRadius: 10, color: "var(--st-live)", fontSize: 13 }}>
            {uploadError}
          </div>
        )}
      </div>
    );
  }

  // Main editor screen — full-screen Studio layout (rail + preview + inspector + timeline)
  const railTools = [
    ["frame", <ZoomIn size={20} />, "Encuadre"],
    ["subs", <Type size={20} />, "Subtítulos"],
    ["overlay", <ImageIcon size={20} />, "Imágenes"],
    ["reframe", <Crosshair size={20} />, "Auto-encuadre"],
    ["keys", <Wand2 size={20} />, "Keyframes"],
  ];
  const inspectorTabs = [["frame", "Encuadre"], ["subs", "Subtítulos"], ["overlay", "Imágenes"], ["reframe", "Auto-encuadre"]];
  const SUB_STYLES = [
    ["standard", "Estándar"],
    ["clean", "Limpio"], ["karaoke", "Karaoke"], ["popup", "Pop-up"], ["highlight", "Highlight"],
    ["big_center", "Big Center"], ["twoword", "Two-Word"], ["bounce", "Bounce"], ["typewriter", "Typewriter"],
    ["karaoke_green", "Karaoke Verde"], ["karaoke_blue", "Karaoke Azul"], ["karaoke_pink", "Karaoke Rosa"],
    ["box_green", "Caja Verde"], ["box_blue", "Caja Azul"], ["neon", "Neón"],
    ["karaoke_red", "Karaoke Rojo"], ["karaoke_orange", "Karaoke Naranja"], ["karaoke_purple", "Karaoke Morado"],
    ["box_pink", "Caja Rosa"], ["box_red", "Caja Roja"], ["line_box", "Caja Línea"], ["underline", "Subrayado"],
    ["bubble", "Burbuja"], ["reveal", "Aparece"], ["stack", "Vertical"], ["hollow", "Contorno"], ["retro", "Retro 3D"],
    ["word_zoom", "1 palabra Zoom"], ["word_yellow", "1 palabra Amarillo"], ["word_box", "1 palabra Caja"],
    ["word_neon", "1 palabra Neón"], ["word_3d", "1 palabra 3D"], ["word_rotate", "1 palabra Giro"],
    ["word_glitch", "1 palabra Glitch"], ["word_outline", "1 palabra Doble borde"], ["word_gold", "1 palabra Gold"],
    ["word_comic", "1 palabra Comic"], ["word_italic", "1 palabra Itálica"], ["word_strip", "1 palabra Barra"],
    ["word_minimal", "1 palabra Minimal"], ["word_longshadow", "1 palabra Sombra"],
  ];
  // Thin adapter over the shared StSlider (keeps EditorMode's number-style
  // onChange + `val` prop so existing usages stay unchanged).
  const FrameSlider = ({ label, val, min, max, step, value, onChange }) => (
    <StSlider label={label} display={val} min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))} style={{ marginBottom: 15 }} />
  );

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--st-bg)", color: "var(--st-text)", fontFamily: "var(--st-ui)", overflow: "hidden" }}>
      {/* ═══ RAIL (60px) ═══ */}
      <div style={{ width: 60, flexShrink: 0, background: "var(--st-surface)", borderRight: "1px solid var(--st-line)", display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 0", gap: 6 }}>
        <div onClick={onExit} title="Salir del editor" style={{ width: 30, height: 30, borderRadius: 8, background: "var(--st-accent)", display: "grid", placeItems: "center", marginBottom: 10, cursor: "pointer" }}>
          <Scissors size={16} style={{ color: "var(--st-on-accent)" }} />
        </div>
        {railTools.map(([k, ic, label]) => {
          const isActive = k === "keys" ? showKeyframesModal : activeRailTool === k;
          return (
            <div key={k} title={label}
              onClick={() => { if (k === "keys") setShowKeyframesModal(true); else setActiveRailTool(k); }}
              style={{
                width: 42, height: 42, borderRadius: 10, display: "grid", placeItems: "center",
                color: isActive ? "var(--st-text)" : "var(--st-faint)",
                background: isActive ? "var(--st-alt)" : "transparent",
                border: isActive ? "1px solid var(--st-border)" : "1px solid transparent",
                cursor: "pointer", transition: "all .12s",
              }}>{ic}</div>
          );
        })}
        <div style={{ flex: 1 }} />
        <div onClick={onExit} title="Salir del editor" style={{ width: 42, height: 42, borderRadius: 10, display: "grid", placeItems: "center", color: "var(--st-faint)", cursor: "pointer" }}>
          <Settings size={20} />
        </div>
      </div>

      {/* ═══ MAIN COLUMN ═══ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 22px", borderBottom: "1px solid var(--st-line)", flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--st-mono)", fontSize: 10.5, color: "var(--st-faint)" }}>Editor · {trimDuration > 0 ? formatT(trimDuration) : "—"}</div>
            <div style={{ fontFamily: "var(--st-display)", fontSize: 17, fontWeight: 600, letterSpacing: "-.015em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {filename || "Clip sin título"}
            </div>
          </div>
          <button onClick={undo} disabled={!canUndo} title="Deshacer (Ctrl+Z)" className="st-btn st-btn--ghost" style={{ padding: "7px 10px", opacity: canUndo ? 1 : 0.4 }}>
            <Undo2 size={15} />
          </button>
          <button onClick={redo} disabled={!canRedo} title="Rehacer (Ctrl+Shift+Z)" className="st-btn st-btn--ghost" style={{ padding: "7px 10px", opacity: canRedo ? 1 : 0.4 }}>
            <Redo2 size={15} />
          </button>
          <button onClick={resetVideoTransform} className="st-btn st-btn--ghost" style={{ padding: "7px 12px" }}>
            <RefreshCw size={14} /> Restablecer
          </button>
          <button onClick={reset} className="st-btn st-btn--quiet" style={{ padding: "7px 12px" }}>
            Nuevo video
          </button>
          <button onClick={handleExport} disabled={trimDuration < 0.5 || exporting} className="st-btn st-btn--primary" style={{ padding: "8px 15px" }}>
            <Download size={15} /> Exportar
          </button>
        </div>

        {/* Middle: preview + inspector */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
          {/* ─── Center: preview + transport ─── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--st-soft)", minWidth: 0 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, minHeight: 0 }}>
              <div ref={previewBoxRef} style={{
                height: "100%", maxHeight: 440, aspectRatio: aspectRatio.replace(":", " / "),
                borderRadius: 14, overflow: "hidden", position: "relative",
                background: bgStyle === "white" ? "#fff" : "#000",
                boxShadow: "var(--st-shadow)", containerType: "size",
              }}>
                {/* Blurred background fill (mirrors export fit mode) */}
                <video
                  ref={bgVideoRef}
                  src={rawVideoUrl}
                  muted
                  style={{
                    position: "absolute", inset: 0, width: "100%", height: "100%",
                    objectFit: "cover", filter: "blur(24px) brightness(0.5)",
                    transform: "scale(1.15)", pointerEvents: "none",
                    visibility: (showingImageClip || bgStyle !== "blur") ? "hidden" : "visible",
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
                    filter: VF_CSS[visualFilter] || "none",
                    visibility: showingImageClip ? "hidden" : "visible",
                  }}
                />
                {/* Image clip — shown full-screen when the playhead is on an image segment */}
                {showingImageClip && currentSegment.url && (
                  <div style={{ position: "absolute", inset: 0, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
                    <img src={currentSegment.url} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                  </div>
                )}
                {/* Image overlays — visible if their time range covers the playhead */}
                {overlays.map((ov, i) => {
                  const visible = outputTime >= ov.start - 0.01 && outputTime <= ov.end + 0.01;
                  const isSel = selectedOverlayIdx === i;
                  if (!visible && !isSel) return null;
                  return (
                    <div key={i}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSelectedOverlayIdx(i);
                        setActiveRailTool("overlay");
                        overlayDragRef.current = { mode: "move", idx: i, startX: e.clientX, startY: e.clientY, ox: ov.x, oy: ov.y };
                      }}
                      style={{
                        position: "absolute",
                        left: `${ov.x * 100}%`, top: `${ov.y * 100}%`,
                        width: `${ov.scale * 100}%`,
                        transform: "translate(-50%, -50%)",
                        opacity: visible ? ov.opacity : 0.35,
                        cursor: "move",
                        outline: isSel ? "1.5px dashed var(--st-gold)" : "none",
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
                            position: "absolute", right: -6, bottom: -6, width: 12, height: 12,
                            background: "var(--st-gold)", borderRadius: "50%", cursor: "nwse-resize",
                            border: "2px solid #15130e",
                          }}
                        />
                      )}
                    </div>
                  );
                })}
                {/* B-roll video overlays — same drag/resize pattern as image
                    overlays, but rendered with a <video> element. Playback is
                    kept in sync with the main playhead via the useEffect a
                    bit further down; this block only handles position + size
                    + selection + the visibility window. */}
                {brolls.map((b, i) => {
                  const visible = outputTime >= b.start - 0.01 && outputTime <= b.end + 0.01;
                  const isSel = selectedBrollIdx === i;
                  if (!visible && !isSel) return null;
                  return (
                    <div key={`broll-${i}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSelectedBrollIdx(i);
                        setActiveRailTool("overlay");
                        overlayDragRef.current = { mode: "moveBroll", idx: i, startX: e.clientX, startY: e.clientY, ox: b.x, oy: b.y };
                      }}
                      style={{
                        position: "absolute",
                        left: `${b.x * 100}%`, top: `${b.y * 100}%`,
                        width: `${b.scale * 100}%`,
                        transform: "translate(-50%, -50%)",
                        opacity: visible ? b.opacity : 0.35,
                        cursor: "move",
                        outline: isSel ? "1.5px dashed var(--st-gold)" : "none",
                        zIndex: 6,
                        background: "#000",
                        borderRadius: 4,
                        overflow: "hidden",
                      }}
                    >
                      <video
                        ref={(el) => { if (el) brollVideoRefs.current[i] = el; else delete brollVideoRefs.current[i]; }}
                        src={b.url}
                        muted={b.audio_mode === "mute"}
                        preload="metadata"
                        draggable={false}
                        style={{ width: "100%", height: "auto", display: "block", pointerEvents: "none" }}
                      />
                      {isSel && (
                        <div
                          onMouseDown={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            overlayDragRef.current = { mode: "resizeBroll", idx: i, startX: e.clientX, startY: e.clientY, oscale: b.scale };
                          }}
                          style={{
                            position: "absolute", right: -6, bottom: -6, width: 12, height: 12,
                            background: "var(--st-gold)", borderRadius: "50%", cursor: "nwse-resize",
                            border: "2px solid #15130e",
                          }}
                        />
                      )}
                    </div>
                  );
                })}
                {/* Live subtitle overlay — reads activeWords, which is the
                    EN transcript by default and the ES transcript when the
                    user toggles ES (and has translated).
                    Draggable: pointer-drag on the text updates subY directly
                    (keeps the "Posición" slider in sync). previewBoxRef points
                    to the 9:16 preview container — drag math divides Δy by
                    its height. */}
                {subtitlesOn && activeWords.length > 0 && (
                  <SubtitleOverlay
                    words={activeWords}
                    currentTime={livePlayheadTime}
                    style={subStyle}
                    sizeScale={subSize}
                    yOffset={subY}
                    onYOffsetChange={setSubY}
                    containerRef={previewBoxRef}
                  />
                )}
                {/* Live auto-reframe viewfinder — only shown while the user is
                    in the Reframe tab, so the rectangle doesn't clutter the
                    preview during normal edits. The shaded area outside the
                    rectangle is what the export crops out. */}
                {activeRailTool === "reframe" && faceSamples.length > 0 && (
                  <ReframeViewfinder
                    samples={faceSamples}
                    srcSize={faceSrcSize}
                    currentTime={currentTime}
                    mode={reframeMode}
                    followId={reframeFollowId}
                    padding={reframePadding}
                    smoothing={reframeSmoothing}
                  />
                )}
                {/* Aspect badge */}
                <span style={{ position: "absolute", top: 10, left: 11, fontFamily: "var(--st-mono)", fontSize: 9.5, color: "#fff", background: "rgba(0,0,0,.5)", padding: "2px 6px", borderRadius: 5, zIndex: 7 }}>
                  {aspectRatio}
                </span>
                {/* Live transition preview (CSS approximation of FFmpeg xfade) */}
                {activeTransition && (
                  <>
                    <div style={{
                      position: "absolute", inset: 0, zIndex: 9, pointerEvents: "none",
                      ...buildTransitionFx(activeTransition.type, activeTransition.progress),
                    }} />
                    <span style={{
                      position: "absolute", top: 10, right: 11, zIndex: 10,
                      fontFamily: "var(--st-mono)", fontSize: 10, color: "#15130e",
                      background: "var(--st-gold, #e6c270)", padding: "3px 8px",
                      borderRadius: 5, fontWeight: 700, letterSpacing: ".4px",
                      boxShadow: "0 2px 6px rgba(0,0,0,.4)",
                    }}>
                      ▸ {activeTransition.type} · {activeTransition.duration.toFixed(2)}s
                    </span>
                  </>
                )}
              </div>
            </div>
            {/* Transport */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "0 0 16px", flexShrink: 0 }}>
              <div onClick={() => seekOutput(0)} title="Inicio" style={{ width: 36, height: 36, borderRadius: 9, border: "1px solid var(--st-border)", background: "var(--st-surface)", display: "grid", placeItems: "center", color: "var(--st-muted)", cursor: "pointer" }}>
                <SkipBack size={16} />
              </div>
              <div onClick={togglePlay} title={playing ? "Pausa" : "Play"} style={{ width: 46, height: 46, borderRadius: 99, background: "var(--st-accent)", display: "grid", placeItems: "center", color: "var(--st-on-accent)", cursor: "pointer" }}>
                {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
              </div>
              <div onClick={() => seekOutput(outputDuration - 0.1)} title="Final" style={{ width: 36, height: 36, borderRadius: 9, border: "1px solid var(--st-border)", background: "var(--st-surface)", display: "grid", placeItems: "center", color: "var(--st-muted)", cursor: "pointer" }}>
                <SkipForward size={16} />
              </div>
              <span style={{ fontFamily: "var(--st-mono)", fontSize: 11.5, color: "var(--st-faint)", marginLeft: 8 }}>
                {vZoom.toFixed(2)}× · arrastra para mover · rueda = zoom
              </span>
            </div>
          </div>

          {/* ─── Inspector (312px) ─── */}
          <div style={{ width: "clamp(260px, 28vw, 312px)", flexShrink: 0, borderLeft: "1px solid var(--st-line)", background: "var(--st-surface)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, padding: "12px 16px", borderBottom: "1px solid var(--st-line)", flexShrink: 0 }}>
              {inspectorTabs.map(([k, label]) => (
                <span key={k} onClick={() => setActiveRailTool(k)} style={{
                  fontSize: 12.5, fontWeight: 600, padding: "7px 12px", borderRadius: 8, cursor: "pointer",
                  background: activeRailTool === k ? "var(--st-alt)" : "transparent",
                  color: activeRailTool === k ? "var(--st-text)" : "var(--st-muted)",
                }}>{label}</span>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
              {/* ── FRAME panel (Formato + Encuadre) ── */}
              {(activeRailTool === "frame" || activeRailTool === "audio") && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
                    <LayoutGrid size={14} style={{ color: "var(--st-muted)" }} />
                    <span className="st-eyebrow">Formato</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
                    {[["9:16", "TikTok"], ["1:1", "Cuadrado"], ["16:9", "YouTube"], ["4:5", "IG Feed"]].map(([v, d]) => {
                      const sel = aspectRatio === v;
                      return (
                        <div key={v} onClick={() => setAspectRatio(v)} style={{
                          padding: "9px 12px", borderRadius: 9, cursor: "pointer",
                          border: `1px solid ${sel ? "var(--st-accent)" : "var(--st-border)"}`,
                          background: sel ? "var(--st-soft)" : "transparent",
                        }}>
                          <div style={{ fontFamily: "var(--st-mono)", fontSize: 13, fontWeight: 600, color: sel ? "var(--st-text)" : "var(--st-muted)" }}>{v}</div>
                          <div style={{ fontSize: 10.5, color: "var(--st-faint)" }}>{d}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
                    <ImageIcon size={14} style={{ color: "var(--st-muted)" }} />
                    <span className="st-eyebrow">Fondo</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
                    {[["blur", "Blur"], ["black", "Negro"], ["white", "Blanco"]].map(([v, d]) => {
                      const sel = bgStyle === v;
                      return (
                        <div key={v} onClick={() => setBgStyle(v)} style={{
                          padding: "9px 6px", borderRadius: 9, cursor: "pointer", textAlign: "center",
                          border: `1px solid ${sel ? "var(--st-accent)" : "var(--st-border)"}`,
                          background: sel ? "var(--st-soft)" : "transparent",
                        }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: sel ? "var(--st-text)" : "var(--st-muted)" }}>{d}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
                    <Wand2 size={14} style={{ color: "var(--st-muted)" }} />
                    <span className="st-eyebrow">Filtro</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
                    {VF_LABELS.map(([v, d]) => {
                      const sel = visualFilter === v;
                      return (
                        <div key={v} onClick={() => setVisualFilter(v)} style={{
                          padding: "9px 6px", borderRadius: 9, cursor: "pointer", textAlign: "center",
                          border: `1px solid ${sel ? "var(--st-accent)" : "var(--st-border)"}`,
                          background: sel ? "var(--st-soft)" : "transparent",
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: sel ? "var(--st-text)" : "var(--st-muted)" }}>{d}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
                    <ZoomIn size={14} style={{ color: "var(--st-muted)" }} />
                    <span className="st-eyebrow">Encuadre</span>
                  </div>
                  <FrameSlider label="Zoom" val={`${vZoom.toFixed(2)}×`} min={0.3} max={3} step={0.05} value={vZoom}
                    onChange={(n) => setVideoTransform({ edit_zoom: n })} />
                  <FrameSlider label="Posición X" val={vPanX > 0 ? `+${Math.round(vPanX)}` : `${Math.round(vPanX)}`} min={-100} max={100} step={1} value={vPanX}
                    onChange={(n) => setVideoTransform({ edit_pan_x: n })} />
                  <FrameSlider label="Posición Y" val={vPanY > 0 ? `+${Math.round(vPanY)}` : `${Math.round(vPanY)}`} min={-100} max={100} step={1} value={vPanY}
                    onChange={(n) => setVideoTransform({ edit_pan_y: n })} />

                  <div style={{ height: 1, background: "var(--st-line)", margin: "18px 0" }} />
                  <button onClick={() => setShowKeyframesModal(true)} className="st-btn st-btn--ghost" style={{ width: "100%", justifyContent: "center", padding: "9px 0" }}>
                    <Wand2 size={14} /> Keyframes {clipObj?.keyframes?.length > 0 ? `(${clipObj.keyframes.length})` : ""}
                  </button>
                </>
              )}

              {/* ── SUBS panel ── */}
              {activeRailTool === "subs" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
                    <Type size={14} style={{ color: "var(--st-muted)" }} />
                    <span className="st-eyebrow">Subtítulos</span>
                    <div style={{ flex: 1 }} />
                    {subtitlesOn && <span style={{ fontFamily: "var(--st-mono)", fontSize: 10, color: "var(--st-faint)" }}>{subWordCount} palabras</span>}
                  </div>

                  {!subtitlesOn ? (
                    <>
                      <button onClick={activateSubtitles} disabled={transcribing || trimDuration < 0.5}
                        className="st-btn st-btn--primary" style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}>
                        {transcribing ? "Transcribiendo..." : `Generar subtítulos · ${formatT(trimDuration)}`}
                      </button>
                      {transcribeError && (
                        <p style={{ color: "var(--st-live)", fontSize: 11.5, margin: "8px 0 0" }}>{transcribeError}</p>
                      )}
                      <p style={{ fontSize: 11.5, color: "var(--st-muted)", margin: "10px 0 0", lineHeight: 1.5 }}>
                        Whisper corre solo sobre el trim actual. {trimDuration > 300
                          ? `~${Math.round(trimDuration / 60 * 0.3)} min de espera.`
                          : `~${Math.max(3, Math.round(trimDuration * 0.3))} segundos.`}
                      </p>
                    </>
                  ) : (
                    <>
                      {subsStale && (
                        <div style={{ background: "var(--st-soft)", border: "1px solid var(--st-border)", padding: 10, borderRadius: 9, marginBottom: 12 }}>
                          <p style={{ margin: 0, fontSize: 11.5, color: "var(--st-muted)" }}>Cambiaste el trim después de transcribir.</p>
                          <button onClick={activateSubtitles} disabled={transcribing}
                            className="st-btn st-btn--ghost" style={{ marginTop: 8, padding: "5px 10px", width: "100%", justifyContent: "center" }}>
                            {transcribing ? "..." : "Re-transcribir"}
                          </button>
                        </div>
                      )}

                      {/* ── Idioma de los subtítulos (EN / ES) ──────────────────
                          El toggle solo cambia QUÉ palabras se renderizan en el
                          preview y QUÉ idioma se exporta. No toca el estilo, ni
                          el tamaño, ni la posición. */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                          <span className="st-eyebrow" style={{ fontSize: 10 }}>Idioma</span>
                          <div style={{ flex: 1 }} />
                          {subLanguage === "es" && transcriptWordsEs.length > 0 && (
                            <span style={{ fontFamily: "var(--st-mono)", fontSize: 10, color: "var(--st-faint)" }}>{transcriptWordsEs.length} palabras ES</span>
                          )}
                        </div>
                        <div style={{ display: "inline-flex", width: "100%", border: "1px solid var(--st-border)", borderRadius: 8, padding: 2 }}>
                          {[["en", "🇬🇧 EN"], ["es", "🇪🇸 ES"]].map(([k, label]) => {
                            const active = subLanguage === k;
                            const disabled = k === "es" && transcriptWordsEs.length === 0;
                            return (
                              <button
                                key={k}
                                onClick={() => !disabled && setSubLanguage(k)}
                                disabled={disabled}
                                title={disabled ? "Primero traduce los subtítulos al español" : `Mostrar y exportar subtítulos en ${k.toUpperCase()}`}
                                style={{
                                  flex: 1, padding: "6px 0", fontSize: 12, fontWeight: 600,
                                  background: active ? "var(--st-accent)" : "transparent",
                                  color: active ? "var(--st-on-accent)" : (disabled ? "var(--st-faint)" : "var(--st-muted)"),
                                  border: "none", borderRadius: 6,
                                  cursor: disabled ? "not-allowed" : "pointer",
                                  opacity: disabled ? 0.6 : 1,
                                }}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        {/* Translate CTA — appears when ES isn't cached yet */}
                        {transcriptWordsEs.length === 0 && (
                          <button
                            onClick={handleTranslateSubsEs}
                            disabled={translatingSubs || transcriptWords.length === 0}
                            className="st-btn st-btn--ghost"
                            style={{
                              width: "100%", marginTop: 8, padding: "7px 0",
                              justifyContent: "center", fontSize: 12,
                              border: "1px dashed var(--st-accent)",
                            }}
                            title="Traduce los subtítulos al español con Gemini (~2s)"
                          >
                            {translatingSubs ? "Traduciendo…" : "🇪🇸 Traducir subtítulos al español"}
                          </button>
                        )}
                        {translateSubsError && (
                          <p style={{ color: "var(--st-live)", fontSize: 11.5, margin: "8px 0 0" }}>{translateSubsError}</p>
                        )}
                      </div>

                      {/* Style preview grid (CapCut-style thumbnails) */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7, marginBottom: 18 }}>
                        {SUB_STYLES.map(([v, label]) => (
                          <SubThumb key={v} styleKey={v} label={label} selected={subStyle === v} onClick={() => setSubStyle(v)} />
                        ))}
                      </div>
                      <FrameSlider label="Tamaño" val={`${Math.round(subSize * 100)}%`} min={0.6} max={1.6} step={0.05} value={subSize}
                        onChange={(n) => setSubSize(n)} />
                      <FrameSlider
                        label="Posición"
                        val={subY === 0 ? "default" : subY > 0 ? `⬆ ${Math.round(subY * 100)}%` : `⬇ ${Math.round(-subY * 100)}%`}
                        min={-0.5} max={0.5} step={0.02} value={subY}
                        onChange={(n) => setSubY(n)} />
                      <div style={{ height: 1, background: "var(--st-line)", margin: "6px 0 14px" }} />
                      <button onClick={deactivateSubtitles} className="st-btn st-btn--ghost" style={{ width: "100%", justifyContent: "center", padding: "8px 0" }}>
                        Quitar subtítulos
                      </button>
                    </>
                  )}
                </>
              )}

              {/* ── OVERLAY (Imágenes) panel ── */}
              {activeRailTool === "overlay" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
                    <ImageIcon size={14} style={{ color: "var(--st-muted)" }} />
                    <span className="st-eyebrow">Imágenes</span>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontFamily: "var(--st-mono)", fontSize: 10, color: "var(--st-faint)" }}>{overlays.length}</span>
                  </div>

                  <button onClick={() => overlayFileRef.current?.click()} disabled={uploadingOverlay}
                    className="st-btn st-btn--ghost" style={{ width: "100%", justifyContent: "center", padding: "9px 0", marginBottom: 14 }}>
                    {uploadingOverlay ? "Subiendo..." : <><Upload size={14} /> Subir imagen</>}
                  </button>

                  {overlays.length === 0 ? (
                    <p style={{ fontSize: 11.5, color: "var(--st-muted)", margin: 0, lineHeight: 1.5 }}>
                      Subí una imagen (logo, captura, meme) para ponerla encima del video. La arrastrás y redimensionás en el preview.
                    </p>
                  ) : (
                    <>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                        {overlays.map((ov, i) => {
                          const sel = selectedOverlayIdx === i;
                          return (
                            <span key={i} onClick={() => setSelectedOverlayIdx(i)} style={{
                              fontFamily: "var(--st-mono)", fontSize: 11, padding: "4px 9px", borderRadius: 7, cursor: "pointer",
                              border: `1px solid ${sel ? "var(--st-accent)" : "var(--st-border)"}`,
                              background: sel ? "var(--st-soft)" : "transparent",
                              color: sel ? "var(--st-text)" : "var(--st-muted)",
                            }}>{String(i + 1).padStart(2, "0")}</span>
                          );
                        })}
                      </div>

                      {selectedOverlayIdx !== null && overlays[selectedOverlayIdx] && (() => {
                        const ov = overlays[selectedOverlayIdx];
                        const i = selectedOverlayIdx;
                        return (
                          <>
                            <FrameSlider label="Aparece desde" val={`${ov.start.toFixed(1)}s`} min={0} max={Math.max(1, outputDuration)} step={0.1} value={ov.start}
                              onChange={(n) => updateOverlay(i, { start: Math.min(n, ov.end - 0.2) })} />
                            <FrameSlider label="Hasta" val={`${ov.end.toFixed(1)}s`} min={0} max={Math.max(1, outputDuration)} step={0.1} value={ov.end}
                              onChange={(n) => updateOverlay(i, { end: Math.max(n, ov.start + 0.2) })} />
                            <FrameSlider label="Opacidad" val={`${Math.round(ov.opacity * 100)}%`} min={0.1} max={1} step={0.05} value={ov.opacity}
                              onChange={(n) => updateOverlay(i, { opacity: n })} />
                            <button onClick={() => deleteOverlay(i)} className="st-btn st-btn--ghost" style={{ width: "100%", justifyContent: "center", padding: "8px 0" }}>
                              Borrar imagen
                            </button>
                          </>
                        );
                      })()}
                      <p style={{ fontSize: 10.5, color: "var(--st-faint)", margin: "12px 0 0", lineHeight: 1.5 }}>
                        Arrastrá la imagen en el preview para moverla · esquina dorada para redimensionar.
                      </p>
                    </>
                  )}

                  {/* ── B-roll (videos picture-in-picture) ────────────────
                      Lives inside the Imágenes panel because conceptually
                      they're "things laid over the video" — same drag UX
                      pattern, just video instead of static images. */}
                  <div style={{ height: 1, background: "var(--st-line)", margin: "18px 0 12px" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
                    <Film size={14} style={{ color: "var(--st-muted)" }} />
                    <span className="st-eyebrow">📺 B-roll</span>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontFamily: "var(--st-mono)", fontSize: 10, color: "var(--st-faint)" }}>{brolls.length}</span>
                  </div>

                  <button onClick={() => brollFileRef.current?.click()} disabled={uploadingBroll}
                    className="st-btn st-btn--ghost" style={{ width: "100%", justifyContent: "center", padding: "9px 0", marginBottom: 12 }}>
                    {uploadingBroll
                      ? `Subiendo… ${brollUploadPct}%`
                      : <><Upload size={14} /> Subir video B-roll</>}
                  </button>

                  {brolls.length === 0 ? (
                    <p style={{ fontSize: 11.5, color: "var(--st-muted)", margin: 0, lineHeight: 1.5 }}>
                      Subí un video (reaction, B-roll, gameplay) para mostrarlo encima del video principal por un rango de tiempo.
                    </p>
                  ) : (
                    <>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                        {brolls.map((b, i) => {
                          const sel = selectedBrollIdx === i;
                          return (
                            <span key={i} onClick={() => setSelectedBrollIdx(i)} style={{
                              fontFamily: "var(--st-mono)", fontSize: 11, padding: "4px 9px", borderRadius: 7, cursor: "pointer",
                              border: `1px solid ${sel ? "var(--st-accent)" : "var(--st-border)"}`,
                              background: sel ? "var(--st-soft)" : "transparent",
                              color: sel ? "var(--st-text)" : "var(--st-muted)",
                            }}>📺 {String(i + 1).padStart(2, "0")}</span>
                          );
                        })}
                      </div>

                      {selectedBrollIdx !== null && brolls[selectedBrollIdx] && (() => {
                        const b = brolls[selectedBrollIdx];
                        const i = selectedBrollIdx;
                        return (
                          <>
                            <div style={{ fontSize: 11, color: "var(--st-faint)", marginBottom: 8, fontFamily: "var(--st-mono)" }}>
                              {b.name} · {b.duration.toFixed(1)}s
                            </div>

                            <FrameSlider label="Aparece desde" val={`${b.start.toFixed(1)}s`}
                              min={0} max={Math.max(0.5, outputDuration)} step={0.1} value={b.start}
                              onChange={(n) => updateBroll(i, { start: Math.min(n, b.end - 0.1) })} />
                            <FrameSlider label="Hasta" val={`${b.end.toFixed(1)}s`}
                              min={0.5} max={Math.max(0.5, outputDuration)} step={0.1} value={b.end}
                              onChange={(n) => updateBroll(i, { end: Math.max(n, b.start + 0.1) })} />

                            <div style={{ fontSize: 10.5, color: "var(--st-faint)", margin: "4px 0 8px", fontFamily: "var(--st-mono)" }}>↳ Pedazo del B-roll que se reproduce:</div>
                            <FrameSlider label="B-roll desde" val={`${b.broll_in.toFixed(1)}s`}
                              min={0} max={Math.max(0.5, b.duration - 0.1)} step={0.1} value={b.broll_in}
                              onChange={(n) => updateBroll(i, { broll_in: Math.min(n, b.broll_out - 0.1) })} />
                            <FrameSlider label="B-roll hasta" val={`${b.broll_out.toFixed(1)}s`}
                              min={0.1} max={b.duration} step={0.1} value={b.broll_out}
                              onChange={(n) => updateBroll(i, { broll_out: Math.max(n, b.broll_in + 0.1) })} />

                            <FrameSlider label="Tamaño" val={`${Math.round(b.scale * 100)}%`}
                              min={0.1} max={1.0} step={0.02} value={b.scale}
                              onChange={(n) => updateBroll(i, { scale: n })} />
                            <FrameSlider label="Opacidad" val={`${Math.round(b.opacity * 100)}%`}
                              min={0.2} max={1.0} step={0.05} value={b.opacity}
                              onChange={(n) => updateBroll(i, { opacity: n })} />

                            {/* Position presets (4 corners + custom) */}
                            <div style={{ fontSize: 10.5, color: "var(--st-faint)", margin: "8px 0 5px", fontFamily: "var(--st-mono)" }}>POSICIÓN</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5, marginBottom: 12 }}>
                              {[
                                ["↖", 0.18, 0.18], ["↗", 0.82, 0.18],
                                ["↙", 0.18, 0.82], ["↘", 0.82, 0.82],
                              ].map(([label, x, y]) => (
                                <button key={label} onClick={() => updateBroll(i, { x, y })}
                                  style={{
                                    padding: "6px 0", fontSize: 14, border: "1px solid var(--st-border)",
                                    borderRadius: 6, background: "transparent", color: "var(--st-text)", cursor: "pointer",
                                  }}>{label}</button>
                              ))}
                            </div>

                            {/* Audio mode */}
                            <div style={{ fontSize: 10.5, color: "var(--st-faint)", margin: "0 0 5px", fontFamily: "var(--st-mono)" }}>AUDIO DEL B-ROLL</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 12 }}>
                              {[["mute", "🔇 Mute"], ["mix", "🎚 Mix"], ["replace", "🔄 Reemp."]].map(([k, label]) => {
                                const active = b.audio_mode === k;
                                return (
                                  <button key={k} onClick={() => updateBroll(i, { audio_mode: k })}
                                    title={k === "mute" ? "Audio del B-roll silenciado" : k === "mix" ? "Mezcla a 50% con el audio original" : "Reemplaza el audio original (mismo mix por ahora)"}
                                    style={{
                                      fontSize: 11, padding: "6px 3px",
                                      background: active ? "var(--st-accent)" : "transparent",
                                      color: active ? "var(--st-on-accent)" : "var(--st-muted)",
                                      border: `1px solid ${active ? "var(--st-accent)" : "var(--st-border)"}`,
                                      borderRadius: 6, cursor: "pointer",
                                    }}>{label}</button>
                                );
                              })}
                            </div>

                            <button onClick={() => removeBroll(i)} className="st-btn st-btn--ghost"
                              style={{ width: "100%", justifyContent: "center", padding: "6px 0", fontSize: 11.5, color: "var(--st-live)" }}>
                              <Trash2 size={12} /> Borrar B-roll
                            </button>
                          </>
                        );
                      })()}

                      <p style={{ fontSize: 10.5, color: "var(--st-faint)", margin: "12px 0 0", lineHeight: 1.5 }}>
                        Arrastrá el video en el preview para moverlo · esquina dorada para redimensionar.
                      </p>
                    </>
                  )}
                </>
              )}

              {/* ── AUTO-REFRAME panel ── */}
              {activeRailTool === "reframe" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
                    <Crosshair size={14} style={{ color: "var(--st-muted)" }} />
                    <span className="st-eyebrow">Auto-encuadre</span>
                    <div style={{ flex: 1 }} />
                    {faceSamples.length > 0 && (
                      <span style={{ fontFamily: "var(--st-mono)", fontSize: 10, color: "var(--st-faint)" }}>
                        {facePeople.length} {facePeople.length === 1 ? "persona" : "personas"}
                      </span>
                    )}
                  </div>

                  {faceSamples.length === 0 ? (
                    <>
                      <p style={{ fontSize: 11.5, color: "var(--st-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
                        Detectá las caras del clip para que el encuadre 9:16 las siga automáticamente. El audio queda intacto.
                      </p>
                      <button onClick={handleAnalyzeFaces} disabled={analyzingFaces || trimDuration < 0.5}
                        className="st-btn st-btn--primary" style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}>
                        {analyzingFaces ? "Analizando…" : `🎯 Analizar caras · ${formatT(trimDuration)}`}
                      </button>
                      {analyzeFacesError && (
                        <p style={{ color: "var(--st-live)", fontSize: 11.5, margin: "8px 0 0" }}>{analyzeFacesError}</p>
                      )}
                      <p style={{ fontSize: 11, color: "var(--st-faint)", margin: "10px 0 0", lineHeight: 1.5 }}>
                        Estimado: {trimDuration > 300
                          ? `~${Math.round(trimDuration / 60 * 0.4)} min`
                          : `~${Math.max(10, Math.round(trimDuration * 0.4))} seg`} en CPU.
                      </p>
                    </>
                  ) : (
                    <>
                      {/* Master enable toggle */}
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 12px", marginBottom: 12,
                        background: reframeOn ? "var(--st-soft)" : "transparent",
                        border: `1px solid ${reframeOn ? "var(--st-accent)" : "var(--st-border)"}`,
                        borderRadius: 9,
                      }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--st-text)" }}>
                          Aplicar al export
                        </span>
                        <button onClick={() => setReframeOn((v) => !v)}
                          style={{
                            width: 40, height: 22, borderRadius: 99, border: "none",
                            background: reframeOn ? "var(--st-accent)" : "var(--st-border)",
                            position: "relative", cursor: "pointer",
                          }}
                          title={reframeOn ? "Desactivar auto-encuadre" : "Activar auto-encuadre"}>
                          <span style={{
                            position: "absolute", top: 2, left: reframeOn ? 20 : 2,
                            width: 18, height: 18, borderRadius: "50%", background: "#fff",
                            transition: "left .15s",
                          }} />
                        </button>
                      </div>

                      {/* Mode picker */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 10.5, color: "var(--st-muted)", marginBottom: 6, fontFamily: "var(--st-mono)", letterSpacing: ".06em" }}>
                          MODO
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                          {[
                            ["all", "🫂 Todos"],
                            ["biggest", "🔍 Más grande"],
                            ["follow", "👤 Manual"],
                          ].map(([k, label]) => {
                            const active = reframeMode === k;
                            const disabled = k === "follow" && facePeople.length === 0;
                            return (
                              <button key={k}
                                onClick={() => !disabled && setReframeMode(k)}
                                disabled={disabled}
                                style={{
                                  fontSize: 11, padding: "7px 4px",
                                  background: active ? "var(--st-accent)" : "transparent",
                                  color: active ? "var(--st-on-accent)" : "var(--st-muted)",
                                  border: `1px solid ${active ? "var(--st-accent)" : "var(--st-border)"}`,
                                  borderRadius: 7, cursor: disabled ? "not-allowed" : "pointer",
                                  opacity: disabled ? 0.5 : 1,
                                }}>{label}</button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Manual pick grid */}
                      {reframeMode === "follow" && facePeople.length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 10.5, color: "var(--st-muted)", marginBottom: 6, fontFamily: "var(--st-mono)", letterSpacing: ".06em" }}>
                            ELEGÍ A QUIÉN SEGUIR
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                            {facePeople.slice(0, 9).map((p) => {
                              const sel = reframeFollowId === p.id;
                              const srcW = faceSrcSize.w || 1;
                              const srcH = faceSrcSize.h || 1;
                              // Render thumbnail by drawing the raw video frame at thumb_t with
                              // CSS background-position to focus on the bounding box.
                              return (
                                <div key={p.id} onClick={() => setReframeFollowId(p.id)}
                                  title={`Aparece en ${p.appearance_count} muestras`}
                                  style={{
                                    aspectRatio: "1/1",
                                    border: `2px solid ${sel ? "var(--st-accent)" : "var(--st-border)"}`,
                                    borderRadius: 9, overflow: "hidden", cursor: "pointer",
                                    background: "#000", position: "relative",
                                  }}>
                                  <video
                                    src={rawVideoUrl}
                                    muted
                                    preload="metadata"
                                    onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = p.thumb_t || 0; } catch {} }}
                                    style={{
                                      position: "absolute",
                                      width: `${(srcW / Math.max(1, p.thumb_box.w)) * 100}%`,
                                      height: `${(srcH / Math.max(1, p.thumb_box.h)) * 100}%`,
                                      left: `${-(p.thumb_box.x / Math.max(1, p.thumb_box.w)) * 100}%`,
                                      top: `${-(p.thumb_box.y / Math.max(1, p.thumb_box.h)) * 100}%`,
                                      objectFit: "cover",
                                    }}
                                  />
                                  <span style={{
                                    position: "absolute", top: 3, left: 4,
                                    fontFamily: "var(--st-mono)", fontSize: 10, color: "#fff",
                                    background: "rgba(0,0,0,.6)", padding: "1px 5px", borderRadius: 4,
                                  }}>#{p.id}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <FrameSlider label="Suavidad" val={`${Math.round(reframeSmoothing * 100)}%`}
                        min={0} max={0.99} step={0.02} value={reframeSmoothing}
                        onChange={(n) => setReframeSmoothing(n)} />
                      <FrameSlider label="Aire" val={`${Math.round(reframePadding * 100)}%`}
                        min={0} max={1} step={0.02} value={reframePadding}
                        onChange={(n) => setReframePadding(n)} />

                      <div style={{ height: 1, background: "var(--st-line)", margin: "10px 0 12px" }} />

                      <button onClick={openReframePreview}
                        className="st-btn st-btn--ghost"
                        style={{ width: "100%", justifyContent: "center", padding: "9px 0", marginBottom: 6 }}>
                        <Play size={13} fill="currentColor" /> Ver muestra (10s)
                      </button>
                      <button onClick={handleAnalyzeFaces} disabled={analyzingFaces}
                        className="st-btn st-btn--ghost"
                        style={{ width: "100%", justifyContent: "center", padding: "7px 0", fontSize: 12 }}>
                        {analyzingFaces ? "Re-analizando…" : "Re-analizar"}
                      </button>
                      <p style={{ fontSize: 10.5, color: "var(--st-faint)", margin: "10px 0 0", lineHeight: 1.5 }}>
                        Incompatible con split-screen y keyframes — se desactiva en esos casos.
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* The audio track now lives INSIDE the timeline (below the video).
            These are just the hidden file input + the preview <audio> element. */}
        <input ref={musicInputRef} type="file" accept="audio/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleMusicUpload(f); e.target.value = ""; }} />
        <audio ref={musicRef} src={music?.url || undefined} preload="auto" />

        {/* ═══ TIMELINE (video track + audio track below, full width) ═══ */}
        <div style={{ height: 225, flexShrink: 0, borderTop: "1px solid var(--st-line)", background: "var(--st-surface)" }}>
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
            onSpeedChange={setSegmentSpeed}
            onTransitionChange={setSegmentTransition}
            onImageDurationChange={setImageClipDuration}
            onInsertImageClick={() => imageClipFileRef.current?.click()}
            uploadingOverlay={uploadingOverlay}
            music={music}
            onAddMusic={() => musicInputRef.current?.click()}
            onRemoveMusic={() => setMusic(null)}
            onMusicVol={(v) => setMusic((m) => m ? { ...m, volume: v } : m)}
            onOrigVol={(v) => setMusic((m) => m ? { ...m, originalVolume: v } : m)}
            uploadingMusic={uploadingMusic}
          />
        </div>
      </div>

      {/* Hidden file inputs */}
      <input ref={imageClipFileRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { addImageClip(e.target.files[0]); e.target.value = ""; }} />
      <input ref={overlayFileRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { handleOverlayUpload(e.target.files[0]); e.target.value = ""; }} />
      <input ref={brollFileRef} type="file" accept="video/*" style={{ display: "none" }}
        onChange={(e) => { handleBrollUpload(e.target.files[0]); e.target.value = ""; }} />

      {/* Auto-reframe MP4 preview modal — 10s sample with reframe baked in
          so the user can verify the framing before exporting the full clip. */}
      {reframePreviewing && (
        <div className="modal-overlay" onClick={closeReframePreview}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <h3>🎯 Muestra con auto-encuadre (10s)</h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: 12, fontSize: 13 }}>
              Renderizado con los ajustes actuales · {reframeMode === "all" ? "Todos" : reframeMode === "biggest" ? "Más grande" : `Sigue a #${reframeFollowId}`}
            </p>
            {reframePreviewLoading && (
              <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text-muted)" }}>
                <div className="loading-spinner" style={{ margin: "0 auto 12px" }}></div>
                <p style={{ fontSize: 13 }}>Generando muestra… (~10–25s)</p>
              </div>
            )}
            {reframePreviewUrl && (
              <video
                key={reframePreviewUrl}
                controls autoPlay
                style={{ width: "100%", borderRadius: 10, background: "black", maxHeight: 460, display: reframePreviewLoading ? "none" : "block" }}
                src={reframePreviewUrl}
                onCanPlay={() => setReframePreviewLoading(false)}
                onError={() => {
                  setReframePreviewLoading(false);
                  alert("No se pudo generar la muestra. ¿Analizaste caras primero?");
                  closeReframePreview();
                }}
              />
            )}
            <div className="btn-group">
              <button className="btn btn-secondary" onClick={closeReframePreview}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Export overlay (interim — full export-flow screen comes later) */}
      {(exporting || exportFiles.length > 0) && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", zIndex: 50 }}>
          <div style={{ width: 420, background: "var(--st-surface)", border: "1px solid var(--st-line)", borderRadius: 16, padding: 24, boxShadow: "var(--st-shadow-modal)" }}>
            {exporting ? (
              <>
                <h3 style={{ fontFamily: "var(--st-display)", fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>Exportando…</h3>
                <p style={{ fontFamily: "var(--st-mono)", fontSize: 11.5, color: "var(--st-muted)", margin: "0 0 14px" }}>
                  Clip {exportProgress.current} de {exportProgress.total || 1}
                </p>
                <div style={{ background: "var(--st-alt)", borderRadius: 99, height: 5, overflow: "hidden" }}>
                  <div style={{
                    width: `${exportProgress.total > 0 ? (exportProgress.current / exportProgress.total) * 100 : 30}%`,
                    background: "var(--st-accent)", height: "100%", borderRadius: 99, transition: "width 0.3s",
                  }} />
                </div>
              </>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 99, background: "var(--st-accent)", display: "grid", placeItems: "center" }}>
                    <Check size={16} style={{ color: "var(--st-on-accent)" }} />
                  </div>
                  <h3 style={{ fontFamily: "var(--st-display)", fontSize: 18, fontWeight: 600, margin: 0 }}>Export completado</h3>
                </div>
                {exportFiles.map((f) => (
                  <a key={f} href={api.getDownloadUrl(projectId, f)} download
                    className="st-btn st-btn--ghost"
                    style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", textDecoration: "none", marginBottom: 6 }}>
                    <span style={{ fontFamily: "var(--st-mono)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f}</span>
                    <Download size={14} />
                  </a>
                ))}
                <button onClick={() => { setExportFiles([]); setExportProgress({ current: 0, total: 0 }); }}
                  className="st-btn st-btn--primary" style={{ width: "100%", justifyContent: "center", padding: "9px 0", marginTop: 8 }}>
                  Listo
                </button>
              </>
            )}
          </div>
        </div>
      )}

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


// ─── Settings (Ajustes) ─────────────────────────────────────────────────────
function SettingsStep({ onOpenPrompts }) {
  const { theme, toggle } = useTheme();
  const { model, setModel } = useModel();
  const [defaultClips, setDefaultClips] = useState(25);
  const [autoSubs, setAutoSubs] = useState(true);
  const [exportQuality, setExportQuality] = useState("1080p");
  // Editable Gemini API key (masked preview from the server + a new-value input)
  const [apiMasked, setApiMasked] = useState("");
  const [apiInput, setApiInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  useEffect(() => { api.getApiKey().then((d) => setApiMasked(d.masked || "")).catch(() => {}); }, []);
  const saveApiKey = async () => {
    if (!apiInput.trim()) return;
    setSavingKey(true);
    try { const d = await api.setApiKey(apiInput.trim()); setApiMasked(d.masked || ""); setApiInput(""); }
    catch (e) { alert(e.message); }
    finally { setSavingKey(false); }
  };

  // Shared primitives (single source of truth in components/studio.jsx)
  const Toggle = StToggle;
  const Row = StFieldRow;

  return (
    <div style={{ height: "100vh", overflowY: "auto", padding: "30px 0" }}>
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 32px" }}>
        <h1 style={{ margin: "0 0 26px", fontFamily: "var(--st-display)", fontSize: 28, fontWeight: 600, letterSpacing: "-.025em" }}>Ajustes</h1>

        <div className="st-eyebrow" style={{ marginBottom: 6 }}>Modelo</div>
        <div style={{ marginBottom: 28 }}>
          <Row label="Modelo de IA" desc={`Gemini analiza el video y genera captions. ${(GEMINI_VIDEO_MODELS.find(m => m.val === model) || {}).sub || ""}`} control={
            <select value={model} onChange={(e) => setModel(e.target.value)} className="st-select"
              style={{ width: 180, fontFamily: "var(--st-mono)", fontSize: 12.5 }}>
              {GEMINI_VIDEO_MODELS.map((m) => (<option key={m.val} value={m.val}>{m.label}</option>))}
            </select>
          } />
          <Row label="API Key" desc="Tu clave de Google AI Studio. Se guarda en el servidor y reemplaza la del .env." control={
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="password" value={apiInput} onChange={(e) => setApiInput(e.target.value)}
                placeholder={apiMasked || "AIza…"} spellCheck={false}
                className="st-input" style={{ width: 190, fontFamily: "var(--st-mono)", fontSize: 12.5 }} />
              <button onClick={saveApiKey} disabled={!apiInput.trim() || savingKey} className="st-btn st-btn--primary" style={{ padding: "8px 13px" }}>
                {savingKey ? "…" : "Guardar"}
              </button>
            </div>
          } />
          <Row label="Prompts de la IA" desc="Editá lo que se le pide a Gemini en cada paso (análisis, captions, memes…)." control={
            <button onClick={onOpenPrompts} className="st-btn st-btn--ghost" style={{ padding: "8px 13px" }}>
              <Type size={14} /> Editar prompts
            </button>
          } />
        </div>

        <div className="st-eyebrow" style={{ marginBottom: 6 }}>Preferencias</div>
        <div style={{ marginBottom: 28 }}>
          <Row label="Tema oscuro" desc="Cambia entre blanco y negro." control={<Toggle on={theme === "dark"} onClick={toggle} />} />
          <Row label="Clips por defecto" desc="Cuántos momentos buscar al subir un video." control={
            <input type="number" min={1} max={50} value={defaultClips} onChange={(e) => setDefaultClips(Number(e.target.value))}
              className="st-input" style={{ width: 72, textAlign: "center", fontFamily: "var(--st-mono)" }} />
          } />
          <Row label="Subtítulos automáticos" desc="Transcribir con Whisper al abrir el editor." control={<Toggle on={autoSubs} onClick={() => setAutoSubs(v => !v)} />} />
          <Row label="Calidad de export" desc="Resolución del render final con FFmpeg." control={
            <div style={{ display: "flex", background: "var(--st-alt)", borderRadius: 8, padding: 3 }}>
              {["1080p", "720p"].map((q) => {
                const on = exportQuality === q;
                return (
                  <span key={q} onClick={() => setExportQuality(q)} style={{ fontSize: 12, fontWeight: on ? 600 : 500, padding: "5px 11px", borderRadius: 6, cursor: "pointer", background: on ? "var(--st-surface)" : "transparent", color: on ? "var(--st-text)" : "var(--st-muted)" }}>{q}</span>
                );
              })}
            </div>
          } />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 15px", borderRadius: 11, background: "var(--st-soft)", border: "1px solid var(--st-line)" }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--st-ok)" }} />
          <span style={{ fontSize: 13, color: "var(--st-muted)", flex: 1 }}>Servidor local conectado</span>
          <span style={{ fontFamily: "var(--st-mono)", fontSize: 11.5, color: "var(--st-faint)" }}>localhost:8000</span>
        </div>
      </div>
    </div>
  );
}

// ─── Prompts editor (Ajustes → Prompts) ────────────────────────────────────
function PromptsStep({ onExit }) {
  const [items, setItems] = useState([]);
  const [drafts, setDrafts] = useState({});   // { key: text }
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const d = await api.listPrompts();
      const ps = d.prompts || [];
      setItems(ps);
      setDrafts(Object.fromEntries(ps.map((p) => [p.key, p.current])));
      setErr("");
    } catch (e) { setErr(e.message || "No se pudieron cargar los prompts"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async (key) => {
    setBusyKey(key);
    try { await api.updatePrompt(key, drafts[key]); await load(); }
    catch (e) { alert(e.message); }
    finally { setBusyKey(null); }
  };
  const resetOne = async (key) => {
    setBusyKey(key);
    try { await api.resetPrompt(key); await load(); }
    catch (e) { alert(e.message); }
    finally { setBusyKey(null); }
  };

  return (
    <div style={{ height: "100vh", overflowY: "auto", padding: "30px 0" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 32px" }}>
        <button onClick={onExit} className="st-btn st-btn--quiet" style={{ padding: "6px 10px", marginBottom: 16, marginLeft: -10 }}>
          <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} /> Ajustes
        </button>
        <h1 style={{ margin: "0 0 6px", fontFamily: "var(--st-display)", fontSize: 28, fontWeight: 600, letterSpacing: "-.025em" }}>Prompts de la IA</h1>
        <p style={{ margin: "0 0 24px", fontSize: 13.5, color: "var(--st-muted)", lineHeight: 1.5 }}>
          Editá lo que se le pide a Gemini en cada paso. Los <span style={{ fontFamily: "var(--st-mono)" }}>{"{{TOKENS}}"}</span> se reemplazan
          solos al ejecutarse — dejalos tal cual. <b>Restablecer</b> vuelve al original.
        </p>

        {err && <div style={{ color: "var(--st-live)", fontSize: 13, marginBottom: 14 }}>{err}</div>}
        {loading ? (
          <div style={{ color: "var(--st-muted)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            <Loader2 size={16} style={{ animation: "st-spin 1s linear infinite" }} /> Cargando prompts…
          </div>
        ) : (
          <div>
            {items.map((p) => {
              const dirty = drafts[p.key] !== p.current;
              return (
                <StRow key={p.key} icon={<Type size={15} />} label={p.label}
                  summary={p.overridden ? "modificado" : null}>
                  <p style={{ fontSize: 12.5, color: "var(--st-muted)", margin: "0 0 10px", lineHeight: 1.5 }}>{p.description}</p>
                  {p.tokens && p.tokens.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                      {p.tokens.map((t) => (
                        <span key={t} style={{ fontFamily: "var(--st-mono)", fontSize: 10.5, padding: "2px 7px", borderRadius: 6, background: "var(--st-alt)", color: "var(--st-muted)" }}>{t}</span>
                      ))}
                    </div>
                  )}
                  <textarea
                    value={drafts[p.key] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.key]: e.target.value }))}
                    spellCheck={false}
                    className="st-textarea"
                    style={{ minHeight: 160, fontFamily: "var(--st-mono)", fontSize: 12, lineHeight: 1.5, resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={() => save(p.key)} disabled={!dirty || busyKey === p.key}
                      className="st-btn st-btn--primary" style={{ padding: "7px 14px" }}>
                      {busyKey === p.key ? "Guardando…" : "Guardar"}
                    </button>
                    <button onClick={() => resetOne(p.key)} disabled={!p.overridden || busyKey === p.key}
                      className="st-btn st-btn--ghost" style={{ padding: "7px 14px" }}>
                      <RefreshCw size={13} /> Restablecer
                    </button>
                    {dirty && <span style={{ alignSelf: "center", fontSize: 11.5, color: "var(--st-faint)" }}>cambios sin guardar</span>}
                  </div>
                </StRow>
              );
            })}
          </div>
        )}
      </div>
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

  // Which sidebar item is active, derived from mode + step
  const activeNav =
    mode === "settings" || mode === "prompts" ? "settings" :
    mode === "editor" ? "editor" :
    mode === "meme" ? "meme" :
    mode === "stream" ? "live" :
    mode === "analyzer" ? "analyzer" :
    mode === "downloader" ? "downloader" :
    step === 2 ? "clips" : step === 3 ? "export" : "upload";

  const handleNav = (target) => {
    if (target === "upload") { setMode("video"); setStep(1); }
    else if (target === "clips") { setMode("video"); setStep(2); }
    else if (target === "export") { setMode("video"); setStep(3); }
    else if (target === "editor") setMode("editor");
    else if (target === "meme") setMode("meme");
    else if (target === "live") setMode("stream");
    else if (target === "analyzer") setMode("analyzer");
    else if (target === "downloader") setMode("downloader");
    else if (target === "settings") setMode("settings");
  };

  // Editor uses a full-screen studio layout (rail replaces the sidebar).
  if (mode === "editor") {
    return (
      <div className="st-root" style={{ height: "100vh", overflow: "hidden", background: "var(--st-bg)" }}>
        <EditorMode onExit={() => { setMode("video"); setStep(1); }} />
      </div>
    );
  }

  return (
    <div className="st-root" style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar
        active={activeNav}
        filename={filename}
        clipCount={clips.length}
        hasProject={!!projectId}
        onNav={handleNav}
      />
      <main style={{ flex: 1, minWidth: 0, background: "var(--st-bg)" }}>
        {mode === "analyzer" && <AnalyzerStep />}
        {mode === "stream" && (
          <LiveStreamStep
            onClipToProject={(projectId, clips, filename) => {
              setMode("video");
              handleUploadComplete({ projectId, clips, filename });
            }}
          />
        )}
        {mode === "meme" && <MemeStep />}
        {mode === "downloader" && (
          <DownloaderStep
            onSendToClipper={(projectId, clips, filename) => {
              setMode("video");
              handleUploadComplete({ projectId, clips, filename });
            }}
          />
        )}
        {mode === "settings" && <SettingsStep onOpenPrompts={() => setMode("prompts")} />}
        {mode === "prompts" && <PromptsStep onExit={() => setMode("settings")} />}

        {mode === "video" && (
          <>
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
          </>
        )}
      </main>
    </div>
  );
}

export default App;
