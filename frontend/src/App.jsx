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
              <button
                className={`btn ${style.fill_mode === "fit" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setStyle((s) => ({ ...s, fill_mode: "fit" }))}>
                Fit
              </button>
              <button
                className={`btn ${style.fill_mode === "zoom" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setStyle((s) => ({ ...s, fill_mode: "zoom" }))}>
                Zoom
              </button>
              <button
                className={`btn ${style.fill_mode === "fill" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setStyle((s) => ({ ...s, fill_mode: "fill" }))}>
                Fill
              </button>
              <button
                className={`btn ${style.fill_mode === "small" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setStyle((s) => ({ ...s, fill_mode: "small" }))}>
                Small
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              Fit = full · Zoom = grande · Fill = frame completo · Small = reducido
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
                Caption Position
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
  const [sessionId, setSessionId] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  // Poll status every 3s while session active
  useEffect(() => {
    if (!sessionId) return;
    const poll = async () => {
      try {
        const data = await api.getStreamStatus(sessionId);
        setSessionData(data);
        if (data.status === "stopped" || data.status === "error") {
          clearInterval(pollRef.current);
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
      const res = await api.startStream(url.trim(), segmentMinutes, 5, resolution);
      setSessionId(res.session_id);
      setSessionData({ session_id: res.session_id, status: res.status, segments: [], ready_count: 0 });
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
    setSessionId(null);
    setSessionData(null);
    setUrl("");
    setError("");
  };

  const isActive = sessionData && (sessionData.status === "recording" || sessionData.status === "starting");
  const segments = sessionData?.segments ?? [];
  const readyCount = sessionData?.ready_count ?? 0;

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 16px" }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 4, fontSize: 18 }}>🔴 Live Stream Clipper</h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
          Graba segmentos del stream → descárgalos → súbelos al Video Clipper para sacar clips con Gemini
        </p>

        {!sessionId ? (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-muted)" }}>
                URL del stream (Twitch o Kick)
              </label>
              <input
                type="text"
                className="input"
                placeholder="https://twitch.tv/nombre_del_canal  o  https://kick.com/nombre"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStart()}
                style={{ width: "100%", marginBottom: 0 }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-muted)" }}>
                Duración por segmento
              </label>
              <div style={{ display: "flex", gap: 5 }}>
                {[5, 7, 10, 15, 20, 30].map((m) => (
                  <button
                    key={m}
                    className={`btn ${segmentMinutes === m ? "btn-primary" : "btn-secondary"}`}
                    style={{ flex: 1, fontSize: 12, padding: "8px 4px" }}
                    onClick={() => setSegmentMinutes(m)}
                  >{m} min</button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                5 min = clips más rápido · 10-15 min = más contexto para Gemini
              </p>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-muted)" }}>
                Resolución de grabación
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {["480p", "720p", "1080p"].map((r) => (
                  <button
                    key={r}
                    className={`btn ${resolution === r ? "btn-primary" : "btn-secondary"}`}
                    style={{ flex: 1, fontSize: 13 }}
                    onClick={() => setResolution(r)}
                  >{r}</button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                480p = archivos pequeños · 720p = balance · 1080p = máxima calidad (requiere más espacio)
              </p>
            </div>

            {error && <p style={{ color: "#f87171", marginBottom: 12, fontSize: 13 }}>{error}</p>}
            <button className="btn btn-primary" onClick={handleStart} disabled={loading} style={{ width: "100%" }}>
              {loading ? "⏳ Conectando al stream..." : "▶ Iniciar grabación"}
            </button>
          </>
        ) : (
          <>
            {/* Status header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16,
              background: "var(--bg-secondary)", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{
                width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                background: isActive ? "#f87171" : "#6b7280",
                boxShadow: isActive ? "0 0 0 3px rgba(248,113,113,0.3)" : "none",
                animation: isActive ? "pulse 1.5s infinite" : "none",
              }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {isActive ? "En vivo" : sessionData?.status === "stopping" ? "Deteniendo..." : "Finalizado"}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 16, flexShrink: 0 }}>
                <span style={{ fontSize: 13 }}>
                  <b>{segments.length}</b> <span style={{ color: "var(--text-muted)", fontSize: 11 }}>segmentos</span>
                </span>
                <span style={{ fontSize: 13 }}>
                  <b style={{ color: "#22c55e" }}>{readyCount}</b> <span style={{ color: "var(--text-muted)", fontSize: 11 }}>listos</span>
                </span>
              </div>
            </div>

            {/* Error from backend */}
            {sessionData?.error && (
              <div style={{ background: "#450a0a", border: "1px solid #f87171", borderRadius: 8,
                padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#fca5a5" }}>
                ❌ {sessionData.error}
              </div>
            )}

            {/* Segments list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {segments.map((seg) => (
                <div key={seg.index} style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 15, flexShrink: 0 }}>
                      {seg.status === "recording" ? "🔴" : seg.status === "ready" ? "✅" :
                       seg.status === "skipped" ? "⏭️" : "❌"}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 14, flexShrink: 0 }}>
                      Segmento {seg.index + 1}
                    </span>

                    {seg.status === "recording" && seg.started_at ? (
                      <SegmentTimer startedAt={seg.started_at} totalMinutes={segmentMinutes} />
                    ) : seg.status === "ready" ? (
                      <>
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {seg.duration_recorded > 0 ? `${Math.round(seg.duration_recorded / 60)}m grabados` : ""}
                          {seg.file_size_mb > 0 ? ` · ${seg.file_size_mb} MB` : ""}
                        </span>
                        <a
                          href={`http://localhost:8000/api/stream/download/${sessionData.session_id}/${seg.index}`}
                          download
                          className="btn btn-primary"
                          style={{ marginLeft: "auto", padding: "4px 12px", fontSize: 12, textDecoration: "none" }}
                        >
                          ⬇ Descargar
                        </a>
                      </>
                    ) : seg.status === "skipped" ? (
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Muy corto, ignorado</span>
                    ) : seg.error ? (
                      <span style={{ fontSize: 12, color: "#f87171" }}>{seg.error.slice(0, 80)}</span>
                    ) : null}
                  </div>
                </div>
              ))}

              {isActive && segments.length === 0 && (
                <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: "14px",
                  textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
                  Conectando al stream... esto puede tomar unos segundos
                </div>
              )}
            </div>

            {readyCount > 0 && (
              <div style={{ background: "#052e16", border: "1px solid #16a34a", borderRadius: 8,
                padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#86efac" }}>
                ✅ {readyCount} segmento{readyCount > 1 ? "s" : ""} listo{readyCount > 1 ? "s" : ""} —
                descárgalo{readyCount > 1 ? "s" : ""} y súbelo{readyCount > 1 ? "s" : ""} al <b>Video Clipper</b> para sacar clips
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              {isActive && (
                <button className="btn btn-secondary" onClick={handleStop} style={{ flex: 1 }}>
                  ⏹ Detener grabación
                </button>
              )}
              {!isActive && (
                <button className="btn btn-primary" onClick={handleReset} style={{ flex: 1 }}>
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
// MEME ITEM CARD (with per-item sliders + re-export)
// ================================================
function MemeItemCard({ item, batchId, index, statusLabel }) {
  const [textY, setTextY] = useState(0.08);
  const [videoScale, setVideoScale] = useState(0.9);
  const [reexporting, setReexporting] = useState(false);
  const [bust, setBust] = useState(null); // cache-buster for video src

  const handleReexport = async () => {
    setReexporting(true);
    try {
      await api.reexportMeme(batchId, index, textY, videoScale);
      setBust(Date.now());
    } catch (e) {
      // ignore
    } finally {
      setReexporting(false);
    }
  };

  return (
    <div style={{
      background: "#111",
      borderRadius: 8,
      padding: "12px 14px",
      border: item.status === "ready" ? "1px solid #22c55e" : item.status === "error" ? "1px solid #ef4444" : "1px solid #333",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3, wordBreak: "break-all" }}>{item.filename}</div>
          <div style={{ fontSize: 12, color: "#aaa" }}>{statusLabel(item)}</div>
          {item.meme_text && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#c084fc", fontStyle: "italic", lineHeight: 1.4 }}>
              "{item.meme_text}"
            </div>
          )}
        </div>
        {item.status === "ready" && (
          <a
            href={api.getMemeDownloadUrl(batchId, index, bust)}
            download
            className="btn btn-primary"
            style={{ fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap", textDecoration: "none" }}
          >
            ⬇ Descargar
          </a>
        )}
      </div>

      {item.status === "ready" && (
        <>
          <div style={{ marginTop: 10 }}>
            <video
              key={bust}
              src={api.getMemeDownloadUrl(batchId, index, bust)}
              controls
              style={{ width: "100%", maxHeight: 320, borderRadius: 6, background: "#000", display: "block" }}
            />
          </div>

          {/* Per-item sliders */}
          <div style={{ marginTop: 12, padding: "10px 0 4px", borderTop: "1px solid #222" }}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#aaa", marginBottom: 4 }}>
                <span>Posición del texto</span>
                <span style={{ color: "#fff" }}>{textY <= 0.12 ? "⬆ Arriba" : textY <= 0.28 ? "↕ Centro" : "⬇ Abajo"}</span>
              </div>
              <input type="range" min="0.02" max="0.45" step="0.01"
                value={textY} onChange={(e) => setTextY(parseFloat(e.target.value))}
                style={{ width: "100%" }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#aaa", marginBottom: 4 }}>
                <span>Tamaño del video</span>
                <span style={{ color: "#fff" }}>{Math.round(videoScale * 100)}%</span>
              </div>
              <input type="range" min="0.4" max="1.0" step="0.05"
                value={videoScale} onChange={(e) => setVideoScale(parseFloat(e.target.value))}
                style={{ width: "100%" }} />
            </div>
            <button
              className="btn btn-secondary"
              style={{ width: "100%", fontSize: 13 }}
              onClick={handleReexport}
              disabled={reexporting}
            >
              {reexporting ? "⏳ Re-exportando..." : "🔄 Re-exportar con estos ajustes"}
            </button>
          </div>
        </>
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
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [batchId, setBatchId] = useState(null);
  const [batch, setBatch] = useState(null);
  const [error, setError] = useState("");
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
      const result = await api.processMemes(files, bgColor, 0.08, 0.9, setUploadPct);
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
    setUploading(false);
    setUploadPct(0);
    setBatchId(null);
    setBatch(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
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
    <div style={{ maxWidth: 640, margin: "24px auto", padding: "0 16px" }}>
      <div style={{ background: "#1a1a1a", borderRadius: 12, padding: 24, color: "#fff" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 20 }}>😂 Meme Generator</h2>
        <p style={{ margin: "0 0 20px", color: "#aaa", fontSize: 13 }}>
          Sube videos cortos — Gemini genera el texto del meme y exporta el video completo con el texto encima.
        </p>

        {!batchId && (
          <>
            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: "2px dashed #444",
                borderRadius: 10,
                padding: "32px 16px",
                textAlign: "center",
                cursor: "pointer",
                marginBottom: 16,
                background: files.length ? "#1e2a1e" : "#111",
                transition: "background 0.2s",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                multiple
                style={{ display: "none" }}
                onChange={handleFiles}
              />
              {files.length ? (
                <div>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>🎥</div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{files.length} video{files.length > 1 ? "s" : ""} seleccionado{files.length > 1 ? "s" : ""}</div>
                  <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", fontSize: 12, color: "#aaa" }}>
                    {files.map((f, i) => (
                      <li key={i}>{f.name}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
                  <div style={{ fontSize: 14, color: "#aaa" }}>Arrastra videos aquí o haz click para seleccionar</div>
                  <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>Máximo ~20 videos</div>
                </div>
              )}
            </div>

            {/* Background color */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: "#aaa", marginBottom: 8 }}>Fondo del meme</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className={`btn ${bgColor === "black" ? "btn-primary" : "btn-secondary"}`}
                  style={{ flex: 1 }}
                  onClick={() => setBgColor("black")}
                >⬛ Negro</button>
                <button
                  className={`btn ${bgColor === "white" ? "btn-primary" : "btn-secondary"}`}
                  style={{ flex: 1 }}
                  onClick={() => setBgColor("white")}
                >⬜ Blanco</button>
              </div>
            </div>

            {error && <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12 }}>{error}</div>}

            {uploading ? (
              <div>
                <div style={{ fontSize: 13, color: "#aaa", marginBottom: 6 }}>Subiendo videos... {uploadPct}%</div>
                <div style={{ background: "#333", borderRadius: 4, height: 8 }}>
                  <div style={{ background: "#6366f1", borderRadius: 4, height: 8, width: `${uploadPct}%`, transition: "width 0.3s" }} />
                </div>
              </div>
            ) : (
              <button
                className="btn btn-primary"
                style={{ width: "100%", fontSize: 15, padding: "12px 0" }}
                onClick={handleStart}
                disabled={!files.length}
              >
                🚀 Generar Memes
              </button>
            )}
          </>
        )}

        {/* Batch progress */}
        {batchId && batch && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {batch.status === "completed"
                  ? `✅ Completado — ${doneCount}/${totalCount} listos`
                  : `⏳ Procesando... ${doneCount}/${totalCount}`}
              </div>
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }} onClick={handleReset}>
                Nuevo batch
              </button>
            </div>

            {/* Progress bar */}
            {batch.status !== "completed" && (
              <div style={{ background: "#333", borderRadius: 4, height: 6, marginBottom: 16 }}>
                <div style={{
                  background: "#6366f1",
                  borderRadius: 4,
                  height: 6,
                  width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%`,
                  transition: "width 0.3s",
                }} />
              </div>
            )}

            {/* Item list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {batch.items.map((item, i) => (
                <MemeItemCard key={i} item={item} batchId={batchId} index={i} statusLabel={statusLabel} />
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
        <div style={{ display: "flex", gap: 8, padding: "12px 16px 0", justifyContent: "center", flexWrap: "wrap" }}>
          <button
            className={`btn ${mode === "video" ? "btn-primary" : "btn-secondary"}`}
            style={{ minWidth: 140 }}
            onClick={() => setMode("video")}
          >📹 Video Clipper</button>
          <button
            className={`btn ${mode === "stream" ? "btn-primary" : "btn-secondary"}`}
            style={{ minWidth: 140 }}
            onClick={() => setMode("stream")}
          >🔴 Live Stream</button>
          <button
            className={`btn ${mode === "meme" ? "btn-primary" : "btn-secondary"}`}
            style={{ minWidth: 140 }}
            onClick={() => setMode("meme")}
          >😂 Meme Generator</button>
        </div>

        {mode === "stream" && <LiveStreamStep />}
        {mode === "meme" && <MemeStep />}

        {mode === "video" && <>
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
        </>}
      </main>
    </>
  );
}

export default App;
