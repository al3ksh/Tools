import { useState, useEffect } from 'react';
import { api, formatDate, getFileUrl, PRESETS } from '../api';
import { Download, Film, Clock, List, Settings, CheckCircle, XCircle, Trash2, ClipboardList, Inbox, XSquare, Archive, Link as LinkIcon } from 'lucide-react';
import Pagination from '../components/Pagination';

function Downloader({ sessionId }) {
  const [url, setUrl] = useState('');
  const [preset, setPreset] = useState('VIDEO_MP4_BEST');
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [genericPreview, setGenericPreview] = useState(null);

  // Pagination State
  const [myJobsPage, setMyJobsPage] = useState(1);
  const [allJobsPage, setAllJobsPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  // Set image loaded back to false when url changes
  useEffect(() => {
    setImgLoaded(false);
    setGenericPreview(null);
  }, [url]);

  // Derive youtube video ID for preview if applicable
  const getYoutubeId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
    return match ? match[1] : null;
  };

  const ytId = getYoutubeId(url);

  // Fetch generic preview if it's not a youtube link and is a valid URL
  useEffect(() => {
    if (!url || ytId) return;

    // Basic url validation
    if (!url.startsWith('http')) return;

    const fetchPreview = async () => {
      try {
        const data = await api.getPreviewUrl(url);
        if (data.image) {
          setGenericPreview(data.image);
        }
      } catch (err) {
        console.error('Failed to fetch preview', err);
      }
    };

    // Debounce preview fetch
    const timer = setTimeout(fetchPreview, 500);
    return () => clearTimeout(timer);
  }, [url, ytId]);

  const fetchJobs = async () => {
    try {
      const allJobs = await api.getJobs(sessionId);
      setJobs(allJobs.filter(j => j.type === 'download'));
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 2000);
    return () => clearInterval(interval);
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError('');

    try {
      await api.createDownloadJob(url, preset, sessionId);
      setUrl('');
      showToast('Job added to queue!');
      fetchJobs();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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
            <Download size={24} /> Universal Downloader
          </h2>
          <div className="subtitle">Download media from YouTube, TikTok, Instagram, Twitter & more</div>
        </div>
      </div>

      <div className="content">
        {/* Form and Preview Layout */}
        <div className="downloader-layout">

          {/* Form */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <div className="card-title"><Film size={18} /> New Download</div>
            </div>
            <div className="card-body">
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label className="form-label">Media URL</label>
                  <input
                    type="url"
                    className="form-input"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://youtube.com/watch?v=... or any supported URL"
                    required
                  />
                  <div className="form-help">
                    Supports: YouTube, TikTok, Instagram, Twitter, Facebook, Vimeo, and 1000+ sites
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Quality Preset</label>
                    <select className="form-input" value={preset} onChange={(e) => setPreset(e.target.value)}>
                      {PRESETS.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {error && (
                  <div style={{ color: 'var(--error)', marginBottom: '15px', padding: '10px', background: 'rgba(231, 76, 60, 0.1)', borderRadius: '6px' }}>
                    {error}
                  </div>
                )}

                <button type="submit" className="btn btn-primary" disabled={loading || !url.trim()}>
                  {loading ? <><Clock size={16} /> Adding...</> : <><Download size={16} /> Add to Queue</>}
                </button>
              </form>
            </div>
          </div>

          {/* Side Preview Area */}
          <div className="downloader-preview">
            {ytId || genericPreview ? (
              <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', backgroundColor: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', backgroundColor: 'var(--bg-card)' }}>
                  {/* Skeleton placeholder that shows until image loads */}
                  {!imgLoaded && (
                    <div className="skeleton-box" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
                  )}
                  {/* The actual image */}
                  <img
                    src={ytId ? `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg` : genericPreview}
                    onLoad={() => setImgLoaded(true)}
                    onError={(e) => {
                      if (ytId && e.target.src.includes('maxresdefault.jpg')) {
                        e.target.src = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
                      } else {
                        setImgLoaded(true); // Hide skeleton and show broken or blank
                      }
                    }}
                    alt={ytId ? "YouTube Video Preview" : "Link Preview"}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: imgLoaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
                  />
                </div>
                <div style={{ padding: '12px', fontSize: '13px', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-card)', borderTop: '1px solid var(--border)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {ytId ? (
                    <><img src="https://www.youtube.com/s/desktop/1054ea61/img/favicon.ico" alt="YT" style={{ width: 16, height: 16 }} /> YouTube Video</>
                  ) : (
                    <><LinkIcon size={16} /> Link Preview</>
                  )}
                </div>
              </div>
            ) : (
              /* Empty skeleton state when no valid URL is present */
              <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                <div className="skeleton-box" style={{ width: '100%', paddingBottom: '56.25%' }} />
                <div className="skeleton-box" style={{ width: '100%', height: '42px', borderTop: '1px solid var(--border)' }} />
              </div>
            )}
          </div>
        </div>

        {/* My Jobs */}
        {
          myJobs.length > 0 && (
            <div className="card">
              <div className="card-header">
                <div className="card-title"><List size={18} /> My Downloads ({myJobs.length})</div>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>URL</th>
                      <th>Preset</th>
                      <th>Status</th>
                      <th>Progress</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myJobs.slice((myJobsPage - 1) * ITEMS_PER_PAGE, myJobsPage * ITEMS_PER_PAGE).map(job => {
                      const input = job.inputJson || {};
                      const shortUrl = input.url ? new URL(input.url).hostname : '-';
                      return (
                        <tr key={job.id}>
                          <td>
                            <span title={input.url} style={{ cursor: 'help' }}>
                              {shortUrl}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: '12px', opacity: 0.8 }}>
                              {input.preset?.replace('_', ' ')}
                            </span>
                          </td>
                          <td>
                            <span className={`status-badge status-${job.status}`}>
                              {job.status === 'queued' && <Clock size={14} />}
                              {job.status === 'running' && <Settings size={14} className="spin" />}
                              {job.status === 'failed' && <XCircle size={14} />}
                              {job.status === 'deleted' && <Archive size={14} />}
                              {job.status}
                            </span>
                          </td>
                          <td>
                            {job.progress !== null ? (
                              <div className="progress-wrapper">
                                <div className="progress-bar">
                                  <div className="progress-fill" style={{ width: `${job.progress}%` }} />
                                </div>
                              </div>
                            ) : '-'}
                          </td>
                          <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                            {formatDate(job.createdAt)}
                          </td>
                          <td>
                            {job.status === 'done' && job.outputJson?.files?.length > 0 && (
                              <a
                                href={getFileUrl(job.id)}
                                className="btn btn-success btn-sm"
                              >
                                <Download size={14} /> Download
                              </a>
                            )}
                            {(job.status === 'queued' || job.status === 'running') && (
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => handleCancel(job.id)}
                                title="Stop downloading"
                              >
                                <XSquare size={14} /> Stop
                              </button>
                            )}
                            {job.status === 'expired' && (
                              <span style={{ color: 'var(--text-secondary)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Clock size={12} /> Expired
                              </span>
                            )}
                            {job.status !== 'expired' && job.status !== 'deleted' && job.status !== 'queued' && job.status !== 'running' && (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleDelete(job.id)}
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
              </div>
              <Pagination
                currentPage={myJobsPage}
                totalItems={myJobs.length}
                itemsPerPage={ITEMS_PER_PAGE}
                onPageChange={setMyJobsPage}
              />
            </div>
          )
        }

        {/* All Jobs */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><ClipboardList size={18} /> All Downloads</div>
          </div>
          <div className="table-container">
            {jobs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><Inbox size={64} style={{ margin: '0 auto' }} /></div>
                <div className="empty-title">No downloads yet</div>
                <p>Paste a URL above to start downloading</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Preset</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.slice((allJobsPage - 1) * ITEMS_PER_PAGE, allJobsPage * ITEMS_PER_PAGE).map(job => {
                    const input = job.inputJson || {};
                    const shortUrl = input.url ? new URL(input.url).hostname : '-';
                    return (
                      <tr key={job.id}>
                        <td>
                          <span title={input.url} style={{ cursor: 'help' }}>
                            {shortUrl}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '12px', opacity: 0.8 }}>
                            {input.preset?.replace('_', ' ')}
                          </span>
                        </td>
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
                        <td>
                          {job.progress !== null ? (
                            <div className="progress-wrapper">
                              <div className="progress-bar">
                                <div className="progress-fill" style={{ width: `${job.progress}%` }} />
                              </div>
                            </div>
                          ) : '-'}
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                          {formatDate(job.createdAt)}
                        </td>
                        <td>
                          {job.status === 'done' && job.outputJson?.files?.length > 0 && (
                            <a
                              href={getFileUrl(job.id)}
                              className="btn btn-success btn-sm"
                            >
                              <Download size={14} /> Download
                            </a>
                          )}
                          {(job.status === 'queued' || job.status === 'running') && (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleCancel(job.id)}
                              title="Stop downloading"
                            >
                              <XSquare size={14} /> Stop
                            </button>
                          )}
                          {job.status === 'failed' && (
                            <span style={{ color: 'var(--error)', fontSize: '12px' }} title={job.error}>
                              Error
                            </span>
                          )}
                          {job.status !== 'queued' && job.status !== 'running' && job.status !== 'failed' && job.status !== 'expired' && job.status !== 'deleted' && (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleDelete(job.id)}
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
      </div >

      {/* Toast */}
      {
        toast && (
          <div className={`toast toast-${toast.type}`}>
            {toast.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />} {toast.message}
          </div>
        )
      }
    </>
  );
}

export default Downloader;
