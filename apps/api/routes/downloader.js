const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { statements } = require('../db/database');
const { PRESETS } = require('../../../packages/shared/types');
const { validatePublicUrl } = require('./utils');

// POST /api/downloader - create a download job
router.post('/', async (req, res) => {
  try {
    const { url, preset, sessionId } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    await validatePublicUrl(url);

    if (!PRESETS[preset]) {
      return res.status(400).json({ error: 'Invalid preset. Use: VIDEO_MP4_BEST, VIDEO_MP4_720P, AUDIO_MP3_192, AUDIO_OPUS_96' });
    }

    const jobId = uuidv4();
    const createdAt = new Date().toISOString();
    const inputJson = JSON.stringify({ url, preset, presetConfig: PRESETS[preset], isAdmin: req.isAdmin });

    statements.createJob.run(jobId, 'download', createdAt, inputJson, sessionId || null);

    res.json({ jobId });
  } catch (err) {
    const code = (err.message && (
      err.message.includes('Invalid') ||
      err.message.includes('Blocked') ||
      err.message.includes('scheme')
    )) ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

module.exports = router;
