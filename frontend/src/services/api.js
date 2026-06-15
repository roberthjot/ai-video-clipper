const API_BASE = "http://localhost:8000/api";

export function uploadVideo(file, clipCount, minDuration, customPrompt, onProgress, geminiModel = "gemini-2.5-flash", creatorName = "", analyzeStart = 0, analyzeDuration = 0) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append("video", file);
        formData.append("clip_count", clipCount);
        formData.append("min_duration", minDuration);
        formData.append("custom_prompt", customPrompt);
        formData.append("gemini_model", geminiModel);
        formData.append("creator_name", creatorName);
        formData.append("analyze_start", analyzeStart);
        formData.append("analyze_duration", analyzeDuration);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}/upload`);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                const pct = Math.round((e.loaded / e.total) * 100);
                onProgress(pct);
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(JSON.parse(xhr.responseText));
            } else {
                reject(new Error("Upload failed"));
            }
        };

        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(formData);
    });
}

export async function getAnalysisStatus(projectId) {
    const res = await fetch(`${API_BASE}/status/${projectId}`);
    if (!res.ok) throw new Error("Failed to get status");
    return res.json();
}

export async function analyzeVideo(projectId, durationOverride = null) {
    const body = { project_id: projectId };
    if (durationOverride) body.duration_override = durationOverride;

    const res = await fetch(`${API_BASE}/clips/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Analysis failed");
    }
    return res.json();
}

export async function getClips(projectId) {
    const res = await fetch(`${API_BASE}/clips/${projectId}`);
    if (!res.ok) throw new Error("Failed to get clips");
    return res.json();
}

export async function updateProjectModel(projectId, geminiModel) {
    const res = await fetch(`${API_BASE}/clips/${projectId}/model`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini_model: geminiModel }),
    });
    if (!res.ok) throw new Error("Failed to switch model");
    return res.json();
}

export async function getProject(projectId) {
    const res = await fetch(`${API_BASE}/projects/${projectId}`);
    if (!res.ok) throw new Error("Failed to get project");
    return res.json();
}

export async function updateProjectCreator(projectId, creatorName) {
    const fd = new FormData();
    fd.append("creator_name", creatorName || "");
    const res = await fetch(`${API_BASE}/projects/${projectId}/creator`, {
        method: "PATCH",
        body: fd,
    });
    if (!res.ok) throw new Error("Failed to update creator");
    return res.json();
}

export async function checkModelHealth(models) {
    const res = await fetch(`${API_BASE}/clips/model-health`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to check models");
    }
    return res.json();
}


export async function editClipTransform(projectId, clipId, payload) {
    const res = await fetch(`${API_BASE}/clips/${projectId}/${clipId}/edit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to save clip edit");
    }
    return res.json();
}

export function getRawVideoUrl(projectId) {
    // Direct stream of the original uploaded video (used by the in-app editor preview).
    return `${API_BASE}/clips/${projectId}/raw-video`;
}


export async function editCaption(projectId, clipId, newCaption) {
    const res = await fetch(`${API_BASE}/clips/${projectId}/${clipId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viral_caption: newCaption }),
    });

    if (!res.ok) throw new Error("Failed to edit caption");
    return res.json();
}

export async function uploadWatermark(projectId, file) {
    const formData = new FormData();
    formData.append("watermark", file);

    const res = await fetch(`${API_BASE}/export/watermark/${projectId}`, {
        method: "POST",
        body: formData,
    });

    if (!res.ok) throw new Error("Watermark upload failed");
    return res.json();
}

export async function uploadSplitImage(projectId, file) {
    const formData = new FormData();
    formData.append("image", file);

    const res = await fetch(`${API_BASE}/export/split-image/${projectId}`, {
        method: "POST",
        body: formData,
    });

    if (!res.ok) throw new Error("Split image upload failed");
    return res.json();
}

export async function updateStyle(projectId, style) {
    const res = await fetch(`${API_BASE}/export/style/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(style),
    });

    if (!res.ok) throw new Error("Failed to update style");
    return res.json();
}

// Per-clip style override (editor "Aplicar a: Este clip / Varios").
export async function updateClipStyle(projectId, clipId, style) {
    const res = await fetch(`${API_BASE}/export/style/${projectId}/${clipId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(style),
    });
    if (!res.ok) throw new Error("Failed to update clip style");
    return res.json();
}

