import { CheckCircle, Clock, Loader, Upload, XCircle } from 'lucide-react';

function getStatusLabel(job) {
  const status = job?.status;
  if (status === 'uploading') return 'Uploading';
  if (status === 'queued') return job.queuePosition ? `Queued #${job.queuePosition}` : 'Queued';
  if (status === 'running') return 'Running';
  if (status === 'done') return 'Done';
  if (status === 'failed') return 'Failed';
  return 'Processing';
}

function getProgress(job) {
  if (!job) return 0;
  if (job.status === 'done') return 100;
  if (job.status === 'uploading') return Math.max(job.progress || 0, 1);
  if (job.status === 'queued') return Math.max(job.progress || 0, 4);
  return Math.min(Math.max(job.progress || 0, 8), 99);
}

function getRunningStage(job) {
  const progress = getProgress(job);
  const tail = job.logsTail ? String(job.logsTail).trim() : '';
  const lower = tail.toLowerCase();

  if (lower.includes('worker slot assigned')) return 'Starting worker';
  if (lower.includes('validating')) return 'Validating upload';
  if (lower.includes('merging')) return 'Merging upload';
  if (lower.includes('download') || lower.includes('yt-dlp')) return 'Downloading source';
  if (lower.includes('reading') || lower.includes('metadata')) return 'Finalizing';
  if (lower.includes('created') || lower.includes('completed')) return 'Ready';
  if (lower.includes('ffmpeg') || lower.includes('frame=') || lower.includes('time=')) return 'Encoding';
  if (progress >= 90) return 'Finalizing';
  if (progress >= 8) return 'Processing';
  return 'Starting worker';
}

function getMessage(job, fallbackMessage) {
  if (!job) return fallbackMessage || 'Preparing job';
  if (job.status === 'failed') return job.error || fallbackMessage || 'Job failed';
  if (job.status === 'done') return 'Completed';
  if (job.status === 'uploading') return 'Sending the file in parts';
  if (job.status === 'queued') {
    return job.queuePosition ? `Queued as #${job.queuePosition}. Waiting for worker slot.` : 'Queued. Waiting for worker slot.';
  }
  if (job.status === 'running') return getRunningStage(job);
  const tail = job.logsTail ? String(job.logsTail).trim().split('\n').filter(Boolean).pop() : '';
  return tail || fallbackMessage || 'Worker is processing this job';
}

function JobProgress({ job, title, fallbackMessage, compact = false }) {
  if (!job) return null;

  const status = job.status || 'queued';
  const progress = getProgress(job);
  const message = getMessage(job, fallbackMessage);
  const Icon = status === 'done' ? CheckCircle : status === 'failed' ? XCircle : status === 'queued' ? Clock : status === 'uploading' ? Upload : Loader;
  const statusLabel = getStatusLabel(job);

  return (
    <div className={`job-progress ${compact ? 'job-progress-compact' : ''} status-${status}`}>
      <div className="job-progress-header">
        <div className="job-progress-title">
          <Icon size={compact ? 14 : 16} className={status === 'running' ? 'spin' : ''} />
          <span>{title || 'Processing job'}</span>
        </div>
        <div className="job-progress-meta">
          {statusLabel} / {progress}%
        </div>
      </div>
      <div className="job-progress-bar" aria-label={`${statusLabel} ${progress}%`}>
        <div className="job-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      {!compact && (
        <div className="job-progress-message" title={message}>
          {message}
        </div>
      )}
    </div>
  );
}

export default JobProgress;
