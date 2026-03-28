const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const { statements, DATA_DIR } = require('../db/database');
const { safePath } = require('./utils');
const rateLimit = require('express-rate-limit');

const CLIPS_DIR = path.join(DATA_DIR, 'clips');
const CHUNKS_DIR = path.join(DATA_DIR, 'clips-temp');

if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });
if (!fs.existsSync(CHUNKS_DIR)) fs.mkdirSync(CHUNKS_DIR, { recursive: true });

const MAX_GUEST = 200 * 1024 * 1024;
const MAX_ADMIN = 5 * 1024 * 1024 * 1024;

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
};

const uploadSizes = new Map();
setInterval(() => {
  if (uploadSizes.size > 1000) uploadSizes.clear();
}, 60 * 60 * 1000);

const chunkRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload requests. Please slow down.' },
});

router.post('/upload-chunk', chunkRateLimit, (req, res) => {
  try {
    const uploadId = req.headers['x-upload-id'];
    if (!uploadId) return res.status(400).json({ error: 'Missing X-Upload-Id header' });

    const contentRange = req.headers['content-range'];
    if (!contentRange) return res.status(400).json({ error: 'Missing Content-Range header' });

    const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!match) return res.status(400).json({ error: 'Invalid Content-Range format' });

    const start = parseInt(match[1]);
    const end = parseInt(match[2]);
    const total = parseInt(match[3]);

    if (!req.isAdmin && total > MAX_GUEST) {
      return res.status(413).json({ error: `File too large. Guest limit is 200MB.` });
    }

    const chunkSize = end - start + 1;
    const currentTotal = uploadSizes.get(uploadId) || 0;
    const newTotal = currentTotal + chunkSize;
    if (!req.isAdmin && newTotal > MAX_GUEST) {
      return res.status(413).json({ error: `File too large. Guest limit is 200MB.` });
    }
    uploadSizes.set(uploadId, newTotal);

    const uploadDir = safePath(CHUNKS_DIR, uploadId);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const chunkPath = path.join(uploadDir, `${start}-${end}.chunk`);
    const writeStream = fs.createWriteStream(chunkPath);
    req.pipe(writeStream);

    writeStream.on('finish', () => {
      res.status(200).json({ received: end - start + 1 });
    });

    writeStream.on('error', () => {
      res.status(500).json({ error: 'Internal server error' });
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/finalize', (req, res) => {
  try {
    uploadSizes.delete(req.body.uploadId);

    const { uploadId, filename, sessionId, trimStart, trimEnd, duration } = req.body;

    if (!uploadId || !filename) {
      return res.status(400).json({ error: 'Missing uploadId or filename' });
    }

    const uploadDir = safePath(CHUNKS_DIR, uploadId);
    if (!fs.existsSync(uploadDir)) {
      return res.status(400).json({ error: 'Upload not found' });
    }

    const processingDir = uploadDir + '_processing';
    try {
      fs.renameSync(uploadDir, processingDir);
    } catch (e) {
      return res.status(409).json({ error: 'Upload already being processed' });
    }

    const token = uuidv4().substring(0, 12);
    const ext = path.extname(filename).toLowerCase() || '.mp4';
    const outputPath = path.join(CLIPS_DIR, `${token}${ext}`);
    const tempPath = path.join(CHUNKS_DIR, `${uploadId}_merged${ext}`);

    const chunks = fs.readdirSync(processingDir)
      .filter(f => f.endsWith('.chunk'))
      .sort((a, b) => {
        const aStart = parseInt(a.split('-')[0]);
        const bStart = parseInt(b.split('-')[0]);
        return aStart - bStart;
      });

    if (chunks.length === 0) {
      return res.status(400).json({ error: 'No chunks found' });
    }

    const writeStream = fs.createWriteStream(tempPath);
    writeStream.on('error', () => {
      res.status(500).json({ error: 'Internal server error' });
    });

    let merged = 0;
    function mergeNext() {
      if (merged >= chunks.length) {
        writeStream.end();
        return;
      }
      const chunkData = fs.readFileSync(path.join(processingDir, chunks[merged]));
      writeStream.write(chunkData, () => {
        merged++;
        mergeNext();
      });
    }
    mergeNext();

    writeStream.on('finish', () => {
      try {
        for (const chunkFile of chunks) {
          fs.unlinkSync(path.join(processingDir, chunkFile));
        }
        fs.rmdirSync(processingDir);
      } catch (e) { }

      const needsTrim = (trimStart != null && trimStart > 0) || (trimEnd != null && duration != null && trimEnd < duration);

      if (needsTrim) {
        const ss = trimStart || 0;
        const to = trimEnd || duration || null;

        const args = ['-y', '-i', tempPath];
        if (ss > 0) args.push('-ss', String(ss));
        if (to != null && to > ss) args.push('-to', String(to));
        args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero', outputPath);

        let responded = false;
        const ffmpeg = spawn('ffmpeg', args);
        ffmpeg.stderr.on('data', (data) => {
          console.log('[clip trim]', String(data).trim());
        });

        const trimTimeout = setTimeout(() => {
          ffmpeg.kill('SIGKILL');
        }, 10 * 60 * 1000);

        ffmpeg.on('close', (code, signal) => {
          clearTimeout(trimTimeout);
          try { fs.unlinkSync(tempPath); } catch (e) { }

          if (responded) return;

          if (signal === 'SIGKILL') {
            responded = true;
            return res.status(504).json({ error: 'Video trimming timed out' });
          }

          if (code !== 0 || !fs.existsSync(outputPath)) {
            responded = true;
            return res.status(500).json({ error: 'Video trimming failed' });
          }

          responded = true;
          const trimmedDuration = to != null ? to - ss : duration;
          finishClip(outputPath, token, ext, filename, sessionId, trimmedDuration, req, res);
        });

        ffmpeg.on('error', () => {
          clearTimeout(trimTimeout);
          try { fs.unlinkSync(tempPath); } catch (e) { }
          if (!responded) {
            responded = true;
            res.status(500).json({ error: 'FFmpeg not available' });
          }
        });
      } else {
        try {
          if (fs.existsSync(tempPath)) {
            fs.copyFileSync(tempPath, outputPath);
            fs.unlinkSync(tempPath);
          }
        } catch (e) {
          try { fs.unlinkSync(tempPath); } catch (e2) { }
          return res.status(500).json({ error: 'Failed to save clip' });
        }
        if (!fs.existsSync(outputPath)) {
          return res.status(500).json({ error: 'Clip file not created' });
        }
        finishClip(outputPath, token, ext, filename, sessionId, duration, req, res);
      }
    });
  } catch (err) {
    if (err.message === 'Invalid path') return res.status(400).json({ error: 'Invalid upload' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

function getVideoMeta(filePath) {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', filePath
    ]);
    let stdout = '';
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ffprobe.kill('SIGKILL');
        resolve(null);
      }
    }, 30000);

    ffprobe.stdout.on('data', (d) => { stdout += d; });
    ffprobe.on('close', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try {
        const data = JSON.parse(stdout);
        const video = (data.streams || []).find(s => s.codec_type === 'video');
        const audio = (data.streams || []).find(s => s.codec_type === 'audio');
        resolve({
          width: video ? video.width : null,
          height: video ? video.height : null,
          fps: video && video.r_frame_rate ? parseFloat(video.r_frame_rate) : null,
          bitrate: data.format && data.format.bit_rate ? parseInt(data.format.bit_rate) : null,
          videoCodec: video ? video.codec_name : null,
          audioCodec: audio ? audio.codec_name : null,
        });
      } catch (e) {
        resolve(null);
      }
    });
    ffprobe.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(null);
      }
    });
  });
}

