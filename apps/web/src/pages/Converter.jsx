import { useState, useEffect, useRef } from 'react';
import { api, formatDate, getFileUrl } from '../api';
import { RefreshCw, FolderOpen, Upload, CheckCircle, Clock, Settings, AlertTriangle, List, Download, Trash2, ClipboardList, PackageOpen, Volume2, XCircle, XSquare, Archive } from 'lucide-react';
import AudioTrimmer from '../components/AudioTrimmer';
import Pagination from '../components/Pagination';
import FileUploader from '../components/FileUploader';
import useToast from '../hooks/useToast';
import useConfirm from '../hooks/useConfirm';

function Converter({ sessionId }) {
  const [formData, setFormData] = useState({
    format: 'mp3',
    preset: 'medium',
    audioBitrate: '192',
    startTime: '',
    endTime: '',
  });
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadedPath, setUploadedPath] = useState('');
  const [selectedFile, setSelectedFile] = useState('');
  const [wavSrc, setWavSrc] = useState('');
  const audioRef = useRef(null);
  const [toast, showToast] = useToast();
  const [confirm, ConfirmDialog] = useConfirm();

  // Pagination State
  const [allJobsPage, setAllJobsPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const fetchJobs = async () => {
    try {
      const allJobs = await api.getJobs(sessionId);
      setJobs(allJobs.filter(j => j.type === 'convert'));
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
      showToast('Failed to fetch data', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleFileSelect = (file) => {
    setSelectedFile(file);
    setUploadedPath('');
    if (file) {
      showToast(`Selected: ${file.name}`, 'success');
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      showToast('Please select a file first', 'error');
      return;
    }

    setUploading(true);

    try {
      const result = await api.uploadFile(selectedFile, sessionId);
      setUploadedPath(result.path);
      showToast('File uploaded successfully!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!uploadedPath) {
      showToast('Please upload a file first', 'error');
      return;
    }

    setLoading(true);

    try {
      const source = {
        type: 'upload',
        path: uploadedPath,
        originalName: selectedFile.name
      };

      const options = {
        format: formData.format,
        preset: formData.preset,
        audioBitrate: formData.audioBitrate,
        startTime: formData.startTime ? parseFloat(formData.startTime) : null,
        endTime: formData.endTime ? parseFloat(formData.endTime) : null
      };

      await api.createConvertJob(source, options, sessionId);
      setSelectedFile(null);
      setUploadedPath('');
      showToast('Conversion job added!', 'success');
      fetchJobs();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const playWavPreview = async (jobId) => {
    try {
      const wavUrl = getFileUrl(jobId, 'preview.wav');
      setWavSrc(wavUrl);
      if (audioRef.current) {
        audioRef.current.src = wavUrl;
        audioRef.current.play();
      }
    } catch (err) {
      console.error('Failed to play preview:', err);
    }
  };

  const myJobs = jobs.filter(j => j.inputJson?.sessionId === sessionId);

  const handleDelete = async (jobId) => {
    try {
      await api.deleteJob(jobId);
      showToast('Job deleted');
      fetchJobs();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleCancel = async (jobId) => {
    try {
      await api.cancelJob(jobId);
      showToast('Cancellation requested', 'info');
      fetchJobs();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <RefreshCw size={24} /> Converter
          </h2>
          <div className="subtitle">Convert media files with loudnorm normalization</div>
        </div>
      </div>

      <div className="content">
        {/* Audio Element for Preview */}
        <audio ref={audioRef} style={{ display: 'none' }} />

        {/* File Selection */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><FolderOpen size={18} /> 1. Upload File</div>
          </div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Choose File</label>
              <FileUploader
                onFileSelect={handleFileSelect}
                maxSizeMB={100}
                accept="video/*,audio/*,.flac,.m4a,.webm"
                selectedFile={selectedFile}
                noLimit={!!localStorage.getItem('adminToken')}
              />

              <button
                type="button"
                onClick={handleUpload}
                disabled={!selectedFile || uploading}
                className="btn btn-secondary"
                style={{ marginTop: '10px' }}
              >
                {uploading ? <><Clock size={16} /> Uploading...</> : <><Upload size={16} /> Upload File</>}
              </button>

              {uploadedPath && (
                <div style={{
                  marginTop: '10px',
                  padding: '10px',
                  background: 'rgba(46, 204, 113, 0.1)',
                  borderRadius: '6px',
                  border: '1px solid rgba(46, 204, 113, 0.3)',
                  color: 'var(--success)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <CheckCircle size={16} /> File uploaded! Now configure conversion settings below.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Conversion Settings */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Settings size={18} /> 2. Conversion Settings</div>
          </div>
          <div className="card-body">
            <form onSubmit={handleSubmit}>
              {/* Show audio trimmer for media files */}
              {selectedFile && selectedFile.type.match(/^(audio|video)\//) && (
                <div style={{ marginBottom: '20px', width: '100%', minWidth: 0, overflow: 'hidden', display: 'block' }}>
                  <AudioTrimmer
                    file={selectedFile}
                    initialStart={formData.startTime}
                    initialEnd={formData.endTime}
                    onChange={({ start, end }) => {
                      setFormData(prev => ({ ...prev, startTime: start, endTime: end }));
                    }}
                  />
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Output Format</label>
                  <select className="form-input" value={formData.format} onChange={(e) => handleInputChange('format', e.target.value)}>
                    <option value="flac">FLAC (Lossless)</option>
                    <option value="mp3">MP3 (Compressed)</option>
                    <option value="wav">WAV (Uncompressed)</option>
                    <option value="opus">Opus (Modern)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Loudness Preset</label>
                  <select className="form-input" value={formData.preset} onChange={(e) => handleInputChange('preset', e.target.value)}>
                    <option value="quiet">Quiet (-16 LUFS)</option>
                    <option value="medium">Medium (-14 LUFS)</option>
                    <option value="loud">Loud (-12 LUFS)</option>
                    <option value="very-loud">Very Loud (-10 LUFS)</option>
                    <option value="none">No normalization</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Audio Bitrate</label>
                  <select className="form-input" value={formData.audioBitrate} onChange={(e) => handleInputChange('audioBitrate', e.target.value)}>
                    <option value="128">128 kbps</option>
                    <option value="192">192 kbps</option>
                    <option value="256">256 kbps</option>
                    <option value="320">320 kbps</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Start Time (optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 00:01:30 or 90"
                    value={formData.startTime}
                    onChange={(e) => handleInputChange('startTime', e.target.value)}
                  />
                  <div className="form-help">Format: HH:MM:SS or seconds</div>
                </div>

                <div className="form-group">
                  <label className="form-label">End Time (optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 00:03:00 or 180"
                    value={formData.endTime}
                    onChange={(e) => handleInputChange('endTime', e.target.value)}
                  />
                  <div className="form-help">Format: HH:MM:SS or seconds</div>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !uploadedPath}
                style={{ opacity: uploadedPath ? 1 : 0.5 }}
              >
                {loading ? <><Clock size={16} /> Converting...</> : <><RefreshCw size={16} /> Start Conversion</>}
              </button>
              {!uploadedPath && (
                <div style={{ marginTop: '8px', color: 'var(--text-secondary)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <AlertTriangle size={14} /> Upload a file first to enable conversion
                </div>
              )}
            </form>
          </div>
        </div>



        {/* All Jobs */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><ClipboardList size={18} /> My Conversions ({jobs.length})</div>
          </div>
          <div className="table-container">
            {jobs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><PackageOpen size={64} style={{ margin: '0 auto' }} /></div>
                <div className="empty-title">No conversions yet</div>
                <p>Upload a file to start converting</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Format</th>
                    <th>Preset</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.slice((allJobsPage - 1) * ITEMS_PER_PAGE, allJobsPage * ITEMS_PER_PAGE).map(job => {
                    const input = job.inputJson || {};
                    return (
                      <tr key={job.id}>
                        <td>
                          <span style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>
                            {input.originalName || '-'}
                          </span>
                        </td>
                        <td>{(input.options?.format || input.format || '-').toUpperCase()}</td>
                        <td>{input.options ? (input.options.normalize?.enabled ? `${input.options.normalize.targetLufs} LUFS` : 'None') : (input.preset || '-')}</td>
                        <td>
                          <span className={`status-badge status-${job.status}`}>
                            {job.status === 'queued' && <Clock size={14} />}
                            {job.status === 'running' && <Settings size={14} className="spin" />}
                            {job.status === 'done' && <CheckCircle size={14} />}
                            {job.status === 'failed' && <XCircle size={14} />}
                            {job.status === 'deleted' && <Archive size={14} />}
                            {job.status}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                          {formatDate(job.createdAt)}
                        </td>
                        <td>
                          {job.status === 'done' && job.outputJson?.files?.length > 0 && (
                            <>
                              <a
                                href={getFileUrl(job.id)}
                                className="btn btn-success btn-sm"
                              >
                                <Download size={14} /> Download
                              </a>
                              {job.outputJson.hasWav && (
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => playWavPreview(job.id)}
                                  style={{ marginLeft: '5px' }}
                                >
                                  <Volume2 size={14} /> Preview
                                </button>
                              )}
                              {!job.deleted && (
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => { confirm('Delete this conversion?').then(yes => { if (yes) handleDelete(job.id); }); }}
                                  style={{ marginLeft: '5px' }}
                                  title="Delete"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </>
                          )}
                          {(job.status === 'queued' || job.status === 'running') && (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleCancel(job.id)}
                              title="Stop conversion"
                            >
                              <XSquare size={14} /> Stop
                            </button>
                          )}
                          {job.status === 'failed' && (
                            <span style={{ color: 'var(--error)', fontSize: '12px', marginRight: '5px' }} title={job.error}>
                              Error
                            </span>
                          )}
                          {job.status !== 'done' && job.status !== 'queued' && job.status !== 'running' && job.status !== 'deleted' && (
                            <button
                              className="btn btn-secondary btn-sm"
                                onClick={() => { confirm('Delete this conversion?').then(yes => { if (yes) handleDelete(job.id); }); }}
                              style={{ marginLeft: '5px' }}
                              title="Delete"
                            >
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
            <Pagination
              currentPage={allJobsPage}
              totalItems={jobs.length}
              itemsPerPage={ITEMS_PER_PAGE}
              onPageChange={setAllJobsPage}
            />
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />} {toast.message}
        </div>
      )}

      {ConfirmDialog}
    </>
  );
}

export default Converter;
