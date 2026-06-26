const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { statements, DATA_DIR } = require('../db/database');
const { safePath, createDiskSpaceGuard } = require('./utils');
const rateLimit = require('express-rate-limit');

const CLIPS_DIR = path.join(DATA_DIR, 'clips');
const CHUNKS_DIR = path.join(DATA_DIR, 'clips-temp');

if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });
if (!fs.existsSync(CHUNKS_DIR)) fs.mkdirSync(CHUNKS_DIR, { recursive: true });

const MAX_GUEST = 200 * 1024 * 1024;
const MAX_ADMIN = 5 * 1024 * 1024 * 1024;
const MAX_CHUNK_SIZE = 25 * 1024 * 1024;
const UPLOAD_ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;
const UPLOAD_META = '.upload.json';
const diskSpaceGuard = createDiskSpaceGuard({ dataDir: DATA_DIR, minFreeBytes: 512 * 1024 * 1024 });

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
};

const uploadSizes = new Map();
setInterval(() => {
  if (uploadSizes.size > 1000) uploadSizes.clear();
}, 60 * 60 * 1000);

function getUploadLimit(req) {
  return req.isAdmin ? MAX_ADMIN : MAX_GUEST;
}

function parseChunkName(filename) {
  const match = filename.match(/^(\d+)-(\d+)\.chunk$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  return { start, end, filename };
}

function getExistingUploadSize(uploadDir) {
  if (!fs.existsSync(uploadDir)) return 0;
  return fs.readdirSync(uploadDir).reduce((sum, file) => {
    const chunk = parseChunkName(file);
    if (!chunk) return sum;
    return sum + fs.statSync(path.join(uploadDir, file)).size;
  }, 0);
}

function getUploadMeta(uploadDir) {
  const metaPath = path.join(uploadDir, UPLOAD_META);
  if (!fs.existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (!Number.isSafeInteger(meta.total) || meta.total <= 0) return null;
    return meta;
  } catch (e) {
    return null;
  }
}

function writeUploadMeta(uploadDir, total) {
  fs.writeFileSync(path.join(uploadDir, UPLOAD_META), JSON.stringify({
    total,
    updatedAt: new Date().toISOString()
  }));
}

function getSortedChunks(processingDir, expectedTotal) {
  const chunks = fs.readdirSync(processingDir)
    .map(parseChunkName)
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  let nextStart = 0;
  for (const chunk of chunks) {
    if (chunk.start !== nextStart) {
      throw new Error('Incomplete upload');
    }
    const actualSize = fs.statSync(path.join(processingDir, chunk.filename)).size;
    const declaredSize = chunk.end - chunk.start + 1;
    if (actualSize !== declaredSize) {
      throw new Error('Corrupt upload chunk');
    }
    nextStart = chunk.end + 1;
  }

  if (chunks.length === 0 || nextStart !== expectedTotal) {
    throw new Error('Incomplete upload');
  }

  return chunks;
}

function parseRangeHeader(range, size) {
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  let start;
  let end;
  if (match[1] === '' && match[2] === '') return null;

  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return null;
  }

  return { start, end: Math.min(end, size - 1) };
}

const chunkRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload requests. Please slow down.' },
});

