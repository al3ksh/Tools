const express = require('express');
const router = express.Router();
const { statements } = require('../db/database');

// GET /api/jobs - recent 50 jobs (filtered by session)
router.get('/', (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    const all = req.query.all === 'true';
    let jobs;
    if (all && req.isAdmin) {
      jobs = statements.getRecentJobs.all(200);
    } else if (sessionId) {
      jobs = statements.getJobsBySession.all(sessionId, 50);
    } else {
      jobs = statements.getRecentJobs.all(50);
    }
    res.json(jobs.map(job => ({
      ...job,
      inputJson: job.inputJson ? JSON.parse(job.inputJson) : null,
      outputJson: job.outputJson ? JSON.parse(job.outputJson) : null
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id - job details
router.get('/:id', (req, res) => {
  try {
    const job = statements.getJobById.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json({
      ...job,
      inputJson: job.inputJson ? JSON.parse(job.inputJson) : null,
      outputJson: job.outputJson ? JSON.parse(job.outputJson) : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/jobs/:id - delete a job
router.delete('/:id', (req, res) => {
  try {
    const job = statements.getJobById.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Mark as deleted
    statements.deleteJob.run(new Date().toISOString(), req.params.id);

    // Delete files from disk
    const fs = require('fs');
    const path = require('path');
    const { DATA_DIR } = require('../db/database');

    // Try to delete files in downloads or converted directories
    const dirs = ['downloads', 'converted'];
    for (const dir of dirs) {
      const jobDir = path.join(DATA_DIR, dir, req.params.id);
      if (fs.existsSync(jobDir)) {
        fs.rmSync(jobDir, { recursive: true, force: true });
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/:id/cancel - cancel a job
router.post('/:id/cancel', (req, res) => {
  try {
    const job = statements.getJobById.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'queued' && job.status !== 'running') {
      return res.status(400).json({ error: 'Job is not cancelable' });
    }

    statements.cancelJob.run(req.params.id);

    res.json({ success: true, message: 'Job cancellation requested' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
