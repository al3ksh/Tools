const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { statements, DATA_DIR } = require('../db/database');
const { safePath, setContentDisposition, createGuestSizeLimit } = require('./utils');

const dropsDir = path.join(DATA_DIR, 'drops');
if (!fs.existsSync(dropsDir)) {
  fs.mkdirSync(dropsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
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

// POST /api/drop/upload - upload a drop file
router.post('/upload', dropSizeLimit, (req, res, next) => {
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
    const sessionId = req.body.sessionId || null;

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
