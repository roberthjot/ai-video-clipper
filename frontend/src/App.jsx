import { useState, useRef, useCallback, useEffect } from "react";
import "./App.css";
import * as api from "./services/api";

// ================================================
// STEP 1: Upload & Config
// ================================================
function UploadStep({ onComplete }) {
  const [file, setFile] = useState(null);
  const [clipCount, setClipCount] = useState(25);
  const [minDuration, setMinDuration] = useState(15);
  const [customPrompt, setCustomPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(""); // upload, analyzing
  const [statusMsg, setStatusMsg] = useState("");
  const [percent, setPercent] = useState(0);
  const [dragover, setDragover] = useState(false);
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

    try {
      // Phase 1: Upload to server (with progress)
      setPhase("upload");
      setStatusMsg("Uploading video to server...");
      setPercent(0);

      const uploadRes = await api.uploadVideo(
        file, clipCount, minDuration, customPrompt,
        (pct) => {
          setPercent(pct);
          setStatusMsg(`Uploading video to server... ${pct}%`);
        }
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
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <h3>{statusMsg}</h3>
        {phase === "upload" && (
          <p>Sending file to local server...</p>
        )}
        {phase === "analyzing" && (
          <p>Don't close this window. The AI is watching your entire video.</p>
        )}
        <div className="progress-bar" style={{ marginTop: 16 }}>
          <div className="fill" style={{ width: `${percent}%` }}></div>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 8 }}>
          {percent}%
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 660, margin: "0 auto" }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        borderRadius: 16, padding: "22px 28px", marginBottom: 20,
        border: "1px solid #2a2a4a",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 28 }}>🎬</div>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#fff" }}>Upload Video</h2>
            <p style={{ margin: 0, color: "#8888aa", fontSize: 13 }}>
              Gemini watches your video and finds the most viral moments automatically
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
          borderRadius: 14, marginBottom: 20,
          background: file ? "#0d1a0d" : "#111",
          border: file ? "2px dashed #22c55e" : "2px dashed #333",
          transition: "all 0.2s",
        }}
      >
        <input ref={inputRef} type="file" accept="video/*" hidden
          onChange={(e) => setFile(e.target.files[0])} />
        <div className="icon">{file ? "✅" : "📁"}</div>
        {file ? (
          <div>
            <p style={{ fontWeight: 700, fontSize: 15, color: "#22c55e", margin: "0 0 4px" }}>{file.name}</p>
            <p style={{ color: "#666", fontSize: 13, margin: 0 }}>{(file.size / 1024 / 1024).toFixed(1)} MB · Click para cambiar</p>
          </div>
        ) : (
          <>
            <h3 style={{ margin: "0 0 6px", color: "#ccc" }}>Drag & drop your video here</h3>
            <p style={{ color: "#555", margin: 0 }}>or click to browse (MP4, MOV, AVI)</p>
          </>
        )}
      </div>

      {/* Config */}
      <div style={{
        background: "#1a1a1a", borderRadius: 14, padding: "20px 24px",
        border: "1px solid #2a2a2a", marginBottom: 20,
      }}>
        <div style={{ fontSize: 12, color: "#666", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 16, textTransform: "uppercase" }}>
          Configuración
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#888", marginBottom: 6 }}>
              Número de clips
            </label>
            <input
              type="number" value={clipCount}
              onChange={(e) => setClipCount(Math.max(1, parseInt(e.target.value) || 1))}
              min={1} max={50}
              style={{
                width: "100%", background: "#111", border: "1px solid #333",
                borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#888", marginBottom: 6 }}>
              Duración mínima (seg)
            </label>
            <input
              type="number" value={minDuration}
              onChange={(e) => setMinDuration(parseInt(e.target.value) || 10)}
              min={5} max={120}
              style={{
                width: "100%", background: "#111", border: "1px solid #333",
                borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, color: "#888", marginBottom: 6 }}>
            Formato de salida
          </label>
          <div style={{
            background: "#111", border: "1px solid #333", borderRadius: 8,
            padding: "8px 12px", color: "#6366f1", fontSize: 14, fontWeight: 600,
          }}>
            9:16 — TikTok / Reels / Shorts
          </div>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#888", marginBottom: 6 }}>
            🧠 Instrucciones para la IA (opcional)
          </label>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="e.g. Find the most dramatic moments. Prioritize funny reactions and confessions..."
            style={{
              width: "100%", background: "#111", border: "1px solid #333",
              borderRadius: 8, padding: "10px 12px", color: "#e5e5e5", fontSize: 13,
              resize: "vertical", minHeight: 80, fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
        </div>
      </div>

      <button
        style={{
          width: "100%", fontSize: 15, padding: "14px 0", borderRadius: 12,
          border: "none", cursor: file ? "pointer" : "default", fontWeight: 700,
          background: file
            ? "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)"
            : "#1a1a1a",
          color: file ? "#fff" : "#444",
          transition: "all 0.2s",
          boxShadow: file ? "0 4px 20px rgba(99,102,241,0.3)" : "none",
        }}
        disabled={!file}
        onClick={handleSubmit}
      >
        🚀 Analyze Video
      </button>
    </div>
  );
}

// ================================================
// STEP 2: Clip Results
// ================================================
function ClipsStep({ projectId, clips, onEdit, onNext }) {
  const [editingClip, setEditingClip] = useState(null);
  const [editText, setEditText] = useState("");
  const [playingClip, setPlayingClip] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [loadingVideo, setLoadingVideo] = useState(false);

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
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
    // loadingVideo stays true until onCanPlay fires on the video element
  };

  return (
    <div>
      <h2 className="section-title">📋 Detected Clips ({clips.length})</h2>
      <p className="section-subtitle">
        Review clips, edit captions, play previews, then style & export.
      </p>

      <div className="clips-list">
        {clips.map((clip) => (
          <div className="clip-card" key={clip.id}>
            <div className="clip-number">{clip.id}</div>
            <div className="clip-info">
              <h4>{clip.description}</h4>
              <p className="caption">"{clip.viral_caption}"</p>
            </div>
            <div className="clip-meta">
              <span className="tag">⏱ {clip.duration.toFixed(0)}s</span>
              <span className="tag">
                📍 {formatTime(clip.start_time)} — {formatTime(clip.end_time)}
              </span>
            </div>
            <div className="clip-actions">
              <button onClick={() => handlePlayClip(clip)}>▶ Play</button>
              <button
                onClick={() => {
                  setEditingClip(clip);
                  setEditText(clip.viral_caption);
                }}
              >
                ✏️ Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="btn-group">
        <button className="btn btn-primary" onClick={onNext}>
          🎨 Style & Export →
        </button>
      </div>

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
function EditorStep({ projectId, clips, onExportDone }) {
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
    ig_fill_mode: "fit",
    ig_top_padding: 130,
    ig_watermark_y: 0.85,
    strip_metadata: false,
    flip_horizontal: false,
    zoom_uniquify: false,
    boost_contrast: false,
    split_screen_enabled: false,
    split_ratio: 0.5,
  });
  const [exportStatus, setExportStatus] = useState("idle"); // idle, exporting, done
  const [exportMode, setExportMode] = useState("tiktok"); // "tiktok" | "instagram"
  const [progress, setProgress] = useState({ current: 0, total: 0, current_file: "" });
  const [exportedFiles, setExportedFiles] = useState([]);
  const [selectedClip, setSelectedClip] = useState(clips[0] || null);
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
  }, [style.fill_mode, style.ig_fill_mode, style.ig_top_padding, style.ig_watermark_y, style.split_screen_enabled, style.split_ratio, style.text_y, style.flip_horizontal, style.boost_contrast]);

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
            </div>
          </div>

          {/* Video format */}
          <div className="control-section">
            <h3>🎬 Video Format</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["fit", "medium", "zoom", "fill", "small"].map((m) => (
                <button
                  key={m}
                  className={`btn ${style.fill_mode === m ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setStyle((s) => ({ ...s, fill_mode: m }))}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              Fit = full · Medium = un poco más chico · Zoom = grande · Fill = frame completo · Small = reducido
            </p>
          </div>

          {/* IG Video Size */}
          <div className="control-section">
            <h3>📸 IG Video Size</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["fit", "medium", "zoom", "fill", "small"].map((m) => (
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
  { label: "🎯 Estándar",    vals: { textY: 0.08, textX: 0.05, videoY: 0.60, videoScale: 0.9,  fontSize: 80 } },
  { label: "⬆ Texto arriba", vals: { textY: 0.04, textX: 0.05, videoY: 0.65, videoScale: 0.9,  fontSize: 75 } },
  { label: "🎬 Video grande", vals: { textY: 0.04, textX: 0.05, videoY: 0.58, videoScale: 1.0,  fontSize: 65 } },
  { label: "📐 Equilibrado",  vals: { textY: 0.12, textX: 0.05, videoY: 0.55, videoScale: 0.85, fontSize: 80 } },
];

// ================================================
// MEME ITEM CARD
// ================================================
function MemeItemCard({ item, batchId, index, statusLabel, globalPreset }) {
  const [textY, setTextY] = useState(0.08);
  const [textX, setTextX] = useState(0.05);
  const [videoY, setVideoY] = useState(0.6);
  const [videoScale, setVideoScale] = useState(0.9);
  const [fontSize, setFontSize] = useState(80);
  const [reexporting, setReexporting] = useState(false);
  const [bust, setBust] = useState(null);
  const [showSliders, setShowSliders] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [copied, setCopied] = useState(false);

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
      await api.reexportMeme(batchId, index, textY, textX, videoScale, videoY, fontSize);
      setBust(Date.now());
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
          <div style={{ fontSize: 11, color: item.artist_info !== undefined ? "#f59e0b" : "#6366f1", fontWeight: 700, marginBottom: 4, letterSpacing: "0.05em" }}>
            {item.artist_info !== undefined ? "VIBE TEXT" : "MEME TEXT"}
          </div>
          <div style={{ fontSize: 14, color: "#e5e5e5", fontWeight: 600, lineHeight: 1.5 }}>
            {item.meme_text}
          </div>
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
  const [globalPreset, setGlobalPreset] = useState(null);
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

  const handleStart = async () => {
    if (!files.length) { setError("Selecciona al menos un video"); return; }
    setError("");
    setUploading(true);
    setUploadPct(0);
    setBatch(null);
    setBatchId(null);
    try {
      const result = await api.processMemes(files, bgColor, 0.08, 0.9, setUploadPct, contentType);
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

  const statusLabel = (item) => {
    switch (item.status) {
      case "pending":    return "⏳ Pendiente";
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
              🚀 Generar memes ({files.length} video{files.length !== 1 ? "s" : ""})
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

          {/* Global presets */}
          <div style={{
            background: "#111", borderRadius: 10, padding: "12px 14px",
            border: "1px solid #2a2a2a", marginBottom: 12,
          }}>
            <div style={{ fontSize: 10, color: "#666", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
              ⚡ Preset global — mueve todos los videos a la vez
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {MEME_PRESETS.map(({ label, vals }) => (
                <button
                  key={label}
                  onClick={() => setGlobalPreset({ ...vals, _ts: Date.now() })}
                  style={{
                    fontSize: 12, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
                    background: "#1a1a1a", color: "#aaa",
                    border: "1px solid #333", fontWeight: 600, transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#6366f1"; e.currentTarget.style.color = "#c4b5fd"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = "#aaa"; }}
                >
                  {label}
                </button>
              ))}
            </div>
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
                globalPreset={globalPreset}
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
function App() {
  const [mode, setMode] = useState("video"); // "video" | "stream" | "meme"
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
        <span className="app-version">v9.1</span>
      </header>

      <main className="app-main">
        {/* Mode toggle */}
        <div style={{ padding: "20px 16px 0", display: "flex", justifyContent: "center" }}>
          <div style={{
            display: "inline-flex", gap: 6, background: "#111", borderRadius: 16,
            padding: 6, border: "1px solid #2a2a2a", boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
          }}>
            {[
              { key: "video",  icon: "📹", label: "Video Clipper",   active: "linear-gradient(135deg,#6366f1,#8b5cf6)" },
              { key: "stream", icon: "🔴", label: "Live Stream",      active: "linear-gradient(135deg,#dc2626,#ef4444)" },
              { key: "meme",   icon: "😂", label: "Meme Generator",   active: "linear-gradient(135deg,#d97706,#f59e0b)" },
            ].map(({ key, icon, label, active }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                style={{
                  padding: "10px 22px", borderRadius: 12, border: "none", cursor: "pointer",
                  background: mode === key ? active : "transparent",
                  color: mode === key ? "#fff" : "#666",
                  fontWeight: 700, fontSize: 14, transition: "all 0.2s",
                  boxShadow: mode === key ? "0 2px 12px rgba(0,0,0,0.3)" : "none",
                  whiteSpace: "nowrap",
                }}
              >
                {icon} {label}
              </button>
            ))}
          </div>
        </div>

        {mode === "stream" && <LiveStreamStep />}
        {mode === "meme" && <MemeStep />}

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
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <EditorStep
              projectId={projectId}
              clips={clips}
              onExportDone={handleReset}
            />
          )}
        </>}
      </main>
    </>
  );
}

export default App;
