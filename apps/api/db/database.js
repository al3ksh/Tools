const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_PATH = path.join(DATA_DIR, 'tools.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Initialize schema
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

// Migration: Add missing columns if they don't exist
try {
  const columns = db.prepare("PRAGMA table_info(jobs)").all();
  const columnNames = columns.map(c => c.name);

  if (!columnNames.includes('expiresAt')) {
    db.exec('ALTER TABLE jobs ADD COLUMN expiresAt TEXT');
    console.log('Migration: Added expiresAt column');
  }

  if (!columnNames.includes('deletedAt')) {
    db.exec('ALTER TABLE jobs ADD COLUMN deletedAt TEXT');
    console.log('Migration: Added deletedAt column');
  }

  if (!columnNames.includes('deleted')) {
    db.exec('ALTER TABLE jobs ADD COLUMN deleted INTEGER DEFAULT 0');
    console.log('Migration: Added deleted column');
  }

  if (!columnNames.includes('isCancelling')) {
    db.exec('ALTER TABLE jobs ADD COLUMN isCancelling INTEGER DEFAULT 0');
    console.log('Migration: Added isCancelling column');
  }

  const dropColumns = db.prepare("PRAGMA table_info(drops)").all();
  const dropColumnNames = dropColumns.map(c => c.name);

  if (!dropColumnNames.includes('expiresAt')) {
    db.exec('ALTER TABLE drops ADD COLUMN expiresAt TEXT');
    console.log('Migration: Added expiresAt column to drops');
  }

  if (!dropColumnNames.includes('deleted')) {
    db.exec('ALTER TABLE drops ADD COLUMN deleted INTEGER DEFAULT 0');
    console.log('Migration: Added deleted column to drops');
  }

  if (!dropColumnNames.includes('sessionId')) {
    db.exec('ALTER TABLE drops ADD COLUMN sessionId TEXT');
    console.log('Migration: Added sessionId column to drops');
  }

  if (!dropColumnNames.includes('password')) {
    db.exec('ALTER TABLE drops ADD COLUMN password TEXT');
    console.log('Migration: Added password column to drops');
  }

  // Jobs sessionId migration
  if (!columnNames.includes('sessionId')) {
    db.exec('ALTER TABLE jobs ADD COLUMN sessionId TEXT');
    console.log('Migration: Added sessionId column to jobs');
  }

  // Shortlinks sessionId migration
  const shortlinkCols = db.prepare("PRAGMA table_info(shortlinks)").all();
  const shortlinkColNames = shortlinkCols.map(c => c.name);
  if (!shortlinkColNames.includes('sessionId')) {
    db.exec('ALTER TABLE shortlinks ADD COLUMN sessionId TEXT');
    console.log('Migration: Added sessionId column to shortlinks');
  }

  // Clips table migration
  const clipColumns = db.prepare("PRAGMA table_info(clips)").all();
  const clipColumnNames = clipColumns.map(c => c.name);
  if (clipColumnNames.length > 0) {
    const clipMetaCols = ['width', 'height', 'fps', 'bitrate', 'videoCodec', 'audioCodec'];
    for (const col of clipMetaCols) {
      if (!clipColumnNames.includes(col)) {
        db.exec(`ALTER TABLE clips ADD COLUMN ${col} ${col === 'fps' ? 'REAL' : col === 'bitrate' ? 'INTEGER' : 'TEXT'}`);
        console.log(`Migration: Added ${col} column to clips`);
      }
    }
  }
} catch (err) {
  console.error('Migration error:', err);
}

// Prepared statements
const statements = {
  // Jobs
  createJob: db.prepare(`
    INSERT INTO jobs (id, type, status, createdAt, inputJson, sessionId)
    VALUES (?, ?, 'queued', ?, ?, ?)
  `),

  getJobById: db.prepare(`
    SELECT * FROM jobs WHERE id = ?
  `),

  countActiveJobsBySession: db.prepare(`
    SELECT COUNT(*) as count FROM jobs WHERE sessionId = ? AND status IN ('queued', 'running') AND deleted = 0
  `),

  countActiveJobsTotal: db.prepare(`
    SELECT COUNT(*) as count FROM jobs WHERE status IN ('queued', 'running') AND deleted = 0
  `),

  getRecentJobs: db.prepare(`
    SELECT * FROM jobs ORDER BY createdAt DESC LIMIT ?
  `),

  getJobsBySession: db.prepare(`
    SELECT * FROM jobs WHERE sessionId = ? ORDER BY createdAt DESC LIMIT ?
  `),

  updateJobStatus: db.prepare(`
    UPDATE jobs SET status = ?, startedAt = ? WHERE id = ?
  `),

  updateJobProgress: db.prepare(`
    UPDATE jobs SET progress = ?, logsTail = ? WHERE id = ?
  `),

  finishJob: db.prepare(`
    UPDATE jobs SET status = ?, finishedAt = ?, outputJson = ?, error = ?, expiresAt = ? WHERE id = ?
  `),

  deleteJob: db.prepare(`
    UPDATE jobs SET status = 'deleted', deletedAt = ?, deleted = 1 WHERE id = ?
  `),

  cancelJob: db.prepare(`
    UPDATE jobs SET isCancelling = 1 WHERE id = ? AND status IN ('queued', 'running')
  `),

  expireJob: db.prepare(`
    UPDATE jobs SET status = 'expired' WHERE id = ?
  `),

  getExpiredJobs: db.prepare(`
    SELECT * FROM jobs WHERE status = 'done' AND deleted = 0 AND expiresAt < ?
  `),

  getJobsToCancel: db.prepare(`
    SELECT id FROM jobs WHERE isCancelling = 1 AND status IN ('queued', 'running')
  `),

  claimNextJob: db.prepare(`
    UPDATE jobs SET status = 'running', startedAt = ? 
    WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY createdAt ASC LIMIT 1)
    RETURNING *
  `),

  // Shortlinks
  createShortlink: db.prepare(`
    INSERT INTO shortlinks (slug, targetUrl, createdAt, sessionId)
    VALUES (?, ?, ?, ?)
  `),

  getShortlink: db.prepare(`
    SELECT * FROM shortlinks WHERE slug = ?
  `),

  incrementClicks: db.prepare(`
    UPDATE shortlinks SET clicks = clicks + 1 WHERE slug = ?
  `),

  getAllShortlinks: db.prepare(`
    SELECT * FROM shortlinks ORDER BY createdAt DESC
  `),

  getShortlinksBySession: db.prepare(`
    SELECT * FROM shortlinks WHERE sessionId = ? ORDER BY createdAt DESC
  `),

  deleteShortlink: db.prepare(`
    DELETE FROM shortlinks WHERE slug = ?
  `),

  // Drops
  createDrop: db.prepare(`
    INSERT INTO drops (token, filename, path, size, createdAt, expiresAt, sessionId, password)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),

  getDrop: db.prepare(`
    SELECT * FROM drops WHERE token = ?
  `),

  incrementDownloads: db.prepare(`
    UPDATE drops SET downloads = downloads + 1 WHERE token = ?
  `),

  getAllDrops: db.prepare(`
    SELECT * FROM drops ORDER BY createdAt DESC
  `),

  getDropsBySession: db.prepare(`
    SELECT * FROM drops WHERE sessionId = ? ORDER BY createdAt DESC
  `),

  expireDrop: db.prepare(`
    UPDATE drops SET deleted = 1 WHERE token = ?
  `),

  getExpiredDrops: db.prepare(`
    SELECT * FROM drops WHERE deleted = 0 AND expiresAt < ?
  `),

  deleteDrop: db.prepare(`
    DELETE FROM drops WHERE token = ?
  `),

  // Clips
  createClip: db.prepare(`
    INSERT INTO clips (token, filename, path, size, duration, width, height, fps, bitrate, videoCodec, audioCodec, downloads, createdAt, expiresAt, deleted, sessionId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?)
  `),

  getClip: db.prepare(`
    SELECT * FROM clips WHERE token = ?
  `),

  getAllClips: db.prepare(`
    SELECT * FROM clips WHERE deleted = 0 ORDER BY createdAt DESC
  `),

  getClipsBySession: db.prepare(`
    SELECT * FROM clips WHERE sessionId = ? AND deleted = 0 ORDER BY createdAt DESC
  `),

  incrementClipViews: db.prepare(`
    UPDATE clips SET downloads = downloads + 1 WHERE token = ?
  `),

  expireClip: db.prepare(`
    UPDATE clips SET deleted = 1 WHERE token = ?
  `),

  deleteClip: db.prepare(`
    UPDATE clips SET deleted = 1 WHERE token = ?
  `),

  getExpiredClips: db.prepare(`
    SELECT * FROM clips WHERE deleted = 0 AND expiresAt < ?
  `)
};

module.exports = { db, statements, DATA_DIR };
