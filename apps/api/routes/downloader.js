const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { statements } = require('../db/database');
const { PRESETS } = require('../../../packages/shared/types');
const { validatePublicUrl, checkJobLimit } = require('./utils');

// POST /api/downloader - create a download job
router.post('/', async (req, res) => {
  try {
    const { url, preset, sessionId } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    await validatePublicUrl(url);

    checkJobLimit(sessionId, req.isAdmin);

    if (!PRESETS[preset]) {
      return res.status(400).json({ error: 'Invalid preset. Use: VIDEO_MP4_BEST, VIDEO_MP4_720P, AUDIO_MP3_192, AUDIO_OPUS_96' });
    }

    const jobId = uuidv4();
    const createdAt = new Date().toISOString();
    const inputJson = JSON.stringify({ url, preset, presetConfig: PRESETS[preset], isAdmin: req.isAdmin });

    statements.createJob.run(jobId, 'download', createdAt, inputJson, sessionId || null);

    res.json({ jobId });
  } catch (err) {
    const isRateLimit = err.message && (
      err.message.includes('queue') ||
      err.message.includes('Too many')
    );
    const isValidation = err.message && !isRateLimit && (
      err.message.includes('Invalid') ||
      err.message.includes('Blocked') ||
      err.message.includes('scheme') ||
      err.message.includes('Insufficient')
    );
    if (isRateLimit) {
      res.status(429).json({ error: err.message });
    } else if (isValidation) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

module.exports = router;