export async function clearClipStyle(projectId, clipId) {
    const res = await fetch(`${API_BASE}/export/style/${projectId}/${clipId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to clear clip style");
    return res.json();
}

// ── Editable prompts ──────────────────────────────────────────────────────
export async function listPrompts() {
    const res = await fetch(`${API_BASE}/prompts`);
    if (!res.ok) throw new Error("Failed to load prompts");
    return res.json();  // { prompts: [...] }
}

export async function updatePrompt(key, text) {
    const res = await fetch(`${API_BASE}/prompts/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("Failed to save prompt");
    return res.json();
}

export async function resetPrompt(key) {
    const res = await fetch(`${API_BASE}/prompts/${key}/reset`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to reset prompt");
    return res.json();
}

// ── API key (editable from Ajustes) ───────────────────────────────────────
export async function getApiKey() {
    const res = await fetch(`${API_BASE}/settings/api-key`);
    if (!res.ok) throw new Error("Failed to load API key");
    return res.json();  // { masked, has_key }
}

export async function setApiKey(apiKey) {
    const res = await fetch(`${API_BASE}/settings/api-key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
    });
    if (!res.ok) {
        let msg = "Failed to save API key";
        try { msg = (await res.json()).detail || msg; } catch {}
        throw new Error(msg);
    }
    return res.json();  // { status, masked }
}

export async function startExport(projectId, selectedClipIds = null) {
    let url = `${API_BASE}/export/render/${projectId}`;
    if (selectedClipIds && selectedClipIds.length > 0) {
        const params = selectedClipIds.map(id => `clip_ids=${id}`).join("&");
        url += `?${params}`;
    }

    const res = await fetch(url, {
        method: "POST",
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Export failed");
    }
    return res.json();
}

export async function getExportProgress(projectId) {
    const res = await fetch(`${API_BASE}/export/progress/${projectId}`);
    if (!res.ok) throw new Error("Failed to get progress");
    return res.json();
}

export function getPreviewUrl(projectId, clipId) {
    return `${API_BASE}/clips/${projectId}/${clipId}/preview?t=${Date.now()}`;
}

export function getVideoPreviewUrl(projectId, clipId) {
    return `${API_BASE}/clips/${projectId}/${clipId}/video-preview?t=${Date.now()}`;
}

export function getVideoPreviewEsUrl(projectId, clipId) {
    return `${API_BASE}/clips/${projectId}/${clipId}/video-preview-es?t=${Date.now()}`;
}

export function getPreviewEsUrl(projectId, clipId) {
    return `${API_BASE}/clips/${projectId}/${clipId}/preview-es?t=${Date.now()}`;
}

export function getInstagramPreviewEsUrl(projectId, clipId) {
    return `${API_BASE}/clips/${projectId}/${clipId}/instagram-preview-es?t=${Date.now()}`;
}

export async function translateClipOnly(projectId, clipId) {
    const res = await fetch(`${API_BASE}/clips/${projectId}/${clipId}/translate-only`, { method: "POST" });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Translation failed");
    }
    return res.json();   // { status, caption_es, words_es }
}

export function getDownloadUrl(projectId, filename) {
    return `${API_BASE}/export/download/${projectId}/${filename}`;
}

export async function startSpanishExport(projectId, selectedClipIds = null) {
    let url = `${API_BASE}/export/render-spanish/${projectId}`;
    if (selectedClipIds && selectedClipIds.length > 0) {
        const params = selectedClipIds.map(id => `clip_ids=${id}`).join("&");
        url += `?${params}`;
    }
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Spanish export failed");
    }
    return res.json();
}

export async function getTranslationStatus(projectId) {
    const res = await fetch(`${API_BASE}/export/translation-status/${projectId}`);
    if (!res.ok) throw new Error("Failed to get translation status");
    return res.json();   // { translated: { clipId: bool } }
}

export async function startInstagramExport(projectId, selectedClipIds = null) {
    let url = `${API_BASE}/export/instagram-render/${projectId}`;
    if (selectedClipIds && selectedClipIds.length > 0) {
        const params = selectedClipIds.map(id => `clip_ids=${id}`).join("&");
        url += `?${params}`;
    }
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Instagram export failed");
    }
    return res.json();
}

export async function getInstagramProgress(projectId) {
    const res = await fetch(`${API_BASE}/export/instagram-progress/${projectId}`);
    if (!res.ok) throw new Error("Failed to get instagram progress");
    return res.json();
}

export function getInstagramDownloadUrl(projectId, filename) {
    return `${API_BASE}/export/instagram-download/${projectId}/${filename}`;
}

export function getInstagramVideoPreviewUrl(projectId, clipId) {
    return `${API_BASE}/clips/${projectId}/${clipId}/instagram-video-preview?t=${Date.now()}`;
}

export function getInstagramPreviewUrl(projectId, clipId) {
    return `${API_BASE}/clips/${projectId}/${clipId}/instagram-preview?t=${Date.now()}`;
}

// ─── Live Stream API ──────────────────────────────────────────────────────────

// ─── Universal video downloader (yt-dlp) ─────────────────────────────────────

export async function startDownload(url, quality = "max", audioOnly = false) {
    const res = await fetch(`${API_BASE}/downloader/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, quality, audio_only: audioOnly }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to start download");
    }
    return res.json();
}

export async function getDownloadStatus(jobId) {
    const res = await fetch(`${API_BASE}/downloader/status/${jobId}`);
    if (!res.ok) throw new Error("Failed to get download status");
    return res.json();
}

export async function listDownloads() {
    const res = await fetch(`${API_BASE}/downloader/list`);
    if (!res.ok) throw new Error("Failed to list downloads");
    return res.json();
}

export async function deleteDownload(jobId) {
    const res = await fetch(`${API_BASE}/downloader/${jobId}`, { method: "DELETE" });
    return res.ok;
}

export function getDownloadFileUrl(jobId) {
    return `${API_BASE}/downloader/file/${jobId}`;
}

export async function processTwitchClipsBatch(clips, broadcasterName = "", geminiModel = "") {
    // clips: [{ slug, title }, ...]  — One project with N clips.
    const res = await fetch(`${API_BASE}/stream/twitch-clips-batch-to-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            clips, broadcaster_name: broadcasterName, gemini_model: geminiModel,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to process clips batch");
    }
    return res.json();
}

export async function processTwitchClip(clipSlug, clipTitle, broadcasterName = "", geminiModel = "") {
    // Downloads a Twitch clip + creates a project + spawns Gemini caption job.
    // Returns immediately with project_id; poll /status/{id} until "ready".
    const res = await fetch(`${API_BASE}/stream/twitch-clip-to-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            clip_slug: clipSlug,
            clip_title: clipTitle,
            broadcaster_name: broadcasterName,
            gemini_model: geminiModel,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to process clip");
    }
    return res.json();
}

export async function getProjectStatus(projectId) {
    const res = await fetch(`${API_BASE}/status/${projectId}`);
    if (!res.ok) throw new Error("Failed to get status");
    return res.json();
}

export async function startTwitchChatVelocity(url) {
    // Kick off a background job that downloads + buckets the VOD chat.
    const qs = new URLSearchParams({ url }).toString();
    const res = await fetch(`${API_BASE}/stream/twitch-chat-velocity/start?${qs}`, {
        method: "POST",
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to start chat velocity");
    }
    return res.json();
}

export async function getTwitchChatVelocity(videoId) {
    // Poll for the chat-velocity job's status / result.
    const res = await fetch(`${API_BASE}/stream/twitch-chat-velocity/status/${videoId}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to get chat velocity");
    }
    return res.json();
}

// ─── Kick (mirror of Twitch — same payload shapes) ────────────────────────

export async function getKickClips(url, limit = 50) {
    // Returns the top viewer-made clips of a Kick VOD, sorted by views.
    // Same response shape as getTwitchClips so the UI can use the same render.
    const qs = new URLSearchParams({ url, limit: String(limit) }).toString();
    const res = await fetch(`${API_BASE}/stream/kick-clips?${qs}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to fetch Kick clips");
    }
    return res.json();
}

export async function processKickClip(clipSlug, clipTitle, broadcasterName = "", geminiModel = "") {
    const res = await fetch(`${API_BASE}/stream/kick-clip-to-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            clip_slug: clipSlug,
            clip_title: clipTitle,
            broadcaster_name: broadcasterName,
            gemini_model: geminiModel,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to process Kick clip");
    }
    return res.json();
}

// ─── Live-clip pescador (Twitch + Kick) ───────────────────────────────────

export async function startLiveClipsSession(platform, channel) {
    const res = await fetch(`${API_BASE}/stream/live-clips/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, channel }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to start live-clip session");
    }
    return res.json();
}

export async function getLiveClipsStatus(sessionId) {
    const res = await fetch(`${API_BASE}/stream/live-clips/status/${sessionId}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to poll session");
    }
    return res.json();
}

export async function stopLiveClipsSession(sessionId) {
    const res = await fetch(`${API_BASE}/stream/live-clips/stop/${sessionId}`, { method: "POST" });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to stop session");
    }
    return res.json();
}

export async function clearLiveClipsSession(sessionId) {
    const res = await fetch(`${API_BASE}/stream/live-clips/clear/${sessionId}`, { method: "POST" });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to clear session");
    }
    return res.json();
}

export async function processKickClipsBatch(clips, broadcasterName = "", geminiModel = "") {
    const res = await fetch(`${API_BASE}/stream/kick-clips-batch-to-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            clips, broadcaster_name: broadcasterName, gemini_model: geminiModel,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to process Kick clips batch");
    }
    return res.json();
}

export async function getTwitchClips(url, limit = 50) {
    // Returns the top viewer-made clips of a Twitch VOD, sorted by views.
    // Each clip has vod_offset_seconds so the UI can autopopulate HH:MM:SS.
    const qs = new URLSearchParams({ url, limit: String(limit) }).toString();
    const res = await fetch(`${API_BASE}/stream/twitch-clips?${qs}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to fetch Twitch clips");
    }
    return res.json();
}

export async function startStream(url, segmentMinutes, clipsPerSegment, resolution = "720p",
                                  startOffsetMinutes = 0, opts = {}) {
    // opts: { singleShot, startOffsetSeconds, durationSeconds } — when set,
    // backend ignores segment_minutes / start_offset_minutes and downloads
    // a single HH:MM:SS slice with -c copy (no re-encode).
    const res = await fetch(`${API_BASE}/stream/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            url,
            segment_minutes: segmentMinutes,
            clips_per_segment: clipsPerSegment,
            resolution,
            start_offset_minutes: startOffsetMinutes,
            single_shot: !!opts.singleShot,
            start_offset_seconds: opts.startOffsetSeconds || 0,
            duration_seconds: opts.durationSeconds || 0,
        }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to start stream");
    }
    return res.json();
}

