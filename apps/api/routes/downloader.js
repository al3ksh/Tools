const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { statements } = require('../db/database');
const { PRESETS } = require('../../../packages/shared/types');

// POST /api/downloader - create a download job
router.post('/', (req, res) => {
  try {
    const { url, preset, sessionId } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    if (!PRESETS[preset]) {
      return res.status(400).json({ error: 'Invalid preset. Use: VIDEO_MP4_BEST, VIDEO_MP4_720P, AUDIO_MP3_192, AUDIO_OPUS_96' });
    }

    const jobId = uuidv4();
    const createdAt = new Date().toISOString();
    const inputJson = JSON.stringify({ url, preset, presetConfig: PRESETS[preset], isAdmin: req.isAdmin });

    statements.createJob.run(jobId, 'download', createdAt, inputJson, sessionId || null);

    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
