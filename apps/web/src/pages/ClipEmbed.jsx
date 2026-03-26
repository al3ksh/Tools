import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Film, AlertCircle } from 'lucide-react';
import { api, getClipStreamUrl, getClipUrl } from '../api';

function ClipEmbed() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const data = await api.getClipInfo(token);
        setInfo(data);
      } catch (err) {
        setError(err.message || 'Clip not found');
      }
    };
    fetchInfo();
  }, [token]);

  if (error || !info) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        height: '100vh', background: '#000', margin: 0, fontFamily: 'sans-serif',
      }}>
        <div style={{ textAlign: 'center', color: '#888' }}>
          <AlertCircle size={32} style={{ margin: '0 auto 8px', color: '#666' }} />
          <div style={{ fontSize: '14px' }}>Clip not found</div>
        </div>
      </div>
    );
  }

  const streamUrl = getClipStreamUrl(token);

  return (
    <div style={{
      background: '#000', margin: 0, padding: 0,
      display: 'flex', flexDirection: 'column', minHeight: '100vh',
      fontFamily: 'sans-serif',
    }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: '720px' }}>
          <video
            src={streamUrl}
            controls
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            style={{ width: '100%', display: 'block' }}
          />
        </div>
      </div>
      <a
        href={getClipUrl(token)}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '6px', padding: '10px', color: '#666', textDecoration: 'none',
          fontSize: '12px', transition: 'color 0.2s',
        }}
        onMouseOver={(e) => e.currentTarget.style.color = '#999'}
        onMouseOut={(e) => e.currentTarget.style.color = '#666'}
      >
        <Film size={14} /> {info.filename}
      </a>
    </div>
  );
}

export default ClipEmbed;