export async function stopStream(sessionId) {
    const res = await fetch(`${API_BASE}/stream/stop/${sessionId}`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to stop stream");
    return res.json();
}

export async function getStreamStatus(sessionId) {
    const res = await fetch(`${API_BASE}/stream/status/${sessionId}`);
    if (!res.ok) throw new Error("Failed to get stream status");
    return res.json();
}

export async function listStreamSessions() {
    const res = await fetch(`${API_BASE}/stream/sessions`);
    if (!res.ok) throw new Error("Failed to list sessions");
    return res.json();
}

// ─── Meme Generator API ───────────────────────────────────────────────────────

export async function detectMemeCrop(file) {
    const formData = new FormData();
    formData.append("video", file);
    const res = await fetch(`${API_BASE}/meme/detect-crop`, { method: "POST", body: formData });
    if (!res.ok) throw new Error("Detect crop failed");
    return res.json(); // { crop_top_pct, crop_bottom_pct }
}

export function getVideoFrameUrl(file) {
    // Returns a Promise that resolves to an object URL for the extracted frame
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append("video", file);
        fetch(`${API_BASE}/meme/frame`, { method: "POST", body: formData })
            .then(r => { if (!r.ok) throw new Error("Frame failed"); return r.blob(); })
            .then(blob => resolve(URL.createObjectURL(blob)))
            .catch(reject);
    });
}

