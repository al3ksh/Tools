const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');
const { statements, DATA_DIR } = require('../db/database');
const { heavyWorkLimit } = require('../lib/heavyWork');
const { createDiskSpaceGuard } = require('./utils');

const PDF_GUEST_LIMIT_MB = 50;
const PDF_ADMIN_LIMIT_MB = 150;
const PDF_GUEST_LIMIT = PDF_GUEST_LIMIT_MB * 1024 * 1024;
const PDF_ADMIN_LIMIT = PDF_ADMIN_LIMIT_MB * 1024 * 1024;

// Temp directory for PDF uploads
const pdfTempDir = path.join(DATA_DIR, 'uploads', 'pdf-temp');
if (!fs.existsSync(pdfTempDir)) {
  fs.mkdirSync(pdfTempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(pdfTempDir, { recursive: true });
    cb(null, pdfTempDir);
  },
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: PDF_ADMIN_LIMIT, fieldSize: 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'images') {
      if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('Only JPG and PNG images are supported'));
      }
    } else {
      if (ext === '.pdf') {
        cb(null, true);
      } else {
        cb(new Error('Only PDF files are allowed'));
      }
    }
  }
});

const uploadGuest = multer({
  storage,
  limits: { fileSize: PDF_GUEST_LIMIT, fieldSize: 1024 * 1024 },
  fileFilter: upload.fileFilter
});
const diskSpaceGuard = createDiskSpaceGuard({ dataDir: DATA_DIR, minFreeBytes: 768 * 1024 * 1024 });

// Size limit for guests
const pdfSizeLimit = (req, res, next) => {
  if (req.isAdmin) return next();
  if (req.headers['content-length'] && parseInt(req.headers['content-length']) > PDF_GUEST_LIMIT) {
    return res.status(413).json({ error: `File too large. Guest limit is ${PDF_GUEST_LIMIT_MB}MB.` });
  }
  next();
};

function getUploader(method, field, maxCount) {
  return (req, res, next) => {
    const uploader = req.isAdmin ? upload : uploadGuest;
    const handler = maxCount ? uploader.array(field, maxCount) : uploader.single(field);
    handler(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: req.isAdmin ? `File too large. Admin PDF limit is ${PDF_ADMIN_LIMIT_MB}MB.` : `File too large. Guest limit is ${PDF_GUEST_LIMIT_MB}MB.` });
        }
        if (err.message && err.message.includes('Only')) {
          return res.status(400).json({ error: err.message });
        }
        console.error('PDF upload failed:', err.message);
        return res.status(400).json({ error: err.message || 'Upload failed' });
      }
      next();
    });
  };
}

function cleanupFiles(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
  }
}

