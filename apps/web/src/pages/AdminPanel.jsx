import { useState, useEffect } from 'react';
import { api, formatDate, formatBytes, getFileUrl, getDropUrl } from '../api';
import {
    Shield, Download, FileAudio, Link as LinkIcon, FolderOpen,
    Trash2, RefreshCw, Copy, ExternalLink, CheckCircle, XCircle,
    Clock, AlertTriangle, Archive
} from 'lucide-react';
import Pagination from '../components/Pagination';
import useToast from '../hooks/useToast';

const STATUS_ICONS = {
    queued: <Clock size={14} />,
    running: <RefreshCw size={14} className="spin" />,
    done: <CheckCircle size={14} />,
    failed: <XCircle size={14} />,
    expired: <AlertTriangle size={14} />,
    deleted: <Archive size={14} />,
};

function AdminPanel() {
    const [activeTab, setActiveTab] = useState('jobs');
    const [jobs, setJobs] = useState([]);
    const [drops, setDrops] = useState([]);
    const [links, setLinks] = useState([]);
    const [toast, showToast] = useToast();

    // Pagination
    const [jobsPage, setJobsPage] = useState(1);
    const [dropsPage, setDropsPage] = useState(1);
    const [linksPage, setLinksPage] = useState(1);
    const ITEMS_PER_PAGE = 15;

    const fetchAll = async () => {
        try {
            const [j, d, l] = await Promise.all([
                api.getAllJobs(),
                api.getAllDrops(),
                api.getAllShortlinks(),
            ]);
            setJobs(j);
            setDrops(d);
            setLinks(l);
        } catch (err) {
            console.error('Admin fetch error:', err);
        }
    };

    useEffect(() => {
        fetchAll();
        const interval = setInterval(fetchAll, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleDeleteJob = async (id) => {
        try {
            await api.deleteJob(id);
            showToast('Job deleted');
            fetchAll();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const handleDeleteDrop = async (token) => {
        try {
            await api.deleteDrop(token);
            showToast('Drop deleted');
            fetchAll();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const handleDeleteLink = async (slug) => {
        try {
            await api.deleteShortlink(slug);
            showToast('Link deleted');
            fetchAll();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        showToast('Copied!');
    };

    const tabs = [
        { id: 'jobs', label: 'Jobs', icon: <Download size={16} />, count: jobs.length },
        { id: 'drops', label: 'Drops', icon: <FolderOpen size={16} />, count: drops.length },
        { id: 'links', label: 'Shortlinks', icon: <LinkIcon size={16} />, count: links.length },
    ];

    return (
        <>
            <div className="page-header">
                <div className="page-title">
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Shield size={24} /> Admin Panel
                    </h2>
                    <div className="subtitle">Manage all application activity</div>
                </div>
            </div>

            <div className="content">
                {/* Tab Bar */}
                <div style={{
                    display: 'flex',
                    gap: '4px',
                    background: 'var(--bg-secondary)',
                    borderRadius: '8px',
                    padding: '4px',
                    marginBottom: '20px'
                }}>
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                flex: 1,
                                padding: '10px 16px',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                fontSize: '13px',
                                fontWeight: '500',
                                transition: 'all 0.2s',
                                background: activeTab === tab.id ? 'var(--accent)' : 'transparent',
                                color: activeTab === tab.id ? '#fff' : 'var(--text-secondary)',
                            }}
                        >
                            {tab.icon} {tab.label}
                            <span style={{
                                background: activeTab === tab.id ? 'rgba(255,255,255,0.2)' : 'var(--bg-tertiary)',
                                padding: '2px 8px',
                                borderRadius: '10px',
                                fontSize: '11px',
                            }}>
                                {tab.count}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Jobs Tab */}
                {activeTab === 'jobs' && (
                    <div className="card">
                        <div className="card-header">
                            <div className="card-title"><Download size={18} /> All Jobs</div>
                        </div>
                        <div className="table-container">
                            {jobs.length === 0 ? (
                                <div className="empty-state">
                                    <div className="empty-title">No jobs yet</div>
                                </div>
                            ) : (
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Type</th>
                                            <th>Status</th>
                                            <th>Input</th>
                                            <th>Session</th>
                                            <th>Created</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {jobs.slice((jobsPage - 1) * ITEMS_PER_PAGE, jobsPage * ITEMS_PER_PAGE).map(job => (
                                            <tr key={job.id} className={job.status === 'deleted' ? 'status-deleted' : ''}>
                                                <td>
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        {job.type === 'download' ? <Download size={14} /> : <FileAudio size={14} />}
                                                        {job.type}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className={`status-badge status-${job.status}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                        {STATUS_ICONS[job.status]} {job.status}
                                                    </span>
                                                </td>
                                                <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px' }}>
                                                    {job.inputJson?.url || (typeof job.inputJson?.source === 'string' ? job.inputJson.source : job.inputJson?.source?.originalName) || '-'}
                                                </td>
                                                <td style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                    {job.sessionId === 'admin' ? (
                                                        <span style={{ color: 'var(--accent)', fontWeight: '500' }}>admin</span>
                                                    ) : (
                                                        job.sessionId ? job.sessionId.slice(0, 12) + '...' : '-'
                                                    )}
                                                </td>
                                                <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                                                    {formatDate(job.createdAt)}
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                        {job.status === 'done' && (
                                                            <a
                                                                href={getFileUrl(job.id)}
                                                                className="btn btn-secondary btn-sm"
                                                                title="Download"
                                                            >
                                                                <Download size={14} />
                                                            </a>
                                                        )}
                                                        {job.status !== 'deleted' && (
                                                            <button
                                                                className="btn btn-secondary btn-sm"
                                                                 onClick={() => { if (window.confirm('Delete this job?')) handleDeleteJob(job.id); }}
                                                                title="Delete"
                                                                style={{ color: 'var(--error)' }}
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        {jobs.length > 0 && (
                            <Pagination
                                currentPage={jobsPage}
                                totalItems={jobs.length}
                                itemsPerPage={ITEMS_PER_PAGE}
                                onPageChange={setJobsPage}
                            />
                        )}
                    </div>
                )}

                {/* Drops Tab */}
                {activeTab === 'drops' && (
                    <div className="card">
                        <div className="card-header">
                            <div className="card-title"><FolderOpen size={18} /> All Drops</div>
                        </div>
                        <div className="table-container">
                            {drops.length === 0 ? (
                                <div className="empty-state">
                                    <div className="empty-title">No drops yet</div>
                                </div>
                            ) : (
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Filename</th>
                                            <th>Size</th>
                                            <th>Downloads</th>
                                            <th>Session</th>
                                            <th>Expires</th>
                                            <th>Created</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {drops.slice((dropsPage - 1) * ITEMS_PER_PAGE, dropsPage * ITEMS_PER_PAGE).map(drop => {
                                            const isExpired = drop.deleted || (drop.expiresAt && new Date(drop.expiresAt) < new Date());
                                            return (
                                                <tr key={drop.token} className={isExpired ? 'status-deleted' : ''}>
                                                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {drop.filename}
                                                    </td>
                                                    <td>{formatBytes(drop.size)}</td>
                                                    <td>{drop.downloads}</td>
                                                    <td style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                        {drop.sessionId === 'admin' ? (
                                                            <span style={{ color: 'var(--accent)', fontWeight: '500' }}>admin</span>
                                                        ) : (
                                                            drop.sessionId ? drop.sessionId.slice(0, 12) + '...' : '-'
                                                        )}
                                                    </td>
                                                    <td style={{ fontSize: '12px' }}>
                                                        {isExpired ? (
                                                            <span className="status-badge status-expired">Expired</span>
                                                        ) : drop.expiresAt ? (
                                                            formatDate(drop.expiresAt)
                                                        ) : (
                                                            <span style={{ color: 'var(--success)' }}>Never</span>
                                                        )}
                                                    </td>
                                                    <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                                                        {formatDate(drop.createdAt)}
                                                    </td>
                                                    <td>
                                                        <div style={{ display: 'flex', gap: '4px' }}>
                                                            {!isExpired && (
                                                                <a
                                                                    href={getDropUrl(drop.token)}
                                                                    className="btn btn-secondary btn-sm"
                                                                    title="Download"
                                                                >
                                                                    <Download size={14} />
                                                                </a>
                                                            )}
                                                            <button
                                                                className="btn btn-secondary btn-sm"
                                                                onClick={() => copyToClipboard(`${window.location.origin}/d/${drop.token}`)}
                                                                title="Copy link"
                                                            >
                                                                <Copy size={14} />
                                                            </button>
                                                            <button
                                                                className="btn btn-secondary btn-sm"
                                                                 onClick={() => { if (window.confirm('Delete this file?')) handleDeleteDrop(drop.token); }}
                                                                title="Delete"
                                                                style={{ color: 'var(--error)' }}
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
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
                                currentPage={dropsPage}
                                totalItems={drops.length}
                                itemsPerPage={ITEMS_PER_PAGE}
                                onPageChange={setDropsPage}
                            />
                        )}
                    </div>
                )}

                {/* Shortlinks Tab */}
                {activeTab === 'links' && (
                    <div className="card">
                        <div className="card-header">
                            <div className="card-title"><LinkIcon size={18} /> All Shortlinks</div>
                        </div>
                        <div className="table-container">
                            {links.length === 0 ? (
                                <div className="empty-state">
                                    <div className="empty-title">No links yet</div>
                                </div>
                            ) : (
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Slug</th>
                                            <th>Target URL</th>
                                            <th>Clicks</th>
                                            <th>Session</th>
                                            <th>Created</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {links.slice((linksPage - 1) * ITEMS_PER_PAGE, linksPage * ITEMS_PER_PAGE).map(link => (
                                            <tr key={link.slug}>
                                                <td>
                                                    <code style={{
                                                        background: 'var(--bg-tertiary)',
                                                        padding: '4px 8px',
                                                        borderRadius: '4px',
                                                        fontSize: '12px'
                                                    }}>
                                                        {link.slug}
                                                    </code>
                                                </td>
                                                <td style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    <a
                                                        href={link.targetUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{ color: 'var(--accent)', textDecoration: 'none' }}
                                                        title={link.targetUrl}
                                                    >
                                                        {link.targetUrl.length > 50 ? link.targetUrl.slice(0, 50) + '...' : link.targetUrl}
                                                    </a>
                                                </td>
                                                <td>
                                                    <span style={{ fontWeight: '500' }}>{link.clicks}</span>
                                                </td>
                                                <td style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                    {link.sessionId === 'admin' ? (
                                                        <span style={{ color: 'var(--accent)', fontWeight: '500' }}>admin</span>
                                                    ) : (
                                                        link.sessionId ? link.sessionId.slice(0, 12) + '...' : '-'
                                                    )}
                                                </td>
                                                <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                                                    {formatDate(link.createdAt)}
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                        <button
                                                            className="btn btn-secondary btn-sm"
                                                            onClick={() => copyToClipboard(`${window.location.origin}/s/${link.slug}`)}
                                                            title="Copy link"
                                                        >
                                                            <Copy size={14} />
                                                        </button>
                                                        <button
                                                            className="btn btn-secondary btn-sm"
                                                            onClick={() => { if (window.confirm('Delete this link?')) handleDeleteLink(link.slug); }}
                                                            title="Delete"
                                                            style={{ color: 'var(--error)' }}
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        {links.length > 0 && (
                            <Pagination
                                currentPage={linksPage}
                                totalItems={links.length}
                                itemsPerPage={ITEMS_PER_PAGE}
                                onPageChange={setLinksPage}
                            />
                        )}
                    </div>
                )}
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

export default AdminPanel;
