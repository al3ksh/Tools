const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { statements, DATA_DIR } = require('../db/database');
const { clampNumber, checkJobLimit, createDiskSpaceGuard } = require('./utils');

const router = express.Router();
const compressTempDir = path.join(DATA_DIR, 'uploads', 'compress-temp');
if (!fs.existsSync(compressTempDir)) {
  fs.mkdirSync(compressTempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(compressTempDir, { recursive: true });
    cb(null, compressTempDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 * 1024 } });
const uploadGuest = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });
const diskSpaceGuard = createDiskSpaceGuard({ dataDir: DATA_DIR, minFreeBytes: 512 * 1024 * 1024 });

function cleanupFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {}
}

function getFileKind(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = file.mimetype || '';
  if (mime.startsWith('video/') || ['.mp4', '.webm', '.mov', '.mkv', '.avi'].includes(ext)) return 'video';
  if (mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'].includes(ext)) return 'image';
  return null;
}

function getOutputFormat(kind, requested) {
  if (kind === 'video') {
    if (['mp4', 'webm'].includes(requested)) return requested;
    return 'mp4';
  }
  if (['jpg', 'jpeg', 'png', 'webp'].includes(requested)) return requested === 'jpeg' ? 'jpg' : requested;
  return 'webp';
}

router.post('/', diskSpaceGuard, (req, res, next) => {
  const uploader = req.isAdmin ? upload : uploadGuest;
  uploader.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Guest limit is 500MB.' });
      }
      return res.status(400).json({ error: 'Upload failed' });
    }
    next();
  });
}, (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const kind = getFileKind(req.file);
    if (!kind) {
      cleanupFile(req.file.path);
      return res.status(400).json({ error: 'Unsupported file type. Use a video or image file.' });
    }

    const sessionId = req.body.sessionId || null;
    checkJobLimit(sessionId, req.isAdmin);

    const quality = clampNumber(req.body.quality, 1, 100, kind === 'video' ? 65 : 75);
    const targetMB = clampNumber(req.body.targetMB, 0, req.isAdmin ? 2048 : 500, 0);
    const maxWidth = clampNumber(req.body.maxWidth, 0, 3840, kind === 'video' ? 1280 : 1920);
    const format = getOutputFormat(kind, req.body.format);
    const jobId = uuidv4();
    const createdAt = new Date().toISOString();
    const relativePath = path.relative(DATA_DIR, req.file.path);
    const inputJson = JSON.stringify({
      file: {
        path: relativePath,
        originalName: req.file.originalname,
        size: req.file.size,
        kind
      },
      options: {
        kind,
        format,
        quality,
        targetMB,
        maxWidth,
        stripAudio: req.body.stripAudio === 'true' || req.body.stripAudio === true
      },
      sessionId,
      isAdmin: req.isAdmin
    });

    statements.createJob.run(jobId, 'compress', createdAt, inputJson, sessionId);
    res.json({ jobId });
  } catch (err) {
    cleanupFile(req.file && req.file.path);
    const isRateLimit = err.message && (err.message.includes('queue') || err.message.includes('Too many'));
    res.status(isRateLimit ? 429 : 500).json({ error: isRateLimit ? err.message : 'Internal server error' });
  }
});

module.exports = router;
