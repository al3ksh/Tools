const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pipeline } = require('stream');
const { v4: uuidv4 } = require('uuid');
const { statements, DATA_DIR } = require('../db/database');
const { safePath, setContentDisposition, createGuestSizeLimit, createDiskSpaceGuard } = require('./utils');

const dropsDir = path.join(DATA_DIR, 'drops');
const dropsTempDir = path.join(DATA_DIR, 'drops-temp');
if (!fs.existsSync(dropsDir)) {
  fs.mkdirSync(dropsDir, { recursive: true });
}
if (!fs.existsSync(dropsTempDir)) {
  fs.mkdirSync(dropsTempDir, { recursive: true });
}

const MAX_GUEST_BYTES = 50 * 1024 * 1024;
const MAX_ADMIN_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_CHUNK_BYTES = 25 * 1024 * 1024;
const MIN_FREE_BYTES = 512 * 1024 * 1024;
const UPLOAD_ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;
const DROP_TOKEN_RE = /^[a-f0-9-]{8,36}$/;
const activeUploads = new Set();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(dropsDir, { recursive: true });
    cb(null, dropsDir);
  },
  filename: (req, file, cb) => {
    const token = uuidv4().substring(0, 12);
    const ext = path.extname(file.originalname);
    cb(null, token + ext);
  }
});

const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 * 1024 } });
const uploadGuest = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const dropSizeLimit = createGuestSizeLimit(50);
const diskSpaceGuard = createDiskSpaceGuard({ dataDir: DATA_DIR, minFreeBytes: MIN_FREE_BYTES });

function getUploadLimit(req) {
  return req.isAdmin ? MAX_ADMIN_BYTES : MAX_GUEST_BYTES;
}

function getLimitError(req) {
  return req.isAdmin ? 'File too large. Admin limit is 5GB.' : 'File too large. Guest limit is 50MB.';
}

function getUploadOwner(req, sessionId) {
  if (req.isAdmin) return 'admin';
  const owner = String(sessionId || '').trim();
  if (!owner || owner.length > 128) return null;
  return owner;
}

function getUploadPaths(uploadId) {
  return {
    partPath: safePath(dropsTempDir, `${uploadId}.part`),
    metaPath: safePath(dropsTempDir, `${uploadId}.json`)
  };
}

function readUploadMeta(metaPath) {
  if (!fs.existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (!Number.isSafeInteger(meta.total) || meta.total <= 0 || !DROP_TOKEN_RE.test(meta.token) || !meta.owner) return null;
    return meta;
  } catch (e) {
    return null;
  }
}

function writeUploadMeta(metaPath, meta) {
  const tempPath = `${metaPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(meta));
  fs.renameSync(tempPath, metaPath);
}

function getPublicDropUrl(req, token) {
  const configuredBaseUrl = process.env.BASE_URL && process.env.BASE_URL.replace(/\/$/, '');
  const origin = configuredBaseUrl || `${req.protocol}://${req.get('host')}`;
  return `${origin}/d/${token}`;
}

function sameUploadOwner(meta, req, owner) {
  return meta.owner === owner && meta.isAdmin === !!req.isAdmin;
}

function ensureEnoughSpace(total) {
  const stat = fs.statfsSync(DATA_DIR);
  return stat.bavail * stat.bsize >= MIN_FREE_BYTES + total;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const hash = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  if (hash.length !== expected.length) return false;
  return crypto.timingSafeEqual(hash, expected);
}

