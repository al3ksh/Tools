import { useState, useEffect } from 'react';
import { api, formatDate } from '../api';
import { Link as LinkIcon, Sparkles, CheckCircle, Copy, Clock, List, XCircle } from 'lucide-react';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import useToast from '../hooks/useToast';

function Shortener({ sessionId }) {
  const [url, setUrl] = useState('');
  const [slug, setSlug] = useState('');
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdLink, setCreatedLink] = useState(null);
  const [toast, showToast] = useToast();

  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const fetchLinks = async () => {
    try {
      const data = await api.getShortlinks(sessionId);
      setLinks(data);
    } catch (err) {
      console.error('Failed to fetch links:', err);
    }
  };

  useEffect(() => {
    fetchLinks();
    const interval = setInterval(fetchLinks, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError('');
    setCreatedLink(null);

    try {
      const result = await api.createShortlink(url, slug || null, sessionId);
      setCreatedLink(result);
      setUrl('');
      setSlug('');
      showToast('Short link created!');
      fetchLinks();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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
            <LinkIcon size={24} /> Link Shortener
          </h2>
          <div className="subtitle">Create short links and track clicks</div>
        </div>
      </div>

      <div className="content">
        {/* Form */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Sparkles size={18} /> Create Short Link</div>
          </div>
          <div className="card-body">
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">URL to Shorten</label>
                <input
                  type="url"
                  className="form-input"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/very/long/url"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Custom Slug (optional)</label>
                <input
                  type="text"
                  className="form-input"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="my-link (leave empty for random)"
                  pattern="[a-zA-Z0-9_-]+"
                  title="Only letters, numbers, hyphens and underscores"
                />
                <div className="form-help">Only letters, numbers, hyphens and underscores allowed</div>
              </div>

              {error && (
                <div style={{ color: 'var(--error)', marginBottom: '15px', padding: '10px', background: 'rgba(231, 76, 60, 0.1)', borderRadius: '6px' }}>
                  {error}
                </div>
              )}

              {createdLink && (
                <div style={{
                  background: 'rgba(46, 204, 113, 0.1)',
                  padding: '15px',
                  borderRadius: '6px',
                  marginBottom: '15px',
                  border: '1px solid rgba(46, 204, 113, 0.3)'
                }}>
                  <div style={{ marginBottom: '8px', fontWeight: '500', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CheckCircle size={16} /> Short link created:
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <code style={{
                      background: 'var(--bg)',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      flex: 1,
                      fontSize: '14px'
                    }}>
                      {createdLink.shortUrl}
                    </code>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => copyToClipboard(createdLink.shortUrl)}
                    >
                      <Copy size={14} /> Copy
                    </button>
                  </div>
                </div>
              )}

              <button type="submit" className="btn btn-primary" disabled={loading || !url.trim()}>
                {loading ? <><Clock size={16} /> Creating...</> : <><LinkIcon size={16} /> Create Short Link</>}
              </button>
            </form>
          </div>
        </div>

        {/* My Links */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><List size={18} /> My Links ({links.length})</div>
          </div>
          <div className="table-container">
            {links.length === 0 ? (
              <EmptyState icon={LinkIcon} title="No links yet" description="Create your first short link above" />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Short URL</th>
                    <th>Target URL</th>
                    <th>Clicks</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {links.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE).map(link => (
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
                      <td>
                        <a
                          href={link.targetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent-text)', textDecoration: 'none' }}
                          title={link.targetUrl}
                        >
                          {link.targetUrl.length > 50 ? link.targetUrl.slice(0, 50) + '...' : link.targetUrl}
                        </a>
                      </td>
                      <td>
                        <span style={{ fontWeight: '500' }}>{link.clicks}</span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                        {formatDate(link.createdAt)}
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => copyToClipboard(`${getBaseUrl()}/s/${link.slug}`)}
                        >
                          <Copy size={14} /> Copy
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {links.length > 0 && (
            <Pagination
              currentPage={currentPage}
              totalItems={links.length}
              itemsPerPage={ITEMS_PER_PAGE}
              onPageChange={setCurrentPage}
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

export default Shortener;
