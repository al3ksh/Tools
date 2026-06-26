const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { DATA_DIR } = require('../db/database');

const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const BASE_URL = process.env.BASE_URL || null;

const CRAWLER_RE = /discordbot|twitterbot|slackbot|facebookexternalhit|linkedinbot|telegrambot|whatsapp|skype|googlebot|bingbot|opengraph/i;
const SHUTDOWN_GRACE_MS = 30000;
let shuttingDown = false;
let activeRequests = 0;

function getAdminToken(req) {
  return req.cookies?.admin_token || null;
}

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Middleware
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'", 'blob:'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));
app.use(cookieParser());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  if (shuttingDown && req.path !== '/api/health') {
    res.setHeader('Connection', 'close');
    return res.status(503).json({ error: 'Server is shutting down' });
  }

  activeRequests++;
  let released = false;
  function releaseRequest() {
    if (released) return;
    released = true;
    activeRequests = Math.max(0, activeRequests - 1);
  }
  res.on('finish', releaseRequest);
  res.on('close', releaseRequest);
  next();
});
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a minute.' },
}));

// Admin auth middleware
app.use((req, res, next) => {
  req.isAdmin = false;

  const token = getAdminToken(req);
  if (token && ADMIN_JWT_SECRET) {
    try {
      const payload = jwt.verify(token, ADMIN_JWT_SECRET, { audience: 'tools-api', issuer: 'tools-api' });
      req.isAdmin = payload?.role === 'admin';
    } catch (err) {
      req.isAdmin = false;
    }
  }

  if (req.isAdmin) {
    if (req.body) req.body.sessionId = 'admin';
    if (req.query) req.query.sessionId = 'admin';
  }

  if (!req.isAdmin) {
    if (req.query && req.query.sessionId === 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.body && req.body.sessionId === 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  next();
});

// Import routes
const jobsRoutes = require('../routes/jobs');
const downloaderRoutes = require('../routes/downloader');
const converterRoutes = require('../routes/converter');
const { router: shortenerRoutes, redirectHandler } = require('../routes/shortener');
const { router: dropRoutes } = require('../routes/drop');
const filesRoutes = require('../routes/files');
const storageRoutes = require('../routes/storage');
const utilsRoutes = require('../routes/utils');
const authRoutes = require('../routes/auth');
const qrRoutes = require('../routes/qr');
const pdfRoutes = require('../routes/pdf');
const gifRoutes = require('../routes/gif');
const clipRoutes = require('../routes/clip');

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/downloader', downloaderRoutes);
app.use('/api/converter', converterRoutes);
// Upload route (from converter)
app.use('/api/upload', converterRoutes);
app.use('/api/shorten', shortenerRoutes);
app.use('/api/shortlinks', shortenerRoutes);
app.use('/api/drop', dropRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/utils', utilsRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/pdf', pdfRoutes);
app.use('/api/gif', gifRoutes);
app.use('/api/clip', clipRoutes);

// Redirect routes (shortener and drop)
app.get('/s/:slug', redirectHandler);

// OG embed for clips (Discord, Twitter, etc.)
app.get('/c/:token', (req, res) => {
  const { statements } = require('../db/database');
  const clip = statements.getClipInfo.get(req.params.token);
  if (!clip || clip.deleted) return res.redirect('/');

  const protocol = req.protocol;
  const host = req.get('host');
  const origin = BASE_URL || `${protocol}://${host}`;
  const clipUrl = `${origin}/c/${req.params.token}`;
  const streamUrl = `${origin}/api/clip/${req.params.token}/stream`;
  const w = clip.width || 1280;
  const h = clip.height || 720;
  const title = escapeHtmlAttr(clip.filename || 'Video Clip');
  const description = escapeHtmlAttr(`${clip.duration ? Math.round(clip.duration) + 's' : 'Video clip'}${clip.size ? ' \u2022 ' + (clip.size / (1024*1024)).toFixed(1) + 'MB' : ''}`);
  const safeClipUrl = escapeHtmlAttr(clipUrl);
  const safeStreamUrl = escapeHtmlAttr(streamUrl);

  res.type('html').send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta property="og:type" content="video.other">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${safeClipUrl}">
<meta property="og:video" content="${safeStreamUrl}">
<meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="${w}">
<meta property="og:video:height" content="${h}">
<meta name="twitter:card" content="player">
<meta name="twitter:player" content="${safeStreamUrl}">
<meta name="twitter:player:width" content="${w}">
<meta name="twitter:player:height" content="${h}">
<meta name="twitter:title" content="${title}">
<meta http-equiv="refresh" content="0;url=${safeClipUrl}/embed">
</head></html>`);
});

app.get('/c/:token/embed', (req, res) => {
  const ua = req.get('user-agent') || '';
  if (CRAWLER_RE.test(ua)) {
    return res.redirect(301, '/c/' + req.params.token);
  }
  const indexPath = path.join(__dirname, '..', '..', 'web', 'dist', 'index.html');
  if (require('fs').existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).json({ error: 'Not found' });
});

// Health check
app.get('/api/health', (req, res) => {
  if (shuttingDown) {
    return res.status(503).json({ status: 'shutting_down', activeRequests, timestamp: new Date().toISOString() });
  }
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Static files from web build (for production)
const webBuildPath = path.join(__dirname, '..', '..', 'web', 'dist');
app.use(express.static(webBuildPath));

// SPA fallback
app.get('*', (req, res) => {
  const indexPath = path.join(webBuildPath, 'index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`API server running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
server.timeout = 300000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 30000;
server.requestTimeout = 300000;

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, closing API server. Active requests: ${activeRequests}`);

  server.close(() => {
    console.log('API server closed cleanly');
    process.exit(0);
  });

  setTimeout(() => {
    console.error(`Forced API shutdown after ${SHUTDOWN_GRACE_MS}ms. Active requests: ${activeRequests}`);
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
