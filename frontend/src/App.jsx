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
    <div>
      <h2 className="section-title">🎬 Upload Video</h2>
      <p className="section-subtitle">
        Upload a video and let the AI find the most viral moments.
      </p>

      <div
        className={`upload-zone ${dragover ? "dragover" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
        onDragLeave={() => setDragover(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => setFile(e.target.files[0])}
        />
        <div className="icon">📁</div>
        {file ? (
          <p className="file-selected">✅ {file.name} ({(file.size / 1024 / 1024).toFixed(0)} MB)</p>
        ) : (
          <>
            <h3>Drag & drop your video here</h3>
            <p>or click to browse (MP4, MOV, AVI)</p>
          </>
        )}
      </div>

      <div className="config-grid">
        <div className="config-field">
          <label>Number of clips</label>
          <input
            type="number"
            value={clipCount}
            onChange={(e) => setClipCount(Math.max(1, parseInt(e.target.value) || 1))}
            min={1}
            max={50}
          />
        </div>
        <div className="config-field">
          <label>Min Duration (sec)</label>
          <input
            type="number"
            value={minDuration}
            onChange={(e) => setMinDuration(parseInt(e.target.value) || 10)}
            min={5}
            max={120}
          />
        </div>
        <div className="config-field">
          <label>Format</label>
          <input type="text" value="9:16 (TikTok / Reels)" readOnly />
        </div>
        <div className="config-field full-width">
          <label>🧠 Instructions for the AI (optional)</label>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="e.g. Find the most dramatic moments. Prioritize funny reactions and confessions..."
          />
        </div>
      </div>

      <div className="btn-group">
        <button
          className="btn btn-primary"
          disabled={!file}
          onClick={handleSubmit}
        >
          🚀 Analyze Video
        </button>
      </div>
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
    setLoadingVideo(false);
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
            {videoUrl && (
              <video
                controls
                autoPlay
                style={{ width: "100%", borderRadius: 10, background: "black", maxHeight: 400 }}
                src={videoUrl}
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
  const [style, setStyle] = useState({
    text_x: 0.5,
    text_y: 0.15,
    font_size: 70,  // Larger font for better readability
    text_color: "#FFFFFF",
    text_stroke_color: "#000000",
    text_stroke_width: 5,  // Thicker stroke for better visibility
    watermark_x: 0.5,
    watermark_y: 0.85,
    watermark_scale: 0.3,
    watermark_opacity: 0.9,
  });
  const [exportStatus, setExportStatus] = useState("idle"); // idle, exporting, done
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
    setLoadingVideo(false);
  };

  // Poll progress
  useEffect(() => {
    if (exportStatus !== "exporting") return;

    const interval = setInterval(async () => {
      try {
        const p = await api.getExportProgress(projectId);
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
  }, [exportStatus, projectId]);

  const handleExport = async () => {
    const idsToExport = Array.from(selectedClipIds);
    if (idsToExport.length === 0) {
      alert("Please select at least one clip to export.");
      return;
    }
    setExportStatus("exporting");
    setProgress({ current: 0, total: idsToExport.length, current_file: "Starting...", status: "exporting" });
    try {
      await api.updateStyle(projectId, style);
      await api.startExport(projectId, idsToExport);
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
        <h3>Exporting clips... {pct}%</h3>
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
        <h2>Export Complete!</h2>
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
                href={api.getDownloadUrl(projectId, f)}
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
              </div>
            ) : videoPreviewUrl ? (
              <video
                controls
                autoPlay
                src={videoPreviewUrl}
                style={{ width: "100%", height: "100%", objectFit: "contain", background: "black", borderRadius: 8 }}
              />
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

            {/* Draggable text - only show when no preview is active */}
            {selectedClip && !previewUrl && !videoPreviewUrl && (
              <div
                className={`draggable-text ${dragging === "text" ? "dragging" : ""}`}
                style={{
                  left: `${style.text_x * 100}%`,
                  top: `${style.text_y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  fontSize: `${Math.max(10, style.font_size * 0.35)}px`,
                  color: style.text_color,
                  WebkitTextStroke: `${style.text_stroke_width * 0.3}px ${style.text_stroke_color}`,
                }}
                onMouseDown={handleMouseDown("text")}
              >
                {selectedClip.viral_caption.substring(0, 60)}
                {selectedClip.viral_caption.length > 60 ? "..." : ""}
              </div>
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
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" onClick={handlePreview} disabled={loadingPreview}>
                {loadingPreview ? "⏳ Generating..." : "👁️ Preview"}
              </button>
              <button className="btn btn-primary" onClick={handlePlayVideo} disabled={loadingVideo} style={{ fontSize: 13 }}>
                {loadingVideo ? "⏳ Loading..." : "▶ Play Clip"}
              </button>
            </div>
          </div>

          {/* Text controls */}
          <div className="control-section">
            <h3>📝 Text Overlay</h3>
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
          <div className="btn-group">
            <button className="btn btn-success" onClick={handleExport} disabled={selectedClipIds.size === 0}>
              📦 Export {selectedClipIds.size} Clip{selectedClipIds.size !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ================================================
// MAIN APP
// ================================================
function App() {
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
        <span className="app-version">v2.0</span>
      </header>

      <main className="app-main">
        <div className="steps-bar">
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
      </main>
    </>
  );
}

export default App;
