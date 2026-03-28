const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../db/database');

function getDirectorySize(dirPath) {
  let size = 0;

  if (!fs.existsSync(dirPath)) {
    return 0;
  }

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

// GET /api/storage - storage usage info
router.get('/', (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const dirs = ['downloads', 'converted', 'uploads', 'drops'];
    const storage = {};
    let total = 0;

    for (const dir of dirs) {
      const dirPath = path.join(DATA_DIR, dir);
      const size = getDirectorySize(dirPath);
      storage[dir] = {
        bytes: size,
        formatted: formatBytes(size)
      };
      total += size;
    }

    const response = {
      directories: storage,
      total: {
        bytes: total,
        formatted: formatBytes(total)
      }
    };

    const disk = getDiskUsage(DATA_DIR);
    if (disk) {
      response.disk = disk;
    }

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
