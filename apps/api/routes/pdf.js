const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument, degrees } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');
const { DATA_DIR } = require('../db/database');

// Temp directory for PDF uploads
const pdfTempDir = path.join(DATA_DIR, 'uploads', 'pdf-temp');
if (!fs.existsSync(pdfTempDir)) {
  fs.mkdirSync(pdfTempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, pdfTempDir),
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'images') {
      if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('Only JPG and PNG images are supported'));
      }
    } else {
      if (ext === '.pdf' || file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(new Error('Only PDF files are allowed'));
      }
    }
  }
});

// Size limit for guests
const pdfSizeLimit = (req, res, next) => {
  if (req.isAdmin) return next();
  const MAX_GUEST = 100 * 1024 * 1024;
  if (req.headers['content-length'] && parseInt(req.headers['content-length']) > MAX_GUEST) {
    return res.status(413).json({ error: 'File too large. Guest limit is 100MB.' });
  }
  next();
};

function cleanupFiles(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
  }
}

// POST /api/pdf/info - get PDF page count and metadata
router.post('/info', pdfSizeLimit, upload.single('file'), async (req, res) => {
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
    res.status(500).json({ error: err.message });
  } finally {
    cleanupFiles(tempFiles);
  }
});

// POST /api/pdf/merge - merge multiple PDFs into one
router.post('/merge', pdfSizeLimit, upload.array('files', 50), async (req, res) => {
  const tempFiles = [];
  try {
    if (!req.files || req.files.length < 2) {
      return res.status(400).json({ error: 'At least 2 PDF files are required' });
    }

    tempFiles.push(...req.files.map(f => f.path));

    const mergedPdf = await PDFDocument.create();

    for (const file of req.files) {
      const pdfBytes = fs.readFileSync(file.path);
      const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      pages.forEach(page => mergedPdf.addPage(page));
    }

    const mergedBytes = await mergedPdf.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="merged.pdf"');
    res.send(Buffer.from(mergedBytes));
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    cleanupFiles(tempFiles);
  }
});

// POST /api/pdf/split - extract specific pages from a PDF
router.post('/split', pdfSizeLimit, upload.single('file'), async (req, res) => {
  const tempFiles = [];
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    tempFiles.push(req.file.path);

    const pages = JSON.parse(req.body.pages); // 1-based page numbers
    if (!Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'Pages array is required' });
    }

    const pdfBytes = fs.readFileSync(req.file.path);
    const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = sourcePdf.getPageCount();

    const validPages = pages.filter(p => p >= 1 && p <= totalPages).map(p => p - 1);
    if (validPages.length === 0) {
      return res.status(400).json({ error: 'No valid pages specified' });
    }

    const newPdf = await PDFDocument.create();
    const copiedPages = await newPdf.copyPages(sourcePdf, validPages);
    copiedPages.forEach(page => newPdf.addPage(page));

    const newBytes = await newPdf.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="extracted.pdf"');
    res.send(Buffer.from(newBytes));
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    cleanupFiles(tempFiles);
  }
});

// POST /api/pdf/rotate - rotate specific pages
router.post('/rotate', pdfSizeLimit, upload.single('file'), async (req, res) => {
  const tempFiles = [];
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    tempFiles.push(req.file.path);

    const rotations = JSON.parse(req.body.rotations); // { "pageNum": angle } (1-based)

    const pdfBytes = fs.readFileSync(req.file.path);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

    for (const [pageStr, angle] of Object.entries(rotations)) {
      const pageIdx = parseInt(pageStr) - 1;
      if (pageIdx >= 0 && pageIdx < pdfDoc.getPageCount()) {
        const page = pdfDoc.getPage(pageIdx);
        const currentRotation = page.getRotation().angle;
        page.setRotation(degrees(currentRotation + angle));
      }
    }

    const newBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="rotated.pdf"');
    res.send(Buffer.from(newBytes));
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    cleanupFiles(tempFiles);
  }
});

// POST /api/pdf/remove-pages - remove specific pages from a PDF
router.post('/remove-pages', pdfSizeLimit, upload.single('file'), async (req, res) => {
  const tempFiles = [];
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    tempFiles.push(req.file.path);

    const pages = JSON.parse(req.body.pages); // 1-based page numbers to remove

    const pdfBytes = fs.readFileSync(req.file.path);
    const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = sourcePdf.getPageCount();

    const removeSet = new Set(pages.map(p => p - 1));
    const keepPages = [];
    for (let i = 0; i < totalPages; i++) {
      if (!removeSet.has(i)) keepPages.push(i);
    }

    if (keepPages.length === 0) {
      return res.status(400).json({ error: 'Cannot remove all pages' });
    }

    const newPdf = await PDFDocument.create();
    const copiedPages = await newPdf.copyPages(sourcePdf, keepPages);
    copiedPages.forEach(page => newPdf.addPage(page));

    const newBytes = await newPdf.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="modified.pdf"');
    res.send(Buffer.from(newBytes));
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    cleanupFiles(tempFiles);
  }
});

// POST /api/pdf/images-to-pdf - convert images to a PDF
router.post('/images-to-pdf', pdfSizeLimit, upload.array('images', 100), async (req, res) => {
  const tempFiles = [];
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'At least 1 image is required' });
    }

    tempFiles.push(...req.files.map(f => f.path));

    const pdfDoc = await PDFDocument.create();

    for (const file of req.files) {
      const imageBytes = fs.readFileSync(file.path);
      const ext = path.extname(file.originalname).toLowerCase();

      let image;
      if (ext === '.png') {
        image = await pdfDoc.embedPng(imageBytes);
      } else if (['.jpg', '.jpeg'].includes(ext)) {
        image = await pdfDoc.embedJpg(imageBytes);
      } else {
        continue;
      }

      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    }

    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="images.pdf"');
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    cleanupFiles(tempFiles);
  }
});

// POST /api/pdf/reorder - reorder pages in a PDF
router.post('/reorder', pdfSizeLimit, upload.single('file'), async (req, res) => {
  const tempFiles = [];
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    tempFiles.push(req.file.path);

    const order = JSON.parse(req.body.order); // array of 1-based page numbers in desired order

    const pdfBytes = fs.readFileSync(req.file.path);
    const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = sourcePdf.getPageCount();

    const zeroOrder = order.filter(p => p >= 1 && p <= totalPages).map(p => p - 1);
    if (zeroOrder.length === 0) {
      return res.status(400).json({ error: 'No valid pages in order' });
    }

    const newPdf = await PDFDocument.create();
    const copiedPages = await newPdf.copyPages(sourcePdf, zeroOrder);
    copiedPages.forEach(page => newPdf.addPage(page));

    const newBytes = await newPdf.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="reordered.pdf"');
    res.send(Buffer.from(newBytes));
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    cleanupFiles(tempFiles);
  }
});

// Multer error handling
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

module.exports = router;
