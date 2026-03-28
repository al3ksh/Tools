import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, Film, AlertCircle, CheckCircle, XCircle, Copy, Code, Trash2, ArrowLeft } from 'lucide-react';
import { api, formatBytes, formatDate, getClipStreamUrl, getClipEmbedUrl } from '../api';
import useToast from '../hooks/useToast';

function ClipView({ isAdmin }) {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showEmbed, setShowEmbed] = useState(false);
  const [toast, showToast] = useToast();
  const sessionId = (() => {
    try {
      const stored = localStorage.getItem('tools_session');
      if (stored) return JSON.parse(stored).id;
    } catch (e) {}
    return null;
  })();

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const data = await api.getClipInfo(token);
        setInfo(data);
      } catch (err) {
        setError(err.message || 'Clip not found');
      } finally {
        setLoading(false);
      }
    };
    fetchInfo();
  }, [token]);

  const streamUrl = getClipStreamUrl(token);
  const embedUrl = getClipEmbedUrl(token);
  const embedCode = `<iframe src="${window.location.origin}${embedUrl}" width="640" height="360" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!');
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(streamUrl, { credentials: 'include' });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = info.filename;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^";\n]+)"?/);
        if (match) filename = match[1];
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDelete = async () => {
    try {
      await api.deleteClip(token, sessionId);
      showToast('Clip deleted');
      window.location.href = '/clips';
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const isOwner = info && sessionId && info.sessionId === sessionId;
  const canDelete = isOwner || isAdmin;

  if (loading) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        minHeight: '100vh', background: '#000'
      }}>
        <div className="skeleton-box" style={{ width: '100%', maxWidth: '720px', height: '450px', borderRadius: '8px' }} />
      </div>
    );
  }

  if (error || !info) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        minHeight: '100vh', background: '#000', padding: '20px'
      }}>
        <div style={{ maxWidth: '500px', width: '100%', textAlign: 'center' }}>
          <AlertCircle size={64} style={{ color: '#666', margin: '0 auto 20px' }} />
          <h2 style={{ marginBottom: '10px', color: '#fff' }}>Clip Not Found</h2>
          <p style={{ color: '#888', marginBottom: '20px' }}>{error}</p>
          <Link to="/" style={{
            color: '#3498db', textDecoration: 'none', display: 'inline-flex',
            alignItems: 'center', gap: '8px'
          }}>
            Go to Tools
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#000', display: 'flex',
      flexDirection: 'column', alignItems: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: '960px', padding: '20px',
        boxSizing: 'border-box',
      }}>
        <Link
          to="/"
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            color: '#888', fontSize: '13px', textDecoration: 'none', padding: '0 0 12px',
            transition: 'color 0.15s',
          }}
          onMouseOver={(e) => e.currentTarget.style.color = '#fff'}
          onMouseOut={(e) => e.currentTarget.style.color = '#888'}
        >
          <ArrowLeft size={16} /> Back to Tools
        </Link>
        <div style={{
          width: '100%', borderRadius: '8px', overflow: 'hidden',
          background: '#000', marginBottom: '16px',
        }}>
          <video
            src={streamUrl}
            controls
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            style={{ width: '100%', maxHeight: '70vh', display: 'block' }}
          />
        </div>

        <div style={{ marginBottom: '12px' }}>
          <h2 style={{
            color: '#fff', marginBottom: '8px', wordBreak: 'break-all',
            fontSize: '16px', fontWeight: '500'
          }}>
            {info.filename}
          </h2>

          <div style={{ display: 'flex', gap: '12px', color: '#888', fontSize: '13px', flexWrap: 'wrap' }}>
            <span>{formatBytes(info.size)}</span>
            <span style={{ color: '#444' }}>|</span>
            <span>{info.downloads} views</span>
            <span style={{ color: '#444' }}>|</span>
            <span>{formatDate(info.createdAt)}</span>
          </div>
          {(info.width || info.fps || info.bitrate || info.videoCodec) && (
            <div style={{ display: 'flex', gap: '12px', color: '#666', fontSize: '12px', flexWrap: 'wrap', marginTop: '6px' }}>
              {info.width && <span>{info.width}x{info.height}</span>}
              {info.fps && <span>{Math.round(info.fps)}fps</span>}
              {info.bitrate && <span>{formatBytes(info.bitrate / 8)}/s</span>}
              {info.videoCodec && <span>{info.videoCodec.toUpperCase()}</span>}
              {info.audioCodec && <span>{info.audioCodec.toUpperCase()}</span>}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => copyToClipboard(window.location.href)}
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
          >
            <Copy size={14} /> Copy Link
          </button>
          <button
            onClick={() => setShowEmbed(!showEmbed)}
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
          >
            <Code size={14} /> Embed
          </button>
          <button
            onClick={handleDownload}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
          >
            <Download size={14} /> Download
          </button>
          {canDelete && (
            <button
              onClick={handleDelete}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px',
                background: 'rgba(231,76,60,0.15)', border: '1px solid rgba(231,76,60,0.3)',
                color: '#e74c3c', padding: '8px 14px', borderRadius: '6px',
                cursor: 'pointer', transition: 'background 0.15s',
              }}
              onMouseOver={(e) => e.currentTarget.style.background = 'rgba(231,76,60,0.25)'}
              onMouseOut={(e) => e.currentTarget.style.background = 'rgba(231,76,60,0.15)'}
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>

        {showEmbed && (
          <div style={{
            marginTop: '12px', background: '#1a1a1a', borderRadius: '8px',
            padding: '12px', border: '1px solid #333'
          }}>
            <textarea
              readOnly
              value={embedCode}
              onClick={(e) => e.target.select()}
              style={{
                width: '100%', background: '#111', color: '#ccc', border: 'none',
                borderRadius: '4px', padding: '10px', fontSize: '12px',
                fontFamily: 'monospace', resize: 'vertical', minHeight: '60px',
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={() => copyToClipboard(embedCode)}
              className="btn btn-secondary btn-sm"
              style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
            >
              <Copy size={12} /> Copy Embed Code
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className={`toast toast-${toast.type}`} style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999 }}>
          {toast.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />} {toast.message}
        </div>
      )}
    </div>
  );
}

export default ClipView;