// POST /api/drop/upload-chunk - resumable upload transport for large drops
router.post('/upload-chunk', diskSpaceGuard, (req, res) => {
  let uploadId;
  let tempChunkPath;
  let finished = false;

  function releaseUpload() {
    if (uploadId) activeUploads.delete(uploadId);
  }

  function fail(status, message) {
    if (finished) return;
    finished = true;
    releaseUpload();
    if (tempChunkPath) {
      try { fs.unlinkSync(tempChunkPath); } catch (e) {}
    }
    if (!req.aborted && !res.headersSent) res.status(status).json({ error: message });
  }

  try {
    uploadId = req.headers['x-upload-id'];
    if (!uploadId || !UPLOAD_ID_RE.test(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload id' });
    }

    const owner = getUploadOwner(req, req.headers['x-session-id']);
    if (!owner) return res.status(400).json({ error: 'Missing session id' });

    const contentRange = req.headers['content-range'];
    const match = contentRange && contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!match) return res.status(400).json({ error: 'Invalid Content-Range header' });

    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = Number(match[3]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total)
      || start < 0 || end < start || end >= total || total <= 0) {
      return res.status(400).json({ error: 'Invalid Content-Range values' });
    }

    if (total > getUploadLimit(req)) return res.status(413).json({ error: getLimitError(req) });

    const chunkSize = end - start + 1;
    if (chunkSize > MAX_CHUNK_BYTES) {
      return res.status(413).json({ error: 'Chunk too large. Maximum chunk size is 25MB.' });
    }

    const contentLength = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(contentLength) || contentLength !== chunkSize) {
      return res.status(400).json({ error: 'Content-Length does not match Content-Range' });
    }

    if (activeUploads.has(uploadId)) {
      return res.status(409).json({ error: 'This upload is already receiving a chunk. Retry shortly.' });
    }
    activeUploads.add(uploadId);

    const { partPath, metaPath } = getUploadPaths(uploadId);
    let meta = readUploadMeta(metaPath);
    if (!meta) {
      if (start !== 0) return fail(409, 'Upload must restart from the first chunk');
      if (!ensureEnoughSpace(total)) return fail(507, 'Insufficient disk space for this file');
      meta = {
        uploadId,
        token: uuidv4().substring(0, 12),
        total,
        owner,
        isAdmin: !!req.isAdmin,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      writeUploadMeta(metaPath, meta);
    } else {
      if (!sameUploadOwner(meta, req, owner)) return fail(403, 'Upload belongs to another session');
      if (meta.total !== total) return fail(400, 'Upload total size changed');
      if (meta.finalizedAt) {
        req.resume();
        finished = true;
        releaseUpload();
        return res.json({ received: chunkSize, offset: total, finalized: true });
      }
    }

    let currentSize = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
    if (currentSize >= end + 1) {
      req.resume();
      finished = true;
      releaseUpload();
      return res.json({ received: chunkSize, offset: currentSize, duplicate: true });
    }

    if (currentSize > start && currentSize <= end) {
      fs.truncateSync(partPath, start);
      currentSize = start;
    }

    if (currentSize !== start) {
      return fail(409, `Upload offset mismatch. Expected byte ${currentSize}.`);
    }

    tempChunkPath = safePath(dropsTempDir, `${uploadId}.${start}-${end}.tmp`);
    try { fs.unlinkSync(tempChunkPath); } catch (e) {}

    let received = 0;
    const writeStream = fs.createWriteStream(tempChunkPath, { flags: 'wx' });

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > chunkSize) {
        req.unpipe(writeStream);
        writeStream.destroy();
        fail(413, 'Chunk body is larger than Content-Range');
      }
    });

    req.on('aborted', () => {
      if (finished) return;
      finished = true;
      writeStream.destroy();
      releaseUpload();
      try { fs.unlinkSync(tempChunkPath); } catch (e) {}
    });

    req.on('error', () => fail(400, 'Upload connection failed'));
    req.pipe(writeStream);

    writeStream.on('finish', () => {
      if (finished) return;
      if (received !== chunkSize) return fail(400, 'Chunk body does not match Content-Range');

      const appendStream = fs.createWriteStream(partPath, { flags: start === 0 ? 'w' : 'a' });
      pipeline(fs.createReadStream(tempChunkPath), appendStream, (err) => {
        if (err) return fail(500, 'Failed to store upload chunk');

        try {
          const nextOffset = fs.statSync(partPath).size;
          if (nextOffset !== end + 1) {
            fs.truncateSync(partPath, start);
            return fail(500, 'Stored upload chunk has an invalid size');
          }

          meta.updatedAt = new Date().toISOString();
          writeUploadMeta(metaPath, meta);
          fs.unlinkSync(tempChunkPath);
          tempChunkPath = null;
          finished = true;
          releaseUpload();
          res.json({ received: chunkSize, offset: nextOffset });
        } catch (err) {
          fail(500, 'Failed to finalize upload chunk');
        }
      });
    });

    writeStream.on('error', () => fail(500, 'Failed to write upload chunk'));
  } catch (err) {
    console.error('Drop chunk upload failed:', err.message);
    fail(500, 'Internal server error');
  }
});

