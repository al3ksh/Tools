// Presets for downloader
const PRESETS = {
  VIDEO_MP4_BEST: {
    format: 'bestvideo+bestaudio/best',
    mergeOutputFormat: 'mp4',
    extractAudio: false
  },
  VIDEO_MP4_720P: {
    format: 'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
    mergeOutputFormat: 'mp4',
    extractAudio: false
  },
  VIDEO_MP4_DISCORD: {
    format: 'bestvideo[filesize<8M]+bestaudio/best[filesize<8M]/best',
    mergeOutputFormat: 'mp4',
    extractAudio: false
  },
  VIDEO_GIF_SOCIAL: {
    format: 'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
    mergeOutputFormat: 'mp4',
    extractAudio: false,
    asGif: true,
    defaultDuration: 8,
    maxDuration: 20,
    defaultFps: 10,
    maxFps: 15,
    defaultWidth: 480,
    maxWidth: 720,
    defaultTargetMB: 8,
    maxTargetMB: 25
  },
  AUDIO_MP3_320: {
    format: 'bestaudio/best',
    mergeOutputFormat: null,
    extractAudio: true,
    audioFormat: 'mp3',
    audioQuality: '320K'
  },
  AUDIO_MP3_192: {
    format: 'bestaudio/best',
    mergeOutputFormat: null,
    extractAudio: true,
    audioFormat: 'mp3',
    audioQuality: '192K'
  },
  AUDIO_FLAC_BEST: {
    format: 'bestaudio/best',
    mergeOutputFormat: null,
    extractAudio: true,
    audioFormat: 'flac',
    audioQuality: '0'
  },
  AUDIO_WAV_BEST: {
    format: 'bestaudio/best',
    mergeOutputFormat: null,
    extractAudio: true,
    audioFormat: 'wav',
    audioQuality: '0'
  },
  AUDIO_OPUS_96: {
    format: 'bestaudio/best',
    mergeOutputFormat: null,
    extractAudio: true,
    audioFormat: 'opus',
    audioQuality: '96K'
  },
  AUDIO_OPUS_BEST: {
    format: 'bestaudio/best',
    mergeOutputFormat: null,
    extractAudio: true,
    audioFormat: 'opus',
    audioQuality: '0'
  }
};

const JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  EXPIRED: 'expired'
};

const JOB_TYPE = {
  DOWNLOAD: 'download',
  CONVERT: 'convert',
  PDF: 'pdf',
  GIF: 'gif',
  CLIP: 'clip',
  COMPRESS: 'compress'
};

module.exports = { PRESETS, JOB_STATUS, JOB_TYPE };
