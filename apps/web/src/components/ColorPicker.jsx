import { useState, useRef, useCallback, useEffect } from 'react';

function hsvToHex(h, s, v) {
  s /= 100;
  v /= 100;
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsv(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return [Math.round(h), max === 0 ? 0 : Math.round((d / max) * 100), Math.round(max * 100)];
}

export default function ColorPicker({ fgColor, bgColor, onFgChange, onBgChange, onSwap }) {
  const [activeTarget, setActiveTarget] = useState('fg');
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(0);
  const [val, setVal] = useState(0);
  const [hexInput, setHexInput] = useState('');

  const panelRef = useRef(null);
  const hueRef = useRef(null);
  const dragging = useRef(null);

  const activeColor = activeTarget === 'fg' ? fgColor : bgColor;

  useEffect(() => {
    const [h, s, v] = hexToHsv(activeColor);
    setHue(h);
    setSat(s);
    setVal(v);
    setHexInput(activeColor);
  }, [activeColor, activeTarget]);

  const updateFromHSV = useCallback((h, s, v) => {
    setHue(h);
    setSat(s);
    setVal(v);
    const hex = hsvToHex(h, s, v);
    setHexInput(hex);
    if (activeTarget === 'fg') onFgChange(hex);
    else onBgChange(hex);
  }, [activeTarget, onFgChange, onBgChange]);

  const updateFromPanel = useCallback((e) => {
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    const x = Math.max(0, Math.min(cx - rect.left, rect.width));
    const y = Math.max(0, Math.min(cy - rect.top, rect.height));
    updateFromHSV(hue, (x / rect.width) * 100, 100 - (y / rect.height) * 100);
  }, [hue, updateFromHSV]);

  const updateFromHue = useCallback((e) => {
    if (!hueRef.current) return;
    const rect = hueRef.current.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const x = Math.max(0, Math.min(cx - rect.left, rect.width));
    updateFromHSV((x / rect.width) * 360, sat, val);
  }, [sat, val, updateFromHSV]);

  useEffect(() => {
    if (!dragging.current) return;
    const onMove = (e) => {
      if (dragging.current === 'panel') updateFromPanel(e);
      if (dragging.current === 'hue') updateFromHue(e);
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [updateFromPanel, updateFromHue]);

  const handleHexInput = (val) => {
    setHexInput(val);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      const [h, s, v] = hexToHsv(val);
      setHue(h);
      setSat(s);
      setVal(v);
      if (activeTarget === 'fg') onFgChange(val);
      else onBgChange(val);
    }
  };

  const selectorStyle = (isActive) => ({
    display: 'flex', alignItems: 'center', gap: '6px', flex: 1,
    padding: '5px 8px', borderRadius: '6px', border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
    background: isActive ? 'rgba(44, 147, 250, 0.1)' : 'transparent',
    cursor: 'pointer', transition: 'all 0.15s',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div
        ref={panelRef}
        onMouseDown={(e) => { e.preventDefault(); dragging.current = 'panel'; updateFromPanel(e); }}
        onTouchStart={(e) => { e.preventDefault(); dragging.current = 'panel'; updateFromPanel(e); }}
        style={{
          width: '100%', height: '120px', borderRadius: '6px', cursor: 'crosshair',
          position: 'relative', overflow: 'hidden',
          background: `linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, transparent), hsl(${hue}, 100%, 50%)`,
        }}
      >
        <div style={{
          position: 'absolute', width: '14px', height: '14px', borderRadius: '50%',
          left: `calc(${sat}% - 7px)`, top: `calc(${100 - val}% - 7px)`,
          border: '2px solid white', boxShadow: '0 0 0 1.5px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
        }} />
      </div>

      <div
        ref={hueRef}
        onMouseDown={(e) => { e.preventDefault(); dragging.current = 'hue'; updateFromHue(e); }}
        onTouchStart={(e) => { e.preventDefault(); dragging.current = 'hue'; updateFromHue(e); }}
        style={{
          width: '100%', height: '12px', borderRadius: '6px', cursor: 'pointer',
          position: 'relative',
          background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
        }}
      >
        <div style={{
          position: 'absolute', width: '6px', height: '16px', borderRadius: '3px',
          left: `calc(${hue / 360 * 100}% - 3px)`, top: '-2px',
          border: '2px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
          pointerEvents: 'none',
        }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <button onClick={() => setActiveTarget('fg')} style={selectorStyle(activeTarget === 'fg')}>
          <div style={{ width: '22px', height: '22px', borderRadius: '4px', background: fgColor, border: '1px solid var(--border)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>FG</div>
            <input type="text" value={activeTarget === 'fg' ? hexInput : fgColor}
              onChange={(e) => { if (activeTarget === 'fg') handleHexInput(e.target.value); }}
              style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontFamily: 'monospace', fontSize: '12px', width: '100%', padding: 0, outline: 'none', textTransform: 'uppercase' }} />
          </div>
        </button>

        <button onClick={onSwap} title="Swap"
          style={{ width: '26px', height: '26px', borderRadius: '5px', flexShrink: 0, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>
          ⇄
        </button>

        <button onClick={() => setActiveTarget('bg')} style={selectorStyle(activeTarget === 'bg')}>
          <div style={{ width: '22px', height: '22px', borderRadius: '4px', background: bgColor, border: '1px solid var(--border)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>BG</div>
            <input type="text" value={activeTarget === 'bg' ? hexInput : bgColor}
              onChange={(e) => { if (activeTarget === 'bg') handleHexInput(e.target.value); }}
              style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontFamily: 'monospace', fontSize: '12px', width: '100%', padding: 0, outline: 'none', textTransform: 'uppercase' }} />
          </div>
        </button>
      </div>
    </div>
  );
}
