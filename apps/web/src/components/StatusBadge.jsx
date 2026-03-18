import { Clock, Play, CheckCircle, XCircle, AlertTriangle, Trash2 } from 'lucide-react';

const STATUS_CONFIG = {
  queued: { icon: Clock, label: 'Queued', className: 'status-queued' },
  running: { icon: Play, label: 'Running', className: 'status-running' },
  done: { icon: CheckCircle, label: 'Done', className: 'status-done' },
  failed: { icon: XCircle, label: 'Failed', className: 'status-failed' },
  expired: { icon: AlertTriangle, label: 'Expired', className: 'status-expired' },
  deleted: { icon: Trash2, label: 'Deleted', className: 'status-deleted' },
};

function StatusBadge({ status, size = 14 }) {
  const config = STATUS_CONFIG[status];
  if (!config) return null;
  const Icon = config.icon;
  return (
    <span className={`status-badge ${config.className}`}>
      <Icon size={size} /> {config.label}
    </span>
  );
}

export default StatusBadge;
