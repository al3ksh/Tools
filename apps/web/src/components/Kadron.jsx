import { ArrowUpRight, Download, Github } from 'lucide-react';

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

// Dashboard banner: what Kadron is and where to get it.
export function KadronHero() {
  return (
    <section className="kadron-hero">
      <div className="kadron-hero-copy">
        <div className="kadron-eyebrow"><KadronMark size={18} /> POWERED BY KADRON</div>
        <h3>The desktop studio behind Tools</h3>
        <p>
          Kadron runs these tools on your own computer, with nothing uploaded, and adds a
          timeline editor: trim audio on the waveform, cut GIFs on a filmstrip, and edit PDFs page by page.
        </p>
        <div className="kadron-hero-actions">
          <a className="btn btn-primary" href={KADRON_DOWNLOAD} target="_blank" rel="noopener noreferrer">
            <Download size={16} /> Download for Windows
          </a>
          <a className="btn btn-secondary" href={KADRON_REPO} target="_blank" rel="noopener noreferrer">
            <Github size={16} /> Source on GitHub
          </a>
        </div>
      </div>
      <a className="kadron-hero-shot" href={KADRON_REPO} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
        <img src="/kadron-editor.webp" alt="Kadron's editor with a sequence on the timeline" loading="lazy" />
      </a>
    </section>
  );
}
