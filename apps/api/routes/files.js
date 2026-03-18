const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { statements, DATA_DIR } = require('../db/database');

// Allowlist of directories that can be served
const ALLOWED_DIRS = ['downloads', 'converted', 'uploads'];

function safePath(baseDir, relativePath) {
  const resolved = path.resolve(baseDir, relativePath);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new Error('Invalid path');
  }
  return resolved;
}

// GET /api/files/:jobId - get output file (auto-find first file)
router.get('/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;

    const job = statements.getJobById.get(jobId);
    if (!job || job.deleted) {
      return res.status(404).json({ error: 'File not found' });
    }
    if (job.expiresAt && new Date(job.expiresAt) < new Date()) {
      return res.status(410).json({ error: 'File has expired' });
    }

    for (const dir of ALLOWED_DIRS) {
      const dirPath = safePath(DATA_DIR, path.join(dir, jobId));
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        const files = fs.readdirSync(dirPath);
        if (files.length > 0) {
          const filePath = path.join(dirPath, files[0]);
          return res.download(filePath, files[0]);
        }
      }
    }

    res.status(404).json({ error: 'File not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/:jobId/:filename - get specific file
router.get('/:jobId/:filename(*)', (req, res) => {
  try {
    const { jobId, filename } = req.params;
    const decodedFilename = decodeURIComponent(filename);

    for (const dir of ALLOWED_DIRS) {
      const filePath = safePath(DATA_DIR, path.join(dir, jobId, decodedFilename));
      if (fs.existsSync(filePath)) {
        return res.download(filePath, decodedFilename);
      }
    }

    res.status(404).json({ error: 'File not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/list/:type - list files of a given type
router.get('/list/:type', (req, res) => {
  try {
    const { type } = req.params;

    if (!ALLOWED_DIRS.includes(type)) {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const dirPath = safePath(DATA_DIR, type);
    if (!fs.existsSync(dirPath)) {
      return res.json([]);
    }

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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
