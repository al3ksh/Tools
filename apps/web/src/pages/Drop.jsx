import { useState, useEffect } from 'react';
import { api, formatBytes, formatDate, getDropUrl } from '../api';
import { FolderOpen, Upload, CheckCircle, Copy, Clock, List, Download, ClipboardList, XCircle, FileBox } from 'lucide-react';
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

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setCreatedDrop(null);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;

    setUploading(true);
    setError('');
    setCreatedDrop(null);

    try {
      const result = await api.uploadDrop(file, sessionId);
      setCreatedDrop(result);
      setFile(null);
      const fileInput = document.querySelector('input[type="file"]');
      if (fileInput) fileInput.value = '';
      showToast('File uploaded successfully!');
      fetchDrops();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!');
  };

  const getBaseUrl = () => {
    return window.location.origin;
  };

  const myDrops = drops.filter(d => d.sessionId === sessionId);

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
              <div className="empty-state">
                <div className="empty-icon"><FileBox size={64} style={{ margin: '0 auto' }} /></div>
                <div className="empty-title">No files yet</div>
                <p>Upload your first file above</p>
              </div>
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
                          <code style={{
                            background: 'var(--bg-tertiary)',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}>
                            {drop.token}
                          </code>
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
                              <a
                                href={getDropUrl(drop.token)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-success btn-sm"
                              >
                                <Download size={14} /> Download
                              </a>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => copyToClipboard(`${getBaseUrl()}/d/${drop.token}`)}
                              >
                                <Copy size={14} /> Copy
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
