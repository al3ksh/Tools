const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const createJobProcessor = require('./jobs');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_PATH = path.join(DATA_DIR, 'tools.db');
const POLL_INTERVAL = 1000;
const MAX_PROCESS_TIME = 30 * 60 * 1000;
const DB_SCHEMA_WAIT_MS = parseInt(process.env.DB_SCHEMA_WAIT_MS || '60000', 10);

function safePath(baseDir, relativePath) {
  const resolved = path.resolve(baseDir, relativePath);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new Error('Invalid path: traversal detected');
  }
  return resolved;
}

['downloads', 'converted', 'uploads', 'drops', 'clips', 'clips-temp'].forEach(dir => {
  const dirPath = path.join(DATA_DIR, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function openDatabase() {
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start < DB_SCHEMA_WAIT_MS) {
    try {
      const candidate = new Database(DB_PATH, { fileMustExist: true });
      const jobsTable = candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jobs'").get();
      if (jobsTable) return candidate;
      candidate.close();
      lastError = new Error('jobs table is not ready');
    } catch (err) {
      lastError = err;
    }

    console.log(`Waiting for API database schema: ${lastError.message}`);
    sleepSync(2000);
  }

  throw lastError || new Error('Database schema is not ready');
}

const db = openDatabase();
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('journal_size_limit = 67108864');

try {
  const sessionUsageTable = db.prepare("PRAGMA table_info(session_usage)").all();
  if (sessionUsageTable.length === 0) {
    db.exec(`CREATE TABLE IF NOT EXISTS session_usage (sessionId TEXT PRIMARY KEY, totalBytes INTEGER NOT NULL DEFAULT 0)`);
  }
} catch (e) {}

db.prepare(`UPDATE jobs SET status = 'failed', error = 'Worker restarted', finishedAt = ? WHERE status = 'running'`)
  .run(new Date().toISOString());
console.log('Reset orphaned running jobs from previous session');

const activeProcesses = new Map();

const claimNextJob = db.prepare(`
  UPDATE jobs SET status = 'running', startedAt = ? 
  WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND isCancelling = 0 ORDER BY createdAt ASC LIMIT 1)
  RETURNING *
`);

const updateJobProgress = db.prepare(`
  UPDATE jobs SET progress = ?, logsTail = ? WHERE id = ?
`);

const finishJob = db.prepare(`
  UPDATE jobs SET status = ?, finishedAt = ?, outputJson = ?, error = ?, expiresAt = ? WHERE id = ?
`);

const selectExpiredDoneJobs = db.prepare(`
  SELECT * FROM jobs WHERE status = 'done' AND expiresAt < ? AND deleted = 0
`);
const expireJob = db.prepare(`UPDATE jobs SET status = 'expired', deleted = 1 WHERE id = ?`);
const selectExpiredDrops = db.prepare(`
  SELECT * FROM drops WHERE deleted = 0 AND expiresAt < ?
`);
const expireDrop = db.prepare(`UPDATE drops SET deleted = 1 WHERE token = ?`);
const selectStaleFailedJobs = db.prepare(`
  SELECT * FROM jobs WHERE status = 'failed' AND finishedAt < ? AND deleted = 0
`);
const deleteStaleFailedJobs = db.prepare(`UPDATE jobs SET deleted = 1 WHERE id = ?`);
const selectExpiredClips = db.prepare(`
  SELECT * FROM clips WHERE deleted = 0 AND expiresAt < ?
`);
const expireClip = db.prepare(`UPDATE clips SET deleted = 1 WHERE token = ?`);
const selectExpiredShortlinks = db.prepare(`
  SELECT * FROM shortlinks WHERE deleted = 0 AND expiresAt IS NOT NULL AND expiresAt < ?
`);
const expireShortlink = db.prepare(`UPDATE shortlinks SET deleted = 1 WHERE slug = ?`);
const addSessionUsage = db.prepare(`
  INSERT INTO session_usage (sessionId, totalBytes) VALUES (?, ?)
  ON CONFLICT(sessionId) DO UPDATE SET totalBytes = totalBytes + ?
`);
const selectCancellingJobs = db.prepare(`
  SELECT id FROM jobs WHERE isCancelling = 1 AND status IN ('queued', 'running')
`);
const clearCancellingFlag = db.prepare(`UPDATE jobs SET isCancelling = 0 WHERE id = ?`);
const cancelIfCancellable = db.prepare(`
  UPDATE jobs SET status = 'failed', finishedAt = ?, error = ?, isCancelling = 0 WHERE id = ? AND status IN ('queued', 'running')
`);
const selectJobsWithInputs = db.prepare(`
  SELECT inputJson FROM jobs WHERE deleted = 0 AND status IN ('queued', 'running', 'done')
`);
const createClip = db.prepare(`
  INSERT INTO clips (token, filename, path, size, duration, width, height, fps, bitrate, videoCodec, audioCodec, createdAt, expiresAt, sessionId)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function updateProgress(jobId, progress, logsTail) {
  updateJobProgress.run(progress, logsTail, jobId);
}

function finishWithSuccess(jobId, outputJson, isAdmin = false, sessionId = null) {
  const expiresAt = isAdmin ? null : new Date(Date.now() + 60 * 60 * 1000).toISOString();
  finishJob.run('done', new Date().toISOString(), JSON.stringify(outputJson), null, expiresAt, jobId);

  if (sessionId && outputJson && outputJson.files) {
    const bytes = outputJson.files.reduce((sum, f) => sum + (f.size || 0), 0);
    if (bytes > 0) {
      try { addSessionUsage.run(sessionId, bytes, bytes); } catch (e) {}
    }
  }
}

function finishWithError(jobId, error) {
  finishJob.run('failed', new Date().toISOString(), null, error, null, jobId);
}

const processJob = createJobProcessor({
  DATA_DIR,
  MAX_PROCESS_TIME,
  db,
  activeProcesses,
  safePath,
  updateProgress,
  finishWithSuccess,
  finishWithError,
  addSessionUsage,
  createClip
});

let shuttingDown = false;
let processing = false;

async function pollAndProcess() {
  if (shuttingDown || processing) return;
  processing = true;
  try {
    const job = claimNextJob.get(new Date().toISOString());

    if (job) {
      console.log(`Processing job ${job.id} (type: ${job.type})`);
      try {
        await processJob(job);
        console.log(`Job ${job.id} completed`);
      } catch (err) {
        console.error(`Job ${job.id} failed:`, err.message);
      }
    }
  } catch (err) {
    console.error('Polling error:', err);
  } finally {
    processing = false;
  }
}

console.log('Worker starting...');
console.log(`Data directory: ${DATA_DIR}`);
console.log(`Database: ${DB_PATH}`);

async function cleanupExpiredJobs() {
  try {
    const now = new Date().toISOString();
    const expiredJobs = selectExpiredDoneJobs.all(now);

    for (const job of expiredJobs) {
      console.log(`Expiring job ${job.id}`);
      expireJob.run(job.id);

      const dirs = ['downloads', 'converted'];
      for (const dir of dirs) {
        try {
          const jobDir = safePath(DATA_DIR, path.join(dir, job.id));
          if (fs.existsSync(jobDir)) {
            fs.rmSync(jobDir, { recursive: true, force: true });
          }
        } catch (e) {}
      }
    }

    const expiredDrops = selectExpiredDrops.all(now);

    for (const drop of expiredDrops) {
      console.log(`Expiring drop ${drop.token}`);
      expireDrop.run(drop.token);

      const dropPath = safePath(DATA_DIR, drop.path);
      if (fs.existsSync(dropPath)) {
        try {
          fs.unlinkSync(dropPath);
        } catch (e) {}
      }
    }

    if (expiredJobs.length > 0 || expiredDrops.length > 0) {
      console.log(`Expired ${expiredJobs.length} jobs and ${expiredDrops.length} drops`);
    }

    const expiredClips = selectExpiredClips.all(now);
    for (const clip of expiredClips) {
      console.log(`Expiring clip ${clip.token}`);
      expireClip.run(clip.token);
      if (clip.path) {
        try {
          const clipPath = safePath(DATA_DIR, clip.path);
          if (fs.existsSync(clipPath)) fs.unlinkSync(clipPath);
        } catch (e) {}
      }
    }
    if (expiredClips.length > 0) {
      console.log(`Expired ${expiredClips.length} clips`);
    }

    const expiredLinks = selectExpiredShortlinks.all(now);
    for (const link of expiredLinks) {
      console.log(`Expiring shortlink ${link.slug}`);
      expireShortlink.run(link.slug);
    }
    if (expiredLinks.length > 0) {
      console.log(`Expired ${expiredLinks.length} shortlinks`);
    }

    const staleJobs = selectStaleFailedJobs.all(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    for (const job of staleJobs) {
      console.log(`Cleaning up failed job ${job.id}`);
      deleteStaleFailedJobs.run(job.id);
      for (const dir of ['downloads', 'converted']) {
        try {
          const jobDir = safePath(DATA_DIR, path.join(dir, job.id));
          if (fs.existsSync(jobDir)) {
            fs.rmSync(jobDir, { recursive: true, force: true });
          }
        } catch (e) {}
      }
    }

    if (staleJobs.length > 0) {
      console.log(`Cleaned up ${staleJobs.length} stale failed jobs`);
    }

    const ORPHAN_THRESHOLD = 5 * 60 * 1000;

    const knownDropPaths = new Set(
      db.prepare(`SELECT path FROM drops WHERE deleted = 0`).all().map(r => r.path)
    );
    const dropsDir = path.join(DATA_DIR, 'drops');
    if (fs.existsSync(dropsDir)) {
      for (const entry of fs.readdirSync(dropsDir)) {
        const entryPath = path.join(dropsDir, entry);
        try {
          const stat = fs.statSync(entryPath);
          if (stat.isFile() && stat.mtimeMs < Date.now() - ORPHAN_THRESHOLD) {
            const relativePath = path.relative(DATA_DIR, entryPath);
            if (!knownDropPaths.has(relativePath)) {
              fs.unlinkSync(entryPath);
              console.log(`Removed orphaned drop file: ${entry}`);
            }
          }
        } catch (e) {}
      }
    }

    const referencedUploadPaths = new Set();
    const referencedTempPaths = new Set();
    for (const row of selectJobsWithInputs.all()) {
      try {
        const input = row.inputJson ? JSON.parse(row.inputJson) : null;
        const sourcePath = input && input.source && input.source.path;
        if (sourcePath && sourcePath.startsWith('uploads/')) {
          referencedUploadPaths.add(path.normalize(sourcePath));
        }
        for (const file of input && input.files ? input.files : []) {
          if (file.path && file.path.startsWith('uploads/')) {
            referencedUploadPaths.add(path.normalize(file.path));
          }
        }
        if (input && input.processingDir) {
          referencedTempPaths.add(path.normalize(input.processingDir));
        }
      } catch (e) {}
    }

    const uploadsDir = path.join(DATA_DIR, 'uploads');
    if (fs.existsSync(uploadsDir)) {
      for (const dateDir of fs.readdirSync(uploadsDir)) {
        const dateDirPath = path.join(uploadsDir, dateDir);
        if (!fs.statSync(dateDirPath).isDirectory()) continue;
        try {
          const dirStat = fs.statSync(dateDirPath);
          if (dirStat.mtimeMs < Date.now() - ORPHAN_THRESHOLD && fs.readdirSync(dateDirPath).length === 0) {
            fs.rmSync(dateDirPath, { recursive: true, force: true });
            continue;
          }
        } catch (e) { continue; }
        for (const entry of fs.readdirSync(dateDirPath)) {
          const entryPath = path.join(dateDirPath, entry);
          try {
            const stat = fs.statSync(entryPath);
            if (stat.isFile() && stat.mtimeMs < Date.now() - ORPHAN_THRESHOLD) {
              const relativePath = path.normalize(path.relative(DATA_DIR, entryPath));
              const referenced = referencedUploadPaths.has(relativePath);
              if (!referenced) {
                fs.unlinkSync(entryPath);
                console.log(`Removed orphaned upload file: ${dateDir}/${entry}`);
              }
            }
          } catch (e) {}
        }
      }
    }

    const tempDirs = [
      path.join(DATA_DIR, 'uploads', 'gif-temp'),
      path.join(DATA_DIR, 'uploads', 'pdf-temp'),
      path.join(DATA_DIR, 'clips-temp')
    ];
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const tempDir of tempDirs) {
      if (!fs.existsSync(tempDir)) continue;
      for (const entry of fs.readdirSync(tempDir)) {
        const entryPath = path.join(tempDir, entry);
        try {
          const stat = fs.statSync(entryPath);
          if (stat.mtimeMs < oneHourAgo) {
            const relativePath = path.normalize(path.relative(DATA_DIR, entryPath));
            if (referencedUploadPaths.has(relativePath) || referencedTempPaths.has(relativePath)) continue;
            if (stat.isDirectory()) {
              fs.rmSync(entryPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(entryPath);
            }
          }
        } catch (e) {}
      }
    }

    try {
      db.pragma('wal_checkpoint(PASSIVE)');
    } catch (e) {}
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

function pollAndCancel() {
  try {
    const jobsToCancel = selectCancellingJobs.all();

    for (const { id } of jobsToCancel) {
      if (activeProcesses.has(id)) {
        console.log(`Killing process for job ${id}`);
        const proc = activeProcesses.get(id);
        proc.kill('SIGKILL');
        activeProcesses.delete(id);
      } else {
        console.log(`Cancelling hanging/queued job ${id}`);
        cancelIfCancellable.run(new Date().toISOString(), 'Cancelled by user', id);
      }
      clearCancellingFlag.run(id);
    }
  } catch (err) {
    console.error('Cancellation polling error:', err);
  }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Received shutdown signal, finishing current job...');

  for (const [jobId, proc] of activeProcesses) {
    try {
      proc.kill('SIGKILL');
      finishWithError(jobId, 'Worker shutting down');
    } catch (e) {}
  }

  setTimeout(() => {
    console.log('Worker shut down complete');
    process.exit(0);
  }, 5000);
}

setInterval(pollAndProcess, POLL_INTERVAL);
setInterval(pollAndCancel, POLL_INTERVAL);
setInterval(cleanupExpiredJobs, 5 * 60 * 1000);
pollAndProcess();
cleanupExpiredJobs();
