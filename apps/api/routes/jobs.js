const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { statements, DATA_DIR } = require('../db/database');

function checkJobOwnership(job, sessionId, isAdmin) {
  if (!job) return false;
  if (isAdmin) return true;
  return job.sessionId === sessionId;
}

function buildQueuePositions() {
  const positions = new Map();
  const queued = statements.getQueuedJobIds.all();
  queued.forEach((job, index) => {
    positions.set(job.id, index + 1);
  });
  return positions;
}

function serializeJob(job, queuePositions) {
  return {
    ...job,
    queuePosition: job.status === 'queued' ? queuePositions.get(job.id) || null : null,
    inputJson: job.inputJson ? JSON.parse(job.inputJson) : null,
    outputJson: job.outputJson ? JSON.parse(job.outputJson) : null
  };
}

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
      jobs = [];
    }
    const queuePositions = buildQueuePositions();
    res.json(jobs.map(job => serializeJob(job, queuePositions)));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/jobs/:id - job details
router.get('/:id', (req, res) => {
  try {
    const job = statements.getJobById.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!checkJobOwnership(job, req.query.sessionId, req.isAdmin)) return res.status(403).json({ error: 'Access denied' });
    const queuePositions = buildQueuePositions();
    res.json(serializeJob(job, queuePositions));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/jobs/:id - delete a job
router.delete('/:id', (req, res) => {
  try {
    const job = statements.getJobById.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!checkJobOwnership(job, req.query.sessionId, req.isAdmin)) return res.status(403).json({ error: 'Access denied' });

    statements.deleteJob.run(new Date().toISOString(), req.params.id);

    const dirs = ['downloads', 'converted'];
    for (const dir of dirs) {
      const jobDir = path.join(DATA_DIR, dir, req.params.id);
      if (fs.existsSync(jobDir)) {
        fs.rmSync(jobDir, { recursive: true, force: true });
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/jobs/:id/cancel - cancel a job
router.post('/:id/cancel', (req, res) => {
  try {
    const job = statements.getJobById.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!checkJobOwnership(job, req.query.sessionId, req.isAdmin)) return res.status(403).json({ error: 'Access denied' });
    if (job.status !== 'queued' && job.status !== 'running') return res.status(400).json({ error: 'Job is not cancelable' });

    statements.cancelJob.run(req.params.id);
    res.json({ success: true, message: 'Job cancellation requested' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/jobs/:id/priority - adjust queued job priority (admin only)
router.patch('/:id/priority', (req, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });

    const job = statements.getJobById.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'queued') return res.status(400).json({ error: 'Only queued jobs can be reprioritized' });

    const priority = Number(req.body.priority);
    if (!Number.isInteger(priority) || priority < -100 || priority > 100) {
      return res.status(400).json({ error: 'Priority must be an integer between -100 and 100' });
    }

    statements.updateJobPriority.run(priority, req.params.id);
    const updated = statements.getJobById.get(req.params.id);
    const queuePositions = buildQueuePositions();
    res.json(serializeJob(updated, queuePositions));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
