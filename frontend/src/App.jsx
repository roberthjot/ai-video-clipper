import { useState, useRef, useCallback, useEffect } from "react";
import "./App.css";
import * as api from "./services/api";
import { useTheme } from "./ThemeContext.jsx";
import { useModel } from "./ModelContext.jsx";
import { StSection, StChip, StSlider, StToggle, StFieldRow, StRow, StSegmented } from "./components/studio.jsx";

// Human label for a model value (falls back to the raw value).
const modelLabel = (val) => (GEMINI_VIDEO_MODELS.find((m) => m.val === val) || {}).label || val;
import {
  Sun, Moon, Scissors, Film, Upload, Download, Image as ImageIcon,
  Radio, Sparkles, Settings, ChevronDown, ChevronRight, Search,
  List, LayoutGrid, Clock, GripVertical, Check, Play, Pencil, RefreshCw,
  ZoomIn, Type, Wand2, SkipBack, SkipForward, Pause,
  Copy, AlertCircle, Loader2, X, Plus, Square, CheckCircle2, Crosshair,
  Undo2, Redo2, FileText,
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
  { val: "gemini-3.1-flash-lite-preview", label: "3.1 Flash Lite",  sub: "preview · free" },
  { val: "gemini-3.5-flash",              label: "3.5 Flash",       sub: "pago · nuevo I/O 26" },
  { val: "gemini-3-flash-preview",        label: "3 Flash",         sub: "20/día · preview" },
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
  const [customPrompt, setCustomPrompt] = useState("");
  const [contentType, setContentType] = useState("drama"); // "drama" | "motivational"
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

        {/* Clips + min duration */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
          <div>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 6 }}>Número de clips</label>
            <input type="number" value={clipCount} onChange={(e) => setClipCount(Math.max(1, parseInt(e.target.value) || 1))} min={1} max={50}
              className="st-input" style={{ fontFamily: "var(--st-mono)" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)", marginBottom: 6 }}>Duración mínima (seg)</label>
            <input type="number" value={minDuration} onChange={(e) => setMinDuration(parseInt(e.target.value) || 10)} min={5} max={120}
              className="st-input" style={{ fontFamily: "var(--st-mono)" }} />
          </div>
        </div>

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

  // Load existing creator_name from the project on mount.
  useEffect(() => {
    if (!projectId) return;
    api.getProject(projectId)
      .then((p) => setCreatorName(p?.creator_name || ""))
      .catch(() => { /* project may not exist after backend restart */ });
  }, [projectId]);

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
          ) : (
            <>
              <button className="btn btn-secondary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={handleReanalyzeBatch}>
                <RefreshCw size={13} /> Re-analizar
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
          return (
            <div
              key={clip.id}
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
                </div>
                <div style={{ fontSize: 13.5, color: "var(--st-muted)", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {isBeingAnalyzed ? "Re-analizando…" : `“${clip.viral_caption}”`}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
                <span style={{ fontFamily: "var(--st-mono)", fontSize: 11.5, color: "var(--st-muted)" }}>{clip.duration.toFixed(0)}s</span>
                <span style={{ fontFamily: "var(--st-mono)", fontSize: 11.5, color: "var(--st-faint)" }}>{formatTime(clip.start_time)}–{formatTime(clip.end_time)}</span>
                {clip.viral_score != null && <ScoreBadge score={clip.viral_score} />}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                {[
                  { ic: <Play size={16} />, title: "Reproducir", fn: () => handlePlayClip(clip) },
                  { ic: <Scissors size={16} />, title: "Editar (zoom/trim)", fn: () => setEditorClip(clip) },
                  { ic: <Pencil size={16} />, title: "Editar caption", fn: () => { setEditingClip(clip); setEditText(clip.viral_caption); } },
                  { ic: <RefreshCw size={16} />, title: "Re-analizar", fn: () => handleReanalyze(clip) },
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

  const handlePreview = async () => {
    if (!selectedClip) {
      alert("Please select a clip first");
      return;
    }
    setLoadingPreview(true);
    setVideoPreviewUrl(null);
    try {
      console.log("Updating style for project:", projectId);
      await persistStyle(style);
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
    await persistStyle(style);
    setVideoPreviewUrl(api.getVideoPreviewUrl(projectId, selectedClip.id));
    // loadingVideo stays true until onCanPlay fires on the video element
  };

  const handlePlayInstagram = async () => {
    if (!selectedClip) return;
    setLoadingPreview(true);
    setVideoPreviewUrl(null);
    try {
      await persistStyle(style);
      setPreviewUrl(api.getInstagramPreviewUrl(projectId, selectedClip.id));
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
  }, [style.fill_mode, style.fill_mode_scale, style.ig_fill_mode, style.ig_top_padding, style.ig_watermark_y, style.split_screen_enabled, style.split_ratio, style.text_x, style.text_y, style.flip_horizontal, style.boost_contrast, style.subtitle_style, style.caption_style, style.visual_filter, style.subtitle_size_scale, style.subtitle_y, style.background_style, style.no_text, style.caption_font, style.no_emojis, style.caption_box_radius, style.caption_box_opacity, style.caption_box_color, style.caption_box_pad_x, style.caption_box_pad_y]);

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

  const handleMouseMove = useCallback(
    (e) => {
      if (!dragging || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
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

                {/* Draggable caption — movable even while a preview is showing.
                    Snaps to the center line; gold dashed border when centered. */}
                {selectedClip && (() => {
                  const centered = Math.abs((style.text_x ?? 0.5) - 0.5) < 0.012;
                  const overPreview = !!(previewUrl || videoPreviewUrl);
                  return (
                    <div
                      className={`draggable-text ${dragging === "text" ? "dragging" : ""}`}
                      style={{ left: `${style.text_x * 100}%`, top: `${style.text_y * 100}%`, transform: "translate(-50%, -50%)", whiteSpace: "nowrap", opacity: overPreview ? 0.85 : 1, border: centered ? "1.5px dashed var(--st-gold)" : undefined, zIndex: 10 }}
                      onMouseDown={handleMouseDown("text")}
                      title="Arrastrá para mover · se centra solo cerca de la línea"
                    >
                      T caption
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
            <button onClick={handlePreview} disabled={loadingPreview} className="st-btn st-btn--ghost" style={{ padding: "7px 12px" }}>
              {loadingPreview ? "Generando…" : <><Search size={14} /> Preview</>}
            </button>
            <button onClick={handlePlayVideo} disabled={loadingVideo} className="st-btn st-btn--primary" style={{ padding: "8px 14px" }}>
              {loadingVideo ? "Cargando…" : <><Play size={14} fill="currentColor" /> Play clip</>}
            </button>
            <button onClick={handlePlayInstagram} disabled={loadingPreview} className="st-btn st-btn--ghost" style={{ padding: "7px 12px" }}>
              <ImageIcon size={14} /> IG
            </button>
            <button onClick={() => selectedClip && setEditorClip(selectedClip)} disabled={!selectedClip} className="st-btn st-btn--ghost" style={{ padding: "7px 12px" }} title="Zoom, posición y trim del clip">
              <ZoomIn size={14} /> Editar encuadre
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              <StChip active={style.caption_style === "box"} onClick={() => setStyle((s) => ({ ...s, caption_style: "box" }))}>Caja blanca</StChip>
              <StChip active={style.caption_style === "tiktok"} onClick={() => setStyle((s) => ({ ...s, caption_style: "tiktok" }))}>TikTok</StChip>
            </div>
            <select className="st-select" value={style.caption_font} onChange={(e) => setStyle((s) => ({ ...s, caption_font: e.target.value }))} style={{ marginBottom: 20 }}>
              <optgroup label="Windows (siempre disponibles)">
                <option value="calibri">Calibri Bold (default)</option>
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
              {[["none", "Ninguno"], ["clean", "Limpio"], ["karaoke", "Karaoke"], ["popup", "Pop-up"], ["highlight", "Highlight"], ["big_center", "Big Center"], ["twoword", "Two-Word"], ["bounce", "Bounce"], ["typewriter", "Typewriter"], ["karaoke_green", "Karaoke Verde"], ["karaoke_blue", "Karaoke Azul"], ["karaoke_pink", "Karaoke Rosa"], ["box_green", "Caja Verde"], ["box_blue", "Caja Azul"], ["neon", "Neón"], ["karaoke_red", "Karaoke Rojo"], ["karaoke_orange", "Karaoke Naranja"], ["karaoke_purple", "Karaoke Morado"], ["box_pink", "Caja Rosa"], ["box_red", "Caja Roja"], ["line_box", "Caja Línea"], ["underline", "Subrayado"], ["bubble", "Burbuja"], ["reveal", "Aparece"], ["stack", "Vertical"], ["hollow", "Contorno"], ["retro", "Retro 3D"]].map(([v, label]) => (
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
            <StRow icon={<Sparkles size={15} />} label="Anti-Detect" summary={(() => { const n = [style.strip_metadata, style.flip_horizontal, style.zoom_uniquify, style.boost_contrast].filter(Boolean).length; return n > 0 ? `${n} activo${n > 1 ? "s" : ""}` : "off"; })()}>
              <p style={{ fontSize: 11.5, color: "var(--st-muted)", margin: "0 0 10px" }}>Se aplican al exportar · no afectan el preview.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <StChip active={style.strip_metadata} onClick={() => setStyle(s => ({ ...s, strip_metadata: !s.strip_metadata }))} title="Elimina EXIF/MP4 metadata">{style.strip_metadata ? "✓ " : ""}Strip Metadata</StChip>
                <StChip active={style.flip_horizontal} onClick={() => setStyle(s => ({ ...s, flip_horizontal: !s.flip_horizontal }))} title="Espejo horizontal">{style.flip_horizontal ? "✓ " : ""}Flip</StChip>
                <StChip active={style.zoom_uniquify} onClick={() => setStyle(s => ({ ...s, zoom_uniquify: !s.zoom_uniquify }))} title="Zoom +2%">{style.zoom_uniquify ? "✓ " : ""}Zoom +2%</StChip>
                <StChip active={style.boost_contrast} onClick={() => setStyle(s => ({ ...s, boost_contrast: !s.boost_contrast }))} title="Contraste/brillo">{style.boost_contrast ? "✓ " : ""}Boost</StChip>
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
        <p style={{ margin: "0 0 26px", fontSize: 14, color: "var(--st-muted)", lineHeight: 1.5 }}>
          Graba un stream de Twitch o Kick en segmentos. Descargalos y subilos al Clipper para extraer clips con Gemini.
        </p>

        {!sessionId ? (
          /* ── Config card ── */
          <div className="st-card" style={{ padding: "22px 24px" }}>
            <div className="st-eyebrow" style={{ marginBottom: 8 }}>URL del stream</div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--st-soft)", border: `1px solid ${url ? "var(--st-accent)" : "var(--st-border)"}`, borderRadius: 10, padding: "11px 13px", marginBottom: 20, transition: "border-color .15s" }}>
              <Radio size={16} style={{ color: "var(--st-muted)", flexShrink: 0 }} />
              <input
                type="text"
                placeholder="twitch.tv/canal"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStart()}
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--st-text)", fontFamily: "var(--st-mono)", fontSize: 12.5 }}
              />
              <span style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)", flexShrink: 0 }}>kick · twitch</span>
            </div>

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

            {error && (
              <div style={{ color: "var(--st-live)", fontSize: 13, marginBottom: 14, background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.25)", padding: "10px 13px", borderRadius: 9 }}>
                {error}
              </div>
            )}

            <button onClick={handleStart} disabled={loading || !url.trim()} className="st-btn st-btn--primary" style={{ width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 14 }}>
              {loading ? "Conectando..." : <><Play size={15} fill="currentColor" /> Iniciar grabación</>}
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
                    <span style={{ fontSize: 11.5, color: "var(--st-faint)" }}>muy corto</span>
                  ) : seg.error ? (
                    <span style={{ fontSize: 11.5, color: "var(--st-live)" }}>{seg.error.slice(0, 60)}</span>
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
  const isWorking = !isReady && !isError;   // pending/uploading/analyzing/exporting…
  const dotColor = isReady ? "var(--st-ok)" : isError ? "var(--st-live)" : "var(--st-faint)";

  const [retrying, setRetrying] = useState(false);
  const handleRetry = async () => {
    setRetrying(true);
    try {
      await api.retryMeme(batchId, index);
      // The parent's status poll will pick up the new "pending→ready" state.
    } catch (e) {
      alert(e.message || "No se pudo reintentar");
    } finally {
      // Keep the spinner only briefly; the poll drives the real status.
      setTimeout(() => setRetrying(false), 1200);
    }
  };

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

      {/* Video preview */}
      {isReady && showVideo && (
        <div style={{ padding: "0 14px 14px" }}>
          <video key={bust} src={api.getMemeDownloadUrl(batchId, index, bust)} controls
            style={{ width: "100%", maxHeight: 300, borderRadius: 9, background: "#000", display: "block" }} />
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
            <button onClick={handleReexport} disabled={reexporting} className="st-btn st-btn--primary" style={{ width: "100%", justifyContent: "center", padding: "10px 0", marginTop: 4 }}>
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
                    <button onClick={handleReexportAll} disabled={reexportingAll} className="st-btn st-btn--primary" style={{ width: "100%", justifyContent: "center", padding: "10px 0", marginTop: 4 }}>
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
  });

  // Single debounced persist whenever ANY style-affecting field changes.
  useEffect(() => {
    if (!projectId) return;
    const t = setTimeout(() => {
      api.updateStyle(projectId, buildEditorStyle()).catch((e) => console.error("style save failed:", e));
    }, 350);
    return () => clearTimeout(t);
  }, [aspectRatio, bgStyle, visualFilter, music, subtitlesOn, subStyle, subSize, subY, overlays]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setMusic(null); setBgStyle("blur"); setVisualFilter("none");
    histRef.current = { past: [], future: [] }; lastDocRef.current = null;
    setAspectRatio("9:16");
    setSubtitlesOn(false); setTranscribedRange(null); setSubWordCount(0);
    setTranscriptWords([]);
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
    ["keys", <Wand2 size={20} />, "Keyframes"],
  ];
  const inspectorTabs = [["frame", "Encuadre"], ["subs", "Subtítulos"], ["overlay", "Imágenes"]];
  const SUB_STYLES = [
    ["clean", "Limpio"], ["karaoke", "Karaoke"], ["popup", "Pop-up"], ["highlight", "Highlight"],
    ["big_center", "Big Center"], ["twoword", "Two-Word"], ["bounce", "Bounce"], ["typewriter", "Typewriter"],
    ["karaoke_green", "Karaoke Verde"], ["karaoke_blue", "Karaoke Azul"], ["karaoke_pink", "Karaoke Rosa"],
    ["box_green", "Caja Verde"], ["box_blue", "Caja Azul"], ["neon", "Neón"],
    ["karaoke_red", "Karaoke Rojo"], ["karaoke_orange", "Karaoke Naranja"], ["karaoke_purple", "Karaoke Morado"],
    ["box_pink", "Caja Rosa"], ["box_red", "Caja Roja"], ["line_box", "Caja Línea"], ["underline", "Subrayado"],
    ["bubble", "Burbuja"], ["reveal", "Aparece"], ["stack", "Vertical"], ["hollow", "Contorno"], ["retro", "Retro 3D"],
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
                {/* Live subtitle overlay */}
                {subtitlesOn && transcriptWords.length > 0 && (
                  <SubtitleOverlay
                    words={transcriptWords}
                    currentTime={livePlayheadTime}
                    style={subStyle}
                    sizeScale={subSize}
                    yOffset={subY}
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
    step === 2 ? "clips" : step === 3 ? "export" : "upload";

  const handleNav = (target) => {
    if (target === "upload") { setMode("video"); setStep(1); }
    else if (target === "clips") { setMode("video"); setStep(2); }
    else if (target === "export") { setMode("video"); setStep(3); }
    else if (target === "editor") setMode("editor");
    else if (target === "meme") setMode("meme");
    else if (target === "live") setMode("stream");
    else if (target === "analyzer") setMode("analyzer");
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
        {mode === "stream" && <LiveStreamStep />}
        {mode === "meme" && <MemeStep />}
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