export function processMemes(files, bgColor, textY, videoScale, onProgress, contentType = "meme", cropTopPct = 0, cropBottomPct = 0, cropLeftPct = 0, cropRightPct = 0, geminiModel = "") {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append("bg_color", bgColor);
        formData.append("text_y", textY);
        formData.append("video_scale", videoScale);
        formData.append("content_type", contentType);
        formData.append("crop_top_pct", cropTopPct);
        formData.append("crop_bottom_pct", cropBottomPct);
        formData.append("crop_left_pct", cropLeftPct);
        formData.append("crop_right_pct", cropRightPct);
        if (geminiModel) formData.append("gemini_model", geminiModel);
        for (const file of files) {
            formData.append("videos", file);
        }

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}/meme/process`);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                const pct = Math.round((e.loaded / e.total) * 100);
                onProgress(pct);
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(JSON.parse(xhr.responseText));
            } else {
                reject(new Error("Upload failed"));
            }
        };

        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(formData);
    });
}

export async function getMemeStatus(batchId) {
    const res = await fetch(`${API_BASE}/meme/status/${batchId}`);
    if (!res.ok) throw new Error("Failed to get meme status");
    return res.json();
}

export function getMemeDownloadUrl(batchId, index, bust) {
    return `${API_BASE}/meme/download/${batchId}/${index}${bust ? `?t=${bust}` : ""}`;
}

export async function retryMeme(batchId, index) {
    const res = await fetch(`${API_BASE}/meme/retry/${batchId}/${index}`, { method: "POST" });
    if (!res.ok) throw new Error("No se pudo reintentar");
    return res.json();
}

export function getCropPreviewUrl(batchId, index, cropTopPct, cropBottomPct, cropLeftPct = 0, cropRightPct = 0) {
    return `${API_BASE}/meme/crop-preview/${batchId}/${index}?crop_top_pct=${cropTopPct}&crop_bottom_pct=${cropBottomPct}&crop_left_pct=${cropLeftPct}&crop_right_pct=${cropRightPct}&t=${Date.now()}`;
}

export async function reexportMeme(batchId, index, textY, textX, videoScale, videoY, fontSize, customText = "", cropTopPct = 0, cropBottomPct = 0, cornerRadius = 0, cropLeftPct = 0, cropRightPct = 0, extras = null) {
    const formData = new FormData();
    formData.append("text_y", textY);
    formData.append("text_x", textX);
    formData.append("video_scale", videoScale);
    formData.append("video_y", videoY);
    formData.append("font_size", fontSize);
    formData.append("crop_top_pct", cropTopPct);
    formData.append("crop_bottom_pct", cropBottomPct);
    formData.append("crop_left_pct", cropLeftPct);
    formData.append("crop_right_pct", cropRightPct);
    formData.append("corner_radius", cornerRadius);
    if (customText) formData.append("custom_text", customText);
    // Extended editor params — only sent when the caller actually customised
    // them, so the backend keeps its sensible defaults otherwise.
    if (extras && typeof extras === "object") {
        const keys = [
            "bg_mode", "font_family", "text_color", "stroke_color", "stroke_width",
            "visual_filter", "trim_start", "trim_end",
            "mirror_cyclic_enabled", "mirror_cyclic_interval", "boost_contrast",
            "text_align",
        ];
        for (const k of keys) {
            if (extras[k] === undefined || extras[k] === null) continue;
            formData.append(k, typeof extras[k] === "boolean" ? (extras[k] ? "true" : "false") : extras[k]);
        }
    }
    const res = await fetch(`${API_BASE}/meme/reexport/${batchId}/${index}`, {
        method: "POST",
        body: formData,
    });
    if (!res.ok) throw new Error("Re-export failed");
    return res.json();
}

export function getMemeDescriptionUrl(batchId, index) {
    return `${API_BASE}/meme/description/${batchId}/${index}`;
}

export async function reanalyzeClip(projectId, clipId) {
    const res = await fetch(`${API_BASE}/clips/${projectId}/${clipId}/reanalyze`, { method: "POST" });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Reanalyze failed");
    }
    return res.json();
}

export async function getMemeIgDescription(batchId, index) {
    const res = await fetch(`${API_BASE}/meme/description/${batchId}/${index}`);
    if (!res.ok) throw new Error("Description not found");
    return res.text();
}


// ─── Editor mode (standalone editor: upload → trim → subtitles → export) ─────

export function uploadForEditor(file, onProgress) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append("video", file);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}/editor/upload`);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
            else {
                let detail = "Upload failed";
                try { detail = JSON.parse(xhr.responseText).detail || detail; } catch {}
                reject(new Error(detail));
            }
        };
        xhr.onerror = () => reject(new Error("Upload failed (network error)"));
        xhr.send(formData);
    });
}

