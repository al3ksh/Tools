const { PDFDocument, degrees } = require('pdf-lib');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function createJobProcessor(context) {
  const {
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
  } = context;

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

  function isStaticImage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif'].includes(ext);
  }

  function buildGifFilterChain({ fps, width, speed, reverse }) {
    const filters = [];

    if (speed !== 1) {
      filters.push(`setpts=PTS/${speed}`);
    }

    if (reverse) {
      filters.push('reverse');
    }

    filters.push(`fps=${fps}`);
    filters.push(`scale=${width}:-1:flags=lanczos`);

    return filters.join(',');
  }

  function parseChunkName(filename) {
    const match = filename.match(/^(\d+)-(\d+)\.chunk$/);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
    return { start, end, filename };
  }

  function getSortedClipChunks(processingDir, expectedTotal) {
    const chunks = fs.readdirSync(processingDir)
      .map(parseChunkName)
      .filter(Boolean)
      .sort((a, b) => a.start - b.start);

    let nextStart = 0;
    for (const chunk of chunks) {
      if (chunk.start !== nextStart) throw new Error('Incomplete upload');
      const chunkPath = path.join(processingDir, chunk.filename);
      const actualSize = fs.statSync(chunkPath).size;
      const declaredSize = chunk.end - chunk.start + 1;
      if (actualSize !== declaredSize) throw new Error('Corrupt upload chunk');
      nextStart = chunk.end + 1;
    }

    if (chunks.length === 0 || nextStart !== expectedTotal) throw new Error('Incomplete upload');
    return chunks;
  }

  function appendFileToStream(sourcePath, writeStream) {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(sourcePath);
      readStream.on('error', reject);
      writeStream.on('error', reject);
      readStream.on('end', resolve);
      readStream.pipe(writeStream, { end: false });
    });
  }

  async function mergeClipChunks(processingDir, chunks, outputPath) {
    const writeStream = fs.createWriteStream(outputPath);
    try {
      for (const chunk of chunks) {
        await appendFileToStream(path.join(processingDir, chunk.filename), writeStream);
      }
    } finally {
      await new Promise((resolve) => writeStream.end(resolve));
    }
  }

  function getVideoMeta(filePath) {
    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', filePath
      ]);
      let stdout = '';
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          ffprobe.kill('SIGKILL');
          resolve(null);
        }
      }, 30000);

      ffprobe.stdout.on('data', (d) => { stdout += d; });
      ffprobe.on('close', () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        try {
          const data = JSON.parse(stdout);
          const video = (data.streams || []).find(s => s.codec_type === 'video');
          const audio = (data.streams || []).find(s => s.codec_type === 'audio');
          resolve({
            duration: data.format && data.format.duration ? Number(data.format.duration) : null,
            width: video ? video.width : null,
            height: video ? video.height : null,
            fps: video && video.r_frame_rate ? parseFloat(video.r_frame_rate) : null,
            bitrate: data.format && data.format.bit_rate ? parseInt(data.format.bit_rate) : null,
            videoCodec: video ? video.codec_name : null,
            audioCodec: audio ? audio.codec_name : null
          });
        } catch (e) {
          resolve(null);
        }
      });
      ffprobe.on('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(null);
        }
      });
    });
  }

  async function processDownloadJob(job) {
    const input = JSON.parse(job.inputJson);
    const { url, presetConfig, isAdmin } = input;
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
      '-o', outputTemplate
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
        if (progressMatch && Date.now() - lastProgressUpdate >= 500) {
          updateProgress(jobId, Math.round(parseFloat(progressMatch[1])), logsTail);
          lastProgressUpdate = Date.now();
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
          try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (e) {}
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

  function cleanupInputFiles(files) {
    for (const file of files || []) {
      try {
        const filePath = safePath(DATA_DIR, file.path);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (e) {}
    }
  }

  async function processPdfJob(job) {
    const input = JSON.parse(job.inputJson);
    const { operation, files, options = {}, isAdmin } = input;
    const jobId = job.id;

    if (!Array.isArray(files) || files.length === 0) {
      finishWithError(jobId, 'No PDF input files found');
      return;
    }

    if (!checkDiskSpace(300)) {
      finishWithError(jobId, 'Insufficient disk space on server');
      return;
    }

    const outputDir = safePath(DATA_DIR, path.join('converted', String(jobId)));
    fs.mkdirSync(outputDir, { recursive: true });

    const outputNames = {
      merge: 'merged.pdf',
      split: 'extracted.pdf',
      rotate: 'rotated.pdf',
      'remove-pages': 'modified.pdf',
      'images-to-pdf': 'images.pdf',
      reorder: 'reordered.pdf'
    };
    const outputFilename = outputNames[operation] || 'output.pdf';
    const outputPath = path.join(outputDir, outputFilename);

    try {
      updateProgress(jobId, 5, `Starting PDF ${operation}`);

      if (operation === 'merge') {
        const mergedPdf = await PDFDocument.create();
        for (const [index, file] of files.entries()) {
          const pdfBytes = fs.readFileSync(safePath(DATA_DIR, file.path));
          const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
          const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
          pages.forEach(page => mergedPdf.addPage(page));
          updateProgress(jobId, Math.min(80, 10 + Math.round(((index + 1) / files.length) * 60)), `Merged ${index + 1}/${files.length} files`);
        }
        fs.writeFileSync(outputPath, Buffer.from(await mergedPdf.save()));
      } else if (operation === 'split') {
        const pdfBytes = fs.readFileSync(safePath(DATA_DIR, files[0].path));
        const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const validPages = (options.pages || []).filter(p => p >= 1 && p <= sourcePdf.getPageCount()).map(p => p - 1);
        if (validPages.length === 0) throw new Error('No valid pages specified');
        const newPdf = await PDFDocument.create();
        const copiedPages = await newPdf.copyPages(sourcePdf, validPages);
        copiedPages.forEach(page => newPdf.addPage(page));
        fs.writeFileSync(outputPath, Buffer.from(await newPdf.save()));
      } else if (operation === 'rotate') {
        const pdfBytes = fs.readFileSync(safePath(DATA_DIR, files[0].path));
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        for (const [pageStr, angle] of Object.entries(options.rotations || {})) {
          const pageIdx = parseInt(pageStr) - 1;
          if (pageIdx >= 0 && pageIdx < pdfDoc.getPageCount()) {
            const page = pdfDoc.getPage(pageIdx);
            const currentRotation = page.getRotation().angle;
            page.setRotation(degrees(currentRotation + angle));
          }
        }
        fs.writeFileSync(outputPath, Buffer.from(await pdfDoc.save()));
      } else if (operation === 'remove-pages') {
        const pdfBytes = fs.readFileSync(safePath(DATA_DIR, files[0].path));
        const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const removeSet = new Set((options.pages || []).map(p => p - 1));
        const keepPages = [];
        for (let i = 0; i < sourcePdf.getPageCount(); i++) {
          if (!removeSet.has(i)) keepPages.push(i);
        }
        if (keepPages.length === 0) throw new Error('Cannot remove all pages');
        const newPdf = await PDFDocument.create();
        const copiedPages = await newPdf.copyPages(sourcePdf, keepPages);
        copiedPages.forEach(page => newPdf.addPage(page));
        fs.writeFileSync(outputPath, Buffer.from(await newPdf.save()));
      } else if (operation === 'images-to-pdf') {
        const pdfDoc = await PDFDocument.create();
        for (const [index, file] of files.entries()) {
          const imageBytes = fs.readFileSync(safePath(DATA_DIR, file.path));
          const ext = path.extname(file.originalName).toLowerCase();
          let image;
          if (ext === '.png') {
            image = await pdfDoc.embedPng(imageBytes);
          } else if (['.jpg', '.jpeg'].includes(ext)) {
            image = await pdfDoc.embedJpg(imageBytes);
          } else {
            continue;
          }
          const page = pdfDoc.addPage([image.width, image.height]);
          page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
          updateProgress(jobId, Math.min(80, 10 + Math.round(((index + 1) / files.length) * 60)), `Added ${index + 1}/${files.length} images`);
        }
        fs.writeFileSync(outputPath, Buffer.from(await pdfDoc.save()));
      } else if (operation === 'reorder') {
        const pdfBytes = fs.readFileSync(safePath(DATA_DIR, files[0].path));
        const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const zeroOrder = (options.order || []).filter(p => p >= 1 && p <= sourcePdf.getPageCount()).map(p => p - 1);
        if (zeroOrder.length === 0) throw new Error('No valid pages in order');
        const newPdf = await PDFDocument.create();
        const copiedPages = await newPdf.copyPages(sourcePdf, zeroOrder);
        copiedPages.forEach(page => newPdf.addPage(page));
        fs.writeFileSync(outputPath, Buffer.from(await newPdf.save()));
      } else {
        throw new Error(`Unknown PDF operation: ${operation}`);
      }

      const stat = fs.statSync(outputPath);
      updateProgress(jobId, 100, `PDF ${operation} completed`);
      finishWithSuccess(jobId, {
        files: [{
          filename: outputFilename,
          path: `converted/${jobId}/${outputFilename}`,
          size: stat.size
        }]
      }, isAdmin, job.sessionId);
    } catch (err) {
      try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (e) {}
      finishWithError(jobId, err.message || 'PDF processing failed');
    } finally {
      cleanupInputFiles(files);
    }
  }

  async function processGifJob(job) {
    const input = JSON.parse(job.inputJson);
    const { files, options = {}, isAdmin } = input;
    const jobId = job.id;

    if (!Array.isArray(files) || files.length !== 1) {
      finishWithError(jobId, 'No GIF input file found');
      return;
    }

    if (!checkDiskSpace(300)) {
      finishWithError(jobId, 'Insufficient disk space on server');
      return;
    }

    let inputPath;
    try {
      inputPath = safePath(DATA_DIR, files[0].path);
    } catch (e) {
      finishWithError(jobId, 'Invalid input path');
      return;
    }

    if (!fs.existsSync(inputPath)) {
      finishWithError(jobId, 'Input file not found');
      return;
    }

    const outputDir = safePath(DATA_DIR, path.join('converted', String(jobId)));
    fs.mkdirSync(outputDir, { recursive: true });
    const outputFilename = options.preview ? 'preview.gif' : 'output.gif';
    const outputPath = path.join(outputDir, outputFilename);

    const fps = Math.min(Math.max(Number(options.fps) || 15, 5), 30);
    const widthRaw = Math.min(Math.max(Number(options.width) || 480, 120), 1080);
    const width = widthRaw % 2 === 0 ? widthRaw : widthRaw + 1;
    const speed = Math.min(Math.max(Number(options.speed) || 1, 0.25), 4);
    const loop = Math.min(Math.max(Number(options.loop) || 0, 0), 10);
    const reverse = options.reverse === true;
    const staticImage = options.staticImage === true || isStaticImage(inputPath);
    const finalFps = options.preview ? Math.min(fps, 12) : fps;
    const finalWidth = options.preview ? Math.min(width, 360) : width;
    const startSec = options.startSec !== undefined && options.startSec !== null ? Number(options.startSec) : null;
    const endSec = options.endSec !== undefined && options.endSec !== null ? Number(options.endSec) : null;

    const scaleFilter = `scale=${finalWidth}:-1:flags=lanczos`;
    const paletteFilter = `${scaleFilter},split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`;
    const args = ['-y'];

    if (staticImage) {
      args.push('-i', inputPath);
      args.push('-vf', paletteFilter);
      args.push('-loop', '0');
      args.push('-an', outputPath);
    } else {
      const chain = buildGifFilterChain({
        fps: finalFps,
        width: finalWidth,
        speed,
        reverse
      });

      if (!Number.isNaN(startSec) && startSec !== null && startSec >= 0) {
        args.push('-ss', String(startSec));
      }
      if (!Number.isNaN(endSec) && endSec !== null && endSec > 0) {
        args.push('-to', String(endSec));
      }

      args.push('-i', inputPath);
      args.push('-filter_complex', `[0:v]${chain},split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`);
      args.push('-loop', String(loop));
      args.push('-an', outputPath);
    }

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', args);
      activeProcesses.set(jobId, ffmpeg);
      let logsTail = '';
      let timedOut = false;

      updateProgress(jobId, 10, 'Starting GIF render');

      const processTimer = setTimeout(() => {
        timedOut = true;
        ffmpeg.kill('SIGKILL');
        finishWithError(jobId, 'GIF job timed out after 10 minutes');
      }, 10 * 60 * 1000);

      ffmpeg.stderr.on('data', (data) => {
        logsTail += data.toString();
        if (logsTail.length > 5000) logsTail = logsTail.slice(-5000);
        updateProgress(jobId, 50, logsTail);
      });

      ffmpeg.on('close', (code, signal) => {
        clearTimeout(processTimer);
        activeProcesses.delete(jobId);

        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (e) {}

        if (signal === 'SIGKILL') {
          if (!timedOut) {
            finishWithError(jobId, 'Cancelled by user');
          }
          resolve();
        } else if (code === 0 && fs.existsSync(outputPath)) {
          try {
            const stat = fs.statSync(outputPath);
            updateProgress(jobId, 100, logsTail);
            finishWithSuccess(jobId, {
              files: [{
                filename: outputFilename,
                path: `converted/${jobId}/${outputFilename}`,
                size: stat.size
              }]
            }, isAdmin, job.sessionId);
            resolve();
          } catch (e) {
            finishWithError(jobId, 'Failed to process GIF output');
            reject(e);
          }
        } else {
          try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (e) {}
          finishWithError(jobId, `ffmpeg exited with code ${code}: ${logsTail.slice(-1000)}`);
          reject(new Error(`Process exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
        clearTimeout(processTimer);
        activeProcesses.delete(jobId);
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (e) {}
        try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (e) {}
        finishWithError(jobId, `Failed to start ffmpeg: ${err.message}`);
        reject(err);
      });
    });
  }

  async function processClipJob(job) {
    const input = JSON.parse(job.inputJson);
    const jobId = job.id;
    const processingDir = safePath(DATA_DIR, input.processingDir);
    const ext = path.extname(input.filename || '').toLowerCase() || input.ext || '.mp4';
    const token = crypto.randomUUID().replace(/-/g, '').substring(0, 12);
    const outputPath = safePath(DATA_DIR, path.join('clips', `${token}${ext}`));
    const tempPath = safePath(DATA_DIR, path.join('clips-temp', `${input.uploadId}_merged${ext}`));

    if (!fs.existsSync(processingDir)) {
      finishWithError(jobId, 'Upload chunks not found');
      return;
    }

    try {
      updateProgress(jobId, 10, 'Validating clip chunks');
      const chunks = getSortedClipChunks(processingDir, input.expectedTotal);

      updateProgress(jobId, 30, 'Merging clip chunks');
      await mergeClipChunks(processingDir, chunks, tempPath);

      const trimStart = input.trimStart != null ? Number(input.trimStart) : null;
      const trimEnd = input.trimEnd != null ? Number(input.trimEnd) : null;
      const duration = input.duration != null ? Number(input.duration) : null;
      const needsTrim = (trimStart != null && trimStart > 0) || (trimEnd != null && duration != null && trimEnd < duration);

      if (needsTrim) {
        await new Promise((resolve, reject) => {
          const ss = trimStart || 0;
          const to = trimEnd || duration || null;
          const args = ['-y', '-i', tempPath];
          if (ss > 0) args.push('-ss', String(ss));
          if (to != null && to > ss) args.push('-to', String(to));
          args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero', outputPath);

          const ffmpeg = spawn('ffmpeg', args);
          activeProcesses.set(jobId, ffmpeg);
          let logsTail = '';
          let timedOut = false;

          updateProgress(jobId, 60, 'Trimming clip');

          const trimTimeout = setTimeout(() => {
            timedOut = true;
            ffmpeg.kill('SIGKILL');
            finishWithError(jobId, 'Video trimming timed out');
          }, 10 * 60 * 1000);

          ffmpeg.stderr.on('data', (data) => {
            logsTail += data.toString();
            if (logsTail.length > 5000) logsTail = logsTail.slice(-5000);
            updateProgress(jobId, 75, logsTail);
          });

          ffmpeg.on('close', (code, signal) => {
            clearTimeout(trimTimeout);
            activeProcesses.delete(jobId);

            if (signal === 'SIGKILL') {
              try { fs.unlinkSync(outputPath); } catch (e) {}
              if (!timedOut) finishWithError(jobId, 'Cancelled by user');
              resolve();
              return;
            }

            if (code !== 0 || !fs.existsSync(outputPath)) {
              try { fs.unlinkSync(outputPath); } catch (e) {}
              reject(new Error('Video trimming failed'));
              return;
            }

            resolve();
          });

          ffmpeg.on('error', (err) => {
            clearTimeout(trimTimeout);
            activeProcesses.delete(jobId);
            reject(err);
          });
        });

        const current = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId);
        if (current && current.status === 'failed') return;
      } else {
        fs.copyFileSync(tempPath, outputPath);
      }

      if (!fs.existsSync(outputPath)) {
        throw new Error('Clip file not created');
      }

      updateProgress(jobId, 90, 'Reading clip metadata');
      const meta = await getVideoMeta(outputPath);
      const stat = fs.statSync(outputPath);
      const createdAt = new Date().toISOString();
      const expiresAt = input.isAdmin ? null : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const actualDuration = duration || (meta && meta.duration) || null;

      createClip.run(
        token,
        input.filename,
        `clips/${token}${ext}`,
        stat.size,
        actualDuration ? parseFloat(actualDuration) : null,
        meta ? meta.width : null,
        meta ? meta.height : null,
        meta ? meta.fps : null,
        meta ? meta.bitrate : null,
        meta ? meta.videoCodec : null,
        meta ? meta.audioCodec : null,
        createdAt,
        expiresAt,
        job.sessionId || null
      );

      if (job.sessionId && !input.isAdmin) {
        try { addSessionUsage.run(job.sessionId, stat.size, stat.size); } catch (e) {}
      }

      updateProgress(jobId, 100, 'Clip created');
      finishWithSuccess(jobId, {
        clip: {
          token,
          filename: input.filename,
          size: stat.size,
          url: `/c/${token}`,
          meta
        }
      }, input.isAdmin, job.sessionId);
    } catch (err) {
      try { fs.unlinkSync(outputPath); } catch (e) {}
      finishWithError(jobId, err.message || 'Clip processing failed');
    } finally {
      try { fs.unlinkSync(tempPath); } catch (e) {}
      try { fs.rmSync(processingDir, { recursive: true, force: true }); } catch (e) {}
    }
  }

  return async function processJob(job) {
    if (job.type === 'download') {
      return processDownloadJob(job);
    } else if (job.type === 'convert') {
      return processConvertJob(job);
    } else if (job.type === 'pdf') {
      return processPdfJob(job);
    } else if (job.type === 'gif') {
      return processGifJob(job);
    } else if (job.type === 'clip') {
      return processClipJob(job);
    } else {
      throw new Error(`Unknown job type: ${job.type}`);
    }
  };
}

module.exports = createJobProcessor;
