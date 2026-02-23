const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { statements, DATA_DIR } = require('../db/database');

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

const upload = multer({ storage });

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
router.post('/upload', converterSizeLimit, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const relativePath = path.relative(DATA_DIR, req.file.path);
    res.json({ path: relativePath, filename: req.file.originalname });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/converter - create a conversion job
router.post('/', (req, res) => {
  try {
    const { source, options, sessionId } = req.body;

    if (!source || !source.type) {
      return res.status(400).json({ error: 'Source type is required' });
    }

    if (!options || !options.format) {
      return res.status(400).json({ error: 'Output format is required' });
    }

    const validFormats = ['mp3', 'wav', 'flac', 'opus'];
    if (!validFormats.includes(options.format)) {
      return res.status(400).json({ error: `Invalid format. Use: ${validFormats.join(', ')}` });
    }

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
        audioBitrate: options.audioBitrate || '192',
        trim: {
          startSec: options.startTime || undefined,
          endSec: options.endTime || undefined
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
