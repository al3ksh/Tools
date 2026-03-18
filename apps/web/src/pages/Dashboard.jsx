import { useState, useEffect } from 'react';
import { api, formatBytes, formatDate, getFileUrl } from '../api';
import { Link } from 'react-router-dom';
import { LayoutDashboard, RefreshCw, FolderOpen, Clock, CheckCircle, XCircle, Zap, Download, FileAudio, Link as LinkIcon, Database, ClipboardList, Settings, Inbox, Archive } from 'lucide-react';
import Pagination from '../components/Pagination';

function Dashboard({ sessionId }) {
  const [jobs, setJobs] = useState([]);
  const [storage, setStorage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  // Pagination State
  const [recentJobsPage, setRecentJobsPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const fetchData = async () => {
    try {
      const isAdmin = !!localStorage.getItem('adminToken');
      const [jobsData, storageData] = await Promise.all([
        api.getJobs(sessionId),
        isAdmin ? api.getStorage().catch(() => null) : Promise.resolve(null)
      ]);
      setJobs(jobsData);
      setStorage(storageData);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  const myJobs = jobs.filter(j => j.inputJson?.sessionId === sessionId);
  const filteredJobs = filter === 'all' ? jobs : filter === 'mine' ? myJobs : jobs.filter(j => j.type === filter);

  const stats = {
    total: jobs.length,
    mine: myJobs.length,
    queued: jobs.filter(j => j.status === 'queued').length,
    running: jobs.filter(j => j.status === 'running').length,
    done: jobs.filter(j => j.status === 'done').length,
    failed: jobs.filter(j => j.status === 'failed').length,
  };

  const totalStorage = storage?.total?.bytes || 0;

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <LayoutDashboard size={24} /> Dashboard
          </h2>
          <div className="subtitle">Overview of all tools and system status</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm" onClick={fetchData}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="content">
        {/* Session Banner */}
        <div className="session-banner">
          <div className="session-info">
            <strong>Your session</strong> - Files expire after 1h
          </div>
          <div className="session-countdown">
            {stats.mine} jobs created
          </div>
        </div>

        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon blue"><FolderOpen size={24} /></div>
            <div className="stat-info">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">Total Jobs</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon orange"><Clock size={24} /></div>
            <div className="stat-info">
              <div className="stat-value">{stats.queued}</div>
              <div className="stat-label">Queued</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green"><CheckCircle size={24} /></div>
            <div className="stat-info">
              <div className="stat-value">{stats.done}</div>
              <div className="stat-label">Completed</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon red"><XCircle size={24} /></div>
            <div className="stat-info">
              <div className="stat-value">{stats.failed}</div>
              <div className="stat-label">Failed</div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Zap size={18} /> Quick Actions</div>
          </div>
          <div className="card-body">
            <div className="quick-actions">
              <Link to="/downloader" className="quick-action">
                <div className="quick-action-icon"><Download size={36} /></div>
                <div className="quick-action-title">Download Media</div>
                <div className="quick-action-desc">YouTube, TikTok, Instagram, Twitter & more</div>
              </Link>
              <Link to="/converter" className="quick-action">
                <div className="quick-action-icon"><FileAudio size={36} /></div>
                <div className="quick-action-title">Convert Audio</div>
                <div className="quick-action-desc">MP3, WAV, FLAC, Opus with normalization</div>
              </Link>
              <Link to="/shortener" className="quick-action">
                <div className="quick-action-icon"><LinkIcon size={36} /></div>
                <div className="quick-action-title">Shorten Link</div>
                <div className="quick-action-desc">Create short URLs with click tracking</div>
              </Link>
              <Link to="/drop" className="quick-action">
                <div className="quick-action-icon"><FolderOpen size={36} /></div>
                <div className="quick-action-title">Share File</div>
                <div className="quick-action-desc">Upload and share files up to 50MB</div>
              </Link>
            </div>
          </div>
        </div>

        {/* Storage */}
        {storage && (
          <div className="card">
            <div className="card-header">
              <div className="card-title"><Database size={18} /> Storage Usage</div>
              <div className="stat-info">{storage.total.formatted}</div>
            </div>
            <div className="card-body">
              <div className="storage-bar">
                {Object.entries(storage.directories).map(([dir, info]) => {
                  const percent = totalStorage > 0 ? (info.bytes / totalStorage) * 100 : 0;
                  if (percent < 1) return null;
                  return (
                    <div
                      key={dir}
                      className={`storage-segment ${dir}`}
                      style={{ width: `${percent}%` }}
                      title={`${dir}: ${info.formatted}`}
                    />
                  );
                })}
              </div>
              <div className="storage-legend">
                {Object.entries(storage.directories).map(([dir, info]) => (
                  <div key={dir} className="storage-legend-item">
                    <div className={`storage-legend-color`} style={{
                      background: dir === 'downloads' ? 'var(--accent)' :
                        dir === 'converted' ? 'var(--success)' :
                          dir === 'uploads' ? 'var(--warning)' : 'var(--error)'
                    }} />
                    <span>{dir}: {info.formatted}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Recent Jobs */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><ClipboardList size={18} /> Recent Jobs</div>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="form-input"
              style={{ width: 'auto', padding: '6px 12px' }}
            >
              <option value="all">All Jobs</option>
              <option value="mine">My Jobs</option>
              <option value="download">Downloads</option>
              <option value="convert">Conversions</option>
            </select>
          </div>
          <div className="table-container">
            {filteredJobs.length === 0 ? (
              <div className="table-empty">
                <div className="empty-icon"><Inbox size={64} style={{ margin: '0 auto' }} /></div>
                <p>No jobs found</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.slice((recentJobsPage - 1) * ITEMS_PER_PAGE, recentJobsPage * ITEMS_PER_PAGE).map(job => (
                    <tr key={job.id}>
                      <td>
                        <Link to={`/${job.type === 'download' ? 'downloader' : job.type === 'convert' ? 'converter' : job.type}`} style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--accent)' }}>
                            {job.type === 'download' ? <Download size={18} /> :
                              job.type === 'convert' ? <FileAudio size={18} /> :
                                job.type === 'shortener' ? <LinkIcon size={18} /> :
                                  <FolderOpen size={18} />}
                          </span>
                          <span style={{ marginLeft: '8px', textTransform: 'capitalize', fontWeight: '500' }}>
                            {job.type}
                          </span>
                        </Link>
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
                        {job.status === 'done' ? (
                          <div className="progress-wrapper">
                            <div className="progress-bar">
                              <div className="progress-fill" style={{ width: '100%', backgroundColor: 'var(--success)' }} />
                            </div>
                            <span className="progress-text">100%</span>
                          </div>
                        ) : job.progress !== null ? (
                          <div className="progress-wrapper">
                            <div className="progress-bar">
                              <div className="progress-fill" style={{ width: `${job.progress}%` }} />
                            </div>
                            <span className="progress-text">{job.progress}%</span>
                          </div>
                        ) : '-'}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                        {formatDate(job.createdAt)}
                      </td>
                      <td>
                        {job.status === 'done' && job.outputJson?.files?.length > 0 && (
                          <a
                            href={getFileUrl(job.id, job.outputJson.files[0].filename)}
                            className="btn btn-success btn-sm"
                          >
                            <Download size={14} /> Download
                          </a>
                        )}
                        {job.status === 'failed' && (
                          <span style={{ color: 'var(--error)', fontSize: '12px' }} title={job.error}>
                            Error
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {filteredJobs.length > 0 && (
            <Pagination
              currentPage={recentJobsPage}
              totalItems={filteredJobs.length}
              itemsPerPage={ITEMS_PER_PAGE}
              onPageChange={setRecentJobsPage}
            />
          )}
        </div>
      </div>
    </>
  );
}

export default Dashboard;
