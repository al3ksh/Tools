const fs = require('fs');
const { pipeline } = require('stream');
const { safePath } = require('./utils');

// Resumable chunked uploads. The browser sends a file as ordered
// Content-Range slices under one upload id; each request stays far below
// Cloudflare's 100 MB request limit. A retried or duplicate slice is harmless,
// and nothing is published until the route's own finalize step.
const UPLOAD_ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;
const DEFAULT_MAX_CHUNK_BYTES = 25 * 1024 * 1024;

function getUploadOwner(req, sessionId) {
  if (req.isAdmin) return 'admin';
  const owner = String(sessionId || '').trim();
  if (!owner || owner.length > 128) return null;
  return owner;
}

function sameUploadOwner(meta, req, owner) {
  return meta.owner === owner && meta.isAdmin === !!req.isAdmin;
}

function createChunkReceiver({
  tempDir,
  getLimit,
  limitError,
  minFreeBytes,
  maxChunkBytes = DEFAULT_MAX_CHUNK_BYTES,
  createMeta = () => ({}),
  isValidMeta = () => true,
}) {
  fs.mkdirSync(tempDir, { recursive: true });
  const activeUploads = new Set();

  function paths(uploadId) {
    return {
      partPath: safePath(tempDir, `${uploadId}.part`),
      metaPath: safePath(tempDir, `${uploadId}.json`),
    };
  }

  function readMeta(metaPath) {
    if (!fs.existsSync(metaPath)) return null;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (!Number.isSafeInteger(meta.total) || meta.total <= 0 || !meta.owner || !isValidMeta(meta)) return null;
      return meta;
    } catch (e) {
      return null;
    }
  }

  function writeMeta(metaPath, meta) {
    const tempPath = `${metaPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(meta));
    fs.renameSync(tempPath, metaPath);
  }

  function ensureEnoughSpace(total) {
    const stat = fs.statfsSync(tempDir);
    return stat.bavail * stat.bsize >= minFreeBytes + total;
  }

  function receive(req, res) {
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
        uploadId = null;
        return res.status(400).json({ error: 'Invalid upload id' });
      }

      const owner = getUploadOwner(req, req.headers['x-session-id']);
      if (!owner) {
        uploadId = null;
        return res.status(400).json({ error: 'Missing session id' });
      }

      const contentRange = req.headers['content-range'];
      const match = contentRange && contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (!match) {
        uploadId = null;
        return res.status(400).json({ error: 'Invalid Content-Range header' });
      }

      const start = Number(match[1]);
      const end = Number(match[2]);
      const total = Number(match[3]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total)
        || start < 0 || end < start || end >= total || total <= 0) {
        uploadId = null;
        return res.status(400).json({ error: 'Invalid Content-Range values' });
      }

      if (total > getLimit(req)) {
        uploadId = null;
        return res.status(413).json({ error: limitError(req) });
      }

      const chunkSize = end - start + 1;
      if (chunkSize > maxChunkBytes) {
        uploadId = null;
        return res.status(413).json({ error: `Chunk too large. Maximum chunk size is ${Math.round(maxChunkBytes / 1024 / 1024)}MB.` });
      }

      const contentLength = Number(req.headers['content-length']);
      if (!Number.isSafeInteger(contentLength) || contentLength !== chunkSize) {
        uploadId = null;
        return res.status(400).json({ error: 'Content-Length does not match Content-Range' });
      }

      if (activeUploads.has(uploadId)) {
        uploadId = null;
        return res.status(409).json({ error: 'This upload is already receiving a chunk. Retry shortly.' });
      }
      activeUploads.add(uploadId);

      const { partPath, metaPath } = paths(uploadId);
      let meta = readMeta(metaPath);
      if (!meta) {
        if (start !== 0) return fail(409, 'Upload must restart from the first chunk');
        if (!ensureEnoughSpace(total)) return fail(507, 'Insufficient disk space for this file');
        const now = new Date().toISOString();
        meta = { uploadId, total, owner, isAdmin: !!req.isAdmin, createdAt: now, updatedAt: now, ...createMeta(req) };
        writeMeta(metaPath, meta);
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

      tempChunkPath = safePath(tempDir, `${uploadId}.${start}-${end}.tmp`);
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
            writeMeta(metaPath, meta);
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
      console.error('Chunk upload failed:', err.message);
      fail(500, 'Internal server error');
    }
  }

  // Runs `publish(meta, partPath)` for a fully received upload, once. Returns
  // { status, body } for the response; publish returns the success body.
  function complete(req, uploadId, sessionId, publish) {
    if (!uploadId || !UPLOAD_ID_RE.test(uploadId)) return { status: 400, body: { error: 'Invalid upload id' } };
    const owner = getUploadOwner(req, sessionId);
    if (!owner) return { status: 400, body: { error: 'Missing session id' } };
    if (activeUploads.has(uploadId)) {
      return { status: 409, body: { error: 'Upload is still receiving data. Retry shortly.' } };
    }

    activeUploads.add(uploadId);
    try {
      const { partPath, metaPath } = paths(uploadId);
      const meta = readMeta(metaPath);
      if (!meta) return { status: 400, body: { error: 'Upload not found or expired' } };
      if (!sameUploadOwner(meta, req, owner)) return { status: 403, body: { error: 'Upload belongs to another session' } };
      if (!meta.finalizedAt && (!fs.existsSync(partPath) || fs.statSync(partPath).size !== meta.total)) {
        return { status: 409, body: { error: 'Upload is incomplete. Retry the missing chunk.' } };
      }
      const body = publish(meta, partPath, owner);
      if (body && body.error) return { status: body.status || 400, body: { error: body.error } };
      if (!meta.finalizedAt) {
        meta.finalizedAt = new Date().toISOString();
        meta.updatedAt = meta.finalizedAt;
        Object.assign(meta, body && body.meta);
        writeMeta(metaPath, meta);
      }
      return { status: 200, body: body.response };
    } finally {
      activeUploads.delete(uploadId);
    }
  }

  return { receive, complete, paths, readMeta, writeMeta };
}

module.exports = { createChunkReceiver, getUploadOwner, sameUploadOwner, UPLOAD_ID_RE };
