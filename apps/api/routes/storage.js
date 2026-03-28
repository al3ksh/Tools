const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('../db/database');

function formatBytes(bytes) {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getDiskUsage(dirPath) {
  try {
    const stats = fs.statfsSync(dirPath);
    const blockSize = stats.bsize;
    const totalBlocks = stats.blocks;
    const freeBlocks = stats.bfree;
    const totalBytes = totalBlocks * blockSize;
    const availableBytes = freeBlocks * blockSize;
    const usedBytes = totalBytes - availableBytes;
    const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
    return {
      totalBytes,
      usedBytes,
      availableBytes,
      totalFormatted: formatBytes(totalBytes),
      usedFormatted: formatBytes(usedBytes),
      availableFormatted: formatBytes(availableBytes),
      usedPercent: parseFloat(usedPercent.toFixed(1)),
    };
  } catch (err) {
    return null;
  }
}

function getDirectorySize(dirPath) {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stat = fs.lstatSync(filePath);
    if (stat.isDirectory()) {
      size += getDirectorySize(filePath);
    } else {
      size += stat.size;
    }
  }
  return size;
}

function getSessionBreakdown(sessionId) {
  const directories = { downloads: 0, converted: 0, drops: 0, clips: 0 };

  try {
    const downloadRows = db.prepare(`
      SELECT j.inputJson, j.outputJson FROM jobs j
      WHERE j.sessionId = ? AND j.type = 'download' AND j.status = 'done'
    `).all(sessionId);
    for (const row of downloadRows) {
      try {
        const output = JSON.parse(row.outputJson);
        if (output.files) {
          for (const f of output.files) directories.downloads += (f.size || 0);
        }
      } catch (e) {}
    }
  } catch (e) {}

  try {
    const convertRows = db.prepare(`
      SELECT j.outputJson FROM jobs j
      WHERE j.sessionId = ? AND j.type = 'convert' AND j.status = 'done'
    `).all(sessionId);
    for (const row of convertRows) {
      try {
        const output = JSON.parse(row.outputJson);
        if (output.files) {
          for (const f of output.files) directories.converted += (f.size || 0);
        }
      } catch (e) {}
    }
  } catch (e) {}

  try {
    const dropRows = db.prepare(`
      SELECT COALESCE(SUM(size), 0) as total FROM drops WHERE sessionId = ?
    `).get(sessionId);
    directories.drops = dropRows.total;
  } catch (e) {}

  try {
    const clipRows = db.prepare(`
      SELECT COALESCE(SUM(size), 0) as total FROM clips WHERE sessionId = ?
    `).get(sessionId);
    directories.clips = clipRows.total;
  } catch (e) {}

  return directories;
}

// GET /api/storage - storage usage info
router.get('/', (req, res) => {
  try {
    if (req.isAdmin) {
      const dirs = ['downloads', 'converted', 'uploads', 'drops', 'clips'];
      const directories = {};
      let total = 0;

      for (const dir of dirs) {
        const dirPath = path.join(DATA_DIR, dir);
        const size = getDirectorySize(dirPath);
        directories[dir] = { bytes: size, formatted: formatBytes(size) };
        total += size;
      }

      const response = {
        directories,
        total: { bytes: total, formatted: formatBytes(total) },
      };

      const disk = getDiskUsage(DATA_DIR);
      if (disk) {
        response.disk = disk;
      }

      return res.json(response);
    }

    const sessionId = req.query.sessionId;
    if (!sessionId) {
      return res.json({ directories: { downloads: 0, converted: 0, drops: 0, clips: 0 }, total: { bytes: 0, formatted: '0 B' } });
    }

    const raw = getSessionBreakdown(sessionId);
    const directories = {};
    let total = 0;

    for (const [dir, bytes] of Object.entries(raw)) {
      directories[dir] = { bytes, formatted: formatBytes(bytes) };
      total += bytes;
    }

    res.json({
      directories,
      total: { bytes: total, formatted: formatBytes(total) },
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