// POST /api/drop/finalize - atomically publish a completed chunked upload
router.post('/finalize', (req, res) => {
  const { uploadId, filename, sessionId, password = '' } = req.body;
  if (!uploadId || !UPLOAD_ID_RE.test(uploadId)) {
    return res.status(400).json({ error: 'Invalid upload id' });
  }

  const owner = getUploadOwner(req, sessionId);
  if (!owner) return res.status(400).json({ error: 'Missing session id' });
  if (typeof password !== 'string' || password.length > 256) {
    return res.status(400).json({ error: 'Password must be 256 characters or fewer' });
  }
  if (activeUploads.has(uploadId)) {
    return res.status(409).json({ error: 'Upload is still receiving data. Retry shortly.' });
  }

  activeUploads.add(uploadId);
  try {
    const { partPath, metaPath } = getUploadPaths(uploadId);
    const meta = readUploadMeta(metaPath);
    if (!meta) return res.status(400).json({ error: 'Upload not found or expired' });
    if (!sameUploadOwner(meta, req, owner)) return res.status(403).json({ error: 'Upload belongs to another session' });

    const existingDrop = statements.getDrop.get(meta.token);
    if (existingDrop) {
      return res.json({
        token: existingDrop.token,
        url: getPublicDropUrl(req, existingDrop.token),
        hasPassword: !!existingDrop.password
      });
    }

    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Filename is required' });
    }
    const originalName = path.basename(filename.replace(/\\/g, '/')).trim().slice(0, 255);
    if (!originalName) return res.status(400).json({ error: 'Filename is required' });
    if (!fs.existsSync(partPath) || fs.statSync(partPath).size !== meta.total) {
      return res.status(409).json({ error: 'Upload is incomplete. Retry the missing chunk.' });
    }

    const rawExtension = path.extname(originalName).slice(0, 16);
    const extension = rawExtension.replace(/[^a-zA-Z0-9.]/g, '');
    const storedName = `${meta.token}${extension}`;
    const finalPath = safePath(dropsDir, storedName);
    fs.renameSync(partPath, finalPath);

    const createdAt = new Date().toISOString();
    const expiresAt = req.isAdmin ? null : new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const rawPassword = String(password).trim();
    const passwordHash = rawPassword ? hashPassword(rawPassword) : null;
    const relativePath = path.relative(DATA_DIR, finalPath);

    try {
      statements.createDrop.run(meta.token, originalName, relativePath, meta.total, createdAt, expiresAt, owner, passwordHash);
      if (!req.isAdmin) {
        try { statements.addSessionUsage.run(owner, meta.total, meta.total); } catch (e) {}
      }
    } catch (err) {
      try { fs.renameSync(finalPath, partPath); } catch (e) {}
      throw err;
    }

    meta.finalizedAt = new Date().toISOString();
    meta.updatedAt = meta.finalizedAt;
    writeUploadMeta(metaPath, meta);

    res.json({
      token: meta.token,
      url: getPublicDropUrl(req, meta.token),
      hasPassword: !!passwordHash
    });
  } catch (err) {
    console.error('Drop finalize failed:', err.message);
    res.status(500).json({ error: 'Failed to finalize upload' });
  } finally {
    activeUploads.delete(uploadId);
  }
});

