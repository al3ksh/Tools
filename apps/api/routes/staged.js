const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../db/database');
const { safePath, createDiskSpaceGuard } = require('./utils');
const { createChunkReceiver, getUploadOwner, sameUploadOwner, UPLOAD_ID_RE } = require('./chunks');

// Staged uploads: files too large for one request through Cloudflare (100 MB)
// arrive in chunks, then a tool request names them instead of carrying them.
// A staged file serves exactly one job, like a file sent with the request.
const uploadsDir = path.join(DATA_DIR, 'uploads');
const stagingDir = path.join(uploadsDir, 'staged-temp');
const MAX_GUEST_BYTES = 500 * 1024 * 1024;
const MAX_ADMIN_BYTES = 5 * 1024 * 1024 * 1024;
const MIN_FREE_BYTES = 512 * 1024 * 1024;

const staged = createChunkReceiver({
  tempDir: stagingDir,
  getLimit: (req) => (req.isAdmin ? MAX_ADMIN_BYTES : MAX_GUEST_BYTES),
  limitError: (req) => (req.isAdmin ? 'File too large. Admin limit is 5GB.' : 'File too large. Guest limit is 500MB.'),
  minFreeBytes: MIN_FREE_BYTES,
});
const diskSpaceGuard = createDiskSpaceGuard({ dataDir: DATA_DIR, minFreeBytes: MIN_FREE_BYTES });

// POST /api/upload/chunk
router.post('/chunk', diskSpaceGuard, staged.receive);

// POST /api/upload/finalize - moves the file next to regular uploads.
// Returns the same { path, filename } as POST /api/upload/upload.
router.post('/finalize', (req, res) => {
  const { uploadId, filename, type, sessionId } = req.body || {};
  try {
    const result = staged.complete(req, uploadId, sessionId, (meta, partPath) => {
      if (meta.finalizedAt) {
        return { response: { uploadId, path: meta.path, filename: meta.originalName, size: meta.total } };
      }
      if (!filename || typeof filename !== 'string') return { error: 'Filename is required' };
      const originalName = path.basename(filename.replace(/\\/g, '/')).trim().slice(0, 255);
      if (!originalName) return { error: 'Filename is required' };

      const extension = path.extname(originalName).slice(0, 16).replace(/[^a-zA-Z0-9.]/g, '');
      const dayDir = path.join(uploadsDir, new Date().toISOString().split('T')[0]);
      fs.mkdirSync(dayDir, { recursive: true });
      const storedName = `${Date.now()}-${crypto.randomUUID().replace(/-/g, '').slice(0, 9)}${extension}`;
      const finalPath = safePath(dayDir, storedName);
      fs.renameSync(partPath, finalPath);

      const relativePath = path.relative(DATA_DIR, finalPath).split(path.sep).join('/');
      const mimetype = typeof type === 'string' ? type.slice(0, 100) : '';
      return {
        meta: { path: relativePath, originalName, mimetype },
        response: { uploadId, path: relativePath, filename: originalName, size: meta.total },
      };
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('Staged finalize failed:', err.message);
    res.status(500).json({ error: 'Failed to finalize upload' });
  }
});

// Route middleware, placed after the route's multer uploader: when the
// request names staged uploads (form field `staged`, a JSON array of upload
// ids) instead of carrying files, present them as multer would, so the route
// handles both the same way. `maxBytes(req)` caps the total size.
function attachStaged({ multiple = false, maxBytes, accepts = () => true }) {
  return (req, res, next) => {
    const hasFiles = multiple ? req.files && req.files.length > 0 : !!req.file;
    const raw = req.body && req.body.staged;
    if (hasFiles || !raw) return next();

    let ids;
    try {
      ids = JSON.parse(raw);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid staged upload list' });
    }
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || (!multiple && ids.length !== 1)
      || !ids.every((id) => typeof id === 'string' && UPLOAD_ID_RE.test(id))) {
      return res.status(400).json({ error: 'Invalid staged upload list' });
    }

    const owner = getUploadOwner(req, req.body.sessionId);
    if (!owner) return res.status(400).json({ error: 'Missing session id' });

    const files = [];
    for (const id of ids) {
      const { metaPath } = staged.paths(id);
      const meta = staged.readMeta(metaPath);
      if (!meta || !meta.finalizedAt || !meta.path) return res.status(400).json({ error: 'Upload not found or expired. Choose the file again.' });
      if (!sameUploadOwner(meta, req, owner)) return res.status(403).json({ error: 'Upload belongs to another session' });
      const filePath = safePath(DATA_DIR, meta.path);
      if (!fs.existsSync(filePath)) return res.status(400).json({ error: 'Upload not found or expired. Choose the file again.' });
      const file = {
        fieldname: 'staged',
        originalname: meta.originalName,
        mimetype: meta.mimetype || '',
        path: filePath,
        size: meta.total,
      };
      if (!accepts(file)) return res.status(400).json({ error: `Unsupported file type: ${meta.originalName}` });
      files.push({ file, metaPath });
    }

    const total = files.reduce((sum, entry) => sum + entry.file.size, 0);
    const limit = maxBytes(req);
    if (total > limit) {
      return res.status(413).json({ error: `File too large. Limit is ${Math.round(limit / 1024 / 1024)}MB.` });
    }

    // One job per staged file: forget the reference now; the job owns the file.
    for (const entry of files) {
      try { fs.unlinkSync(entry.metaPath); } catch (e) {}
    }
    if (multiple) req.files = files.map((entry) => entry.file);
    else req.file = files[0].file;
    next();
  };
}

module.exports = { router, attachStaged };
