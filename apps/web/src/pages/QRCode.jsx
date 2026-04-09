import { useState, useEffect, useCallback, useRef } from 'react';
import { QrCode as QrCodeIcon, Download, Copy } from 'lucide-react';
import { api } from '../api';
import useToast from '../hooks/useToast';
import ColorPicker from '../components/ColorPicker';

const EC_LEVELS = [
  { value: 'L', pct: '7%' },
  { value: 'M', pct: '15%' },
  { value: 'Q', pct: '25%' },
  { value: 'H', pct: '30%' },
];

const SIZE_OPTIONS = [200, 400, 600, 800];

const PRESETS = [
  { fg: '#000000', bg: '#ffffff' },
  { fg: '#ffffff', bg: '#000000' },
  { fg: '#1a5fb4', bg: '#ffffff' },
  { fg: '#ffffff', bg: '#1a5fb4' },
  { fg: '#c0392b', bg: '#fef9e7' },
  { fg: '#1e272e', bg: '#f5f6fa' },
];

export default function QRCode() {
  const [text, setText] = useState('');
  const [size, setSize] = useState(400);
  const [fgColor, setFgColor] = useState('#000000');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [ec, setEc] = useState('M');
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [qrSvg, setQrSvg] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  const abortRef = useRef(null);

  const generate = useCallback(async (t, opts, signal) => {
    if (!t.trim()) { setQrDataUrl(null); setQrSvg(null); return; }
    setGenerating(true);
    setError('');
    try {
      const [png, svg] = await Promise.all([
        api.generateQR(t, opts, signal),
        api.generateQRSvg(t, opts, signal),
      ]);
      setQrDataUrl(png.dataUrl);
      setQrSvg(svg.svg);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally { setGenerating(false); }
  }, []);

  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const t = setTimeout(() => {
      generate(text, { size, darkColor: fgColor, lightColor: bgColor, errorCorrection: ec }, controller.signal);
    }, 300);
    return () => { clearTimeout(t); controller.abort(); };
  }, [text, size, fgColor, bgColor, ec, generate]);

  const dl = (data, name, mime) => {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const dlPng = () => {
    if (!qrDataUrl) return;
    const [, data] = qrDataUrl.split(',');
    const binary = atob(data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    dl(arr, 'qrcode.png', 'image/png');
  };

  const dlSvg = () => { if (qrSvg) dl(qrSvg, 'qrcode.svg', 'image/svg+xml'); };

  const sectionLabel = { fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' };

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <QrCodeIcon size={24} /> QR Code
          </h2>
          <div className="subtitle">Generate custom QR codes</div>
        </div>
      </div>

      <div className="content">
        <div className="qr-grid">
          {/* Left — one compact card */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Text input */}
              <div>
                <textarea
                  className="form-input"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Text or URL..."
                  rows={2}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                  maxLength={4296}
                />
                {error && (
                  <div style={{ color: 'var(--error)', marginTop: '6px', padding: '6px 8px', background: 'rgba(231,76,60,0.1)', borderRadius: '4px', fontSize: '12px' }}>{error}</div>
                )}
              </div>

              {/* Colors */}
              <div>
                <div style={sectionLabel}>Colors</div>
                <ColorPicker
                  fgColor={fgColor} bgColor={bgColor}
                  onFgChange={setFgColor} onBgChange={setBgColor}
                  onSwap={() => { const t = fgColor; setFgColor(bgColor); setBgColor(t); }}
                />
                <div style={{ display: 'flex', gap: '5px', marginTop: '8px' }}>
                  {PRESETS.map((p, i) => (
                    <button key={i} onClick={() => { setFgColor(p.fg); setBgColor(p.bg); }}
                      style={{
                        width: '24px', height: '24px', borderRadius: '4px', cursor: 'pointer',
                        border: '1.5px solid var(--border)', padding: 0,
                        background: `linear-gradient(135deg, ${p.fg} 50%, ${p.bg} 50%)`,
                        transition: 'transform 0.15s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
                      onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    />
                  ))}
                </div>
              </div>

              {/* EC + Size inline */}
              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ flex: 1 }}>
                  <div style={sectionLabel}>Error Correction</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {EC_LEVELS.map((l) => (
                      <button key={l.value} onClick={() => setEc(l.value)}
                        style={{
                          flex: 1, padding: '5px 2px', borderRadius: '5px', border: '1px solid',
                          borderColor: ec === l.value ? 'var(--accent)' : 'var(--border)',
                          background: ec === l.value ? 'var(--accent)' : 'var(--bg)',
                          color: ec === l.value ? 'var(--accent-btn-text)' : 'var(--text-secondary)',
                          fontSize: '11px', fontWeight: ec === l.value ? 600 : 400,
                          cursor: 'pointer', transition: 'all 0.15s', textAlign: 'center',
                        }}>
                        <div style={{ fontWeight: 600 }}>{l.value}</div>
                        <div style={{ fontSize: '9px', opacity: 0.7 }}>{l.pct}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ flex: 1 }}>
                  <div style={sectionLabel}>Size</div>
                  <div style={{ position: 'relative' }}>
                    <select
                      className="form-input"
                      value={size}
                      onChange={(e) => setSize(parseInt(e.target.value))}
                      style={{ padding: '5px 28px 5px 10px', fontSize: '13px', appearance: 'none', cursor: 'pointer' }}
                    >
                      {SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s} × {s}</option>)}
                    </select>
                    <div style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-secondary)', fontSize: '10px' }}>▾</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right — Preview */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <div className="card-title">Preview</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{size}×{size}px</div>
            </div>
            <div className="card-body" style={{ textAlign: 'center' }}>
              {qrDataUrl ? (
                <>
                  <div style={{ padding: '20px', background: bgColor, borderRadius: '10px', display: 'inline-block', border: '1px solid var(--border)' }}>
                    <img src={qrDataUrl} alt="QR" style={{ width: '280px', height: '280px', display: 'block', borderRadius: '4px' }} />
                  </div>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '16px' }}>
                    <button className="btn btn-primary" onClick={dlPng} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 14px', fontSize: '13px' }}>
                      <Download size={14} /> PNG
                    </button>
                    <button className="btn btn-secondary" onClick={dlSvg} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 14px', fontSize: '13px' }}>
                      <Download size={14} /> SVG
                    </button>
                    <button className="btn btn-secondary" onClick={() => { navigator.clipboard.writeText(text); showToast('Copied!'); }} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 14px', fontSize: '13px' }}>
                      <Copy size={14} /> Copy
                    </button>
                  </div>
                </>
              ) : text.trim() && generating ? (
                <div style={{ padding: '80px 20px' }}>
                  <QrCodeIcon size={56} strokeWidth={1} style={{ opacity: 0.15, marginBottom: '10px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', opacity: 0.6 }}>Generating...</div>
                </div>
              ) : (
                <div style={{ padding: '80px 20px' }}>
                  <QrCodeIcon size={56} strokeWidth={1} style={{ opacity: 0.15, marginBottom: '10px' }} />
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', opacity: 0.6 }}>Start typing to generate</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999,
          padding: '10px 18px', borderRadius: '8px', fontWeight: 500, fontSize: '13px',
          background: toast.type === 'error' ? 'var(--error)' : 'var(--accent)',
          color: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {toast.message}
        </div>
      )}
    </>
  );
}
