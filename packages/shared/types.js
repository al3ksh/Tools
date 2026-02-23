// Presets for downloader
const PRESETS = {
  VIDEO_MP4_BEST: {
    format: 'bestvideo+bestaudio/best',
    mergeOutputFormat: 'mp4',
    extractAudio: false
  },
  VIDEO_MP4_720P: {
    format: 'bestvideo[height<=720]+bestaudio/best[height<=720]',
    mergeOutputFormat: 'mp4',
    extractAudio: false
  },
  VIDEO_MP4_DISCORD: {
    format: 'bestvideo[filesize<8M]+bestaudio/best[filesize<8M]/best',
    mergeOutputFormat: 'mp4',
    extractAudio: false
  },
  AUDIO_MP3_192: {
    format: 'bestaudio/best',
    mergeOutputFormat: null,
    extractAudio: true,
    audioFormat: 'mp3',
    audioQuality: '192K'
  },
  AUDIO_OPUS_96: {
    format: 'bestaudio/best',
    mergeOutputFormat: null,
    extractAudio: true,
    audioFormat: 'opus',
    audioQuality: '96K'
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
  CONVERT: 'convert'
};

module.exports = { PRESETS, JOB_STATUS, JOB_TYPE };
