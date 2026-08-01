import { useEffect, useMemo, useState } from 'react';
import { PackageOpen, Upload, Download, Clock, CheckCircle, XCircle, ClipboardList, Inbox, Trash2, XSquare } from 'lucide-react';
import { api, downloadBlob, formatBytes, formatDate, getFileUrl } from '../api';
import FileUploader from '../components/FileUploader';
import JobProgress from '../components/JobProgress';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import useToast from '../hooks/useToast';
import useConfirm from '../hooks/useConfirm';

function getKind(file) {
  if (!file) return 'video';
  if (file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  return 'video';
}

function getOutputName(file, format) {
  const base = file?.name ? file.name.replace(/\.[^.]+$/, '') : 'compressed';
  return `${base}_compressed.${format}`;
}

function Compressor({ sessionId, isAdmin }) {
  const [file, setFile] = useState(null);
  const [mediaKind, setMediaKind] = useState('video');
  const [mode, setMode] = useState('target');
  const [targetMB, setTargetMB] = useState('8');
  const [quality, setQuality] = useState('70');
  const [maxWidth, setMaxWidth] = useState('1280');
  const [format, setFormat] = useState('mp4');
  const [stripAudio, setStripAudio] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [currentJob, setCurrentJob] = useState(null);
  const [resultSize, setResultSize] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [page, setPage] = useState(1);
  const [toast, showToast] = useToast();
  const [confirm, ConfirmDialog] = useConfirm();
  const ITEMS_PER_PAGE = 10;

  const kind = file ? getKind(file) : mediaKind;
  const estimatedTarget = useMemo(() => {
    if (!file) return null;
    if (mode === 'target') return Number(targetMB) > 0 ? Number(targetMB) * 1024 * 1024 : null;
    return Math.round(file.size * (Number(quality) / 100));
  }, [file, mode, targetMB, quality]);

  useEffect(() => {
    if (kind === 'image' && !['jpg', 'png', 'webp', 'gif'].includes(format)) setFormat('webp');
    if (kind === 'video' && !['mp4', 'webm', 'gif'].includes(format)) setFormat('mp4');
  }, [kind, format]);

  async function fetchJobs() {
    try {
      const allJobs = await api.getJobs(sessionId);
      setJobs(allJobs.filter(j => j.type === 'compress'));
    } catch (err) {
      showToast('Failed to fetch compressor jobs', 'error');
    }
  }

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
  }, []);

  function handleFileSelect(nextFile) {
    setFile(nextFile);
    setError('');
    setResultSize(null);
    setCurrentJob(null);
    if (nextFile) {
      const nextKind = getKind(nextFile);
      setMediaKind(nextKind);
      setFormat(nextKind === 'image' ? 'webp' : 'mp4');
      setMaxWidth(nextKind === 'image' ? '1920' : '1280');
    }
  }

  async function handleCompress(e) {
    e.preventDefault();
    if (!file) return;

    setProcessing(true);
    setError('');
    setResultSize(null);
    setCurrentJob(null);

    try {
      const blob = await api.compressFile(file, {
        format,
        quality,
        targetMB: mode === 'target' ? targetMB : '',
        maxWidth,
        stripAudio
      }, sessionId, { onJobUpdate: setCurrentJob });
      setResultSize(blob.size);
      downloadBlob(blob, getOutputName(file, format));
      showToast('Compression completed');
      fetchJobs();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
      setCurrentJob(null);
    }
  }

  async function handleDelete(jobId) {
    try {
      await api.deleteJob(jobId, sessionId);
      showToast('Job deleted');
      fetchJobs();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleCancel(jobId) {
    try {
      await api.cancelJob(jobId, sessionId);
      showToast('Cancellation requested', 'info');
      fetchJobs();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <PackageOpen size={24} /> Compressor
          </h2>
          <div className="subtitle">Reduce video and image file size for sharing limits</div>
        </div>
      </div>

      <div className="content">
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Upload size={18} /> Compress File</div>
          </div>
          <div className="card-body">
            <form onSubmit={handleCompress}>
              <div className="form-group">
                <label className="form-label">Source File</label>
                <FileUploader
                  onFileSelect={handleFileSelect}
                  maxSizeMB={500}
                  accept="video/*,image/*,.mkv,.mov,.webm,.webp"
                  selectedFile={file}
                  noLimit={isAdmin}
                />
                <div className="form-help">Supported: videos and images. Guest limit is 500MB.</div>
              </div>

              {file && (
                <div style={{ marginBottom: '14px', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg)', fontSize: '13px' }}>
                  <strong>{file.name}</strong>
                  <div style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {formatBytes(file.size)} / {kind}
                    {estimatedTarget ? ` / target ${formatBytes(estimatedTarget)}` : ''}
                    {resultSize ? ` / result ${formatBytes(resultSize)}` : ''}
                  </div>
                </div>
              )}

              {!file && (
                <div className="form-group">
                  <label className="form-label">Media Type</label>
                  <select className="form-input" value={mediaKind} onChange={(e) => setMediaKind(e.target.value)}>
                    <option value="video">Video / GIF</option>
                    <option value="image">Image</option>
                  </select>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Mode</label>
                  <select className="form-input" value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value="target">Target size</option>
                    <option value="quality">Quality</option>
                  </select>
                </div>
                {mode === 'target' ? (
                  <div className="form-group">
                    <label className="form-label">Target MB</label>
                    <input className="form-input" type="number" min="1" max={isAdmin ? 2048 : 500} step="1" value={targetMB} onChange={(e) => setTargetMB(e.target.value)} />
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">Quality</label>
                    <input className="form-input" type="number" min="1" max="100" step="1" value={quality} onChange={(e) => setQuality(e.target.value)} />
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Max Width</label>
                  <input className="form-input" type="number" min="0" max="3840" step="2" value={maxWidth} onChange={(e) => setMaxWidth(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Output Format</label>
                  <select className="form-input" value={format} onChange={(e) => setFormat(e.target.value)}>
                    {kind === 'video' ? (
                      <>
                        <option value="mp4">MP4</option>
                        <option value="webm">WebM</option>
                        <option value="gif">GIF</option>
                      </>
                    ) : (
                      <>
                        <option value="webp">WebP</option>
                        <option value="jpg">JPG</option>
                        <option value="png">PNG</option>
                        <option value="gif">GIF</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {kind === 'video' && format !== 'gif' && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', marginBottom: '14px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={stripAudio} onChange={(e) => setStripAudio(e.target.checked)} />
                  Remove audio for smaller output
                </label>
              )}

              {error && (
                <div style={{ color: 'var(--error)', marginBottom: '12px', padding: '10px', background: 'rgba(231, 76, 60, 0.1)', borderRadius: '6px' }}>
                  {error}
                </div>
              )}

              <JobProgress job={currentJob} title="Compressing file" fallbackMessage="Worker is compressing media" />

              <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px' }}>
                <button type="submit" className="btn btn-primary" disabled={!file || processing} style={{ minWidth: '210px', justifyContent: 'center' }}>
                  {processing ? <><Clock size={16} /> Compressing...</> : <><PackageOpen size={16} /> Compress & Download</>}
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title"><ClipboardList size={18} /> My Compressions ({jobs.length})</div>
          </div>
          <div className="table-container">
            {jobs.length === 0 ? (
              <EmptyState icon={Inbox} title="No compressions yet" description="Upload a video or image above to reduce its size" />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE).map(job => {
                    const input = job.inputJson || {};
                    const output = job.outputJson || {};
                    const fileInfo = output.files?.[0];
                    return (
                      <tr key={job.id}>
                        <td>
                          <div style={{ fontWeight: 500 }}>{input.file?.originalName || 'Media file'}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {output.originalSize ? formatBytes(output.originalSize) : input.file?.kind || '-'}
                            {output.compressedSize ? ` -> ${formatBytes(output.compressedSize)}` : ''}
                          </div>
                        </td>
                        <td><StatusBadge status={job.status} queuePosition={job.queuePosition} /></td>
                        <td><JobProgress job={job} title="Progress" compact /></td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{formatDate(job.createdAt)}</td>
                        <td>
                          {job.status === 'done' && fileInfo && (
                            <a href={getFileUrl(job.id, fileInfo.filename, sessionId)} className="btn btn-success btn-sm">
                              <Download size={14} /> Download
                            </a>
                          )}
                          {(job.status === 'queued' || job.status === 'running') && (
                            <button className="btn btn-danger btn-sm" onClick={() => handleCancel(job.id)}>
                              <XSquare size={14} /> Stop
                            </button>
                          )}
                          {job.status !== 'queued' && job.status !== 'running' && (
                            <button className="btn btn-secondary btn-sm" onClick={() => confirm('Delete this compression?').then(yes => { if (yes) handleDelete(job.id); })}>
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {jobs.length > 0 && (
            <Pagination currentPage={page} totalItems={jobs.length} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setPage} />
          )}
        </div>
      </div>

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />} {toast.message}
        </div>
      )}
      {ConfirmDialog}
    </>
  );
}

export default Compressor;