async function finishClip(outputPath, token, ext, filename, sessionId, duration, req, res) {
  try {
    const meta = await getVideoMeta(outputPath);
    const stat = fs.statSync(outputPath);
    const createdAt = new Date().toISOString();
    let expiresAt = null;
    if (!req.isAdmin) {
      expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    }

    const actualDuration = duration || (meta && meta.duration) || 0;
    statements.createClip.run(
      token,
      filename,
      `clips/${token}${ext}`,
      stat.size,
      actualDuration ? parseFloat(actualDuration) : null,
      meta ? meta.width : null,
      meta ? meta.height : null,
      meta ? meta.fps : null,
      meta ? meta.bitrate : null,
      meta ? meta.videoCodec : null,
      meta ? meta.audioCodec : null,
      createdAt,
      expiresAt,
      sessionId || null
    );

    if (sessionId && !req.isAdmin) {
      try { statements.addSessionUsage.run(sessionId, stat.size, stat.size); } catch (e) {}
    }

    const protocol = req.protocol;
    const host = req.get('host');
    const url = `${protocol}://${host}/c/${token}`;

    res.json({ token, url, filename, size: stat.size, meta });
  } catch (err) {
    res.status(500).json({ error: 'Failed to finalize clip' });
  }
}

router.get('/:token/stream', (req, res) => {
  try {
    const { token } = req.params;
    const clip = statements.getClip.get(token);

    if (!clip || clip.deleted) return res.status(404).json({ error: 'Clip not found' });
    if (clip.expiresAt && new Date(clip.expiresAt) < new Date()) {
      statements.expireClip.run(token);
      return res.status(410).json({ error: 'This clip has expired' });
    }

    const viewCookie = `clip_viewed_${token}`;
    if (!req.cookies || !req.cookies[viewCookie]) {
      statements.incrementClipViews.run(token);
      res.cookie(viewCookie, '1', { maxAge: 3600, httpOnly: true });
    }

    const filePath = safePath(DATA_DIR, clip.path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'video/mp4';
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      });

      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      });

      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    if (err.message === 'Invalid path') return res.status(400).json({ error: 'Invalid token' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:token/info', (req, res) => {
  try {
    const { token } = req.params;
    const clip = statements.getClip.get(token);

    if (!clip || clip.deleted) return res.status(404).json({ error: 'Clip not found' });
    if (clip.expiresAt && new Date(clip.expiresAt) < new Date()) {
      statements.expireClip.run(token);
      return res.status(410).json({ error: 'This clip has expired' });
    }

    res.json({
      token: clip.token,
      filename: clip.filename,
      size: clip.size,
      duration: clip.duration,
      width: clip.width,
      height: clip.height,
      fps: clip.fps,
      bitrate: clip.bitrate,
      videoCodec: clip.videoCodec,
      audioCodec: clip.audioCodec,
      downloads: clip.downloads,
      createdAt: clip.createdAt,
      expiresAt: clip.expiresAt,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/list', (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    const all = req.query.all === 'true';

    if (all && req.isAdmin) {
      return res.json(statements.getAllClips.all());
    }

    if (sessionId) {
      return res.json(statements.getClipsBySession.all(sessionId));
    }

    res.json([]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:token', (req, res) => {
  try {
    const { token } = req.params;
    const clip = statements.getClip.get(token);

    if (!clip || clip.deleted) {
      return res.status(404).json({ error: 'Clip not found' });
    }

    if (!req.isAdmin && (!clip.sessionId || clip.sessionId !== req.body.sessionId)) {
      return res.status(403).json({ error: 'Not your clip' });
    }

    if (clip.path) {
      const filePath = safePath(DATA_DIR, clip.path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    statements.deleteClip.run(token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/upload-status', (req, res) => {
  try {
    const uploadId = req.query.uploadId;
    if (!uploadId) return res.status(400).json({ error: 'Missing uploadId' });

    const uploadDir = safePath(CHUNKS_DIR, uploadId);
    if (!fs.existsSync(uploadDir)) return res.json({ chunks: [] });

    const chunks = fs.readdirSync(uploadDir)
      .filter(f => f.endsWith('.chunk'))
      .map(f => {
        const parts = f.replace('.chunk', '').split('-');
        return { start: parseInt(parts[0]), end: parseInt(parts[1]) };
      })
      .sort((a, b) => a.start - b.start);

    res.json({ chunks });
  } catch (err) {
    if (err.message === 'Invalid path') return res.status(400).json({ error: 'Invalid upload' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
