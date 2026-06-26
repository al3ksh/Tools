const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { statements, DATA_DIR } = require('../db/database');
const { heavyWorkLimit } = require('../lib/heavyWork');
const { clampNumber, createDiskSpaceGuard } = require('./utils');

const gifRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many GIF processing requests. Please try again in a minute.' },
});

const gifTempDir = path.join(DATA_DIR, 'uploads', 'gif-temp');
if (!fs.existsSync(gifTempDir)) {
  fs.mkdirSync(gifTempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(gifTempDir, { recursive: true });
    cb(null, gifTempDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});
const uploadGuest = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});
const diskSpaceGuard = createDiskSpaceGuard({ dataDir: DATA_DIR, minFreeBytes: 512 * 1024 * 1024 });

function cleanupFiles(files) {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch (e) {
      // Ignore cleanup failures.
    }
  }
}

function runFfprobe(inputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      inputPath,
    ];

    const ffprobe = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ffprobe.kill('SIGKILL');
        reject(new Error('ffprobe timed out'));
      }
    }, 30000);

    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${stderr}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Invalid ffprobe output: ${e.message}`));
      }
    });

    ffprobe.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

function isStaticImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif'].includes(ext);
}

// POST /api/gif/info - get media metadata for GIF/video input
router.post('/info', gifRateLimit, heavyWorkLimit, diskSpaceGuard, (req, res, next) => {
  const uploader = req.isAdmin ? upload : uploadGuest;
  uploader.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Guest limit is 100MB.' });
      }
      return res.status(400).json({ error: 'Upload failed' });
    }
    next();
  });
}, async (req, res) => {
  const tempFiles = [];

  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    tempFiles.push(req.file.path);

    const data = await runFfprobe(req.file.path);
    const videoStream = (data.streams || []).find((s) => s.codec_type === 'video') || {};
    const format = data.format || {};

    let fps = null;
    if (videoStream.avg_frame_rate && videoStream.avg_frame_rate !== '0/0') {
      const [n, d] = videoStream.avg_frame_rate.split('/').map(Number);
      if (n && d) fps = n / d;
    }

    res.json({
      duration: format.duration ? Number(format.duration) : null,
      width: videoStream.width || null,
      height: videoStream.height || null,
      fps: fps ? Number(fps.toFixed(2)) : null,
      codec: videoStream.codec_name || null,
      format: format.format_name || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    cleanupFiles(tempFiles);
  }
});

// POST /api/gif/process - create/edit GIF from uploaded video or GIF
router.post('/process', gifRateLimit, diskSpaceGuard, (req, res, next) => {
  const uploader = req.isAdmin ? upload : uploadGuest;
  uploader.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Guest limit is 100MB.' });
      }
      return res.status(400).json({ error: 'Upload failed' });
    }
    next();
  });
}, (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const fps = clampNumber(req.body.fps, 5, 30, 15);
    const widthRaw = clampNumber(req.body.width, 120, 1080, 480);
    const width = widthRaw % 2 === 0 ? widthRaw : widthRaw + 1;
    const speed = clampNumber(req.body.speed, 0.25, 4, 1);
    const loop = clampNumber(req.body.loop, 0, 10, 0);
    const reverse = String(req.body.reverse) === 'true';
    const preview = String(req.body.preview) === 'true';
    const staticImage = isStaticImage(req.file.path);

    const startSec = req.body.startSec !== undefined ? Number(req.body.startSec) : null;
    const endSec = req.body.endSec !== undefined ? Number(req.body.endSec) : null;

    const sessionId = req.isAdmin ? 'admin' : req.body.sessionId;
    const jobId = uuidv4();
    const createdAt = new Date().toISOString();
    const inputJson = JSON.stringify({
      files: [{
        path: path.relative(DATA_DIR, req.file.path),
        originalName: req.file.originalname,
        size: req.file.size
      }],
      options: {
        fps,
        width,
        speed,
        loop,
        reverse,
        preview,
        staticImage,
        startSec: Number.isNaN(startSec) ? null : startSec,
        endSec: Number.isNaN(endSec) ? null : endSec
      },
      isAdmin: req.isAdmin
    });

    statements.createJob.run(jobId, 'gif', createdAt, inputJson, sessionId || null);
    res.json({ jobId });
  } catch (err) {
    if (req.file) cleanupFiles([req.file.path]);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }

  if (err) {
    return res.status(400).json({ error: err.message });
  }

  next();
});

module.exports = router;
