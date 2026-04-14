const Database = require('better-sqlite3');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_PATH = path.join(DATA_DIR, 'tools.db');
const POLL_INTERVAL = 1000;
const MAX_PROCESS_TIME = 30 * 60 * 1000;

function safePath(baseDir, relativePath) {
  const resolved = path.resolve(baseDir, relativePath);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new Error('Invalid path: traversal detected');
  }
  return resolved;
}

['downloads', 'converted', 'uploads', 'drops', 'clips-temp'].forEach(dir => {
  const dirPath = path.join(DATA_DIR, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

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

function checkDiskSpace(requiredMB = 500) {
  try {
    const stat = fs.statfsSync(DATA_DIR);
    const availableBytes = stat.bavail * stat.bsize;
    const availableMB = availableBytes / (1024 * 1024);
    if (availableMB < requiredMB) {
      return false;
    }
    return true;
  } catch (e) {
    return true;
  }
}

function getAudioDuration(filePath) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath
    ], { encoding: 'utf8', timeout: 30000 }).trim();
    return parseFloat(out) || 0;
  } catch (e) { return 0; }
}

async function processDownloadJob(job) {
  const input = JSON.parse(job.inputJson);
  const { url, preset, presetConfig, isAdmin } = input;
  const jobId = job.id;

  if (!checkDiskSpace(500)) {
    finishWithError(jobId, 'Insufficient disk space on server');
    return;
  }

  const outputDir = safePath(DATA_DIR, path.join('downloads', jobId));
  fs.mkdirSync(outputDir, { recursive: true });
  const outputTemplate = path.join(outputDir, '%(extractor)s_%(uploader)s_%(upload_date)s_%(title)s_%(id)s.%(ext)s');

  const args = [
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '--force-ipv4',
    '--socket-timeout', '15',
    '-o', outputTemplate,
  ];

  if (presetConfig.extractAudio) {
    args.push('-x');
    args.push('--audio-format', presetConfig.audioFormat);
    args.push('--audio-quality', presetConfig.audioQuality);
  } else {
    args.push('-f', presetConfig.format);
    if (presetConfig.mergeOutputFormat) {
      args.push('--merge-output-format', presetConfig.mergeOutputFormat);
    }
  }

  args.push(url);

  return new Promise((resolve, reject) => {
    const ytdlp = spawn('yt-dlp', args);
    activeProcesses.set(jobId, ytdlp);
    let logsTail = '';
    let lastProgress = 0;
    let lastProgressUpdate = 0;

    let timedOut = false;

    const processTimer = setTimeout(() => {
      timedOut = true;
      ytdlp.kill('SIGKILL');
      finishWithError(jobId, 'Job timed out after 30 minutes');
    }, MAX_PROCESS_TIME);

    ytdlp.stdout.on('data', (data) => {
      const text = data.toString();
      logsTail = logsTail + text;
      if (logsTail.length > 5000) {
        logsTail = logsTail.slice(-5000);
      }

      const progressMatch = text.match(/(\d+\.?\d*)%/);
      if (progressMatch) {
        lastProgress = Math.round(parseFloat(progressMatch[1]));
        if (Date.now() - lastProgressUpdate >= 500) {
          updateProgress(jobId, lastProgress, logsTail);
          lastProgressUpdate = Date.now();
        }
      }
    });

    ytdlp.stderr.on('data', (data) => {
      logsTail = logsTail + data.toString();
      if (logsTail.length > 5000) {
        logsTail = logsTail.slice(-5000);
      }
    });

    ytdlp.on('close', (code, signal) => {
      clearTimeout(processTimer);
      activeProcesses.delete(jobId);

      if (signal === 'SIGKILL') {
        if (!timedOut) {
          finishWithError(jobId, 'Cancelled by user');
        }
        resolve();
      } else if (code === 0) {
        try {
          const files = fs.readdirSync(outputDir).map(filename => {
            const filePath = path.join(outputDir, filename);
            const stat = fs.statSync(filePath);
            return {
              filename,
              path: `downloads/${jobId}/${filename}`,
              size: stat.size
            };
          });

          updateProgress(jobId, 100, logsTail);
          finishWithSuccess(jobId, { files }, isAdmin, job.sessionId);
          resolve();
        } catch (e) {
          finishWithError(jobId, 'Failed to process output');
          reject(e);
        }
      } else {
        finishWithError(jobId, `yt-dlp exited with code ${code}: ${logsTail.slice(-1000)}`);
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    ytdlp.on('error', (err) => {
      clearTimeout(processTimer);
      activeProcesses.delete(jobId);
      finishWithError(jobId, `Failed to start yt-dlp: ${err.message}`);
      reject(err);
    });
  });
}

async function processConvertJob(job) {
  const input = JSON.parse(job.inputJson);
  const { source, options, isAdmin } = input;
  const jobId = job.id;

  if (!checkDiskSpace(200)) {
    finishWithError(jobId, 'Insufficient disk space on server');
    return;
  }

  let inputPath;
  if (source.type === 'upload') {
    inputPath = safePath(DATA_DIR, source.path);
  } else if (source.type === 'path') {
    inputPath = safePath(DATA_DIR, source.path);
  } else {
    finishWithError(jobId, 'Invalid source type');
    return;
  }

  if (!fs.existsSync(inputPath)) {
    finishWithError(jobId, 'Input file not found');
    return;
  }

  const outputDir = safePath(DATA_DIR, path.join('converted', String(jobId)));
  fs.mkdirSync(outputDir, { recursive: true });

  const outputExt = options.format;
  const outputPath = path.join(outputDir, `output.${outputExt}`);
  const inputDuration = getAudioDuration(inputPath);

  const args = ['-i', inputPath];

  if (options.trim) {
    if (options.trim.startSec !== undefined) {
      args.push('-ss', String(options.trim.startSec));
    }
    if (options.trim.endSec !== undefined) {
      args.push('-to', String(options.trim.endSec));
    }
  }

  if (options.normalize && options.normalize.enabled) {
    const targetLufs = Number(options.normalize.targetLufs);
    if (isNaN(targetLufs) || targetLufs < -70 || targetLufs > 0) {
      finishWithError(jobId, 'Invalid normalization target');
      return;
    }
    args.push('-af', `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11`);
  }

  if (options.audioBitrate) {
    args.push('-b:a', `${options.audioBitrate}k`);
  }

  args.push('-y', outputPath);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args);
    activeProcesses.set(jobId, ffmpeg);
    let logsTail = '';
    let lastProgressUpdate = 0;

    let timedOut = false;

    const processTimer = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill('SIGKILL');
      finishWithError(jobId, 'Job timed out after 30 minutes');
    }, MAX_PROCESS_TIME);

    ffmpeg.stderr.on('data', (data) => {
      const text = data.toString();
      logsTail = logsTail + text;
      if (logsTail.length > 5000) {
        logsTail = logsTail.slice(-5000);
      }

      if (inputDuration > 0) {
        const timeMatch = text.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
        if (timeMatch) {
          const current = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 100;
          const progress = Math.min(Math.round((current / inputDuration) * 100), 100);
          if (Date.now() - lastProgressUpdate >= 500) {
            updateProgress(jobId, progress, logsTail);
            lastProgressUpdate = Date.now();
          }
        }
      }
    });

    ffmpeg.on('close', (code, signal) => {
      clearTimeout(processTimer);
      activeProcesses.delete(jobId);

      if (signal === 'SIGKILL') {
        if (!timedOut) {
          finishWithError(jobId, 'Cancelled by user');
        }
        resolve();
      } else if (code === 0) {
        try {
          const stat = fs.statSync(outputPath);
          updateProgress(jobId, 100, logsTail);
          finishWithSuccess(jobId, {
            files: [{
              filename: `output.${outputExt}`,
              path: `converted/${jobId}/output.${outputExt}`,
              size: stat.size
            }]
          }, isAdmin, job.sessionId);
          if (source.type === 'upload' && source.path) {
            try {
              const uploadPath = safePath(DATA_DIR, source.path);
              if (fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
            } catch (e) { console.error('Failed to cleanup upload:', e.message); }
          }
          resolve();
        } catch (e) {
          finishWithError(jobId, 'Failed to process output');
          reject(e);
        }
      } else {
        finishWithError(jobId, `ffmpeg exited with code ${code}: ${logsTail.slice(-1000)}`);
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(processTimer);
      activeProcesses.delete(jobId);
      finishWithError(jobId, `Failed to start ffmpeg: ${err.message}`);
      reject(err);
    });
  });
}

async function processJob(job) {
  if (job.type === 'download') {
    return processDownloadJob(job);
  } else if (job.type === 'convert') {
    return processConvertJob(job);
  } else {
    throw new Error(`Unknown job type: ${job.type}`);
  }
}

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
        } catch (e) { }
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
        } catch (e) { }
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
        } catch (e) { }
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
        } catch (e) { }
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

    const uploadsDir = path.join(DATA_DIR, 'uploads');
    if (fs.existsSync(uploadsDir)) {
      const knownJobIds = new Set(
        db.prepare(`SELECT id FROM jobs WHERE deleted = 0`).all().map(r => r.id)
      );
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
              const referenced = knownJobIds.has(entry.split('-')[0]);
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
      path.join(DATA_DIR, 'clips-temp'),
    ];
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const tempDir of tempDirs) {
      if (!fs.existsSync(tempDir)) continue;
      for (const entry of fs.readdirSync(tempDir)) {
        const entryPath = path.join(tempDir, entry);
        try {
          const stat = fs.statSync(entryPath);
          if (stat.mtimeMs < oneHourAgo) {
            if (stat.isDirectory()) {
              fs.rmSync(entryPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(entryPath);
            }
          }
        } catch (e) { }
      }
    }

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
    } catch (e) { }
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
