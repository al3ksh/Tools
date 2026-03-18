import { useNavigate } from 'react-router-dom';
import { Home, AlertTriangle } from 'lucide-react';

function NotFound() {
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '16px', color: 'var(--text-secondary)' }}>
      <AlertTriangle size={48} style={{ opacity: 0.4 }} />
      <h2 style={{ color: 'var(--text-primary)', margin: 0 }}>Page Not Found</h2>
      <p style={{ margin: 0 }}>The page you're looking for doesn't exist.</p>
      <button className="btn btn-primary" onClick={() => navigate('/')}>
        <Home size={16} /> Go to Dashboard
      </button>
    </div>
  );
}

export default NotFound;