// POST /api/drop/upload - upload a drop file
router.post('/upload', diskSpaceGuard, dropSizeLimit, (req, res, next) => {
  const uploader = req.isAdmin ? upload : uploadGuest;
  uploader.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Guest limit is 50MB.' });
      }
      return res.status(400).json({ error: 'Upload failed' });
    }
    next();
  });
}, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const token = path.basename(req.file.filename, path.extname(req.file.filename));
    const createdAt = new Date().toISOString();
    const relativePath = path.relative(DATA_DIR, req.file.path);
    const sessionId = req.isAdmin ? 'admin' : (req.body.sessionId || null);

    let expiresAt = null;
    if (!req.isAdmin) {
      expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    }

    const rawPassword = (req.body.password || '').trim();
    const password = rawPassword ? hashPassword(rawPassword) : null;

    statements.createDrop.run(token, req.file.originalname, relativePath, req.file.size, createdAt, expiresAt, sessionId, password);

    if (sessionId && !req.isAdmin) {
      try { statements.addSessionUsage.run(sessionId, req.file.size, req.file.size); } catch (e) {}
    }

    const protocol = req.protocol;
    const host = req.get('host');
    const url = `${protocol}://${host}/d/${token}`;

    res.json({ token, url, hasPassword: !!password });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/drop/list - list drops (filtered by session)
router.get('/list', (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    const all = req.query.all === 'true';
    let drops;
    if (all && req.isAdmin) {
      drops = statements.getAllDrops.all();
    } else if (sessionId) {
      drops = statements.getDropsBySession.all(sessionId);
    } else {
      drops = [];
    }
    const safe = drops.map(d => {
      const { password, ...rest } = d;
      return { ...rest, hasPassword: !!password };
    });
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/drop/:token - admin-only delete
router.delete('/:token', (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { token } = req.params;
    const drop = statements.getDrop.get(token);
    if (drop && drop.path) {
      const fullPath = safePath(DATA_DIR, drop.path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    statements.deleteDrop.run(token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/drop/:token/download - download file (no password support — redirect or block)
router.get('/:token/download', (req, res) => {
  try {
    const { token } = req.params;
    const drop = statements.getDrop.get(token);

    if (!drop) {
      return res.status(404).json({ error: 'Drop not found' });
    }

    if (drop.deleted) {
      return res.status(410).json({ error: 'This file has expired and is no longer available.' });
    }

    if (drop.expiresAt && new Date(drop.expiresAt) < new Date()) {
      statements.expireDrop.run(token);
      return res.status(410).json({ error: 'This file has expired and is no longer available.' });
    }

    if (drop.password && !req.isAdmin) {
      return res.status(403).json({ error: 'Password required', requiresPassword: true });
    }

    const filePath = safePath(DATA_DIR, drop.path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    statements.incrementDownloads.run(token);
    setContentDisposition(res, drop.filename);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(filePath, drop.filename);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/drop/:token/download - download file with password
router.post('/:token/download', express.json(), (req, res) => {
  try {
    const { token } = req.params;
    const drop = statements.getDrop.get(token);

    if (!drop) {
      return res.status(404).json({ error: 'Drop not found' });
    }

    if (drop.deleted) {
      return res.status(410).json({ error: 'This file has expired and is no longer available.' });
    }

    if (drop.expiresAt && new Date(drop.expiresAt) < new Date()) {
      statements.expireDrop.run(token);
      return res.status(410).json({ error: 'This file has expired and is no longer available.' });
    }

    if (!drop.password) {
      return res.status(400).json({ error: 'This file does not require a password' });
    }

    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    if (!verifyPassword(password, drop.password)) {
      return res.status(403).json({ error: 'Wrong password' });
    }

    const filePath = safePath(DATA_DIR, drop.path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    statements.incrementDownloads.run(token);
    setContentDisposition(res, drop.filename);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(filePath, drop.filename);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/drop/:token/info - get file info for preview
router.get('/:token/info', (req, res) => {
  try {
    const { token } = req.params;
    const drop = statements.getDrop.get(token);

    if (!drop) {
      return res.status(404).json({ error: 'Drop not found' });
    }

    if (drop.deleted) {
      return res.status(410).json({ error: 'This file has expired and is no longer available.' });
    }

    if (drop.expiresAt && new Date(drop.expiresAt) < new Date()) {
      statements.expireDrop.run(token);
      return res.status(410).json({ error: 'This file has expired and is no longer available.' });
    }

    res.json({
      token: drop.token,
      filename: drop.filename,
      size: drop.size,
      downloads: drop.downloads,
      createdAt: drop.createdAt,
      expiresAt: drop.expiresAt,
      deleted: drop.deleted,
      hasPassword: !!drop.password
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router };
