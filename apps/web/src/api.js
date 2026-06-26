const API_BASE = '/api';

async function fetchApi(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

async function submitPdfJob(endpoint, formData, sessionId, fallbackError, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: fallbackError }));
    throw new Error(error.error || fallbackError);
  }

  const { jobId } = await response.json();
  if (!jobId) throw new Error(fallbackError);

  const startedAt = Date.now();
  if (options.onJobUpdate) {
    options.onJobUpdate({ id: jobId, status: 'queued', progress: 0, type: 'pdf', logsTail: 'Job queued' });
  }
  while (Date.now() - startedAt < 10 * 60 * 1000) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const job = await fetchApi(`/jobs/${jobId}${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`);
    if (options.onJobUpdate) options.onJobUpdate(job);

    if (job.status === 'done') {
      const fileResponse = await fetch(getFileUrl(jobId, null, sessionId), { credentials: 'include' });
      if (!fileResponse.ok) {
        const error = await fileResponse.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(error.error || 'Download failed');
      }
      return fileResponse.blob();
    }

    if (job.status === 'failed') {
      throw new Error(job.error || fallbackError);
    }
  }

  throw new Error('PDF job timed out');
}

async function submitGeneratedFileJob(endpoint, formData, sessionId, fallbackError, timeoutMs = 10 * 60 * 1000, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: fallbackError }));
    throw new Error(error.error || fallbackError);
  }

  const { jobId } = await response.json();
  if (!jobId) throw new Error(fallbackError);

  const startedAt = Date.now();
  if (options.onJobUpdate) {
    options.onJobUpdate({ id: jobId, status: 'queued', progress: 0, type: 'gif', logsTail: 'Job queued' });
  }
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const job = await fetchApi(`/jobs/${jobId}${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`);
    if (options.onJobUpdate) options.onJobUpdate(job);

    if (job.status === 'done') {
      const fileResponse = await fetch(getFileUrl(jobId, null, sessionId), { credentials: 'include' });
      if (!fileResponse.ok) {
        const error = await fileResponse.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(error.error || 'Download failed');
      }
      return fileResponse.blob();
    }

    if (job.status === 'failed') {
      throw new Error(job.error || fallbackError);
    }
  }

  throw new Error(`${fallbackError} timed out`);
}

async function waitForJob(jobId, sessionId, fallbackError, timeoutMs = 10 * 60 * 1000, options = {}) {
  const startedAt = Date.now();
  if (options.onJobUpdate) {
    options.onJobUpdate({ id: jobId, status: 'queued', progress: 0, logsTail: 'Job queued' });
  }
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const job = await fetchApi(`/jobs/${jobId}${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`);
    if (options.onJobUpdate) options.onJobUpdate(job);
    if (job.status === 'done') return job;
    if (job.status === 'failed') throw new Error(job.error || fallbackError);
  }
  throw new Error(`${fallbackError} timed out`);
}

