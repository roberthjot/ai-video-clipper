const API_BASE = "http://localhost:8000/api";

export function uploadVideo(file, clipCount, minDuration, customPrompt, onProgress) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append("video", file);
        formData.append("clip_count", clipCount);
        formData.append("min_duration", minDuration);
        formData.append("custom_prompt", customPrompt);

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

export function getDownloadUrl(projectId, filename) {
    return `${API_BASE}/export/download/${projectId}/${filename}`;
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
