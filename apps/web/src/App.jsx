import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Download, FileAudio, Link as LinkIcon, FolderOpen, Wrench, UserCircle, Settings, Sun, Moon, Shield, X, Menu, Cookie, FileText, QrCode, Files, Sparkles, Film } from 'lucide-react';
import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import Downloader from './pages/Downloader';
import Converter from './pages/Converter';
import Shortener from './pages/Shortener';
import Drop from './pages/Drop';
import DropView from './pages/DropView';
import AdminPanel from './pages/AdminPanel';
import PrivacyPolicy from './pages/PrivacyPolicy';
import QRCode from './pages/QRCode';
import PDFEditor from './pages/PDFEditor';
import GifMaker from './pages/GifMaker';
import Clips from './pages/Clips';
import ClipView from './pages/ClipView';
import ClipEmbed from './pages/ClipEmbed';
import NotFound from './pages/NotFound';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

function App() {
  const [isAdmin, setIsAdmin] = useState(false);

  const [sessionId] = useState(() => {
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
    return saved !== 'light';
  });

  const [accentColor, setAccentColor] = useState(() => {
    return localStorage.getItem('accentColor') || '';
  });


  const [showLoginModal, setShowLoginModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [cookieConsent, setCookieConsent] = useState(() => localStorage.getItem('cookieConsent'));

  const handleAdminToggle = () => {
    if (isAdmin) {
      fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      }).finally(() => {
        localStorage.removeItem('adminToken');
        setIsAdmin(false);
        window.location.reload();
      });
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
        credentials: 'include',
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem('adminToken', 'ui-admin');
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
    let cancelled = false;

    const verifyAdmin = async () => {
      try {
        const res = await fetch('/api/auth/verify', {
          method: 'GET',
          credentials: 'include',
        });
        const data = await res.json();
        if (!cancelled) {
          const next = !!data?.isAdmin;
          setIsAdmin(next);
          if (next) localStorage.setItem('adminToken', 'ui-admin');
          else localStorage.removeItem('adminToken');
        }
      } catch (err) {
        if (!cancelled) {
          setIsAdmin(false);
          localStorage.removeItem('adminToken');
        }
      }
    };

    verifyAdmin();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove('light-mode');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.classList.add('light-mode');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  function getLuminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  }

  function getContrastTextColor(hex) {
    return getLuminance(hex) > 0.35
      ? `color-mix(in srgb, ${hex}, #000 45%)`
      : `color-mix(in srgb, ${hex}, #fff 50%)`;
  }

  function getContrastBtnText(hex) {
    return getLuminance(hex) > 0.35 ? '#000000' : '#ffffff';
  }

  useEffect(() => {
    if (accentColor) {
      document.documentElement.style.setProperty('--accent', accentColor);
      document.documentElement.style.setProperty('--accent-hover', accentColor);
      document.documentElement.style.setProperty('--accent-text', getContrastTextColor(accentColor));
      document.documentElement.style.setProperty('--accent-btn-text', getContrastBtnText(accentColor));
    } else {
      document.documentElement.style.removeProperty('--accent');
      document.documentElement.style.removeProperty('--accent-hover');
      document.documentElement.style.removeProperty('--accent-text');
      document.documentElement.style.removeProperty('--accent-btn-text');
    }
  }, [accentColor]);

  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  return (
    <>
      <BrowserRouter>
        <div className="app-container">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <Menu size={20} />
          </button>
          <div className={`sidebar-overlay${sidebarOpen ? ' visible' : ''}`} onClick={() => setSidebarOpen(false)} />
          <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
            <div className="sidebar-header">
              <h1><Wrench size={24} color="var(--accent-text)" /> <span>Tools</span></h1>
            </div>
            <nav className="sidebar-nav">
              <div className="nav-section">Menu</div>
              <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} onClick={() => setSidebarOpen(false)}>
                <span className="nav-icon"><LayoutDashboard size={18} /></span>
                <span>Dashboard</span>
              </NavLink>
              <NavLink to="/downloader" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} onClick={() => setSidebarOpen(false)}>
                <span className="nav-icon"><Download size={18} /></span>
                <span>Downloader</span>
              </NavLink>
              <NavLink to="/converter" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} onClick={() => setSidebarOpen(false)}>
                <span className="nav-icon"><FileAudio size={18} /></span>
                <span>Converter</span>
              </NavLink>
              <NavLink to="/shortener" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} onClick={() => setSidebarOpen(false)}>
                <span className="nav-icon"><LinkIcon size={18} /></span>
                <span>Shortener</span>
              </NavLink>
              <NavLink to="/drop" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} onClick={() => setSidebarOpen(false)}>
                <span className="nav-icon"><FolderOpen size={18} /></span>
                <span>Drop</span>
              </NavLink>
              <NavLink to="/qr" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} onClick={() => setSidebarOpen(false)}>
                <span className="nav-icon"><QrCode size={18} /></span>
                <span>QR Code</span>
              </NavLink>
              <NavLink to="/pdf" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} onClick={() => setSidebarOpen(false)}>
                <span className="nav-icon"><Files size={18} /></span>
                <span>PDF Editor</span>
              </NavLink>
              <NavLink to="/gif" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} onClick={() => setSidebarOpen(false)}>
                <span className="nav-icon"><Sparkles size={18} /></span>
                <span>GIF Maker</span>
              </NavLink>
              <NavLink to="/clips" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} onClick={() => setSidebarOpen(false)}>
                <span className="nav-icon"><Film size={18} /></span>
                <span>Clips</span>
              </NavLink>
              {isAdmin && (
                <>
                  <div className="nav-section" style={{ marginTop: '16px' }}>Admin</div>
                  <NavLink to="/admin" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} onClick={() => setSidebarOpen(false)}>
                    <span className="nav-icon"><Shield size={18} /></span>
                    <span>Manage All</span>
                  </NavLink>
                </>
              )}
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
                      {isAdmin && <Shield size={14} color="var(--accent-text)" />}
                    </div>
                    <div className="user-session" title={sessionId}>ID: {sessionId.slice(0, 8)}...</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                  <div className="session-expiry" style={{ opacity: 0.5, fontSize: '11px' }}>{isAdmin ? '∞ No expiry' : 'Files expire in 1h'}</div>
                  <button
                    onClick={() => setShowSettingsModal(true)}
                    style={{
                      background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '6px', borderRadius: '4px', transition: 'background 0.2s'
                    }}
                    title="Settings"
                    onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <Settings size={18} />
                  </button>
                </div>
                <NavLink
                  to="/privacy"
                  onClick={() => setSidebarOpen(false)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    marginTop: '10px', fontSize: '11px', color: 'var(--text-secondary)',
                    textDecoration: 'none', opacity: 0.6
                  }}
                >
                  <FileText size={12} /> Privacy Policy
                </NavLink>
              </div>
          </aside>
          <main className="main-content">
            <ErrorBoundary>
              <Routes>
              <Route path="/" element={<Dashboard sessionId={sessionId} />} />
              <Route path="/downloader" element={<Downloader sessionId={sessionId} />} />
              <Route path="/converter" element={<Converter sessionId={sessionId} />} />
              <Route path="/shortener" element={<Shortener sessionId={sessionId} />} />
              <Route path="/drop" element={<Drop sessionId={sessionId} />} />
              <Route path="/qr" element={<QRCode />} />
              <Route path="/pdf" element={<PDFEditor />} />
              <Route path="/gif" element={<GifMaker />} />
              <Route path="/clips" element={<Clips sessionId={sessionId} />} />
              <Route path="/d/:token" element={<DropView />} />
              <Route path="/c/:token/embed" element={<ClipEmbed />} />
              <Route path="/c/:token" element={<ClipView />} />
              {isAdmin && <Route path="/admin" element={<AdminPanel />} />}
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="*" element={<NotFound />} />
              </Routes>
            </ErrorBoundary>
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

      {showSettingsModal && (
        <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={18} /> Settings
              </h3>
              <button className="btn-icon" onClick={() => setShowSettingsModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>Appearance</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>Theme</span>
                      <button className="btn btn-secondary btn-sm" onClick={toggleTheme} style={{ padding: '4px 10px', fontSize: '12px' }}>
                        {isDarkMode ? <><Sun size={14} /> Light</> : <><Moon size={14} /> Dark</>}
                      </button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>Accent Color</span>
                      <div style={{
                        width: '28px', height: '28px', borderRadius: '6px', border: '2px solid var(--border)',
                        background: accentColor || 'var(--accent)', cursor: 'pointer', flexShrink: 0, overflow: 'hidden',
                      }}>
                        <input
                          type="color"
                          value={accentColor || '#2c93fa'}
                          onChange={(e) => {
                            const c = e.target.value;
                            setAccentColor(c);
                            localStorage.setItem('accentColor', c);
                          }}
                          style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer', padding: 0 }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>Session</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{
                      padding: '8px 10px', background: 'var(--bg-hover)', borderRadius: '6px',
                      fontSize: '12px', color: 'var(--text-primary)', fontFamily: 'monospace',
                      wordBreak: 'break-all',
                    }}>
                      {sessionId}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {isAdmin ? 'Admin session — no file expiry' : 'Guest session — files expire in 1 hour'}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ borderTop: '1px solid var(--border)', marginTop: '16px', paddingTop: '16px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', fontWeight: 600 }}>Admin</div>
                {isAdmin ? (
                  <button
                    className="btn btn-secondary"
                    onClick={() => { setShowSettingsModal(false); handleAdminToggle(); }}
                    style={{ width: '100%', fontSize: '13px' }}
                  >
                    <Shield size={14} style={{ marginRight: '6px' }} /> Logout from Admin
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={() => { setShowSettingsModal(false); setLoginError(''); setPasswordInput(''); setShowLoginModal(true); }}
                    style={{ width: '100%', fontSize: '13px' }}
                  >
                    <Shield size={14} style={{ marginRight: '6px' }} /> Login as Admin
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cookie Consent Banner */}
      {!cookieConsent && (
        <div className="cookie-banner">
          <div className="cookie-banner-text">
            <Cookie size={18} />
            <span>We use cookies for session management. <a href="/privacy" style={{ color: 'var(--accent-text)' }}>Learn more</a></span>
          </div>
          <div className="cookie-banner-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { setCookieConsent('rejected'); localStorage.setItem('cookieConsent', 'rejected'); }}
            >
              Reject
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => { setCookieConsent('accepted'); localStorage.setItem('cookieConsent', 'accepted'); }}
            >
              Accept
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
