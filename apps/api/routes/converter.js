const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { statements, DATA_DIR } = require('../db/database');

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

const MAX_ACTIVE_JOBS = 10;

function checkJobLimit(sessionId, isAdmin) {
  if (isAdmin) return;
  const total = statements.countActiveJobsTotal.get().count;
  if (total >= 50) throw new Error('Server queue is full. Please try again later.');
  if (sessionId) {
    const userCount = statements.countActiveJobsBySession.get(sessionId).count;
    if (userCount >= MAX_ACTIVE_JOBS) throw new Error('Too many active jobs. Please wait for current jobs to finish.');
  }
}

// Configure multer for uploads
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subDir = path.join(uploadsDir, new Date().toISOString().split('T')[0]);
    if (!fs.existsSync(subDir)) {
      fs.mkdirSync(subDir, { recursive: true });
    }
    cb(null, subDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 * 1024 } });
const uploadGuest = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

// Size limit middleware — unlimited for admin, 500MB for guests
const converterSizeLimit = (req, res, next) => {
  if (req.isAdmin) return next();
  const MAX_GUEST = 500 * 1024 * 1024;
  if (req.headers['content-length'] && parseInt(req.headers['content-length']) > MAX_GUEST) {
    return res.status(413).json({ error: `File too large. Guest limit is 500MB.` });
  }
  next();
};

// POST /api/upload - upload a file
router.post('/upload', converterSizeLimit, (req, res, next) => {
  const uploader = req.isAdmin ? upload : uploadGuest;
  uploader.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `File too large. Guest limit is 500MB.` });
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

    const relativePath = path.relative(DATA_DIR, req.file.path);
    res.json({ path: relativePath, filename: req.file.originalname });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/converter - create a conversion job
router.post('/', (req, res) => {
  try {
    const { source, options, sessionId } = req.body;

    if (!source || !source.type) {
      return res.status(400).json({ error: 'Source type is required' });
    }

    if (source.type !== 'upload' && source.type !== 'path') {
      return res.status(400).json({ error: 'Invalid source type' });
    }

    if (!source.path || typeof source.path !== 'string') {
      return res.status(400).json({ error: 'Source path is required' });
    }

    if (!source.path.startsWith('uploads/') && !source.path.startsWith('downloads/')) {
      return res.status(400).json({ error: 'Invalid source path' });
    }

    if (source.path.includes('..')) {
      return res.status(400).json({ error: 'Invalid source path' });
    }

    if (!options || !options.format) {
      return res.status(400).json({ error: 'Output format is required' });
    }

    const validFormats = ['mp3', 'wav', 'flac', 'opus'];
    if (!validFormats.includes(options.format)) {
      return res.status(400).json({ error: `Invalid format. Use: ${validFormats.join(', ')}` });
    }

    checkJobLimit(sessionId, req.isAdmin);

    const jobId = uuidv4();
    const createdAt = new Date().toISOString();
    const inputJson = JSON.stringify({
      source: {
        ...source,
        originalName: source.originalName || req.body.source.originalName || 'uploaded_file'
      },
      originalName: source.originalName || req.body.source.originalName || 'uploaded_file',
      options: {
        format: options.format,
        audioBitrate: clampNumber(options.audioBitrate, 64, 320, 192),
        trim: {
          startSec: options.startTime != null ? Number(options.startTime) : undefined,
          endSec: options.endTime != null ? Number(options.endTime) : undefined
        },
        normalize: {
          enabled: options.preset !== 'none',
          targetLufs: options.preset === 'quiet' ? -16 :
            options.preset === 'medium' ? -14 :
              options.preset === 'loud' ? -12 :
                options.preset === 'very-loud' ? -10 : -14
        }
      },
      sessionId,
      isAdmin: req.isAdmin
    });

    statements.createJob.run(jobId, 'convert', createdAt, inputJson, sessionId || null);

    res.json({ jobId });
  } catch (err) {
    const isValidation = err.message && (err.message.includes('queue') || err.message.includes('Too many'));
    res.status(isValidation ? 429 : 500).json({ error: isValidation ? err.message : 'Internal server error' });
  }
});

module.exports = router;
