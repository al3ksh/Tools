import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { LayoutDashboard, Download, FileAudio, Link as LinkIcon, FolderOpen, Wrench, UserCircle, Sun, Moon, Shield, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import Downloader from './pages/Downloader';
import Converter from './pages/Converter';
import Shortener from './pages/Shortener';
import Drop from './pages/Drop';
import DropView from './pages/DropView';
import './index.css';

function App() {
  const [isAdmin, setIsAdmin] = useState(() => {
    return !!localStorage.getItem('adminToken');
  });

  const [sessionId] = useState(() => {
    // Admin always uses a shared fixed sessionId
    if (localStorage.getItem('adminToken')) {
      return 'admin';
    }
    // Guest gets a unique persistent session
    const stored = localStorage.getItem('tools_session');
    if (stored) {
      const parsed = JSON.parse(stored);
      const id = parsed.id || parsed;
      if (id) return id;
    }
    const newId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('tools_session', JSON.stringify({ id: newId }));
    return newId;
  });

  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    // Default to dark mode if nothing saved
    return saved !== 'light';
  });


  const [showLoginModal, setShowLoginModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const handleAdminToggle = () => {
    if (isAdmin) {
      localStorage.removeItem('adminToken');
      setIsAdmin(false);
      window.location.reload();
    } else {
      setLoginError('');
      setPasswordInput('');
      setShowLoginModal(true);
    }
  };

  const submitLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem('adminToken', data.token);
        setIsAdmin(true);
        setShowLoginModal(false);
        window.location.reload();
      } else {
        setLoginError(data.error || 'Login failed');
        setPasswordInput('');
      }
    } catch (err) {
      setLoginError('Connection error');
    } finally {
      setLoginLoading(false);
    }
  };

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove('light-mode');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.classList.add('light-mode');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  return (
    <>
      <BrowserRouter>
        <div className="app-container">
          <aside className="sidebar">
            <div className="sidebar-header">
              <h1><Wrench size={24} color="var(--accent)" /> <span>Tools</span></h1>
            </div>
            <nav className="sidebar-nav">
              <div className="nav-section">Menu</div>
              <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
                <span className="nav-icon"><LayoutDashboard size={18} /></span>
                <span>Dashboard</span>
              </NavLink>
              <NavLink to="/downloader" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
                <span className="nav-icon"><Download size={18} /></span>
                <span>Downloader</span>
              </NavLink>
              <NavLink to="/converter" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
                <span className="nav-icon"><FileAudio size={18} /></span>
                <span>Converter</span>
              </NavLink>
              <NavLink to="/shortener" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
                <span className="nav-icon"><LinkIcon size={18} /></span>
                <span>Shortener</span>
              </NavLink>
              <NavLink to="/drop" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
                <span className="nav-icon"><FolderOpen size={18} /></span>
                <span>Drop</span>
              </NavLink>
            </nav>
            <div className="sidebar-footer">
              <div className="user-profile-card">
                <UserCircle size={32} className="user-avatar" />
                <div className="user-details">
                  <div
                    className="user-name"
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}
                    onClick={handleAdminToggle}
                    title=""
                  >
                    {isAdmin ? 'Admin Session' : 'Guest Session'}
                    {isAdmin && <Shield size={14} color="var(--accent)" />}
                  </div>
                  <div className="user-session" title={sessionId}>ID: {sessionId.slice(0, 8)}...</div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                <div className="session-expiry" style={{ opacity: 0.5, fontSize: '11px' }}>{isAdmin ? '∞ No expiry' : 'Files expire in 1h'}</div>
                <button
                  onClick={toggleTheme}
                  style={{
                    background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '6px', borderRadius: '4px', transition: 'background 0.2s'
                  }}
                  title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                  onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
                </button>
              </div>
            </div>
          </aside>
          <main className="main-content">
            <Routes>
              <Route path="/" element={<Dashboard sessionId={sessionId} />} />
              <Route path="/downloader" element={<Downloader sessionId={sessionId} />} />
              <Route path="/converter" element={<Converter sessionId={sessionId} />} />
              <Route path="/shortener" element={<Shortener sessionId={sessionId} />} />
              <Route path="/drop" element={<Drop sessionId={sessionId} />} />
              <Route path="/d/:token" element={<DropView />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>

      {showLoginModal && (
        <div className="modal-overlay" onClick={() => setShowLoginModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Admin Login</h3>
              <button className="btn-icon" onClick={() => setShowLoginModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <form onSubmit={submitLogin}>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input
                    type="password"
                    style={{
                      width: '100%', padding: '10px',
                      borderRadius: '6px', border: `2px solid ${loginError ? 'var(--error)' : 'var(--border)'}`,
                      background: 'var(--bg)', color: 'var(--text)',
                      outline: 'none',
                      transition: 'border-color 0.2s',
                    }}
                    value={passwordInput}
                    onChange={(e) => { setPasswordInput(e.target.value); setLoginError(''); }}
                    placeholder="Enter admin password..."
                    autoFocus
                  />
                  {loginError && (
                    <div style={{ color: 'var(--error)', fontSize: '13px', marginTop: '8px' }}>
                      {loginError}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowLoginModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={!passwordInput || loginLoading}>
                    {loginLoading ? 'Logging in...' : 'Login'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
