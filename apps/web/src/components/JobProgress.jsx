import { CheckCircle, Clock, Loader, XCircle } from 'lucide-react';

function getStatusLabel(status) {
  if (status === 'queued') return 'Queued';
  if (status === 'running') return 'Running';
  if (status === 'done') return 'Done';
  if (status === 'failed') return 'Failed';
  return 'Processing';
}

function getProgress(job) {
  if (!job) return 0;
  if (job.status === 'done') return 100;
  if (job.status === 'queued') return Math.max(job.progress || 0, 4);
  return Math.min(Math.max(job.progress || 0, 8), 99);
}

function getMessage(job, fallbackMessage) {
  if (!job) return fallbackMessage || 'Preparing job';
  if (job.status === 'failed') return job.error || fallbackMessage || 'Job failed';
  if (job.status === 'done') return 'Completed';
  const tail = job.logsTail ? String(job.logsTail).trim().split('\n').filter(Boolean).pop() : '';
  return tail || fallbackMessage || 'Worker is processing this job';
}

function JobProgress({ job, title, fallbackMessage, compact = false }) {
  if (!job) return null;

  const status = job.status || 'queued';
  const progress = getProgress(job);
  const message = getMessage(job, fallbackMessage);
  const Icon = status === 'done' ? CheckCircle : status === 'failed' ? XCircle : status === 'queued' ? Clock : Loader;

  return (
    <div className={`job-progress ${compact ? 'job-progress-compact' : ''} status-${status}`}>
      <div className="job-progress-header">
        <div className="job-progress-title">
          <Icon size={compact ? 14 : 16} className={status === 'running' ? 'spin' : ''} />
          <span>{title || 'Processing job'}</span>
        </div>
        <div className="job-progress-meta">
          {getStatusLabel(status)} / {progress}%
        </div>
      </div>
      <div className="job-progress-bar" aria-label={`${getStatusLabel(status)} ${progress}%`}>
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
