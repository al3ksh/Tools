import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, Github, Pause, Play, X } from 'lucide-react';
import RangeStrip, { formatStripTime } from './RangeStrip';

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

const HERO_DURATION = 17;

// Deterministic waveform heights for the third clip in the timeline preview.
const WAVE_PEAKS = Array.from({ length: 54 }, (_, i) => {
  const env = Math.sin(((i + 1) / 55) * Math.PI);
  const wave = 0.45 + 0.55 * Math.abs(Math.sin(i * 0.68) * Math.cos(i * 0.27));
  return Number((0.18 + env * wave * 0.78).toFixed(3));
});

const TIMELINE_CLIPS = [
  { id: '01', name: 'demo-a.mp4', len: '0:04.5', widthPct: 26.5, kind: 'video-a' },
  { id: '02', name: 'demo-b.mp4', len: '0:05.5', widthPct: 32.3, kind: 'video-b' },
  { id: '03', name: 'ui-music.wav', len: '0:07.0', widthPct: 41.2, kind: 'audio' },
];

function TimelineLane({ tone }) {
  const isSelected = tone === 'selected';
  return (
    <div className={`kadron-tl-lane${isSelected ? ' is-selected' : ''}`}>
      {TIMELINE_CLIPS.map((clip) => (
        <div key={clip.id} className={`kadron-tl-clip is-${clip.kind}`} style={{ width: `${clip.widthPct}%` }}>
          <span className="kadron-tl-tag">
            <strong>{clip.id}</strong> {clip.name} <em>{clip.len}</em>
          </span>
          {clip.kind === 'audio' ? (
            <svg className="kadron-tl-wave" viewBox="0 0 216 40" preserveAspectRatio="none" aria-hidden="true">
              {WAVE_PEAKS.map((peak, idx) => {
                const h = peak * 36;
                const y = (40 - h) / 2;
                return (
                  <rect
                    key={idx}
                    x={idx * 4}
                    y={y}
                    width="2.4"
                    height={h}
                    rx="1"
                    fill={isSelected ? 'var(--accent)' : 'var(--wave-idle)'}
                  />
                );
              })}
            </svg>
          ) : (
            <>
              <div className="kadron-tl-frames">
                <span /><span /><span /><span />
              </div>
              <div className="kadron-tl-subwave" />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// Dashboard banner: what Kadron is and where to get it. Closing it is
// remembered; the sidebar card still links to Kadron.
export function KadronHero() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(HERO_DISMISSED) === '1');
  const [closing, setClosing] = useState(false);
  const [range, setRange] = useState({ start: 4.5, end: 13.8 });
  const [position, setPosition] = useState(10.0);
  const [playing, setPlaying] = useState(false);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  useEffect(() => {
    if (!playing) return undefined;
    let rafId = 0;
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      const { start, end } = rangeRef.current;
      setPosition((prev) => {
        const next = prev + dt;
        return next >= end ? start : next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing]);

  if (dismissed) return null;

  const close = () => {
    localStorage.setItem(HERO_DISMISSED, '1');
    setClosing(true);
  };

  const togglePlay = () => {
    setPlaying((wasPlaying) => {
      if (!wasPlaying && (position < range.start || position >= range.end - 0.05)) {
        setPosition(range.start);
      }
      return !wasPlaying;
    });
  };

  return (
    <section
      className={`kadron-hero${closing ? ' is-closing' : ''}`}
      onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) setDismissed(true); }}
    >
      <button type="button" className="kadron-hero-close" onClick={close} aria-label="Hide this banner" title="Hide">
        <X size={16} />
      </button>
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
        <div className="kadron-timeline">
          <div className="kadron-tl-head">
            <div className="kadron-tl-title">
              <strong>Interactive Timeline</strong>
              <span>{formatStripTime(range.end - range.start, HERO_DURATION)} selected</span>
            </div>
            <span className="kadron-tl-hint">Drag handles or scrub</span>
          </div>
          <div className="kadron-tl-body">
            <button
              type="button"
              className={`trimmer-play${playing ? ' is-playing' : ''}`}
              onClick={togglePlay}
              aria-label={playing ? 'Pause timeline preview' : 'Play timeline preview'}
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <div className="kadron-tl-strip">
              <RangeStrip
                duration={HERO_DURATION}
                start={range.start}
                end={range.end}
                position={position}
                laneHeight={52}
                step={0.1}
                minLength={1}
                onChange={(next) => {
                  setRange(next);
                  setPosition((p) => Math.min(Math.max(p, next.start), next.end));
                }}
                onSeek={setPosition}
                onTogglePlay={togglePlay}
                renderLane={(tone) => <TimelineLane tone={tone} />}
              />
            </div>
          </div>
        </div>
      </div>
      <a className="kadron-hero-shot" href={KADRON_REPO} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
        <img src="/kadron-editor.webp" alt="Kadron's editor with a sequence on the timeline" loading="lazy" />
      </a>
    </section>
  );
}
