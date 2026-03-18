const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { statements } = require('../db/database');
const { validatePublicUrl } = require('./utils');

const SLUG_RE = /^[a-zA-Z0-9_-]{3,50}$/;
const RESERVED_SLUGS = ['list', 'admin', 'api', 'd', 's', 'qr', 'pdf', 'gif', 'drop', 'downloader', 'converter', 'shortener'];

// POST /api/shorten - create a short link
router.post('/', async (req, res) => {
  try {
    const { url, slug, sessionId } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required' });
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL must start with http:// or https://' });

    try {
      await validatePublicUrl(url);
    } catch (err) {
      return res.status(400).json({ error: 'URL points to a private or blocked address' });
    }

    if (slug) {
      if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'Slug must be 3-50 alphanumeric characters (a-z, 0-9, -, _)' });
      if (RESERVED_SLUGS.includes(slug.toLowerCase())) return res.status(400).json({ error: 'This slug is reserved' });
    }

    const finalSlug = slug || uuidv4().substring(0, 8);
    const createdAt = new Date().toISOString();

    try {
      statements.createShortlink.run(finalSlug, url, createdAt, sessionId || null);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint')) {
        return res.status(409).json({ error: 'Slug already exists' });
      }
      throw err;
    }

    const protocol = req.protocol;
    const host = req.get('host');
    const shortUrl = `${protocol}://${host}/s/${finalSlug}`;

    res.json({ slug: finalSlug, shortUrl });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) return res.status(409).json({ error: 'Slug already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/shortlinks/list - list short links (filtered by session)
router.get('/list', (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    const all = req.query.all === 'true';

    if (all && req.isAdmin) {
      const links = statements.getAllShortlinks.all();
      return res.json(links);
    }

    if (sessionId) {
      const links = statements.getShortlinksBySession.all(sessionId);
      return res.json(links);
    }

    return res.json([]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/shortlinks/:slug - admin-only delete
router.delete('/:slug', (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { slug } = req.params;
    statements.deleteShortlink.run(slug);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Redirect handler - exported separately
const redirectHandler = (req, res) => {
  try {
    const { slug } = req.params;
    const link = statements.getShortlink.get(slug);

    if (!link) {
      return res.status(404).json({ error: 'Short link not found' });
    }

    if (!/^https?:\/\//i.test(link.targetUrl)) {
      return res.status(400).json({ error: 'Invalid redirect URL' });
    }

    statements.incrementClicks.run(slug);
    res.redirect(302, link.targetUrl);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { router, redirectHandler };
