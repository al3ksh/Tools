const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { statements, DATA_DIR } = require('../db/database');

function setContentDisposition(res, filename) {
  const encoded = encodeURIComponent(filename).replace(/['()]/g, escape);
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`);
}

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

const dropSizeLimit = (req, res, next) => {
  if (req.isAdmin) return next();
  const MAX_GUEST = 50 * 1024 * 1024;
  if (req.headers['content-length'] && parseInt(req.headers['content-length']) > MAX_GUEST) {
    return res.status(413).json({ error: `File too large. Guest limit is 50MB.` });
  }
  next();
};

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
router.post('/upload', dropSizeLimit, upload.single('file'), (req, res) => {
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

    const protocol = req.protocol;
    const host = req.get('host');
    const url = `${protocol}://${host}/d/${token}`;

    res.json({ token, url, hasPassword: !!password });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
      const fullPath = path.join(DATA_DIR, drop.path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    statements.deleteDrop.run(token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    if (drop.password && !req.isAdmin) {
      return res.status(403).json({ error: 'Password required', requiresPassword: true });
    }

    const filePath = path.join(DATA_DIR, drop.path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    statements.incrementDownloads.run(token);
    setContentDisposition(res, drop.filename);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(filePath, drop.filename);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    const filePath = path.join(DATA_DIR, drop.path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    statements.incrementDownloads.run(token);
    setContentDisposition(res, drop.filename);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(filePath, drop.filename);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router };
