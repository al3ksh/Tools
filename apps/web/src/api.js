const API_BASE = '/api';

// Cloudflare turns away request bodies over 100 MB before they reach the
// server, so larger uploads go ahead in chunks (see stageFiles).
const SINGLE_REQUEST_BUDGET = 90 * 1024 * 1024;

// The server's own message, or a plain explanation for the HTML error pages
// Cloudflare returns (too large, rate limited, origin too slow).
async function readError(response, fallback) {
  const data = await response.json().catch(() => null);
  if (data && data.error) return data.error;
  if (response.status === 413) return 'This file is too large to upload in one request.';
  if (response.status === 429) return 'Too many requests. Wait a moment and try again.';
  if ([502, 503, 504, 520, 521, 522, 523, 524].includes(response.status)) {
    return 'The server did not respond in time. Try again in a moment.';
  }
  return fallback;
}

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
    throw new Error(await readError(response, 'Request failed'));
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
    throw new Error(await readError(response, fallbackError));
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
        throw new Error(await readError(fileResponse, 'Download failed'));
      }
      return fileResponse.blob();
    }

    if (job.status === 'failed') {
      throw new Error(job.error || fallbackError);
    }
  }

  throw new Error('PDF job timed out');
}

async function submitGeneratedFileJob(endpoint, formData, sessionId, fallbackError, timeoutMs = 10 * 60 * 1000, options = {}, jobType = 'gif') {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await readError(response, fallbackError));
  }

  const { jobId } = await response.json();
  if (!jobId) throw new Error(fallbackError);

  const startedAt = Date.now();
  if (options.onJobUpdate) {
    options.onJobUpdate({ id: jobId, status: 'queued', progress: 0, type: jobType, logsTail: 'Job queued' });
  }
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const job = await fetchApi(`/jobs/${jobId}${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`);
    if (options.onJobUpdate) options.onJobUpdate(job);

    if (job.status === 'done') {
      const fileResponse = await fetch(getFileUrl(jobId, null, sessionId), { credentials: 'include' });
      if (!fileResponse.ok) {
        throw new Error(await readError(fileResponse, 'Download failed'));
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
  setJobPriority: (id, priority) => fetchApi(`/jobs/${id}/priority`, {
    method: 'PATCH',
    body: JSON.stringify({ priority })
  }),

  // Downloader
  createDownloadJob: (url, preset, sessionId, options = {}) => fetchApi('/downloader', {
    method: 'POST',
    body: JSON.stringify({ url, preset, sessionId, ...options }),
  }),

  // Converter
  uploadFile: async (file, sessionId, onProgress) => {
    if (file.size > SINGLE_REQUEST_BUDGET) {
      return stageFile(file, sessionId, onProgress && (({ uploadedBytes }) => onProgress(Math.round((uploadedBytes / file.size) * 100))));
    }
    const formData = new FormData();
    formData.append('file', file);
    if (sessionId) formData.append('sessionId', sessionId);
    const response = await fetch(`${API_BASE}/upload/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      throw new Error(await readError(response, 'Upload failed'));
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
  uploadDrop: (file, sessionId, password, onProgress, onPhase) => uploadDropChunks(
    file,
    sessionId,
    password,
    onProgress,
    onPhase
  ),

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
      throw new Error(await readError(response, 'Download failed'));
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
  gifInfo: async (file, sessionId) => {
    const formData = new FormData();
    if (sessionId) formData.append('sessionId', sessionId);
    await appendFiles(formData, 'file', [file], sessionId);
    const response = await fetch(`${API_BASE}/gif/info`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      throw new Error(await readError(response, 'Failed to read media info'));
    }
    return response.json();
  },
  gifProcess: async (file, options = {}, sessionId, callbacks = {}) => {
    const formData = new FormData();
    if (sessionId) formData.append('sessionId', sessionId);
    await appendFiles(formData, 'file', [file], sessionId, callbacks);
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, String(value));
      }
    });

    return submitGeneratedFileJob('/gif/process', formData, sessionId, 'GIF processing failed', 10 * 60 * 1000, callbacks);
  },

  compressFile: async (file, options = {}, sessionId, callbacks = {}) => {
    const formData = new FormData();
    formData.append('sessionId', sessionId);
    await appendFiles(formData, 'file', [file], sessionId, callbacks);
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') formData.append(key, String(value));
    });
    return submitGeneratedFileJob('/compress', formData, sessionId, 'Compression failed', 30 * 60 * 1000, callbacks, 'compress');
  },

  // PDF
  pdfInfo: async (file, sessionId) => {
    const formData = new FormData();
    if (sessionId) formData.append('sessionId', sessionId);
    await appendFiles(formData, 'file', [file], sessionId);
    const response = await fetch(`${API_BASE}/pdf/info`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      throw new Error(await readError(response, 'Failed'));
    }
    return response.json();
  },
  pdfMerge: async (files, sessionId, callbacks = {}) => {
    const formData = new FormData();
    if (sessionId) formData.append('sessionId', sessionId);
    await appendFiles(formData, 'files', files, sessionId, callbacks);
    return submitPdfJob('/pdf/merge', formData, sessionId, 'Merge failed', callbacks);
  },
  pdfSplit: async (file, pages, sessionId, callbacks = {}) => {
    const formData = new FormData();
    if (sessionId) formData.append('sessionId', sessionId);
    await appendFiles(formData, 'file', [file], sessionId, callbacks);
    formData.append('pages', JSON.stringify(pages));
    return submitPdfJob('/pdf/split', formData, sessionId, 'Split failed', callbacks);
  },
  pdfRotate: async (file, rotations, sessionId, callbacks = {}) => {
    const formData = new FormData();
    if (sessionId) formData.append('sessionId', sessionId);
    await appendFiles(formData, 'file', [file], sessionId, callbacks);
    formData.append('rotations', JSON.stringify(rotations));
    return submitPdfJob('/pdf/rotate', formData, sessionId, 'Rotate failed', callbacks);
  },
  pdfRemovePages: async (file, pages, sessionId, callbacks = {}) => {
    const formData = new FormData();
    if (sessionId) formData.append('sessionId', sessionId);
    await appendFiles(formData, 'file', [file], sessionId, callbacks);
    formData.append('pages', JSON.stringify(pages));
    return submitPdfJob('/pdf/remove-pages', formData, sessionId, 'Remove pages failed', callbacks);
  },
  pdfImagesToPdf: async (files, sessionId, callbacks = {}) => {
    const formData = new FormData();
    if (sessionId) formData.append('sessionId', sessionId);
    await appendFiles(formData, 'images', files, sessionId, callbacks);
    return submitPdfJob('/pdf/images-to-pdf', formData, sessionId, 'Conversion failed', callbacks);
  },
  pdfReorder: async (file, order, sessionId, callbacks = {}) => {
    const formData = new FormData();
    if (sessionId) formData.append('sessionId', sessionId);
    await appendFiles(formData, 'file', [file], sessionId, callbacks);
    formData.append('order', JSON.stringify(order));
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

const CLIP_CHUNK_SIZE = 16 * 1024 * 1024;
const DROP_CHUNK_SIZE = 16 * 1024 * 1024;
const MAX_CHUNK_RETRIES = 3;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function uploadChunks(file, onProgress) {
  const uploadId = crypto.randomUUID();

  const totalChunks = Math.ceil(file.size / CLIP_CHUNK_SIZE);
  let uploadedChunks = 0;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CLIP_CHUNK_SIZE;
    const end = Math.min(start + CLIP_CHUNK_SIZE - 1, file.size - 1);
    const blob = file.slice(start, end + 1);

    for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
      let response;
      try {
        response = await fetch(`${API_BASE}/clip/upload-chunk`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'X-Upload-Id': uploadId,
            'Content-Range': `bytes ${start}-${end}/${file.size}`,
          },
          body: blob,
        });
      } catch (error) {
        if (attempt === MAX_CHUNK_RETRIES) {
          throw new Error('Upload interrupted. Check your connection and try again.');
        }
        await delay(500 * 2 ** attempt);
        continue;
      }

      if (response.ok) break;

      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_CHUNK_RETRIES) {
        throw new Error(await readError(response, 'Upload failed'));
      }

      await delay(retryAfterMs((name) => response.headers.get(name)) ?? 500 * 2 ** attempt);
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

function parseUploadError(xhr, fallback) {
  try {
    const response = JSON.parse(xhr.responseText);
    return response.error || fallback;
  } catch (e) {
    if (xhr.status === 413) return 'Upload was rejected because a request was too large.';
    if (xhr.status === 429) return 'Server is receiving too many uploads. Retrying shortly.';
    return fallback;
  }
}

// How long the server (or Cloudflare) asked us to wait before retrying.
function retryAfterMs(getHeader) {
  const value = Number(getHeader('Retry-After') || getHeader('RateLimit-Reset'));
  return Number.isFinite(value) && value > 0 ? Math.min(value, 60) * 1000 : null;
}

function sendChunk(endpoint, uploadId, sessionId, file, start, end, onProgress) {
  return new Promise((resolve, reject) => {
    const blob = file.slice(start, end + 1);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${endpoint}`);
    xhr.withCredentials = true;
    xhr.timeout = 4 * 60 * 1000;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Upload-Id', uploadId);
    xhr.setRequestHeader('X-Session-Id', sessionId);
    xhr.setRequestHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable || !onProgress) return;
      const uploadedBytes = Math.min(start + event.loaded, file.size);
      onProgress({
        percent: Math.min(99, Math.round((uploadedBytes / file.size) * 100)),
        uploadedBytes,
        totalBytes: file.size
      });
    });

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      const error = new Error(parseUploadError(xhr, 'Upload chunk failed'));
      error.status = xhr.status;
      error.retryAfterMs = retryAfterMs((name) => xhr.getResponseHeader(name));
      reject(error);
    };
    xhr.onerror = () => {
      const error = new Error('Upload interrupted. Check your connection.');
      error.status = 0;
      reject(error);
    };
    xhr.ontimeout = () => {
      const error = new Error('Upload chunk timed out. Check your connection.');
      error.status = 408;
      reject(error);
    };
    xhr.send(blob);
  });
}

