const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { statements, DATA_DIR } = require('../db/database');

// Configure multer for drops
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

// Size limit middleware — unlimited for admin, 50MB for guests
const dropSizeLimit = (req, res, next) => {
  if (req.isAdmin) return next(); // no limit
  const MAX_GUEST = 50 * 1024 * 1024;
  if (req.headers['content-length'] && parseInt(req.headers['content-length']) > MAX_GUEST) {
    return res.status(413).json({ error: `File too large. Guest limit is 50MB.` });
  }
  next();
};

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

    statements.createDrop.run(token, req.file.originalname, relativePath, req.file.size, createdAt, expiresAt, sessionId);

    const protocol = req.protocol;
    const host = req.get('host');
    const url = `${protocol}://${host}/d/${token}`;

    res.json({ token, url });
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
    res.json(drops);
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
      const fs = require('fs');
      const fullPath = require('path').join(require('../db/database').DATA_DIR, drop.path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    statements.deleteDrop.run(token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download handler - exported separately
const downloadHandler = (req, res) => {
  try {
    const { token } = req.params;
    const drop = statements.getDrop.get(token);

    if (!drop) {
      return res.status(404).json({ error: 'Drop not found' });
    }

    if (drop.deleted) {
      return res.status(410).json({ error: 'This file has expired and is no longer available.' });
    }

    const filePath = path.join(DATA_DIR, drop.path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    statements.incrementDownloads.run(token);
    res.download(filePath, drop.filename);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/drop/:token/download - download file
router.get('/:token/download', downloadHandler);

// GET /api/drop/:token/info - get file info for preview
router.get('/:token/info', (req, res) => {
  try {
    const { token } = req.params;
    const drop = statements.getDrop.get(token);

    if (!drop) {
      return res.status(404).json({ error: 'Drop not found' });
    }

    res.json(drop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router };