export async function editorTranscribeTrim(projectId) {
    const res = await fetch(`${API_BASE}/editor/${projectId}/transcribe`, {
        method: "POST",
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Transcription failed");
    }
    return res.json();
}

export async function editorTranslateSpanish(projectId) {
    const res = await fetch(`${API_BASE}/editor/${projectId}/translate-spanish`, {
        method: "POST",
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Translation failed");
    }
    return res.json();   // { status, words }
}

export async function clipAnalyzeFaces(projectId, clipId) {
    const res = await fetch(`${API_BASE}/clips/${projectId}/${clipId}/analyze-faces`, {
        method: "POST",
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Face analysis failed");
    }
    return res.json();
}

export async function editorAnalyzeFaces(projectId) {
    const res = await fetch(`${API_BASE}/editor/${projectId}/analyze-faces`, {
        method: "POST",
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Face analysis failed");
    }
    return res.json();   // { status, sample_count, people, width, height, samples }
}

export async function editorUpdateReframeStyle(projectId, payload) {
    const res = await fetch(`${API_BASE}/editor/${projectId}/reframe-style`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Reframe style update failed");
    }
    return res.json();
}

export function getReframePreviewUrl(projectId, seconds = 10) {
    return `${API_BASE}/editor/${projectId}/preview-reframe?seconds=${seconds}&t=${Date.now()}`;
}

export async function getEditorSession(projectId) {
    const res = await fetch(`${API_BASE}/editor/${projectId}`);
    if (!res.ok) throw new Error("Editor session not found");
    return res.json();
}

export async function getEditorThumbnails(projectId, count = 30) {
    const res = await fetch(`${API_BASE}/editor/${projectId}/thumbnails?count=${count}`, {
        method: "POST",
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Thumbnail generation failed");
    }
    const data = await res.json();
    // Prefix relative URLs with the API origin so <img> can load them
    const origin = API_BASE.replace(/\/api$/, "");
    data.thumbnails = (data.thumbnails || []).map((t) => ({ ...t, url: origin + t.url }));
    return data;
}

export async function uploadOverlayImage(projectId, file) {
    const formData = new FormData();
    formData.append("image", file);
    const res = await fetch(`${API_BASE}/editor/${projectId}/overlay-image`, {
        method: "POST",
        body: formData,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Overlay upload failed");
    }
    const data = await res.json();
    const origin = API_BASE.replace(/\/api$/, "");
    data.url = origin + data.url;  // absolute URL for <img>
    return data;
}

export async function uploadEditorBroll(projectId, file, onProgress) {
    // XHR (not fetch) so we can report progress for large video files.
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append("video", file);
        xhr.open("POST", `${API_BASE}/editor/${projectId}/broll`);
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && typeof onProgress === "function") {
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    const origin = API_BASE.replace(/\/api$/, "");
                    data.url = origin + data.url;
                    resolve(data);
                } catch (e) {
                    reject(new Error("Bad upload response"));
                }
            } else {
                let msg = `Upload failed (${xhr.status})`;
                try { msg = JSON.parse(xhr.responseText).detail || msg; } catch {}
                reject(new Error(msg));
            }
        };
        xhr.onerror = () => reject(new Error("Upload failed (network error)"));
        xhr.send(formData);
    });
}

export async function uploadProjectMusic(projectId, file, onProgress) {
    // XHR (not fetch) so the user gets real progress feedback for large
    // audio files. Returns the same {path, url (absolute), filename,
    // duration, peaks} shape as the editor music upload.
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append("audio", file);
        xhr.open("POST", `${API_BASE}/export/music/${projectId}`);
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && typeof onProgress === "function") {
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    const origin = API_BASE.replace(/\/api$/, "");
                    data.url = origin + data.url;
                    resolve(data);
                } catch (e) {
                    reject(new Error("Bad upload response"));
                }
            } else {
                let msg = `Upload failed (${xhr.status})`;
                try { msg = JSON.parse(xhr.responseText).detail || msg; } catch {}
                reject(new Error(msg));
            }
        };
        xhr.onerror = () => reject(new Error("Upload failed (network error)"));
        xhr.send(formData);
    });
}

export function getProjectMusicUrl(projectId, filename) {
    return `${API_BASE}/export/music/${projectId}/${encodeURIComponent(filename)}`;
}

export async function uploadEditorMusic(projectId, file) {
    const formData = new FormData();
    formData.append("audio", file);
    const res = await fetch(`${API_BASE}/editor/${projectId}/music`, {
        method: "POST",
        body: formData,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Music upload failed");
    }
    const data = await res.json();
    const origin = API_BASE.replace(/\/api$/, "");
    data.url = origin + data.url;  // absolute URL for <audio>
    return data;
}

export async function saveEditorSegments(projectId, segments) {
    const res = await fetch(`${API_BASE}/editor/${projectId}/segments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to save segments");
    }
    return res.json();
}
