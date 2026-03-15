import { useEffect, useMemo, useRef, useState } from 'react';
import { Film, Upload, Play, Download, RotateCcw, Sparkles, Scissors, SlidersHorizontal, Wand2 } from 'lucide-react';
import { api, formatBytes } from '../api';
import FileUploader from '../components/FileUploader';

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) return '0.00s';
  return `${value.toFixed(2)}s`;
}

export default function GifMaker() {
  const [file, setFile] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [resultSize, setResultSize] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [timelineFrames, setTimelineFrames] = useState([]);

  const [fps, setFps] = useState(15);
  const [width, setWidth] = useState(480);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(0);
  const [reverse, setReverse] = useState(false);
  const [startSec, setStartSec] = useState('0');
  const [endSec, setEndSec] = useState('');

  const videoRef = useRef(null);
  const timelineRef = useRef(null);
  const dragModeRef = useRef(null);

  const sourceUrl = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  const isGifInput = file ? file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif') : false;
  const duration = meta?.duration && Number.isFinite(meta.duration) ? Number(meta.duration) : 0;

  const parsedStart = clamp(startSec, 0, duration || 99999, 0);
  const parsedEnd = endSec === '' ? duration : clamp(endSec, 0, duration || 99999, duration || 0);
  const safeStart = Math.min(parsedStart, parsedEnd || parsedStart);
  const safeEnd = Math.max(parsedEnd, safeStart + 0.05);
  const clipDuration = Math.max(safeEnd - safeStart, 0);
  const timelinePlayhead = duration > 0 ? (Math.min(Math.max(currentTime, 0), duration) / duration) * 100 : 0;
  const timelineStart = duration > 0 ? (safeStart / duration) * 100 : 0;
  const timelineWidth = duration > 0 ? Math.max(((safeEnd - safeStart) / duration) * 100, 1) : 100;

  const qualityTag = useMemo(() => {
    const pixelScore = Number(width) * Number(fps) * Math.max(clipDuration, 1);
    if (pixelScore < 18000) return { label: 'Small', color: 'var(--success)' };
    if (pixelScore < 50000) return { label: 'Balanced', color: 'var(--accent)' };
    return { label: 'High', color: 'var(--warning)' };
  }, [width, fps, clipDuration]);

  const clearTimelineFrames = () => {
    setTimelineFrames((prev) => {
      prev.forEach((frame) => {
        try { URL.revokeObjectURL(frame.url); } catch (e) { /* ignore */ }
      });
      return [];
    });
  };

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      clearTimelineFrames();
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
    clearTimelineFrames();
    setMeta(null);
    setCurrentTime(0);
    setFile(nextFile);

    if (!nextFile) return;

    setLoadingMeta(true);
    try {
      const info = await api.gifInfo(nextFile);
      setMeta(info);
      if (info?.duration && Number.isFinite(info.duration)) {
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

  useEffect(() => {
    if (!sourceUrl || isGifInput || !duration || duration <= 0) {
      clearTimelineFrames();
      return;
    }

    let cancelled = false;
    const frameCount = 9;
    const thumbs = [];

    const generateFrames = async () => {
      const tempVideo = document.createElement('video');
      tempVideo.src = sourceUrl;
      tempVideo.preload = 'auto';
      tempVideo.muted = true;
      tempVideo.playsInline = true;

      const waitFor = (event) => new Promise((resolve, reject) => {
        const onOk = () => {
          tempVideo.removeEventListener(event, onOk);
          tempVideo.removeEventListener('error', onErr);
          resolve();
        };
        const onErr = () => {
          tempVideo.removeEventListener(event, onOk);
          tempVideo.removeEventListener('error', onErr);
          reject(new Error('Failed to build timeline previews'));
        };
        tempVideo.addEventListener(event, onOk, { once: true });
        tempVideo.addEventListener('error', onErr, { once: true });
      });

      try {
        await waitFor('loadedmetadata');
        const canvas = document.createElement('canvas');
        const ratio = tempVideo.videoWidth / Math.max(tempVideo.videoHeight, 1);
        canvas.width = 120;
        canvas.height = Math.max(68, Math.round(canvas.width / Math.max(ratio, 0.3)));
        const ctx = canvas.getContext('2d');

        for (let i = 0; i < frameCount; i++) {
          if (cancelled) break;
          const t = (duration * i) / Math.max(frameCount - 1, 1);
          tempVideo.currentTime = Math.min(t, Math.max(duration - 0.02, 0));
          await waitFor('seeked');
          ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
          if (!blob) continue;
          thumbs.push({
            t,
            url: URL.createObjectURL(blob),
          });
        }

        if (!cancelled) {
          setTimelineFrames((prev) => {
            prev.forEach((frame) => {
              try { URL.revokeObjectURL(frame.url); } catch (e) { /* ignore */ }
            });
            return thumbs;
          });
        }
      } catch {
        if (!cancelled) {
          clearTimelineFrames();
        }
      }
    };

    generateFrames();

    return () => {
      cancelled = true;
      thumbs.forEach((frame) => {
        try { URL.revokeObjectURL(frame.url); } catch (e) { /* ignore */ }
      });
    };
  }, [sourceUrl, duration, isGifInput]);

  const jumpToTime = (time) => {
    const t = Math.max(0, time);
    setCurrentTime(t);
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      videoRef.current.pause();
    }
  };

  const updateTrimFromPointer = (clientX, mode = dragModeRef.current) => {
    if (!timelineRef.current || !duration || duration <= 0 || !mode) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    const t = Math.min(Math.max(ratio, 0), 1) * duration;

    if (mode === 'start') {
      const nextStart = Math.min(t, safeEnd - 0.05);
      setStartSec(String(nextStart));
      jumpToTime(nextStart);
      return;
    }

    if (mode === 'end') {
      const nextEnd = Math.max(t, safeStart + 0.05);
      setEndSec(String(nextEnd));
      jumpToTime(nextEnd);
      return;
    }

    jumpToTime(t);
  };

  const beginDrag = (mode, e) => {
    e.preventDefault();
    e.stopPropagation();
    dragModeRef.current = mode;
    updateTrimFromPointer(e.clientX, mode);
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragModeRef.current) return;
      updateTrimFromPointer(e.clientX, dragModeRef.current);
    };

    const onUp = () => {
      dragModeRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [duration, safeStart, safeEnd]);

  const buildOptions = (preview) => {
    const options = {
      fps: clamp(fps, 5, 30, 15),
      width: clamp(width, 120, 1080, 480),
      speed: clamp(speed, 0.25, 4, 1),
      loop: clamp(loop, 0, 10, 0),
      reverse,
      preview,
    };

    if (!isGifInput) {
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
    setError('');

    try {
      const blob = await api.gifProcess(file, buildOptions(preview));
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
    setPreviewUrl('');
    setResultUrl('');
    setResultSize(null);
    clearTimelineFrames();
    setFps(15);
    setWidth(480);
    setSpeed(1);
    setLoop(0);
    setReverse(false);
    setStartSec('0');
    setEndSec('');
    setCurrentTime(0);
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
              maxSizeMB={200}
              accept="video/*,image/gif"
              selectedFile={file}
              noLimit={!!localStorage.getItem('adminToken')}
            />
            <div className="form-help" style={{ marginTop: '-6px' }}>
              Supported: MP4, WEBM, MOV, MKV and GIF
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
                {!isGifInput ? (
                  <video
                    ref={videoRef}
                    src={sourceUrl}
                    controls
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
                    onLoadedMetadata={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
                    style={{ width: '100%', display: 'block', background: '#000' }}
                  />
                ) : (
                  <img src={sourceUrl} alt="Source GIF" style={{ width: '100%', display: 'block' }} />
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
              <div style={{ marginBottom: '14px', padding: '14px', border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--bg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                    <Scissors size={14} /> Visual Trim Editor
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: 600 }}>
                    Clip Length: {formatSeconds(clipDuration)}
                  </div>
                </div>

                <div
                  ref={timelineRef}
                  style={{
                    position: 'relative',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    marginBottom: '10px',
                    background: 'var(--bg-card)',
                    cursor: 'pointer',
                  }}
                  onMouseDown={(e) => beginDrag('playhead', e)}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${timelineFrames.length || 9}, minmax(0, 1fr))`, height: '72px' }}>
                    {(timelineFrames.length > 0 ? timelineFrames : Array.from({ length: 9 }, () => ({ url: '' }))).map((frame, i) => (
                      <div key={`tl-${i}`} style={{ borderRight: i === (timelineFrames.length || 9) - 1 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
                        {frame.url ? (
                          <img src={frame.url} alt={`frame-${i}`} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.82)' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', background: 'linear-gradient(120deg, rgba(255,255,255,0.03), rgba(255,255,255,0.08), rgba(255,255,255,0.03))' }} />
                        )}
                      </div>
                    ))}
                  </div>

                  <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.16), rgba(0,0,0,0.32))' }} />

                  <div
                    style={{
                      position: 'absolute', top: 0, bottom: 0,
                      left: `${timelineStart}%`, width: `${timelineWidth}%`,
                      background: 'linear-gradient(90deg, rgba(44,147,250,0.25), rgba(44,147,250,0.55))',
                    }}
                  />

                  <button
                    type="button"
                    onMouseDown={(e) => beginDrag('start', e)}
                    style={{
                      position: 'absolute', top: 0, bottom: 0, left: `${timelineStart}%`,
                      width: '12px', marginLeft: '-6px', border: 'none', cursor: 'ew-resize',
                      background: 'rgba(255,255,255,0.92)', boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
                    }}
                    aria-label="Trim start handle"
                  />

                  <button
                    type="button"
                    onMouseDown={(e) => beginDrag('end', e)}
                    style={{
                      position: 'absolute', top: 0, bottom: 0, left: `${timelineStart + timelineWidth}%`,
                      width: '12px', marginLeft: '-6px', border: 'none', cursor: 'ew-resize',
                      background: 'rgba(255,255,255,0.92)', boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
                    }}
                    aria-label="Trim end handle"
                  />

                  <div
                    style={{
                      position: 'absolute', top: 0, bottom: 0, left: `${timelinePlayhead}%`,
                      width: '2px', background: '#fff',
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.2)',
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px', marginBottom: '8px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Start: <strong style={{ color: 'var(--text-primary)' }}>{formatSeconds(safeStart)}</strong></div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>Playhead: <strong style={{ color: 'var(--text-primary)' }}>{formatSeconds(currentTime)}</strong></div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'right' }}>End: <strong style={{ color: 'var(--text-primary)' }}>{formatSeconds(safeEnd)}</strong></div>
                </div>
              </div>
            )}

            {!isGifInput && (
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

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setFps(12); setWidth(360); }}>Small</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setFps(15); setWidth(480); }}>Balanced</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setFps(20); setWidth(640); }}>High</button>
            </div>

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
                <label className="form-label">Speed</label>
                <input className="form-input" type="number" min="0.25" max="4" step="0.05" value={speed} onChange={(e) => setSpeed(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Loop</label>
                <input className="form-input" type="number" min="0" max="10" value={loop} onChange={(e) => setLoop(e.target.value)} />
              </div>
            </div>

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

            {error && (
              <div style={{
                color: 'var(--error)', marginTop: '8px', padding: '10px',
                background: 'rgba(231, 76, 60, 0.1)', borderRadius: '6px', fontSize: '13px',
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
                <img src={previewUrl} alt="GIF preview" style={{ width: '100%', borderRadius: '8px', border: '1px solid var(--border)', display: 'block' }} />
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
                  <img src={resultUrl} alt="GIF result" style={{ width: '100%', borderRadius: '8px', border: '1px solid var(--border)', display: 'block' }} />
                  <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                      {resultSize ? formatBytes(resultSize) : ''}
                    </span>
                    <button className="btn btn-primary" onClick={handleDownload}><Download size={16} /> Download GIF</button>
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