export const api = {
  // Jobs
  getJobs: (sessionId) => fetchApi(`/jobs${sessionId ? `?sessionId=${sessionId}` : ''}`),
  getJob: (id, sessionId) => fetchApi(`/jobs/${id}${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`),
  deleteJob: (id, sessionId) => fetchApi(`/jobs/${id}${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`, { method: 'DELETE' }),
  cancelJob: (id, sessionId) => fetchApi(`/jobs/${id}/cancel${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`, { method: 'POST' }),

  // Downloader
  createDownloadJob: (url, preset, sessionId) => fetchApi('/downloader', {
    method: 'POST',
    body: JSON.stringify({ url, preset, sessionId }),
  }),

  // Converter
  uploadFile: async (file, sessionId) => {
    const formData = new FormData();
    formData.append('file', file);
    if (sessionId) formData.append('sessionId', sessionId);
    const response = await fetch(`${API_BASE}/upload/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }
    return response.json();
  },

  createConvertJob: (source, options, sessionId) => fetchApi('/converter', {
    method: 'POST',
    body: JSON.stringify({ source, options, sessionId }),
  }),

  // Shortener
  createShortlink: (url, slug, sessionId) => fetchApi('/shorten', {
    method: 'POST',
    body: JSON.stringify({ url, slug, sessionId }),
  }),

  getShortlinks: (sessionId) => fetchApi(`/shortlinks/list${sessionId ? `?sessionId=${sessionId}` : ''}`),

  // Drop
  uploadDrop: (file, sessionId, password, onProgress) => {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      if (sessionId) formData.append('sessionId', sessionId);
      if (password) formData.append('password', password);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/drop/upload`);
      xhr.withCredentials = true;
      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        });
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { reject(new Error('Upload failed')); }
        } else {
          try { reject(new Error(JSON.parse(xhr.responseText).error || 'Upload failed')); }
          catch (e) { reject(new Error('Upload failed')); }
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(formData);
    });
  },

  getDrops: (sessionId) => fetchApi(`/drop/list${sessionId ? `?sessionId=${sessionId}` : ''}`),
  getDropInfo: (token) => fetchApi(`/drop/${token}/info`),

  downloadDrop: async (token, password) => {
    const options = { credentials: 'include' };
    if (password) {
      options.method = 'POST';
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify({ password });
    }
    const response = await fetch(`${API_BASE}/drop/${token}/download`, options);
    if (response.status === 403) {
      const err = await response.json().catch(() => ({ error: 'Access denied' }));
      throw new Error(err.error || 'Access denied');
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Download failed' }));
      throw new Error(error.error || 'Download failed');
    }
    const blob = await response.blob();
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = 'download';
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^";\n]+)"?/);
      if (match) filename = match[1];
    }
    return { blob, filename };
  },

  // Storage
  getStorage: (sessionId) => fetchApi(`/storage?sessionId=${encodeURIComponent(sessionId || '')}`),

  // Utils
  getPreviewUrl: (url) => fetchApi(`/utils/preview?url=${encodeURIComponent(url)}`),

  // QR Code
  generateQR: (text, options = {}, signal) => fetchApi('/qr/generate', {
    method: 'POST',
    body: JSON.stringify({ text, ...options }),
    signal,
  }),
  generateQRSvg: (text, options = {}, signal) => fetchApi('/qr/generate-svg', {
    method: 'POST',
    body: JSON.stringify({ text, ...options }),
    signal,
  }),

  // GIF
  gifInfo: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/gif/info`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to read media info' }));
      throw new Error(error.error || 'Failed to read media info');
    }
    return response.json();
  },
  gifProcess: async (file, options = {}, sessionId, callbacks = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    if (sessionId) formData.append('sessionId', sessionId);
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, String(value));
      }
    });

    return submitGeneratedFileJob('/gif/process', formData, sessionId, 'GIF processing failed', 10 * 60 * 1000, callbacks);
  },

  // PDF
  pdfInfo: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/pdf/info`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed' }));
      throw new Error(error.error || 'Failed');
    }
    return response.json();
  },
  pdfMerge: async (files, sessionId, callbacks = {}) => {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    if (sessionId) formData.append('sessionId', sessionId);
    return submitPdfJob('/pdf/merge', formData, sessionId, 'Merge failed', callbacks);
  },
  pdfSplit: async (file, pages, sessionId, callbacks = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('pages', JSON.stringify(pages));
    if (sessionId) formData.append('sessionId', sessionId);
    return submitPdfJob('/pdf/split', formData, sessionId, 'Split failed', callbacks);
  },
  pdfRotate: async (file, rotations, sessionId, callbacks = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('rotations', JSON.stringify(rotations));
    if (sessionId) formData.append('sessionId', sessionId);
    return submitPdfJob('/pdf/rotate', formData, sessionId, 'Rotate failed', callbacks);
  },
  pdfRemovePages: async (file, pages, sessionId, callbacks = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('pages', JSON.stringify(pages));
    if (sessionId) formData.append('sessionId', sessionId);
    return submitPdfJob('/pdf/remove-pages', formData, sessionId, 'Remove pages failed', callbacks);
  },
  pdfImagesToPdf: async (files, sessionId, callbacks = {}) => {
    const formData = new FormData();
    files.forEach(f => formData.append('images', f));
    if (sessionId) formData.append('sessionId', sessionId);
    return submitPdfJob('/pdf/images-to-pdf', formData, sessionId, 'Conversion failed', callbacks);
  },
  pdfReorder: async (file, order, sessionId, callbacks = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('order', JSON.stringify(order));
    if (sessionId) formData.append('sessionId', sessionId);
    return submitPdfJob('/pdf/reorder', formData, sessionId, 'Reorder failed', callbacks);
  },

  // Admin
  getAllJobs: () => fetchApi('/jobs?all=true'),
  getAllDrops: () => fetchApi('/drop/list?all=true'),
  getAllShortlinks: () => fetchApi('/shortlinks/list?all=true'),
  deleteShortlink: (slug) => fetchApi(`/shortlinks/${slug}`, { method: 'DELETE' }),
  deleteDrop: (token) => fetchApi(`/drop/${token}`, { method: 'DELETE' }),

  // Clips
  getClips: (sessionId) => fetchApi(`/clip/list${sessionId ? `?sessionId=${sessionId}` : ''}`),
  getClipInfo: (token) => fetchApi(`/clip/${token}/info`),
  getAllClips: () => fetchApi('/clip/list?all=true'),
  deleteClip: (token, sessionId) => fetchApi(`/clip/${token}`, {
    method: 'DELETE',
    body: JSON.stringify({ sessionId }),
  }),
};

