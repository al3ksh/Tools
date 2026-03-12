const express = require('express');
const cors = require('cors');
const path = require('path');
const { DATA_DIR } = require('../db/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Admin auth middleware
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tooladmin1234';
app.use((req, res, next) => {
  const token = req.headers['x-admin-token'];
  req.isAdmin = token === ADMIN_PASSWORD;
  // Force a shared sessionId for admin across all devices
  if (req.isAdmin) {
    if (req.body) req.body.sessionId = 'admin';
    if (req.query) req.query.sessionId = 'admin';
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

// Redirect routes (shortener and drop)
app.get('/s/:slug', redirectHandler);

// Health check
app.get('/api/health', (req, res) => {
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API server running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
