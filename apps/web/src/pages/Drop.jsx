import { useState, useEffect } from 'react';
import { api, formatBytes, formatDate, getDropUrl } from '../api';
import { FolderOpen, Upload, CheckCircle, Copy, Clock, List, Download, ClipboardList, XCircle, FileBox, Lock, Eye, EyeOff, KeyRound } from 'lucide-react';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import FileUploader from '../components/FileUploader';
import useToast from '../hooks/useToast';

function Drop({ sessionId }) {
  const [file, setFile] = useState(null);
  const [drops, setDrops] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [createdDrop, setCreatedDrop] = useState(null);
  const [toast, showToast] = useToast();
  const [uploadPassword, setUploadPassword] = useState('');
  const [showUploadPassword, setShowUploadPassword] = useState(false);

  const [passwordModal, setPasswordModal] = useState(null);
  const [downloadPassword, setDownloadPassword] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const isExpired = (drop) => drop.deleted === 1 || (drop.expiresAt && new Date(drop.expiresAt) < new Date());

  const [myDropsPage, setMyDropsPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const fetchDrops = async () => {
    try {
      const data = await api.getDrops(sessionId);
      setDrops(data);
    } catch (err) {
      console.error('Failed to fetch drops:', err);
      showToast('Failed to fetch data', 'error');
    }
  };

  useEffect(() => {
    fetchDrops();
    const interval = setInterval(fetchDrops, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;

    setUploading(true);
    setError('');
    setCreatedDrop(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (sessionId) formData.append('sessionId', sessionId);
      if (uploadPassword.trim()) formData.append('password', uploadPassword.trim());

      const response = await fetch(`${window.location.origin}/api/drop/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || 'Upload failed');
      }
      const result = await response.json();
      setCreatedDrop(result);
      setFile(null);
      setUploadPassword('');
      showToast('File uploaded successfully!');
      fetchDrops();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownload = async (drop) => {
    if (drop.hasPassword) {
      setPasswordModal(drop);
      setDownloadPassword('');
      setDownloadError('');
      return;
    }
    try {
      const { blob, filename } = await api.downloadDrop(drop.token);
      triggerDownload(blob, filename);
    } catch (err) {
      if (err.message === 'PASSWORD_REQUIRED') {
        setPasswordModal(drop);
        setDownloadPassword('');
        setDownloadError('');
      } else {
        showToast(err.message, 'error');
      }
    }
  };

  const handlePasswordDownload = async () => {
    if (!passwordModal || !downloadPassword.trim()) return;
    setDownloading(true);
    setDownloadError('');
    try {
      const { blob, filename } = await api.downloadDrop(passwordModal.token, downloadPassword);
      setPasswordModal(null);
      triggerDownload(blob, filename);
    } catch (err) {
      setDownloadError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!');
  };

  const getBaseUrl = () => {
    return window.location.origin;
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <FolderOpen size={24} /> Drop Files
          </h2>
          <div className="subtitle">Share files via unique links (max 50MB)</div>
        </div>
      </div>

      <div className="content">
        {/* Upload */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Upload size={18} /> Upload File</div>
          </div>
          <div className="card-body">
            <form onSubmit={handleUpload}>
              <div className="form-group">
                <label className="form-label">Choose File</label>
                <FileUploader
                  onFileSelect={setFile}
                  maxSizeMB={50}
                  accept="*"
                  selectedFile={file}
                  noLimit={!!localStorage.getItem('adminToken')}
                />
                <div className="form-help">{localStorage.getItem('adminToken') ? 'Admin: No size limit' : 'Maximum file size: 50MB'}</div>
              </div>

              <div className="form-group">
                <label className="form-label">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Lock size={13} /> Password (optional)
                  </span>
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showUploadPassword ? 'text' : 'password'}
                    className="form-input"
                    placeholder="Leave empty for no password"
                    value={uploadPassword}
                    onChange={(e) => setUploadPassword(e.target.value)}
                    style={{ paddingRight: '40px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowUploadPassword(!showUploadPassword)}
                    style={{
                      position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', color: 'var(--text-secondary)',
                      cursor: 'pointer', padding: '2px', display: 'flex'
                    }}
                  >
                    {showUploadPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <div style={{ color: 'var(--error)', marginBottom: '15px', padding: '10px', background: 'rgba(231, 76, 60, 0.1)', borderRadius: '6px' }}>
                  {error}
                </div>
              )}

              {createdDrop && (
                <div style={{
                  background: 'rgba(46, 204, 113, 0.1)',
                  padding: '15px',
                  borderRadius: '6px',
                  marginBottom: '15px',
                  border: '1px solid rgba(46, 204, 113, 0.3)'
                }}>
                  <div style={{ marginBottom: '8px', fontWeight: '500', color: 'var(--success)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <CheckCircle size={16} /> File uploaded successfully!
                    {createdDrop.hasPassword && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', opacity: 0.8 }}>
                        <Lock size={12} /> Password protected
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <code style={{
                      background: 'var(--bg)',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      flex: 1,
                      fontSize: '14px'
                    }}>
                      {createdDrop.url}
                    </code>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => copyToClipboard(createdDrop.url)}
                    >
                      <Copy size={14} /> Copy
                    </button>
                  </div>
                </div>
              )}

              <button type="submit" className="btn btn-primary" disabled={uploading || !file}>
                {uploading ? <><Clock size={16} /> Uploading...</> : <><Upload size={16} /> Upload File</>}
              </button>
            </form>
          </div>
        </div>

        {/* My Files */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><ClipboardList size={18} /> My Files ({drops.length})</div>
          </div>
          <div className="table-container">
            {drops.length === 0 ? (
              <EmptyState icon={FileBox} title="No files yet" description="Upload your first file above" />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Filename</th>
                    <th>Size</th>
                    <th>Downloads</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drops.slice((myDropsPage - 1) * ITEMS_PER_PAGE, myDropsPage * ITEMS_PER_PAGE).map(drop => {
                    const expired = isExpired(drop);
                    return (
                      <tr key={drop.token}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <code style={{
                              background: 'var(--bg-tertiary)',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px'
                            }}>
                              {drop.token}
                            </code>
                            {drop.hasPassword && <Lock size={12} color="var(--warning)" title="Password protected" />}
                          </div>
                        </td>
                        <td>
                          <span style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>
                            <span style={{ textDecoration: expired ? 'line-through' : 'none', opacity: expired ? 0.7 : 1 }}>
                              {drop.filename}
                            </span>
                          </span>
                        </td>
                        <td>{formatBytes(drop.size)}</td>
                        <td>
                          <span style={{ fontWeight: '500' }}>{drop.downloads}</span>
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                          {formatDate(drop.createdAt)}
                        </td>
                        <td>
                          {expired ? (
                            <span className="status-badge status-expired"><Clock size={12} /> Expired</span>
                          ) : (
                            <div style={{ display: 'flex', gap: '5px' }}>
                              <button
                                className="btn btn-success btn-sm"
                                onClick={() => handleDownload(drop)}
                              >
                                <Download size={14} />
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => copyToClipboard(`${getBaseUrl()}/d/${drop.token}`)}
                              >
                                <Copy size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {drops.length > 0 && (
            <Pagination
              currentPage={myDropsPage}
              totalItems={drops.length}
              itemsPerPage={ITEMS_PER_PAGE}
              onPageChange={setMyDropsPage}
            />
          )}
        </div>
      </div>

      {/* Password Modal */}
      {passwordModal && (
        <div className="modal-overlay" onClick={() => setPasswordModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px' }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <KeyRound size={18} /> Password Required
              </h3>
              <button className="btn-icon" onClick={() => setPasswordModal(null)}>
                <XCircle size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                This file is protected. Enter the password to download.
              </div>
              <form onSubmit={(e) => { e.preventDefault(); handlePasswordDownload(); }}>
                <div className="form-group">
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Enter password"
                    value={downloadPassword}
                    onChange={(e) => { setDownloadPassword(e.target.value); setDownloadError(''); }}
                    autoFocus
                  />
                </div>
                {downloadError && (
                  <div style={{ color: 'var(--error)', fontSize: '12px', marginBottom: '10px', padding: '8px', background: 'rgba(231, 76, 60, 0.1)', borderRadius: '6px' }}>
                    {downloadError}
                  </div>
                )}
                <button type="submit" className="btn btn-primary" disabled={downloading || !downloadPassword.trim()} style={{ width: '100%' }}>
                  {downloading ? 'Downloading...' : <><Download size={14} style={{ marginRight: '6px' }} /> Download</>}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />} {toast.message}
        </div>
      )}
    </>
  );
}

export default Drop;