router.post('/upload-chunk', chunkRateLimit, diskSpaceGuard, (req, res) => {
  try {
    const uploadId = req.headers['x-upload-id'];
    if (!uploadId) return res.status(400).json({ error: 'Missing X-Upload-Id header' });
    if (!UPLOAD_ID_RE.test(uploadId)) return res.status(400).json({ error: 'Invalid upload id' });

    const contentRange = req.headers['content-range'];
    if (!contentRange) return res.status(400).json({ error: 'Missing Content-Range header' });

    const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!match) return res.status(400).json({ error: 'Invalid Content-Range format' });

    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = Number(match[3]);
    const limit = getUploadLimit(req);

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total) || start < 0 || end < start || end >= total || total <= 0) {
      return res.status(400).json({ error: 'Invalid Content-Range values' });
    }

    if (total > limit) {
      return res.status(413).json({ error: req.isAdmin ? 'File too large. Admin limit is 5GB.' : 'File too large. Guest limit is 200MB.' });
    }

    const chunkSize = end - start + 1;
    if (chunkSize > MAX_CHUNK_SIZE) {
      return res.status(413).json({ error: 'Chunk too large. Maximum chunk size is 25MB.' });
    }

    const contentLength = req.headers['content-length'] ? Number(req.headers['content-length']) : null;
    if (contentLength != null && (!Number.isSafeInteger(contentLength) || contentLength !== chunkSize)) {
      return res.status(400).json({ error: 'Content-Length does not match Content-Range' });
    }

    const uploadDir = safePath(CHUNKS_DIR, uploadId);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const meta = getUploadMeta(uploadDir);
    if (meta && meta.total !== total) {
      return res.status(400).json({ error: 'Upload total size changed' });
    }
    if (!meta) writeUploadMeta(uploadDir, total);

    const chunkPath = path.join(uploadDir, `${start}-${end}.chunk`);
    const tempChunkPath = `${chunkPath}.tmp`;
    const currentTotal = uploadSizes.get(uploadId) || getExistingUploadSize(uploadDir);
    const existingSize = fs.existsSync(chunkPath) ? fs.statSync(chunkPath).size : 0;
    if (currentTotal - existingSize + chunkSize > limit) {
      return res.status(413).json({ error: req.isAdmin ? 'File too large. Admin limit is 5GB.' : 'File too large. Guest limit is 200MB.' });
    }

    let received = 0;
    let done = false;
    const writeStream = fs.createWriteStream(tempChunkPath);

    function fail(status, message) {
      if (done) return;
      done = true;
      req.unpipe(writeStream);
      writeStream.destroy();
      try { fs.unlinkSync(tempChunkPath); } catch (e) {}
      res.status(status).json({ error: message });
    }

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > chunkSize) {
        fail(413, 'Chunk body is larger than Content-Range');
      }
    });

    req.on('aborted', () => {
      if (done) return;
      done = true;
      writeStream.destroy();
      try { fs.unlinkSync(tempChunkPath); } catch (e) {}
    });

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      if (done) return;
      if (received !== chunkSize) {
        return fail(400, 'Chunk body does not match Content-Range');
      }
      try {
        fs.renameSync(tempChunkPath, chunkPath);
        uploadSizes.set(uploadId, currentTotal - existingSize + chunkSize);
        done = true;
        res.status(200).json({ received: chunkSize });
      } catch (e) {
        fail(500, 'Internal server error');
      }
    });

    writeStream.on('error', () => {
      fail(500, 'Internal server error');
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/finalize', (req, res) => {
  try {
    const { uploadId, filename, sessionId, trimStart, trimEnd, duration } = req.body;

    if (!uploadId || !filename) {
      return res.status(400).json({ error: 'Missing uploadId or filename' });
    }
    if (!UPLOAD_ID_RE.test(uploadId)) return res.status(400).json({ error: 'Invalid upload id' });

    const uploadDir = safePath(CHUNKS_DIR, uploadId);
    if (!fs.existsSync(uploadDir)) {
      return res.status(400).json({ error: 'Upload not found' });
    }

    const meta = getUploadMeta(uploadDir);
    const expectedTotal = meta ? meta.total : uploadSizes.get(uploadId);
    if (!Number.isSafeInteger(expectedTotal) || expectedTotal <= 0) {
      return res.status(400).json({ error: 'Upload is incomplete or expired' });
    }

    const processingDir = uploadDir + '_processing';
    try {
      fs.renameSync(uploadDir, processingDir);
    } catch (e) {
      return res.status(409).json({ error: 'Upload already being processed' });
    }

    const ext = path.extname(filename).toLowerCase() || '.mp4';

    try {
      getSortedChunks(processingDir, expectedTotal);
    } catch (e) {
      try { fs.rmSync(processingDir, { recursive: true, force: true }); } catch (e2) {}
      uploadSizes.delete(uploadId);
      return res.status(400).json({ error: e.message });
    }

    const jobId = uuidv4();
    const createdAt = new Date().toISOString();
    const jobSessionId = req.isAdmin ? 'admin' : sessionId;
    const inputJson = JSON.stringify({
      uploadId,
      processingDir: path.relative(DATA_DIR, processingDir),
      filename,
      ext,
      expectedTotal,
      trimStart: trimStart != null ? Number(trimStart) : null,
      trimEnd: trimEnd != null ? Number(trimEnd) : null,
      duration: duration != null ? Number(duration) : null,
      isAdmin: req.isAdmin
    });

    statements.createJob.run(jobId, 'clip', createdAt, inputJson, jobSessionId || null);
    uploadSizes.delete(uploadId);
    res.json({ jobId });
  } catch (err) {
    if (err.message === 'Invalid path') return res.status(400).json({ error: 'Invalid upload' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:token/stream', (req, res) => {
  try {
    const { token } = req.params;
    const clip = statements.getClip.get(token);

    if (!clip || clip.deleted) return res.status(404).json({ error: 'Clip not found' });
    if (clip.expiresAt && new Date(clip.expiresAt) < new Date()) {
      statements.expireClip.run(token);
      return res.status(410).json({ error: 'This clip has expired' });
    }

    const viewCookie = `clip_viewed_${token}`;
    if (!req.cookies || !req.cookies[viewCookie]) {
      statements.incrementClipViews.run(token);
      res.cookie(viewCookie, '1', { maxAge: 3600, httpOnly: true });
    }

    const filePath = safePath(DATA_DIR, clip.path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'video/mp4';
    const range = req.headers.range;

    if (range) {
      const parsedRange = parseRangeHeader(range, stat.size);
      if (!parsedRange) {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        return res.status(416).end();
      }

      res.writeHead(206, {
        'Content-Range': `bytes ${parsedRange.start}-${parsedRange.end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': parsedRange.end - parsedRange.start + 1,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      });

      fs.createReadStream(filePath, { start: parsedRange.start, end: parsedRange.end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      });

      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    if (err.message === 'Invalid path') return res.status(400).json({ error: 'Invalid token' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:token/info', (req, res) => {
  try {
    const { token } = req.params;
    const clip = statements.getClip.get(token);

    if (!clip || clip.deleted) return res.status(404).json({ error: 'Clip not found' });
    if (clip.expiresAt && new Date(clip.expiresAt) < new Date()) {
      statements.expireClip.run(token);
      return res.status(410).json({ error: 'This clip has expired' });
    }

    res.json({
      token: clip.token,
      filename: clip.filename,
      size: clip.size,
      duration: clip.duration,
      width: clip.width,
      height: clip.height,
      fps: clip.fps,
      bitrate: clip.bitrate,
      videoCodec: clip.videoCodec,
      audioCodec: clip.audioCodec,
      downloads: clip.downloads,
      createdAt: clip.createdAt,
      expiresAt: clip.expiresAt,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/list', (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    const all = req.query.all === 'true';

    if (all && req.isAdmin) {
      return res.json(statements.getAllClips.all());
    }

    if (sessionId) {
      return res.json(statements.getClipsBySession.all(sessionId));
    }

    res.json([]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:token', (req, res) => {
  try {
    const { token } = req.params;
    const clip = statements.getClip.get(token);

    if (!clip || clip.deleted) {
      return res.status(404).json({ error: 'Clip not found' });
    }

    const sessionId = req.body.sessionId || req.query.sessionId;
    if (!req.isAdmin && (!clip.sessionId || clip.sessionId !== sessionId)) {
      return res.status(403).json({ error: 'Not your clip' });
    }

    if (clip.path) {
      const filePath = safePath(DATA_DIR, clip.path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    statements.deleteClip.run(token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/upload-status', (req, res) => {
  try {
    const uploadId = req.query.uploadId;
    if (!uploadId) return res.status(400).json({ error: 'Missing uploadId' });

    const uploadDir = safePath(CHUNKS_DIR, uploadId);
    if (!fs.existsSync(uploadDir)) return res.json({ chunks: [] });

    const chunks = fs.readdirSync(uploadDir)
      .filter(f => f.endsWith('.chunk'))
      .map(f => {
        const parts = f.replace('.chunk', '').split('-');
        return { start: parseInt(parts[0]), end: parseInt(parts[1]) };
      })
      .sort((a, b) => a.start - b.start);

    res.json({ chunks });
  } catch (err) {
    if (err.message === 'Invalid path') return res.status(400).json({ error: 'Invalid upload' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
