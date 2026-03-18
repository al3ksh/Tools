const Database = require('better-sqlite3');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { PRESETS, JOB_STATUS } = require('../../../packages/shared/types');

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

// Ensure directories exist
['downloads', 'converted', 'uploads'].forEach(dir => {
  const dirPath = path.join(DATA_DIR, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Active processes map for cancellation
const activeProcesses = new Map();

// Prepared statements
const claimNextJob = db.prepare(`
  UPDATE jobs SET status = 'running', startedAt = ? 
  WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY createdAt ASC LIMIT 1)
  RETURNING *
`);

const updateJobProgress = db.prepare(`
  UPDATE jobs SET progress = ?, logsTail = ? WHERE id = ?
`);

const finishJob = db.prepare(`
  UPDATE jobs SET status = ?, finishedAt = ?, outputJson = ?, error = ?, expiresAt = ? WHERE id = ?
`);

function updateProgress(jobId, progress, logsTail) {
  updateJobProgress.run(progress, logsTail, jobId);
}

function finishWithSuccess(jobId, outputJson, isAdmin = false) {
  // Set expiration to 1 hour from now for guests, null for admins
  const expiresAt = isAdmin ? null : new Date(Date.now() + 60 * 60 * 1000).toISOString();
  finishJob.run('done', new Date().toISOString(), JSON.stringify(outputJson), null, expiresAt, jobId);
}

function finishWithError(jobId, error) {
  finishJob.run('failed', new Date().toISOString(), null, error, null, jobId);
}

// Download job processor
async function processDownloadJob(job) {
  const input = JSON.parse(job.inputJson);
  const { url, preset, presetConfig, isAdmin } = input;
  const jobId = job.id;

  const outputDir = safePath(DATA_DIR, 'downloads');
  fs.mkdirSync(path.join(outputDir, jobId), { recursive: true });
  const outputTemplate = path.join(outputDir, jobId, '%(extractor)s_%(uploader)s_%(upload_date)s_%(title)s_%(id)s.%(ext)s');

  const args = [
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '-o', outputTemplate,
  ];

  // Preset-specific options
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

    const processTimer = setTimeout(() => {
      ytdlp.kill('SIGKILL');
      finishWithError(jobId, 'Job timed out after 30 minutes');
    }, MAX_PROCESS_TIME);

    ytdlp.stdout.on('data', (data) => {
      const text = data.toString();
      logsTail = logsTail + text;
      if (logsTail.length > 5000) {
        logsTail = logsTail.slice(-5000);
      }

      // Parse progress from yt-dlp output
      const progressMatch = text.match(/(\d+\.?\d*)%/);
      if (progressMatch) {
        lastProgress = Math.round(parseFloat(progressMatch[1]));
        updateProgress(jobId, lastProgress, logsTail);
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
        finishWithError(jobId, 'Cancelled by user');
        resolve();
      } else if (code === 0) {
        try {
          // List created files
          const files = fs.readdirSync(path.join(outputDir, jobId)).map(filename => {
            const filePath = path.join(outputDir, jobId, filename);
            const stat = fs.statSync(filePath);
            return {
              filename,
              path: `downloads/${jobId}/${filename}`,
              size: stat.size
            };
          });

          finishWithSuccess(jobId, { files }, isAdmin);
          resolve();
        } catch (e) {
          finishWithError(jobId, `Failed to post-process output: ${e.message}`);
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

// Convert job processor
async function processConvertJob(job) {
  const input = JSON.parse(job.inputJson);
  const { source, options, isAdmin } = input;
  const jobId = job.id;

  let inputPath;
  if (source.type === 'upload') {
    inputPath = safePath(DATA_DIR, source.path);
  } else if (source.type === 'path') {
    inputPath = safePath(DATA_DIR, source.path);
  } else {
    throw new Error('Invalid source type');
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const outputDir = safePath(DATA_DIR, path.join('converted', String(jobId)));
  fs.mkdirSync(outputDir, { recursive: true });

  const outputExt = options.format;
  const outputPath = path.join(outputDir, `output.${outputExt}`);

  function getAudioDuration(filePath) {
    try {
      const { execFileSync } = require('child_process');
      const out = execFileSync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath
      ], { encoding: 'utf8' }).trim();
      return parseFloat(out) || 0;
    } catch (e) { return 0; }
  }

  const inputDuration = getAudioDuration(inputPath);

  // Build ffmpeg command
  const args = ['-i', inputPath];

  // Trim options
  if (options.trim) {
    if (options.trim.startSec !== undefined) {
      args.push('-ss', String(options.trim.startSec));
    }
    if (options.trim.endSec !== undefined) {
      args.push('-to', String(options.trim.endSec));
    }
  }

  // Normalization
  if (options.normalize && options.normalize.enabled) {
    const targetLufs = options.normalize.targetLufs || -14;
    args.push('-af', `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11`);
  }

  // Audio bitrate
  if (options.audioBitrate) {
    args.push('-b:a', `${options.audioBitrate}k`);
  }

  // Output format
  args.push('-y', outputPath);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args);
    activeProcesses.set(jobId, ffmpeg);
    let logsTail = '';

    const processTimer = setTimeout(() => {
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
          db.prepare('UPDATE jobs SET progress = ? WHERE id = ?').run(progress, jobId);
        }
      }
    });

    ffmpeg.on('close', (code, signal) => {
      clearTimeout(processTimer);
      activeProcesses.delete(jobId);

      if (signal === 'SIGKILL') {
        finishWithError(jobId, 'Cancelled by user');
        resolve();
      } else if (code === 0) {
        try {
          const stat = fs.statSync(outputPath);
          finishWithSuccess(jobId, {
            files: [{
              filename: `output.${outputExt}`,
              path: `converted/${jobId}/output.${outputExt}`,
              size: stat.size
            }]
          }, isAdmin);
          resolve();
        } catch (e) {
          finishWithError(jobId, `Failed to post-process output: ${e.message}`);
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

// Job processor
async function processJob(job) {
  if (job.type === 'download') {
    return processDownloadJob(job);
  } else if (job.type === 'convert') {
    return processConvertJob(job);
  } else {
    throw new Error(`Unknown job type: ${job.type}`);
  }
}

// Main polling loop
async function pollAndProcess() {
  try {
    const job = claimNextJob.get(new Date().toISOString());

    if (job) {
      console.log(`Processing job ${job.id} (type: ${job.type})`);
      try {
        await processJob(job);
        console.log(`Job ${job.id} completed`);
      } catch (err) {
        console.error(`Job ${job.id} failed:`, err.message);
        // Error already handled in processJob
      }
    }
  } catch (err) {
    console.error('Polling error:', err);
  }
}

console.log('Worker starting...');
console.log(`Data directory: ${DATA_DIR}`);
console.log(`Database: ${DB_PATH}`);

// Cleanup expired jobs every 5 minutes
async function cleanupExpiredJobs() {
  try {
    const now = new Date().toISOString();
    const expiredJobs = db.prepare(`
      SELECT * FROM jobs WHERE status = 'done' AND expiresAt < ? AND deletedAt IS NULL
    `).all(now);

    for (const job of expiredJobs) {
      console.log(`Expiring job ${job.id}`);
      db.prepare(`UPDATE jobs SET status = 'expired' WHERE id = ?`).run(job.id);

      // Delete files
      const dirs = ['downloads', 'converted'];
      for (const dir of dirs) {
        const jobDir = path.join(DATA_DIR, dir, job.id);
        if (fs.existsSync(jobDir)) {
          fs.rmSync(jobDir, { recursive: true, force: true });
        }
      }
    }

    const expiredDrops = db.prepare(`
      SELECT * FROM drops WHERE deleted = 0 AND expiresAt < ?
    `).all(now);

    for (const drop of expiredDrops) {
      console.log(`Expiring drop ${drop.token}`);
      db.prepare(`UPDATE drops SET deleted = 1 WHERE token = ?`).run(drop.token);

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

    const staleJobs = db.prepare(`
      SELECT * FROM jobs WHERE status = 'failed' AND finishedAt < ?
    `).all(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    for (const job of staleJobs) {
      console.log(`Cleaning up failed job ${job.id}`);
      for (const dir of ['downloads', 'converted']) {
        const jobDir = path.join(DATA_DIR, dir, job.id);
        if (fs.existsSync(jobDir)) {
          try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (e) { }
        }
      }
    }

    if (staleJobs.length > 0) {
      console.log(`Cleaned up ${staleJobs.length} stale failed jobs`);
    }
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

// Poll and cancel jobs
function pollAndCancel() {
  try {
    const jobsToCancel = db.prepare(`SELECT id FROM jobs WHERE isCancelling = 1 AND status IN ('queued', 'running')`).all();

    for (const { id } of jobsToCancel) {
      if (activeProcesses.has(id)) {
        console.log(`Killing process for job ${id}`);
        const proc = activeProcesses.get(id);
        proc.kill('SIGKILL');
        activeProcesses.delete(id);
      } else {
        // Fix for queued jobs that were never run, or somehow stuck
        console.log(`Cancelling hanging/queued job ${id}`);
        finishWithError(id, 'Cancelled by user');
      }
      db.prepare(`UPDATE jobs SET isCancelling = 0 WHERE id = ?`).run(id);
    }
  } catch (err) {
    console.error('Cancellation polling error:', err);
  }
}

setInterval(pollAndProcess, POLL_INTERVAL);
setInterval(pollAndCancel, POLL_INTERVAL);
setInterval(cleanupExpiredJobs, 5 * 60 * 1000); // Every 5 minutes
pollAndProcess(); // Initial poll
cleanupExpiredJobs(); // Initial cleanup
