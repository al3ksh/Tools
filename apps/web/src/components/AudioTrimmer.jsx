import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pause, Play, Repeat } from 'lucide-react';
import RangeStrip, { formatStripTime } from './RangeStrip';
import VolumeControl from './VolumeControl';

const PEAK_BUCKETS = 1600;

// Accepts seconds ("90", "12.5") or clock times ("1:30", "00:01:30").
export function parseTimeInput(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parts = String(value).trim().split(':');
  if (parts.some((part) => part === '' || Number.isNaN(Number(part)))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

// Loudest sample per bucket across channels, normalized to the file's peak.
async function decodePeaks(file) {
  const Context = window.AudioContext || window.webkitAudioContext;
  const context = new Context();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const peaks = new Float32Array(PEAK_BUCKETS);
    const size = buffer.length / PEAK_BUCKETS;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let b = 0; b < PEAK_BUCKETS; b++) {
        let max = peaks[b];
        const to = Math.min(data.length, Math.floor((b + 1) * size));
        for (let i = Math.floor(b * size); i < to; i++) {
          const v = data[i] < 0 ? -data[i] : data[i];
          if (v > max) max = v;
        }
        peaks[b] = max;
      }
    }
    let loudest = 0;
    for (const v of peaks) loudest = Math.max(loudest, v);
    if (loudest > 0) for (let b = 0; b < PEAK_BUCKETS; b++) peaks[b] /= loudest;
    return { peaks, duration: buffer.duration };
  } finally {
    context.close();
  }
}

function Waveform({ peaks, tone }) {
  const canvasRef = useRef(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return undefined;
    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      const ctx = canvas.getContext('2d');
      const styles = getComputedStyle(canvas);
      ctx.fillStyle = tone === 'selected' ? styles.getPropertyValue('--accent').trim() || '#c9f27a'
                                          : styles.getPropertyValue('--wave-idle').trim() || '#6f7a80';
      const middle = canvas.height / 2;
      const columns = canvas.width;
      for (let x = 0; x < columns; x++) {
        const from = Math.floor((x / columns) * peaks.length);
        const to = Math.max(from + 1, Math.floor(((x + 1) / columns) * peaks.length));
        let peak = 0;
        for (let i = from; i < to; i++) peak = Math.max(peak, peaks[i]);
        const half = Math.max(0.5 * ratio, peak * middle * 0.92);
        ctx.fillRect(x, middle - half, 1, half * 2);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [peaks, tone]);

  return <canvas ref={canvasRef} className={`waveform${tone === 'selected' ? ' is-selected' : ''}`} />;
}

export default function AudioTrimmer({ file, start, end, onChange }) {
  const audioRef = useRef(null);
  const frameRef = useRef(0);
  const [url, setUrl] = useState('');
  const [peaks, setPeaks] = useState(null);
  const [waveError, setWaveError] = useState('');
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState(false);

  const parsedStart = parseTimeInput(start);
  const parsedEnd = parseTimeInput(end);
  const rangeStart = Math.min(Math.max(parsedStart ?? 0, 0), duration || 0);
  const rangeEnd = parsedEnd && parsedEnd > rangeStart ? Math.min(parsedEnd, duration || parsedEnd) : duration;
  const wholeFile = rangeStart <= 0.001 && (duration === 0 || rangeEnd >= duration - 0.001);

  // Refs for the animation loop, which must see the latest range.
  const rangeRef = useRef({ start: rangeStart, end: rangeEnd, looping });
  rangeRef.current = { start: rangeStart, end: rangeEnd, looping };

  useEffect(() => {
    if (!file) return undefined;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    setPeaks(null);
    setWaveError('');
    setDuration(0);
    setPosition(0);
    setPlaying(false);
    let cancelled = false;
    decodePeaks(file)
      .then((result) => {
        if (cancelled) return;
        setPeaks(result.peaks);
        setDuration((current) => current || result.duration);
      })
      .catch(() => { if (!cancelled) setWaveError('No waveform for this file, but you can still trim it.'); });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  // While playing, follow the audio every frame and stop or loop at the end.
  useEffect(() => {
    if (!playing) return undefined;
    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const range = rangeRef.current;
      if (audio.currentTime >= range.end - 0.01) {
        if (range.looping) {
          audio.currentTime = range.start;
        } else {
          audio.pause();
          audio.currentTime = range.end;
        }
      }
      setPosition(audio.currentTime);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [playing]);

  const round = (t) => Number(t.toFixed(3));
  const setRange = (next) => onChange?.({ start: round(next.start), end: round(next.end) });

  const seek = (t) => {
    setPosition(t);
    if (audioRef.current) audioRef.current.currentTime = t;
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    // Play the selection: from the playhead if it is inside, else from the start.
    if (audio.currentTime < rangeStart || audio.currentTime >= rangeEnd - 0.01) audio.currentTime = rangeStart;
    audio.play().catch(() => setPlaying(false));
  };

  return (
    <div className="trimmer" style={{ '--lane-center': '46px' }}>
      <audio
        ref={audioRef}
        src={url || undefined}
        preload="auto"
        onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration); }}
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); setPosition(audioRef.current?.currentTime || 0); }}
      />
      <div className="trimmer-row">
        <button
          type="button"
          className={`trimmer-play${playing ? ' is-playing' : ''}`}
          onClick={togglePlay}
          disabled={!duration}
          aria-label={playing ? 'Pause selection' : 'Play selection'}
          title={playing ? 'Pause (Space)' : 'Play selection (Space)'}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <div className="trimmer-strip">
          <RangeStrip
            duration={duration}
            start={rangeStart}
            end={rangeEnd}
            position={position}
            laneHeight={92}
            step={0.1}
            onChange={setRange}
            onSeek={seek}
            onTogglePlay={togglePlay}
            renderLane={(tone) => (peaks
              ? <Waveform peaks={peaks} tone={tone} />
              : waveError ? <div className="waveform-flat" /> : <div className="skeleton waveform-skeleton" />)}
          />
        </div>
      </div>
      <div className="trimmer-meta">
        <span className="trimmer-summary">
          Selection <strong>{formatStripTime(rangeEnd - rangeStart, duration)}</strong> of {formatStripTime(duration, duration)}
          {waveError && <span className="trimmer-note"> · {waveError}</span>}
        </span>
        <VolumeControl mediaRef={audioRef} />
        <label className="toggle-chip">
          <input type="checkbox" checked={looping} onChange={(e) => setLooping(e.target.checked)} />
          <Repeat size={13} /> Loop
        </label>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={wholeFile}
          onClick={() => setRange({ start: 0, end: duration })}
        >
          Whole file
        </button>
      </div>
    </div>
  );
}
