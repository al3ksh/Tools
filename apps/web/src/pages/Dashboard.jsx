import { useState, useEffect, useMemo } from 'react';
import { api, formatBytes, formatDate, getFileUrl } from '../api';
import { Link } from 'react-router-dom';
import { LayoutDashboard, RefreshCw, FolderOpen, Clock, CheckCircle, XCircle, Zap, Download, FileAudio, Link as LinkIcon, Database, ClipboardList, Settings, Inbox, Archive, PackageOpen, Film, QrCode, Files, Sparkles, ArrowUpRight } from 'lucide-react';
import JobProgress from '../components/JobProgress';
import Pagination from '../components/Pagination';
import { KadronHero } from '../components/Kadron';

const TOOLS = [
  { to: '/downloader', icon: Download, title: 'Downloader', desc: 'YouTube, TikTok, Instagram, X and 1000+ sites' },
  { to: '/converter', icon: FileAudio, title: 'Audio Converter', desc: 'MP3, FLAC, WAV, Opus, trimmed on the waveform' },
  { to: '/compress', icon: PackageOpen, title: 'Compressor', desc: 'Shrink video, audio and images to a target size' },
  { to: '/clips', icon: Film, title: 'Clips', desc: 'Trim on a filmstrip and share with embeds' },
  { to: '/gif', icon: Sparkles, title: 'GIF Maker', desc: 'Pick a segment, preview, export' },
  { to: '/pdf', icon: Files, title: 'PDF Editor', desc: 'Edit pages, merge, extract, images to PDF' },
  { to: '/drop', icon: FolderOpen, title: 'Drop', desc: 'Share a file with a link, optional password' },
  { to: '/shortener', icon: LinkIcon, title: 'Shortener', desc: 'Short links with custom slugs and clicks' },
  { to: '/qr', icon: QrCode, title: 'QR Code', desc: 'PNG or SVG, custom colours' },
];

function Dashboard({ sessionId, isAdmin }) {
  const [jobs, setJobs] = useState([]);
  const [storage, setStorage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  // Pagination State
  const [recentJobsPage, setRecentJobsPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const fetchData = async () => {
    try {
      const [jobsData, storageData] = await Promise.all([
        api.getJobs(sessionId),
        api.getStorage(sessionId).catch(() => null)
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

  const myJobs = useMemo(() => jobs.filter(j => j.sessionId === sessionId || j.inputJson?.sessionId === sessionId), [jobs, sessionId]);
  const filteredJobs = useMemo(() => filter === 'all' ? jobs : filter === 'mine' ? myJobs : jobs.filter(j => j.type === filter), [filter, jobs, myJobs]);

  function getJobRoute(type) {
    const routes = {
      download: '/downloader',
      convert: '/converter',
      pdf: '/pdf',
      gif: '/gif',
      clip: '/clips',
      compress: '/compress'
    };
    return routes[type] || '/';
  }

  const stats = useMemo(() => ({
    total: jobs.length,
    mine: myJobs.length,
    queued: jobs.filter(j => j.status === 'queued').length,
    running: jobs.filter(j => j.status === 'running').length,
    done: jobs.filter(j => j.status === 'done').length,
    failed: jobs.filter(j => j.status === 'failed').length,
  }), [jobs, myJobs]);

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
        <KadronHero />

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
            <div className="card-title"><Zap size={18} /> Tools</div>
          </div>
          <div className="card-body">
            <div className="tool-grid">
              {TOOLS.map(({ to, icon: Icon, title, desc }) => (
                <Link key={to} to={to} className="tool-tile">
                  <span className="tool-tile-icon"><Icon size={20} /></span>
                  <span className="tool-tile-text">
                    <span className="tool-tile-title">{title}</span>
                    <span className="tool-tile-desc">{desc}</span>
                  </span>
                  <ArrowUpRight size={16} className="tool-tile-arrow" />
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="dashboard-columns">
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
              <option value="pdf">PDF</option>
              <option value="gif">GIF</option>
              <option value="clip">Clips</option>
              <option value="compress">Compressions</option>
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
                        <Link to={getJobRoute(job.type)} style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--accent-text)' }}>
                            {job.type === 'download' ? <Download size={18} /> :
                              job.type === 'convert' ? <FileAudio size={18} /> :
                                job.type === 'compress' ? <PackageOpen size={18} /> :
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
                        <JobProgress
                          job={job}
                          title={job.status === 'done' ? 'Completed' : 'Progress'}
                          compact
                        />
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                        {formatDate(job.createdAt)}
                      </td>
                      <td>
                        {job.status === 'done' && job.outputJson?.files?.length > 0 && (
                          <a
                            href={getFileUrl(job.id, job.outputJson.files[0].filename, sessionId)}
                            className="btn btn-success btn-sm"
                          >
                            <Download size={14} /> Download
                          </a>
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
        {/* Storage */}
        {storage && (
          <div className="card">
            <div className="card-header">
              <div className="card-title"><Database size={18} /> {isAdmin ? 'Storage Usage' : 'Your Usage'}</div>
              {storage.total && <div className="stat-info">{storage.total.formatted}</div>}
            </div>
            <div className="card-body">
              {isAdmin && storage.disk && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <span>Disk</span>
                    <span>{storage.disk.usedFormatted} / {storage.disk.totalFormatted} ({storage.disk.usedPercent}%)</span>
                  </div>
                  <div className="progress-bar" style={{ height: '8px' }}>
                    <div className="progress-fill" style={{
                      width: `${Math.min(storage.disk.usedPercent, 100)}%`,
                      backgroundColor: storage.disk.usedPercent > 90 ? 'var(--error)' : storage.disk.usedPercent > 70 ? 'var(--warning)' : 'var(--accent)'
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    <span>Free: {storage.disk.availableFormatted}</span>
                  </div>
                </div>
              )}
              <div className="storage-bar">
                {Object.entries(storage.directories || {}).map(([dir, info]) => {
                  const percent = storage.total.bytes > 0 ? (info.bytes / storage.total.bytes) * 100 : 0;
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
                {Object.entries(storage.directories || {}).map(([dir, info]) => (
                  <div key={dir} className="storage-legend-item">
                    <div className={`storage-legend-color`} style={{
                      background: dir === 'downloads' ? 'var(--accent)' :
                        dir === 'converted' ? 'var(--success)' :
                          dir === 'clips' ? '#a78bfa' :
                            dir === 'uploads' ? 'var(--warning)' : 'var(--error)'
                    }} />
                    <span>{dir}: {info.formatted}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        </div>
      </div>
    </>
  );
}

export default Dashboard;
