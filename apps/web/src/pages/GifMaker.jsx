import { useEffect, useMemo, useRef, useState } from 'react';
import { Film, Upload, Play, Pause, Download, RotateCcw, Sparkles, SlidersHorizontal, Wand2 } from 'lucide-react';
import { api, formatBytes } from '../api';
import FileUploader from '../components/FileUploader';
import JobProgress from '../components/JobProgress';
import RangeStrip, { Filmstrip, formatStripTime } from '../components/RangeStrip';
import useFilmstrip from '../hooks/useFilmstrip';

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export default function GifMaker({ sessionId, isAdmin }) {
  const [file, setFile] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [currentJob, setCurrentJob] = useState(null);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [resultSize, setResultSize] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);

  const [fps, setFps] = useState(15);
  const [width, setWidth] = useState(480);
  const [targetMB, setTargetMB] = useState(8);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(0);
  const [reverse, setReverse] = useState(false);
  const [startSec, setStartSec] = useState('0');
  const [endSec, setEndSec] = useState('');
  const [isRegionPlaying, setIsRegionPlaying] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);

  const videoRef = useRef(null);

  const sourceUrl = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  const isGifInput = file ? file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif') : false;
  const isStaticImage = file ? file.type.startsWith('image/') && !isGifInput : false;
  const duration = meta?.duration && Number.isFinite(meta.duration) ? Number(meta.duration) : 0;
  const timelineFrames = useFilmstrip(isGifInput || isStaticImage ? '' : sourceUrl, duration);

  const parsedStart = clamp(startSec, 0, duration || 99999, 0);
  const parsedEnd = endSec === '' ? duration : clamp(endSec, 0, duration || 99999, duration || 0);
  const safeStart = Math.min(parsedStart, parsedEnd || parsedStart);
  const safeEnd = Math.max(parsedEnd, safeStart + 0.05);
  const clipDuration = Math.max(safeEnd - safeStart, 0);
  const frameInterval = 1 / Math.max(Number(fps) || 15, 1);
  const targetBytes = Math.max(Number(targetMB) || 0, 0) * 1024 * 1024;
  const resultRatio = resultSize && targetBytes > 0 ? Math.min((resultSize / targetBytes) * 100, 100) : 0;
  const resultOverTarget = resultSize && targetBytes > 0 && resultSize > targetBytes;

  const qualityTag = useMemo(() => {
    const pixelScore = Number(width) * Number(fps) * Math.max(clipDuration, 1);
    if (pixelScore < 18000) return { label: 'Small', color: 'var(--success)' };
    if (pixelScore < 50000) return { label: 'Balanced', color: 'var(--accent-text)' };
    return { label: 'High', color: 'var(--warning)' };
  }, [width, fps, clipDuration]);

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [sourceUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [previewUrl, resultUrl]);

  const handleFileChange = async (nextFile) => {
    setError('');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setPreviewUrl('');
    setResultUrl('');
    setResultSize(null);
    setMeta(null);
    setCurrentTime(0);
    setIsRegionPlaying(false);
    setFile(nextFile);

    if (!nextFile) return;

    setLoadingMeta(true);
    try {
      const info = await api.gifInfo(nextFile, sessionId);
      setMeta(info);
      if (nextFile.type.startsWith('image/') && !nextFile.name.toLowerCase().endsWith('.gif')) {
        setWidth(Math.min(info.width || 480, 1080));
      } else if (info?.duration && Number.isFinite(info.duration)) {
        setStartSec('0');
        setEndSec(String(Math.min(Math.floor(info.duration), 15)));
        setCurrentTime(0);
      } else {
        setStartSec('0');
        setEndSec('');
      }

      if (info?.width) {
        setWidth(Math.min(Math.max(info.width, 160), 720));
      }

      if (info?.fps) {
        setFps(Math.min(Math.max(Math.round(info.fps), 8), 20));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMeta(false);
    }
  };

  const snapToFrame = (t) => {
    if (!snapEnabled) return Math.round(t * 1000) / 1000;
    return Math.round(Math.round(t / frameInterval) * frameInterval * 1000) / 1000;
  };

  const toggleRegionPlay = () => {
    const video = videoRef.current;
    if (!video || !sourceUrl || isGifInput) return;
    if (isRegionPlaying) {
      video.pause();
      setIsRegionPlaying(false);
      return;
    }
    if (video.currentTime < safeStart || video.currentTime >= safeEnd) {
      video.currentTime = safeStart;
    }
    video.play().then(() => setIsRegionPlaying(true)).catch(() => setIsRegionPlaying(false));
  };

  const jumpToTime = (time) => {
    const t = Math.max(0, time);
    setCurrentTime(t);
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      if (isRegionPlaying) {
        videoRef.current.pause();
        setIsRegionPlaying(false);
      }
    }
  };

  // The selection preview loops like the finished GIF. Following the video
  // every frame keeps the loop point tight (timeupdate fires only ~4x a second).
  const rangeRef = useRef({ start: 0, end: 0 });
  rangeRef.current = { start: safeStart, end: safeEnd };
  useEffect(() => {
    if (!isRegionPlaying) return undefined;
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (!video) return;
      if (video.currentTime >= rangeRef.current.end - 0.01) video.currentTime = rangeRef.current.start;
      setCurrentTime(video.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isRegionPlaying]);

  const buildOptions = (preview) => {
    const options = {
      fps: clamp(fps, 5, 30, 15),
      width: clamp(width, 120, 1080, 480),
      speed: clamp(speed, 0.25, 4, 1),
      loop: clamp(loop, 0, 10, 0),
      reverse,
      preview,
    };

    if (!isGifInput && !isStaticImage) {
      const start = Number(safeStart);
      const end = Number(safeEnd);
      if (Number.isFinite(start) && start >= 0) options.startSec = start;
      if (Number.isFinite(end) && end > start) options.endSec = end;
    }

    return options;
  };

  const handleGenerate = async (preview) => {
    if (!file) return;

    setProcessing(true);
    setCurrentJob(null);
    setError('');

    try {
      const blob = await api.gifProcess(file, buildOptions(preview), sessionId, { onJobUpdate: setCurrentJob });
      const url = URL.createObjectURL(blob);
      if (preview) {
        setPreviewUrl(url);
      } else {
        setResultUrl(url);
        setResultSize(blob.size);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
      setCurrentJob(null);
    }
  };

  const handleDownload = () => {
    if (!resultUrl) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = 'output.gif';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const resetAll = () => {
    setFile(null);
    setMeta(null);
    setError('');
    setCurrentJob(null);
    setPreviewUrl('');
    setResultUrl('');
    setResultSize(null);
    setFps(15);
    setWidth(480);
    setTargetMB(8);
    setSpeed(1);
    setLoop(0);
    setReverse(false);
    setStartSec('0');
    setEndSec('');
    setCurrentTime(0);
    setIsRegionPlaying(false);
    setSnapEnabled(true);
    setHoveredHandle(null);
    setIsDragging(false);
    setDraggingHandle(null);
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Sparkles size={24} /> GIF Maker
          </h2>
          <div className="subtitle">Studio-style GIF editor with timeline trimming, presets and instant previews</div>
        </div>
      </div>

      <div className="content">
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header">
            <div className="card-title"><Film size={18} /> Source</div>
          </div>
          <div className="card-body">
            <FileUploader
              onFileSelect={handleFileChange}
              maxSizeMB={isAdmin ? 500 : 100}
              accept="video/*,image/*"
              selectedFile={file}
            />
            <div className="form-help" style={{ marginTop: '-6px' }}>
              Supported: MP4, WEBM, MOV, MKV, GIF and images (PNG, JPG, WEBP)
            </div>

            {file && (
              <div style={{
                marginTop: '10px',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                background: 'var(--bg)',
                fontSize: '13px',
                padding: '10px 12px',
              }}>
                <div><strong>{file.name}</strong></div>
                <div style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>{formatBytes(file.size)}</div>
                {meta && (
                  <div style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {meta.width && meta.height ? `${meta.width}x${meta.height}` : 'Unknown size'}
                    {meta.fps ? ` • ${meta.fps} fps` : ''}
                    {meta.duration ? ` • ${meta.duration.toFixed(2)}s` : ''}
                  </div>
                )}
              </div>
            )}

            {sourceUrl && (
              <div style={{ marginTop: '12px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                {!isGifInput && !isStaticImage ? (
                  <video
                    ref={videoRef}
                    src={sourceUrl}
                    controls
                    onTimeUpdate={(e) => { if (!isRegionPlaying) setCurrentTime(e.currentTarget.currentTime || 0); }}
                    onPause={() => setIsRegionPlaying(false)}
                    onLoadedMetadata={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
                    style={{ width: '100%', display: 'block', background: '#000', maxHeight: '360px', objectFit: 'contain' }}
                  />
                ) : (
                  <img src={sourceUrl} alt="Source GIF" style={{ width: '100%', maxHeight: '360px', objectFit: 'contain', display: 'block' }} />
                )}
              </div>
            )}

            {loadingMeta && <div style={{ marginTop: '10px', color: 'var(--text-secondary)' }}>Reading metadata...</div>}
          </div>
        </div>

        <div className="card" style={{ marginTop: '16px' }}>
          <div className="card-header">
            <div className="card-title"><SlidersHorizontal size={18} /> Controls</div>
          </div>
          <div className="card-body">
            {!isGifInput && file && duration > 0 && (
              <div className="trimmer" style={{ marginBottom: '18px' }}>
                <div className="trimmer-row">
                  <button
                    type="button"
                    className={`trimmer-play${isRegionPlaying ? ' is-playing' : ''}`}
                    onClick={toggleRegionPlay}
                    aria-label={isRegionPlaying ? 'Pause selection' : 'Play selection'}
                    title={isRegionPlaying ? 'Pause (Space)' : 'Play selection on a loop (Space)'}
                  >
                    {isRegionPlaying ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <div className="trimmer-strip">
                    <RangeStrip
                      duration={duration}
                      start={safeStart}
                      end={safeEnd}
                      position={currentTime}
                      step={frameInterval}
                      minLength={frameInterval}
                      snap={snapToFrame}
                      onChange={({ start, end }) => { setStartSec(String(start)); setEndSec(String(end)); }}
                      onSeek={jumpToTime}
                      onTogglePlay={toggleRegionPlay}
                      renderLane={(tone) => <Filmstrip frames={timelineFrames} tone={tone} />}
                    />
                  </div>
                </div>
                <div className="trimmer-meta">
                  <span className="trimmer-summary">
                    Selection <strong>{formatStripTime(clipDuration, duration)}</strong> of {formatStripTime(duration, duration)}
                  </span>
                  <label className="toggle-chip" title="Snap the range to whole frames at the chosen FPS">
                    <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
                    Snap to frames
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={safeStart <= 0.001 && safeEnd >= duration - 0.001}
                    onClick={() => { setStartSec('0'); setEndSec(String(duration)); }}
                  >
                    Whole clip
                  </button>
                </div>
                <div className="trimmer-hint">
                  ←/→ move the start · Shift+←/→ the end · Space plays the selection on a loop · Home/End jump
                </div>
              </div>
            )}

            {isStaticImage && (
              <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px', marginBottom: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Output Width</label>
                  <input className="form-input" type="number" min="120" max="1080" step="2" value={width} onChange={(e) => setWidth(e.target.value)} />
                </div>
              </div>
            )}

            {!isGifInput && !isStaticImage && (
              <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label className="form-label">Start (sec)</label>
                  <input className="form-input" type="number" min="0" step="0.1" value={startSec} onChange={(e) => setStartSec(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">End (sec)</label>
                  <input className="form-input" type="number" min="0" step="0.1" value={endSec} onChange={(e) => setEndSec(e.target.value)} />
                </div>
              </div>
            )}

            {!isStaticImage && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setFps(12); setWidth(360); }}>Small</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setFps(15); setWidth(480); }}>Balanced</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setFps(20); setWidth(640); }}>High</button>
            </div>
            )}

            {!isStaticImage && (
            <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(120px, 1fr))', gap: '10px' }}>
              <div className="form-group">
                <label className="form-label">FPS</label>
                <input className="form-input" type="number" min="5" max="30" value={fps} onChange={(e) => setFps(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Width</label>
                <input className="form-input" type="number" min="120" max="1080" step="2" value={width} onChange={(e) => setWidth(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Target MB</label>
                <input className="form-input" type="number" min="1" max="100" step="1" value={targetMB} onChange={(e) => setTargetMB(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Speed</label>
                <input className="form-input" type="number" min="0.25" max="4" step="0.05" value={speed} onChange={(e) => setSpeed(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Loop</label>
                <input className="form-input" type="number" min="0" max="10" value={loop} onChange={(e) => setLoop(e.target.value)} />
              </div>
            </div>
            )}

            {!isStaticImage && (
            <div style={{
              border: '1px solid var(--border)', borderRadius: '10px', padding: '10px', marginBottom: '12px',
              background: 'var(--bg)', display: 'grid', gap: '8px'
            }}>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Render Profile</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Estimated complexity</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: qualityTag.color }}>{qualityTag.label}</span>
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
                Reverse animation
              </label>
            </div>
            )}

            {error && (
              <div style={{
                color: 'var(--error)', marginTop: '8px', padding: '10px',
                background: 'rgba(231, 170, 164, 0.12)', borderRadius: '6px', fontSize: '13px',
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
              <button className="btn btn-secondary" disabled={!file || processing} onClick={() => handleGenerate(true)}>
                {processing ? <><Play size={16} /> Processing...</> : <><Wand2 size={16} /> Generate Preview</>}
              </button>
              <button className="btn btn-primary" disabled={!file || processing} onClick={() => handleGenerate(false)}>
                {processing ? <><Play size={16} /> Processing...</> : <><Sparkles size={16} /> Render Final GIF</>}
              </button>
              <JobProgress
                job={currentJob}
                title={currentJob?.status === 'queued' ? 'Waiting to render GIF' : 'Rendering GIF'}
                fallbackMessage="Worker is rendering frames"
              />
              <button className="btn btn-secondary" onClick={resetAll}>
                <RotateCcw size={16} /> Reset Session
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', marginTop: '16px' }}>
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <div className="card-title"><Play size={18} /> Quick Preview</div>
            </div>
            <div className="card-body" style={{ minHeight: '220px' }}>
              {previewUrl ? (
                <img src={previewUrl} alt="GIF preview" style={{ width: '100%', maxWidth: '480px', maxHeight: '400px', objectFit: 'contain', borderRadius: '8px', border: '1px solid var(--border)', display: 'block' }} />
              ) : (
                <div style={{ color: 'var(--text-secondary)' }}>Generate a preview to see quick output.</div>
              )}
            </div>
          </div>

          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <div className="card-title"><Download size={18} /> Final Output</div>
            </div>
            <div className="card-body" style={{ minHeight: '220px' }}>
              {resultUrl ? (
                <>
                  <img src={resultUrl} alt="GIF result" style={{ width: '100%', maxWidth: '480px', maxHeight: '400px', objectFit: 'contain', borderRadius: '8px', border: '1px solid var(--border)', display: 'block' }} />
                  <div style={{ marginTop: '10px', display: 'grid', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <span style={{ color: resultOverTarget ? 'var(--warning)' : 'var(--text-secondary)', fontSize: '13px', fontWeight: resultOverTarget ? 700 : 500 }}>
                        {resultSize ? `${formatBytes(resultSize)} / target ${formatBytes(targetBytes)}` : ''}
                      </span>
                      <button className="btn btn-primary" onClick={handleDownload}><Download size={16} /> Download GIF</button>
                    </div>
                    <div className="progress-bar" style={{ height: '8px' }}>
                      <div className="progress-fill" style={{
                        width: `${resultRatio}%`,
                        backgroundColor: resultOverTarget ? 'var(--warning)' : 'var(--success)'
                      }} />
                    </div>
                    {resultOverTarget && (
                      <div style={{ color: 'var(--warning)', fontSize: '12px' }}>
                        Lower FPS, width or duration to fit this target.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--text-secondary)' }}>Render final GIF to download.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