async function finalizeDropUpload(uploadId, file, sessionId, password) {
  const response = await fetch(`${API_BASE}/drop/finalize`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, filename: file.name, sessionId, password })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || 'Failed to finalize upload');
    error.status = response.status;
    throw error;
  }

  return response.json();
}

// Sends a file as ordered chunks to one upload id; returns the id.
async function uploadInChunks(endpoint, file, sessionId, onProgress, onPhase) {
  if (!sessionId) throw new Error('Missing browser session. Refresh the page and try again.');
  if (!file || file.size <= 0) throw new Error('The selected file is empty.');

  const uploadId = crypto.randomUUID();
  if (onPhase) onPhase('uploading');

  for (let start = 0; start < file.size; start += DROP_CHUNK_SIZE) {
    const end = Math.min(start + DROP_CHUNK_SIZE - 1, file.size - 1);

    for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
      try {
        await sendChunk(endpoint, uploadId, sessionId, file, start, end, onProgress);
        break;
      } catch (error) {
        const retryable = error.status === 0 || error.status === 408 || error.status === 409
          || error.status === 429 || error.status >= 500;
        if (!retryable || attempt === MAX_CHUNK_RETRIES) throw error;
        if (onPhase) onPhase('retrying');
        await delay(error.retryAfterMs ?? 750 * 2 ** attempt);
        if (onPhase) onPhase('uploading');
      }
    }

    if (onProgress) {
      const uploadedBytes = end + 1;
      onProgress({
        percent: Math.min(99, Math.round((uploadedBytes / file.size) * 100)),
        uploadedBytes,
        totalBytes: file.size
      });
    }
  }

  return uploadId;
}

