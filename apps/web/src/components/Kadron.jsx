import { useState } from 'react';
import { ArrowUpRight, Cpu, Download, Film, Github, X, Zap } from 'lucide-react';

// Tools is the web edition of Kadron: same palette, same controls, and a
// clear way to the desktop app.
export const KADRON_REPO = 'https://github.com/al3ksh/Kadron';
export const KADRON_DOWNLOAD = 'https://github.com/al3ksh/Kadron/releases/latest';

// Kadron's mark: a frame bracket (kadr) cut by a chevron, reading as a K.
// Same 64-unit paths as Kadron's BrandMark.qml.
export function KadronMark({ size = 32, className = '' }) {
  return (
    <svg className={`kadron-mark ${className}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M42.5 8.5H12.5V55.5H42.5" fill="none" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M52.5 11L30 32L52.5 53" fill="none" stroke="var(--accent)" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Sidebar lockup, mirroring Kadron's "KADRON / MEDIA STUDIO".
export function ToolsLockup() {
  return (
    <div className="brand-lockup">
      <KadronMark size={34} />
      <div className="brand-words">
        <span className="brand-name">TOOLS</span>
        <a className="brand-powered" href={KADRON_REPO} target="_blank" rel="noopener noreferrer" title="Tools is the web edition of Kadron">
          POWERED BY <strong>KADRON</strong>
        </a>
      </div>
    </div>
  );
}

// Compact sidebar card pointing at the desktop app.
export function KadronPromo() {
  return (
    <a className="kadron-promo" href={KADRON_DOWNLOAD} target="_blank" rel="noopener noreferrer">
      <KadronMark size={26} />
      <span className="kadron-promo-text">
        <strong>Kadron for Windows</strong>
        <span>These tools offline, plus an editor</span>
      </span>
      <ArrowUpRight size={15} className="kadron-promo-arrow" />
    </a>
  );
}

const HERO_DISMISSED = 'kadronHeroDismissed';

const HERO_SPECS = [
  { icon: Cpu, title: '100% Local & Offline', desc: 'Zero uploads, no file expiry' },
  { icon: Film, title: 'Multi-track Timeline', desc: 'Video, waveform & filmstrip cut' },
  { icon: Zap, title: 'Native Engine', desc: 'FFmpeg & yt-dlp built right in' },
];

// Dashboard banner: what Kadron is and where to get it. Closing it is
// remembered; the sidebar card still links to Kadron.
export function KadronHero() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(HERO_DISMISSED) === '1');
  const [closing, setClosing] = useState(false);
  if (dismissed) return null;

  const close = () => {
    localStorage.setItem(HERO_DISMISSED, '1');
    setClosing(true);
  };

  return (
    <section
      className={`kadron-hero${closing ? ' is-closing' : ''}`}
      onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) setDismissed(true); }}
    >
      <span className="kadron-frame-corner is-tl" aria-hidden="true" />
      <span className="kadron-frame-corner is-bl" aria-hidden="true" />
      <button type="button" className="kadron-hero-close" onClick={close} aria-label="Hide this banner" title="Hide">
        <X size={16} />
      </button>
      <div className="kadron-hero-copy">
        <div className="kadron-eyebrow-row">
          <div className="kadron-eyebrow">
            <span className="kadron-pulse" aria-hidden="true" />
            <KadronMark size={16} /> POWERED BY KADRON
          </div>
          <span className="kadron-eyebrow-tag">WINDOWS DESKTOP STUDIO · FREE &amp; OPEN SOURCE</span>
        </div>
        <h3>
          The desktop studio behind Tools —{' '}
          <span className="kadron-hero-highlight">without upload limits.</span>
        </h3>
        <p>
          Run every tool locally on your hardware at native speed, plus a full multi-track
          timeline editor for video, audio waveforms, GIF filmstrips, and PDFs.
        </p>
        <div className="kadron-specs">
          {HERO_SPECS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="kadron-spec">
              <span className="kadron-spec-icon"><Icon size={15} /></span>
              <span className="kadron-spec-text">
                <strong>{title}</strong>
                <span>{desc}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="kadron-hero-actions">
          <a className="btn btn-primary kadron-cta-btn" href={KADRON_DOWNLOAD} target="_blank" rel="noopener noreferrer">
            <Download size={16} /> Download for Windows
          </a>
          <a className="btn btn-secondary" href={KADRON_REPO} target="_blank" rel="noopener noreferrer">
            <Github size={16} /> Source on GitHub
          </a>
        </div>
      </div>
      <div className="kadron-hero-stage">
        <a className="kadron-hero-shot" href={KADRON_REPO} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
          <div className="kadron-window-bar" aria-hidden="true">
            <span className="kadron-window-dots">
              <i /><i /><i />
            </span>
            <span className="kadron-window-title">Kadron Media Studio — Editor</span>
          </div>
          <img src="/kadron-editor.webp" alt="Kadron's editor with a sequence on the timeline" loading="lazy" />
        </a>
        <div className="kadron-floating-badge" aria-hidden="true">
          <span className="kadron-badge-dot" />
          <span className="kadron-badge-bars">
            <i className="waveform-bar" style={{ height: '7px', animationDelay: '0s' }} />
            <i className="waveform-bar" style={{ height: '12px', animationDelay: '0.15s' }} />
            <i className="waveform-bar" style={{ height: '9px', animationDelay: '0.3s' }} />
            <i className="waveform-bar" style={{ height: '14px', animationDelay: '0.45s' }} />
          </span>
          <span>00:10.0 · 60 fps Timeline</span>
        </div>
      </div>
    </section>
  );
}
