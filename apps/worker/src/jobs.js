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

  function parseFfmpegTime(text) {
    const match = text.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
    if (!match) return null;
    return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + parseInt(match[4]) / 100;
  }

  function getOutputBaseName(originalName, suffix, ext) {
    const parsed = path.parse(originalName || 'output');
    const safeName = parsed.name.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'output';
    return `${safeName}_${suffix}.${ext}`;
  }

  function getDownloadedFiles(outputDir) {
    return fs.readdirSync(outputDir)
      .map(filename => {
        const filePath = path.join(outputDir, filename);
        const stat = fs.statSync(filePath);
        return { filename, filePath, size: stat.size };
      })
      .filter(file => file.size > 0);
  }

  function getPrimaryDownloadedFile(outputDir) {
    const files = getDownloadedFiles(outputDir);
    files.sort((a, b) => b.size - a.size);
    return files[0] || null;
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

  function runGifEncode(jobId, inputPath, outputPath, options, progressBase, progressSpan) {
    const { start, duration, width, fps, maxColors } = options;
    const filter = `${buildGifFilterChain({ fps, width, speed: 1, reverse: false })},split[s0][s1];[s0]palettegen=max_colors=${maxColors}[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`;
    const args = ['-y'];
    if (start > 0) args.push('-ss', String(start));
    args.push('-t', String(duration), '-i', inputPath, '-filter_complex', filter, '-loop', '0', outputPath);

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', args);
      activeProcesses.set(jobId, ffmpeg);
      let logsTail = '';
      let lastProgressUpdate = 0;
      let timedOut = false;

      const processTimer = setTimeout(() => {
        timedOut = true;
        ffmpeg.kill('SIGKILL');
      }, MAX_PROCESS_TIME);

      ffmpeg.stderr.on('data', (data) => {
        const text = data.toString();
        logsTail += text;
        if (logsTail.length > 5000) logsTail = logsTail.slice(-5000);
        const current = parseFfmpegTime(text);
        if (duration > 0 && current != null && Date.now() - lastProgressUpdate >= 500) {
          const progress = progressBase + Math.min(Math.round((current / duration) * progressSpan), progressSpan);
          updateProgress(jobId, Math.min(progress, 98), logsTail);
          lastProgressUpdate = Date.now();
        }
      });

      ffmpeg.on('close', (code, signal) => {
        clearTimeout(processTimer);
        activeProcesses.delete(jobId);
        if (signal === 'SIGKILL') {
          reject(new Error(timedOut ? 'GIF encoding timed out' : 'Cancelled by user'));
        } else if (code === 0 && fs.existsSync(outputPath)) {
          resolve(logsTail);
        } else {
          reject(new Error(`ffmpeg exited with code ${code}: ${logsTail.slice(-1000)}`));
        }
      });

      ffmpeg.on('error', (err) => {
        clearTimeout(processTimer);
        activeProcesses.delete(jobId);
        reject(err);
      });
    });
  }

  async function convertDownloadToGif(jobId, inputPath, outputDir, presetConfig, gifOptions) {
    const duration = Math.min(Math.max(Number(gifOptions.duration) || presetConfig.defaultDuration || 8, 1), presetConfig.maxDuration || 20);
    const start = Math.max(0, Number(gifOptions.start) || 0);
    const targetBytes = Math.min(Math.max(Number(gifOptions.targetMB) || presetConfig.defaultTargetMB || 8, 1), presetConfig.maxTargetMB || 25) * 1024 * 1024;
    let width = Math.min(Math.max(Number(gifOptions.width) || presetConfig.defaultWidth || 480, 160), presetConfig.maxWidth || 720);
    let fps = Math.min(Math.max(Number(gifOptions.fps) || presetConfig.defaultFps || 10, 5), presetConfig.maxFps || 15);
    const outputFilename = getOutputBaseName(path.basename(inputPath), 'download', 'gif');
    const outputPath = path.join(outputDir, outputFilename);
    let finalSize = 0;
    let attempts = 0;

    while (attempts < 3) {
      attempts += 1;
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) {}
      updateProgress(jobId, 60 + attempts * 5, `Encoding GIF attempt ${attempts}`);
      await runGifEncode(jobId, inputPath, outputPath, {
        start: 0,
        duration,
        width,
        fps,
        maxColors: attempts === 1 ? 128 : 96
      }, 60, 35);

      finalSize = fs.statSync(outputPath).size;
      if (finalSize <= targetBytes || width <= 240 || fps <= 6) break;
      width = Math.max(240, Math.round(width * 0.78));
      fps = Math.max(6, fps - 2);
    }

    return {
      filename: outputFilename,
      path: `downloads/${jobId}/${outputFilename}`,
      size: finalSize,
      targetBytes,
      overTarget: finalSize > targetBytes,
      width,
      fps,
      duration,
      start,
      attempts,
      outputPath
    };
  }

  async function processDownloadJob(job) {
    const input = JSON.parse(job.inputJson);
    const { url, presetConfig, gifOptions = {}, isAdmin } = input;
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
      if (presetConfig.asGif) {
        const start = Math.max(0, Number(gifOptions.start) || 0);
        const duration = Math.min(Math.max(Number(gifOptions.duration) || presetConfig.defaultDuration || 8, 1), presetConfig.maxDuration || 20);
        args.push('--download-sections', `*${start}-${start + duration}`);
        args.push('--force-keyframes-at-cuts');
      }
    }

    args.push(url);

    return new Promise((resolve, reject) => {
      const ytdlp = spawn('yt-dlp', args);
      activeProcesses.set(jobId, ytdlp);
      let logsTail = '';
      let lastProgressUpdate = 0;
      let lastLogUpdate = 0;
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
          const rawProgress = Math.round(parseFloat(progressMatch[1]));
          const progress = presetConfig.asGif ? Math.min(Math.round(rawProgress * 0.58), 58) : rawProgress;
          updateProgress(jobId, progress, logsTail);
          lastProgressUpdate = Date.now();
        }
      });

      ytdlp.stderr.on('data', (data) => {
        logsTail = logsTail + data.toString();
        if (logsTail.length > 5000) {
          logsTail = logsTail.slice(-5000);
        }

        if (Date.now() - lastLogUpdate >= 1000) {
          updateProgress(jobId, presetConfig.asGif ? 4 : 8, logsTail);
          lastLogUpdate = Date.now();
        }
      });

      ytdlp.on('close', async (code, signal) => {
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
            let files;
            let gifMeta = null;

            if (presetConfig.asGif) {
              const source = getPrimaryDownloadedFile(outputDir);
              if (!source) throw new Error('No downloaded media found');
              gifMeta = await convertDownloadToGif(jobId, source.filePath, outputDir, presetConfig, gifOptions);
              for (const file of getDownloadedFiles(outputDir)) {
                if (file.filePath !== gifMeta.outputPath) {
                  try { fs.unlinkSync(file.filePath); } catch (e) {}
                }
              }
            }

            files = getDownloadedFiles(outputDir).map(file => ({
              filename: file.filename,
              path: `downloads/${jobId}/${file.filename}`,
              size: file.size
            }));

            updateProgress(jobId, 100, logsTail);
            finishWithSuccess(jobId, { files, gif: gifMeta }, isAdmin, job.sessionId);
            resolve();
          } catch (e) {
            try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (cleanupErr) {}
            finishWithError(jobId, e.message === 'Cancelled by user' ? 'Cancelled by user' : 'Failed to process output');
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

  async function processCompressJob(job) {
    const input = JSON.parse(job.inputJson);
    const { file, options = {}, isAdmin } = input;
    const jobId = job.id;

    if (!file || !file.path) {
      finishWithError(jobId, 'No input file found');
      return;
    }

    if (!checkDiskSpace(500)) {
      finishWithError(jobId, 'Insufficient disk space on server');
      return;
    }

    let inputPath;
    try {
      inputPath = safePath(DATA_DIR, file.path);
    } catch (e) {
      finishWithError(jobId, 'Invalid input path');
      return;
    }

    if (!fs.existsSync(inputPath)) {
      finishWithError(jobId, 'Input file not found');
      return;
    }

    const kind = options.kind === 'image' ? 'image' : 'video';
    const format = String(options.format || (kind === 'image' ? 'webp' : 'mp4')).toLowerCase();
    const outputDir = safePath(DATA_DIR, path.join('converted', String(jobId)));
    fs.mkdirSync(outputDir, { recursive: true });
    const outputFilename = getOutputBaseName(file.originalName, 'compressed', format);
    const outputPath = path.join(outputDir, outputFilename);
    const targetMB = Number(options.targetMB) || 0;
    const maxWidth = Number(options.maxWidth) || 0;
    const quality = Math.min(Math.max(Number(options.quality) || 70, 1), 100);
    const inputSize = Number(file.size) || (fs.existsSync(inputPath) ? fs.statSync(inputPath).size : 0);
    const inputDuration = kind === 'video' ? getAudioDuration(inputPath) : 0;
    const args = ['-y', '-i', inputPath];

    if (kind === 'video') {
      const filters = [];
      if (maxWidth > 0) {
        filters.push(`scale=w='min(${maxWidth},iw)':h=-2`);
      }

      if (format === 'gif') {
        filters.push('fps=10');
        const filter = `${filters.join(',')},split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`;
        args.push('-filter_complex', filter, '-loop', '0');
        if (targetMB > 1) args.push('-fs', String(Math.floor(targetMB * 1024 * 1024)));
      } else {
        if (filters.length > 0) args.push('-vf', filters.join(','));
      }

      if (format === 'gif') {
        args.push('-an');
      } else if (format === 'webm') {
        args.push('-c:v', 'libvpx-vp9');
      } else {
        args.push('-c:v', 'libx264', '-preset', 'veryfast', '-movflags', '+faststart');
      }

      if (format === 'gif') {
        // GIF size is controlled mostly by duration, width, fps and palette. Bitrate flags do not apply.
      } else if (targetMB > 0 && inputDuration > 0) {
        const totalKbps = Math.max(Math.floor((targetMB * 8192) / inputDuration), 160);
        const audioKbps = options.stripAudio ? 0 : Math.min(128, Math.max(64, Math.floor(totalKbps * 0.18)));
        const videoKbps = Math.max(totalKbps - audioKbps, 120);
        args.push('-b:v', `${videoKbps}k`, '-maxrate', `${Math.round(videoKbps * 1.35)}k`, '-bufsize', `${Math.round(videoKbps * 2)}k`);
        if (targetMB > 1) args.push('-fs', String(Math.floor(targetMB * 1024 * 1024)));
        if (options.stripAudio) {
          args.push('-an');
        } else {
          args.push('-c:a', format === 'webm' ? 'libopus' : 'aac', '-b:a', `${audioKbps}k`);
        }
      } else {
        const crf = Math.round(34 - (quality / 100) * 16);
        args.push('-crf', String(crf));
        if (options.stripAudio) {
          args.push('-an');
        } else {
          args.push('-c:a', format === 'webm' ? 'libopus' : 'aac', '-b:a', '128k');
        }
      }
    } else {
      if (maxWidth > 0) {
        args.push('-vf', `scale=w='min(${maxWidth},iw)':h=-2`);
      }

      if (format === 'png') {
        args.push('-compression_level', quality >= 80 ? '6' : '9');
      } else if (format === 'jpg' || format === 'jpeg') {
        const q = Math.round(31 - (quality / 100) * 26);
        args.push('-q:v', String(Math.min(Math.max(q, 2), 31)));
      } else if (format === 'gif') {
        // Static image to GIF does not need a video codec.
      } else {
        args.push('-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6');
      }
      args.push('-frames:v', '1');
    }

    args.push(outputPath);

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', args);
      activeProcesses.set(jobId, ffmpeg);
      let logsTail = '';
      let lastProgressUpdate = 0;
      let timedOut = false;

      updateProgress(jobId, 8, 'Starting compression');

      const processTimer = setTimeout(() => {
        timedOut = true;
        ffmpeg.kill('SIGKILL');
        finishWithError(jobId, 'Compression timed out');
      }, MAX_PROCESS_TIME);

      ffmpeg.stderr.on('data', (data) => {
        const text = data.toString();
        logsTail += text;
        if (logsTail.length > 5000) logsTail = logsTail.slice(-5000);

        const current = parseFfmpegTime(text);
        if (kind === 'video' && inputDuration > 0 && current != null && Date.now() - lastProgressUpdate >= 500) {
          updateProgress(jobId, Math.min(Math.max(Math.round((current / inputDuration) * 90), 8), 95), logsTail);
          lastProgressUpdate = Date.now();
        } else if (kind === 'image' && Date.now() - lastProgressUpdate >= 500) {
          updateProgress(jobId, 55, logsTail);
          lastProgressUpdate = Date.now();
        }
      });

      ffmpeg.on('close', (code, signal) => {
        clearTimeout(processTimer);
        activeProcesses.delete(jobId);
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (e) {}

        if (signal === 'SIGKILL') {
          try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (e) {}
          if (!timedOut) finishWithError(jobId, 'Cancelled by user');
          resolve();
          return;
        }

        if (code === 0 && fs.existsSync(outputPath)) {
          try {
            const stat = fs.statSync(outputPath);
            updateProgress(jobId, 100, logsTail);
            finishWithSuccess(jobId, {
              files: [{
                filename: outputFilename,
                path: `converted/${jobId}/${outputFilename}`,
                size: stat.size
              }],
              originalSize: inputSize,
              compressedSize: stat.size,
              savedBytes: Math.max(inputSize - stat.size, 0),
              targetMB: targetMB || null,
              kind,
              format
            }, isAdmin, job.sessionId);
            resolve();
          } catch (e) {
            finishWithError(jobId, 'Failed to process compressed output');
            reject(e);
          }
          return;
        }

        try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (e) {}
        finishWithError(jobId, `ffmpeg exited with code ${code}: ${logsTail.slice(-1000)}`);
        reject(new Error(`Process exited with code ${code}`));
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
    } else if (job.type === 'compress') {
      return processCompressJob(job);
    } else {
      throw new Error(`Unknown job type: ${job.type}`);
    }
  };
}

module.exports = createJobProcessor;