async function uploadDropChunks(file, sessionId, password, onProgress, onPhase) {
  const uploadId = await uploadInChunks('/drop/upload-chunk', file, sessionId, onProgress, onPhase);
  if (onPhase) onPhase('finalizing');
  if (onProgress) onProgress({ percent: 100, uploadedBytes: file.size, totalBytes: file.size });

  for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
    try {
      return await finalizeDropUpload(uploadId, file, sessionId, password);
    } catch (error) {
      const retryable = error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
      if (!retryable || attempt === MAX_CHUNK_RETRIES) throw error;
      await delay(750 * 2 ** attempt);
    }
  }

  throw new Error('Failed to finalize upload');
}

// Uploads one file in chunks and returns { uploadId, path, filename, size }.
async function stageFile(file, sessionId, onProgress) {
  const uploadId = await uploadInChunks('/upload/chunk', file, sessionId, onProgress);
  const response = await fetch(`${API_BASE}/upload/finalize`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, filename: file.name, type: file.type, sessionId }),
  });
  if (!response.ok) throw new Error(await readError(response, 'Upload failed'));
  return response.json();
}

// Adds files to a tool request: inline when the request stays under
// Cloudflare's limit, otherwise uploaded first in chunks and named in a
// `staged` field. Upload progress is reported through onJobUpdate.
async function appendFiles(formData, field, files, sessionId, callbacks = {}) {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total <= SINGLE_REQUEST_BUDGET) {
    files.forEach((file) => formData.append(field, file));
    return;
  }
  const ids = [];
  let sent = 0;
  for (const file of files) {
    const staged = await stageFile(file, sessionId, ({ uploadedBytes }) => {
      if (callbacks.onJobUpdate) {
        callbacks.onJobUpdate({ id: null, status: 'uploading', progress: Math.min(99, Math.round(((sent + uploadedBytes) / total) * 100)) });
      }
    });
    ids.push(staged.uploadId);
    sent += file.size;
  }
  formData.append('staged', JSON.stringify(ids));
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
    throw new Error(await readError(finalizeResponse, 'Finalize failed'));
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
  { value: 'VIDEO_GIF_SOCIAL', label: 'GIF - Social clip' },
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
