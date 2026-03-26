const API_BASE = '/api';

const getAuthHeaders = () => {
  return {};
};

async function fetchApi(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
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
  deleteJob: (id) => fetchApi(`/jobs/${id}`, { method: 'DELETE' }),
  cancelJob: (id) => fetchApi(`/jobs/${id}/cancel`, { method: 'POST' }),

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
      headers: getAuthHeaders(),
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
  uploadDrop: async (file, sessionId) => {
    const formData = new FormData();
    formData.append('file', file);
    if (sessionId) formData.append('sessionId', sessionId);
    const response = await fetch(`${API_BASE}/drop/upload`, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders(),
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }
    return response.json();
  },

  getDrops: (sessionId) => fetchApi(`/drop/list${sessionId ? `?sessionId=${sessionId}` : ''}`),
  getDropInfo: (token) => fetchApi(`/drop/${token}/info`),

  // Storage
  getStorage: () => fetchApi('/storage'),

  // Utils
  getPreviewUrl: (url) => fetchApi(`/utils/preview?url=${encodeURIComponent(url)}`),

  // QR Code
  generateQR: (text, options = {}) => fetchApi('/qr/generate', {
    method: 'POST',
    body: JSON.stringify({ text, ...options }),
  }),
  generateQRSvg: (text, options = {}) => fetchApi('/qr/generate-svg', {
    method: 'POST',
    body: JSON.stringify({ text, ...options }),
  }),

  // GIF
  gifInfo: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/gif/info`, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders(),
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
  deleteClip: (token) => fetchApi(`/clip/${token}`, { method: 'DELETE' }),
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

export const getFileUrl = (jobId, filename = null) => {
  // If no filename, use auto-find endpoint to get first file in directory
  if (!filename) {
    return `/api/files/${jobId}`;
  }
  return `/api/files/${jobId}/${encodeURIComponent(filename)}`;
};
export const getDropUrl = (token) => `/api/drop/${token}/download`;

export const getClipUrl = (token) => `/c/${token}`;

export const getClipStreamUrl = (token) => `/api/clip/${token}/stream`;

export const getClipEmbedUrl = (token) => `/c/${token}/embed`;

const CHUNK_SIZE = 5 * 1024 * 1024;

export async function chunkedUpload(file, sessionId, trimOptions, onProgress) {
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

  const body = {
    uploadId,
    filename: file.name,
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
