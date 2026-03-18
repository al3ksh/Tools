const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const QRCode = require('qrcode');

const qrRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many QR code requests. Please try again in a minute.' },
});

// POST /api/qr/generate - generate QR code as PNG data URL
router.post('/generate', qrRateLimit, async (req, res) => {
  try {
    const { text, size = 300, darkColor = '#000000', lightColor = '#ffffff', errorCorrection = 'M' } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    if (text.length > 4296) {
      return res.status(400).json({ error: 'Text too long (max 4296 characters)' });
    }

    const hexRegex = /^#[0-9A-Fa-f]{6}$/;
    if (!hexRegex.test(darkColor) || !hexRegex.test(lightColor)) {
      return res.status(400).json({ error: 'Invalid color format. Use hex like #000000' });
    }

    const validLevels = ['L', 'M', 'Q', 'H'];
    if (!validLevels.includes(errorCorrection)) {
      return res.status(400).json({ error: 'Invalid error correction level. Use: L, M, Q, H' });
    }

    const sizeNum = Math.min(Math.max(parseInt(size) || 300, 100), 2000);

    const dataUrl = await QRCode.toDataURL(text, {
      width: sizeNum,
      margin: 2,
      color: { dark: darkColor, light: lightColor },
      errorCorrectionLevel: errorCorrection,
    });

    res.json({ dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/qr/generate-svg - generate QR code as SVG string
router.post('/generate-svg', async (req, res) => {
  try {
    const { text, darkColor = '#000000', lightColor = '#ffffff', errorCorrection = 'M' } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    if (text.length > 4296) {
      return res.status(400).json({ error: 'Text too long (max 4296 characters)' });
    }

    const hexRegex = /^#[0-9A-Fa-f]{6}$/;
    if (!hexRegex.test(darkColor) || !hexRegex.test(lightColor)) {
      return res.status(400).json({ error: 'Invalid color format' });
    }

    const validLevels = ['L', 'M', 'Q', 'H'];
    if (!validLevels.includes(errorCorrection)) {
      return res.status(400).json({ error: 'Invalid error correction level' });
    }

    const svg = await QRCode.toString(text, {
      type: 'svg',
      margin: 2,
      color: { dark: darkColor, light: lightColor },
      errorCorrectionLevel: errorCorrection,
    });

    res.json({ svg });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
