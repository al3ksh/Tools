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

export const api = {
  // Jobs
  getJobs: (sessionId) => fetchApi(`/jobs${sessionId ? `?sessionId=${sessionId}` : ''}`),
  getJob: (id) => fetchApi(`/jobs/${id}`),
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
  gifProcess: async (file, options = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, String(value));
      }
    });

    const response = await fetch(`${API_BASE}/gif/process`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'GIF processing failed' }));
      throw new Error(error.error || 'GIF processing failed');
    }
    return response.blob();
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
  pdfMerge: async (files) => {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    const response = await fetch(`${API_BASE}/pdf/merge`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Merge failed' }));
      throw new Error(error.error || 'Merge failed');
    }
    return response.blob();
  },
  pdfSplit: async (file, pages) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('pages', JSON.stringify(pages));
    const response = await fetch(`${API_BASE}/pdf/split`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Split failed' }));
      throw new Error(error.error || 'Split failed');
    }
    return response.blob();
  },
  pdfRotate: async (file, rotations) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('rotations', JSON.stringify(rotations));
    const response = await fetch(`${API_BASE}/pdf/rotate`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Rotate failed' }));
      throw new Error(error.error || 'Rotate failed');
    }
    return response.blob();
  },
  pdfRemovePages: async (file, pages) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('pages', JSON.stringify(pages));
    const response = await fetch(`${API_BASE}/pdf/remove-pages`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Remove pages failed' }));
      throw new Error(error.error || 'Remove pages failed');
    }
    return response.blob();
  },
  pdfImagesToPdf: async (files) => {
    const formData = new FormData();
    files.forEach(f => formData.append('images', f));
    const response = await fetch(`${API_BASE}/pdf/images-to-pdf`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Conversion failed' }));
      throw new Error(error.error || 'Conversion failed');
    }
    return response.blob();
  },
  pdfReorder: async (file, order) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('order', JSON.stringify(order));
    const response = await fetch(`${API_BASE}/pdf/reorder`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Reorder failed' }));
      throw new Error(error.error || 'Reorder failed');
    }
    return response.blob();
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

export async function finalizeUpload(uploadId, filename, sessionId, trimOptions) {
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

  return finalizeResponse.json();
}

export async function chunkedUpload(file, sessionId, trimOptions, onProgress) {
  const uploadId = await uploadChunks(file, onProgress);
  return finalizeUpload(uploadId, file.name, sessionId, trimOptions);
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