function createPdfJob(req, res, operation, files, options = {}) {
  try {
    const sessionId = req.isAdmin ? 'admin' : req.body.sessionId;
    const jobId = uuidv4();
    const createdAt = new Date().toISOString();
    const inputJson = JSON.stringify({
      operation,
      files: files.map(file => ({
        path: path.relative(DATA_DIR, file.path),
        originalName: file.originalname,
        size: file.size
      })),
      options,
      isAdmin: req.isAdmin
    });

    statements.createJob.run(jobId, 'pdf', createdAt, inputJson, sessionId || null);
    res.json({ jobId });
  } catch (err) {
    cleanupFiles(files.map(file => file.path));
    res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /api/pdf/info - get PDF page count and metadata
router.post('/info', heavyWorkLimit, diskSpaceGuard, pdfSizeLimit, getUploader("single", "file"), async (req, res) => {
  const tempFiles = [];
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    tempFiles.push(req.file.path);

    const pdfBytes = fs.readFileSync(req.file.path);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

    res.json({
      pageCount: pdfDoc.getPageCount(),
      title: pdfDoc.getTitle() || null,
      author: pdfDoc.getAuthor() || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    cleanupFiles(tempFiles);
  }
});

// POST /api/pdf/merge - merge multiple PDFs into one
router.post('/merge', diskSpaceGuard, pdfSizeLimit, getUploader("array", "files", 50), (req, res) => {
  try {
    if (!req.files || req.files.length < 2) {
      return res.status(400).json({ error: 'At least 2 PDF files are required' });
    }

    const totalSize = req.files.reduce((sum, f) => sum + f.size, 0);
    const maxSize = req.isAdmin ? PDF_ADMIN_LIMIT : PDF_GUEST_LIMIT;
    if (totalSize > maxSize) {
      cleanupFiles(req.files.map(f => f.path));
      return res.status(413).json({ error: `Total file size exceeds ${req.isAdmin ? PDF_ADMIN_LIMIT_MB : PDF_GUEST_LIMIT_MB}MB limit.` });
    }

    createPdfJob(req, res, 'merge', req.files);
  } catch (err) {
    if (req.files) cleanupFiles(req.files.map(f => f.path));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pdf/split - extract specific pages from a PDF
router.post('/split', diskSpaceGuard, pdfSizeLimit, getUploader("single", "file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const pages = JSON.parse(req.body.pages); // 1-based page numbers
    if (!Array.isArray(pages) || pages.length === 0) {
      cleanupFiles([req.file.path]);
      return res.status(400).json({ error: 'Pages array is required' });
    }
    if (!pages.every(p => typeof p === 'number' && Number.isInteger(p) && p >= 1)) {
      cleanupFiles([req.file.path]);
      return res.status(400).json({ error: 'Pages must be positive integers' });
    }

    createPdfJob(req, res, 'split', [req.file], { pages });
  } catch (err) {
    if (req.file) cleanupFiles([req.file.path]);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pdf/rotate - rotate specific pages
router.post('/rotate', diskSpaceGuard, pdfSizeLimit, getUploader("single", "file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const rotations = JSON.parse(req.body.rotations);
    if (typeof rotations !== 'object' || rotations === null || Array.isArray(rotations)) {
      cleanupFiles([req.file.path]);
      return res.status(400).json({ error: 'Rotations must be an object' });
    }
    for (const [pageStr, angle] of Object.entries(rotations)) {
      if (!Number.isInteger(Number(pageStr)) || typeof angle !== 'number') {
        cleanupFiles([req.file.path]);
        return res.status(400).json({ error: 'Invalid rotation format' });
      }
    }

    createPdfJob(req, res, 'rotate', [req.file], { rotations });
  } catch (err) {
    if (req.file) cleanupFiles([req.file.path]);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pdf/remove-pages - remove specific pages from a PDF
router.post('/remove-pages', diskSpaceGuard, pdfSizeLimit, getUploader("single", "file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const pages = JSON.parse(req.body.pages);
    if (!Array.isArray(pages) || pages.length === 0) {
      cleanupFiles([req.file.path]);
      return res.status(400).json({ error: 'Pages array is required' });
    }
    if (!pages.every(p => typeof p === 'number' && Number.isInteger(p) && p >= 1)) {
      cleanupFiles([req.file.path]);
      return res.status(400).json({ error: 'Pages must be positive integers' });
    }

    createPdfJob(req, res, 'remove-pages', [req.file], { pages });
  } catch (err) {
    if (req.file) cleanupFiles([req.file.path]);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pdf/images-to-pdf - convert images to a PDF
router.post('/images-to-pdf', diskSpaceGuard, pdfSizeLimit, getUploader("array", "images", 100), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'At least 1 image is required' });
    }

    createPdfJob(req, res, 'images-to-pdf', req.files);
  } catch (err) {
    if (req.files) cleanupFiles(req.files.map(f => f.path));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pdf/reorder - reorder pages in a PDF
router.post('/reorder', diskSpaceGuard, pdfSizeLimit, getUploader("single", "file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const order = JSON.parse(req.body.order);
    if (!Array.isArray(order) || order.length === 0) {
      cleanupFiles([req.file.path]);
      return res.status(400).json({ error: 'Order array is required' });
    }
    if (!order.every(p => typeof p === 'number' && Number.isInteger(p) && p >= 1)) {
      cleanupFiles([req.file.path]);
      return res.status(400).json({ error: 'Order must contain positive integers' });
    }

    createPdfJob(req, res, 'reorder', [req.file], { order });
  } catch (err) {
    if (req.file) cleanupFiles([req.file.path]);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Multer error handling
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: 'Upload failed' });
  }
  next();
});

module.exports = router;
