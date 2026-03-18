const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { DATA_DIR } = require('../db/database');

const gifTempDir = path.join(DATA_DIR, 'uploads', 'gif-temp');
if (!fs.existsSync(gifTempDir)) {
  fs.mkdirSync(gifTempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, gifTempDir),
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
});

function cleanupFiles(files) {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch (e) {
      // Ignore cleanup failures.
    }
  }
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

function runProcess(command, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-2000)}`));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
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

    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffprobe.on('close', (code) => {
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

    ffprobe.on('error', (err) => reject(err));
  });
}

function isStaticImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif'].includes(ext);
}

function buildFilterChain({ fps, width, speed, reverse }) {
  const filters = [];

  if (speed !== 1) {
    filters.push(`setpts=PTS/${speed}`);
  }

  if (reverse) {
    filters.push('reverse');
  }

  filters.push(`fps=${fps}`);
  filters.push(`scale=${width}:-1:flags=lanczos`);

  return filters.join(',');
}

// POST /api/gif/info - get media metadata for GIF/video input
router.post('/info', upload.single('file'), async (req, res) => {
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
    res.status(500).json({ error: err.message });
  } finally {
    cleanupFiles(tempFiles);
  }
});

// POST /api/gif/process - create/edit GIF from uploaded video or GIF
router.post('/process', upload.single('file'), async (req, res) => {
  const tempFiles = [];

  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    tempFiles.push(req.file.path);

    const fps = clampNumber(req.body.fps, 5, 30, 15);
    const widthRaw = clampNumber(req.body.width, 120, 1080, 480);
    const width = widthRaw % 2 === 0 ? widthRaw : widthRaw + 1;
    const speed = clampNumber(req.body.speed, 0.25, 4, 1);
    const loop = clampNumber(req.body.loop, 0, 10, 0);
    const reverse = String(req.body.reverse) === 'true';
    const preview = String(req.body.preview) === 'true';
    const staticImage = isStaticImage(req.file.path);

    const finalFps = preview ? Math.min(fps, 12) : fps;
    const finalWidth = preview ? Math.min(width, 360) : width;

    const startSec = req.body.startSec !== undefined ? Number(req.body.startSec) : null;
    const endSec = req.body.endSec !== undefined ? Number(req.body.endSec) : null;

    const outputPath = path.join(gifTempDir, `${uuidv4()}.gif`);
    tempFiles.push(outputPath);

    const scaleFilter = `scale=${finalWidth}:-1:flags=lanczos`;
    const paletteFilter = `${scaleFilter},split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`;

    let ffmpegArgs = ['-y'];

    if (staticImage) {
      ffmpegArgs.push('-i', req.file.path);
      ffmpegArgs.push('-vf', paletteFilter);
      ffmpegArgs.push('-loop', '0');
      ffmpegArgs.push('-an', outputPath);
    } else {
      const chain = buildFilterChain({
        fps: finalFps,
        width: finalWidth,
        speed,
        reverse,
      });

      if (!Number.isNaN(startSec) && startSec !== null && startSec >= 0) {
        ffmpegArgs.push('-ss', String(startSec));
      }

      if (!Number.isNaN(endSec) && endSec !== null && endSec > 0) {
        ffmpegArgs.push('-to', String(endSec));
      }

      ffmpegArgs.push('-i', req.file.path);
      ffmpegArgs.push('-filter_complex', `[0:v]${chain},split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`);
      ffmpegArgs.push('-loop', String(loop));
      ffmpegArgs.push('-an', outputPath);
    }

    await runProcess('ffmpeg', ffmpegArgs);

    const stat = fs.statSync(outputPath);

    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Disposition', `attachment; filename="${preview ? 'preview' : 'output'}.gif"`);
    res.setHeader('X-Output-Size', String(stat.size));
    res.send(fs.readFileSync(outputPath));
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    cleanupFiles(tempFiles);
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
