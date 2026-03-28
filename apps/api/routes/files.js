const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { statements, DATA_DIR } = require('../db/database');
const { safePath, setContentDisposition } = require('./utils');

const ALLOWED_DIRS = ['downloads', 'converted', 'uploads'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidJobId(jobId) {
  if (!jobId || typeof jobId !== 'string') return false;
  return UUID_RE.test(jobId);
}

function checkJobAccess(job, sessionId, isAdmin) {
  if (!job || job.deleted) return false;
  if (job.expiresAt && new Date(job.expiresAt) < new Date()) return false;
  if (isAdmin) return true;
  return job.sessionId === sessionId;
}

// GET /api/files/list/:type - list files (admin only)
router.get('/list/:type', (req, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin only' });

    const { type } = req.params;
    if (!ALLOWED_DIRS.includes(type)) return res.status(400).json({ error: 'Invalid type' });

    const dirPath = safePath(DATA_DIR, type);
    if (!fs.existsSync(dirPath)) return res.json([]);

    const results = [];
    const jobs = fs.readdirSync(dirPath);

    for (const jobId of jobs) {
      const jobDir = path.join(dirPath, jobId);
      if (fs.statSync(jobDir).isDirectory()) {
        const files = fs.readdirSync(jobDir);
        for (const file of files) {
          const filePath = path.join(jobDir, file);
          const stat = fs.statSync(filePath);
          results.push({
            jobId,
            filename: file,
            path: `${type}/${jobId}/${file}`,
            size: stat.size,
            createdAt: stat.birthtime
          });
        }
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/:jobId - get output file (auto-find first file)
router.get('/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    if (!isValidJobId(jobId)) return res.status(400).json({ error: 'Invalid job ID' });

    const job = statements.getJobById.get(jobId);
    if (!job || job.deleted) return res.status(404).json({ error: 'File not found' });
    if (job.expiresAt && new Date(job.expiresAt) < new Date()) return res.status(410).json({ error: 'File has expired' });
    if (!checkJobAccess(job, req.query.sessionId, req.isAdmin)) return res.status(403).json({ error: 'Access denied' });

    for (const dir of ALLOWED_DIRS) {
      const dirPath = safePath(DATA_DIR, path.join(dir, jobId));
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        const files = fs.readdirSync(dirPath);
        if (files.length > 0) {
          const filePath = path.join(dirPath, files[0]);
          setContentDisposition(res, files[0]);
          res.setHeader('X-Content-Type-Options', 'nosniff');
          return res.download(filePath, files[0]);
        }
      }
    }

    res.status(404).json({ error: 'File not found' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/:jobId/:filename - get specific file
router.get('/:jobId/:filename(*)', (req, res) => {
  try {
    const { jobId, filename } = req.params;
    if (!isValidJobId(jobId)) return res.status(400).json({ error: 'Invalid job ID' });

    const job = statements.getJobById.get(jobId);
    if (!job || job.deleted) return res.status(404).json({ error: 'File not found' });
    if (job.expiresAt && new Date(job.expiresAt) < new Date()) return res.status(410).json({ error: 'File has expired' });
    if (!checkJobAccess(job, req.query.sessionId, req.isAdmin)) return res.status(403).json({ error: 'Access denied' });

    const decodedFilename = decodeURIComponent(filename);

    for (const dir of ALLOWED_DIRS) {
      const filePath = safePath(DATA_DIR, path.join(dir, jobId, decodedFilename));
      if (fs.existsSync(filePath)) {
        setContentDisposition(res, decodedFilename);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.download(filePath, decodedFilename);
      }
    }

    res.status(404).json({ error: 'File not found' });
  } catch (err) {
    if (err.message === 'Invalid path') return res.status(400).json({ error: 'Invalid filename' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
