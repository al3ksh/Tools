const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const DATA_DIR = path.join(process.cwd(), 'data');
const SESSION_ID = `smoke-${Date.now()}`;
const OUTPUTS = [];
const JOBS = [];
let clipToken = null;

function log(message) {
  console.log(`[smoke] ${message}`);
}

function writeMinimalPdf(filePath) {
  const content = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 120 120] >> endobj',
    'xref',
    '0 4',
    '0000000000 65535 f ',
    '0000000009 00000 n ',
    '0000000058 00000 n ',
    '0000000115 00000 n ',
    'trailer << /Root 1 0 R /Size 4 >>',
    'startxref',
    '185',
    '%%EOF'
  ].join('\n');
  fs.writeFileSync(filePath, content);
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function createSmokeFiles() {
  ensureDataDir();
  const pdfA = path.join(DATA_DIR, 'codex-smoke-a.pdf');
  const pdfB = path.join(DATA_DIR, 'codex-smoke-b.pdf');
  const png = path.join(DATA_DIR, 'codex-smoke.png');
  const mp4 = path.join(DATA_DIR, 'codex-smoke.mp4');

  writeMinimalPdf(pdfA);
  writeMinimalPdf(pdfB);
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'));

  execFileSync('docker', [
    'compose', 'exec', '-T', 'worker',
    'ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.5',
    '-pix_fmt', 'yuv420p', '/data/codex-smoke.mp4'
  ], { stdio: 'ignore' });

  OUTPUTS.push(pdfA, pdfB, png, mp4);
  return { pdfA, pdfB, png, mp4 };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `${options.method || 'GET'} ${url} failed with ${response.status}`);
  }
  return data;
}

async function waitForJob(jobId, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = await requestJson(`${BASE_URL}/api/jobs/${jobId}?sessionId=${encodeURIComponent(SESSION_ID)}`);
    if (job.status === 'done') return job;
    if (job.status === 'failed') throw new Error(`Job ${jobId} failed: ${job.error}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

async function downloadJobFile(jobId, outputPath) {
  const response = await fetch(`${BASE_URL}/api/files/${jobId}?sessionId=${encodeURIComponent(SESSION_ID)}`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Download failed with ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error('Downloaded file is empty');
  fs.writeFileSync(outputPath, buffer);
  OUTPUTS.push(outputPath);
  return buffer.length;
}

async function runPdfSmoke(files) {
  const form = new FormData();
  form.append('sessionId', SESSION_ID);
  form.append('files', new Blob([fs.readFileSync(files.pdfA)], { type: 'application/pdf' }), 'codex-smoke-a.pdf');
  form.append('files', new Blob([fs.readFileSync(files.pdfB)], { type: 'application/pdf' }), 'codex-smoke-b.pdf');

  const created = await requestJson(`${BASE_URL}/api/pdf/merge`, { method: 'POST', body: form });
  JOBS.push(created.jobId);
  const job = await waitForJob(created.jobId);
  const size = await downloadJobFile(created.jobId, path.join(DATA_DIR, 'codex-smoke-merged.pdf'));
  log(`PDF merge OK (${job.id}, ${size} bytes)`);
}

async function runGifSmoke(files) {
  const form = new FormData();
  form.append('sessionId', SESSION_ID);
  form.append('file', new Blob([fs.readFileSync(files.png)], { type: 'image/png' }), 'codex-smoke.png');
  form.append('fps', '10');
  form.append('width', '120');

  const created = await requestJson(`${BASE_URL}/api/gif/process`, { method: 'POST', body: form });
  JOBS.push(created.jobId);
  const job = await waitForJob(created.jobId);
  const size = await downloadJobFile(created.jobId, path.join(DATA_DIR, 'codex-smoke.gif'));
  log(`GIF render OK (${job.id}, ${size} bytes)`);
}

async function runClipSmoke(files) {
  const uploadId = `codexsmoke${Date.now()}`;
  const body = fs.readFileSync(files.mp4);
  const end = body.length - 1;
  const uploadResponse = await fetch(`${BASE_URL}/api/clip/upload-chunk`, {
    method: 'POST',
    headers: {
      'X-Upload-Id': uploadId,
      'Content-Range': `bytes 0-${end}/${body.length}`,
      'Content-Type': 'application/octet-stream'
    },
    body
  });
  const uploadData = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok) throw new Error(uploadData.error || 'Clip chunk upload failed');

  const created = await requestJson(`${BASE_URL}/api/clip/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uploadId,
      filename: 'codex-smoke.mp4',
      sessionId: SESSION_ID,
      duration: 0.5
    })
  });
  JOBS.push(created.jobId);
  const job = await waitForJob(created.jobId);
  clipToken = job.outputJson && job.outputJson.clip && job.outputJson.clip.token;
  if (!clipToken) throw new Error('Clip job completed without token');

  const info = await requestJson(`${BASE_URL}/api/clip/${clipToken}/info`);
  if (!info.size || info.size <= 0) throw new Error('Clip info returned empty size');
  log(`Clip finalize OK (${job.id}, token ${clipToken}, ${info.size} bytes)`);
}

async function cleanup() {
  for (const jobId of JOBS) {
    try {
      await fetch(`${BASE_URL}/api/jobs/${jobId}?sessionId=${encodeURIComponent(SESSION_ID)}`, { method: 'DELETE' });
    } catch (e) {}
  }

  if (clipToken) {
    try {
      await fetch(`${BASE_URL}/api/clip/${clipToken}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: SESSION_ID })
      });
    } catch (e) {}
  }

  for (const filePath of OUTPUTS) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {}
  }
}

async function main() {
  const files = createSmokeFiles();
  try {
    await requestJson(`${BASE_URL}/api/health`);
    await runPdfSmoke(files);
    await runGifSmoke(files);
    await runClipSmoke(files);
    log('All smoke checks passed');
  } finally {
    await cleanup();
  }
}

main().catch(async (err) => {
  console.error(`[smoke] ${err.message}`);
  await cleanup();
  process.exit(1);
});