export const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString();
};

export const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const getFileUrl = (jobId, filename = null, sid = null) => {
  if (!filename) {
    const base = `/api/files/${jobId}`;
    return sid ? `${base}?sessionId=${encodeURIComponent(sid)}` : base;
  }
  const base = `/api/files/${jobId}/${encodeURIComponent(filename)}`;
  return sid ? `${base}?sessionId=${encodeURIComponent(sid)}` : base;
};
export const getDropUrl = (token) => `/api/drop/${token}/download`;

export const getClipUrl = (token) => `/c/${token}`;

export const getClipStreamUrl = (token) => `/api/clip/${token}/stream`;

export const getClipEmbedUrl = (token) => `/c/${token}/embed`;

const CHUNK_SIZE = 5 * 1024 * 1024;

export async function uploadChunks(file, onProgress) {
  const uploadId = crypto.randomUUID();

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let uploadedChunks = 0;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE - 1, file.size - 1);
    const blob = file.slice(start, end + 1);

    const response = await fetch(`${API_BASE}/clip/upload-chunk`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Upload-Id': uploadId,
        'Content-Range': `bytes ${start}-${end}/${file.size}`,
      },
      body: blob,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }

    uploadedChunks++;
    if (onProgress) {
      const percent = Math.round((uploadedChunks / totalChunks) * 100);
      const remaining = totalChunks - uploadedChunks;
      onProgress({ percent, uploaded: uploadedChunks, total: totalChunks, remaining });
    }
  }

  return uploadId;
}

export async function finalizeUpload(uploadId, filename, sessionId, trimOptions, callbacks = {}) {
  const body = {
    uploadId,
    filename,
    sessionId,
  };

  if (trimOptions) {
    body.trimStart = trimOptions.trimStart;
    body.trimEnd = trimOptions.trimEnd;
    body.duration = trimOptions.duration;
  }

  const finalizeResponse = await fetch(`${API_BASE}/clip/finalize`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!finalizeResponse.ok) {
    const error = await finalizeResponse.json().catch(() => ({ error: 'Finalize failed' }));
    throw new Error(error.error || 'Finalize failed');
  }

  const { jobId } = await finalizeResponse.json();
  if (!jobId) throw new Error('Finalize failed');

  const job = await waitForJob(jobId, sessionId, 'Clip processing failed', 10 * 60 * 1000, callbacks);
  const clip = job.outputJson?.clip;
  if (!clip || !clip.token) throw new Error('Clip processing failed');

  return {
    ...clip,
    url: `${window.location.origin}${clip.url || `/c/${clip.token}`}`
  };
}

export async function chunkedUpload(file, sessionId, trimOptions, onProgress, callbacks = {}) {
  const uploadId = await uploadChunks(file, onProgress);
  return finalizeUpload(uploadId, file.name, sessionId, trimOptions, callbacks);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const PRESETS = [
  { value: 'VIDEO_MP4_BEST', label: 'Video MP4 - Best Quality' },
  { value: 'VIDEO_MP4_720P', label: 'Video MP4 - 720p' },
  { value: 'VIDEO_MP4_DISCORD', label: 'Video MP4 - Discord (<8MB)' },
  { value: 'AUDIO_FLAC_BEST', label: 'Audio FLAC - Lossless' },
  { value: 'AUDIO_WAV_BEST', label: 'Audio WAV - Lossless' },
  { value: 'AUDIO_MP3_320', label: 'Audio MP3 - 320kbps' },
  { value: 'AUDIO_MP3_192', label: 'Audio MP3 - 192kbps' },
  { value: 'AUDIO_OPUS_BEST', label: 'Audio Opus - Best Quality' },
  { value: 'AUDIO_OPUS_96', label: 'Audio Opus - 96kbps (small size)' },
];

export const FORMATS = [
  { value: 'mp3', label: 'MP3 - Best Compatibility' },
  { value: 'wav', label: 'WAV - Lossless (large)' },
  { value: 'flac', label: 'FLAC - Lossless (compressed)' },
  { value: 'opus', label: 'Opus - Best Quality/Size Ratio' },
];
