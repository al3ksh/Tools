const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { statements } = require('../db/database');

// POST /api/shorten - create a short link
router.post('/', (req, res) => {
  try {
    const { url, slug, sessionId } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
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
    res.status(500).json({ error: err.message });
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

    const links = statements.getAllShortlinks.all();
    res.json(links);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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

    statements.incrementClicks.run(slug);
    res.redirect(302, link.targetUrl);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { router, redirectHandler };
