import { useEffect, useMemo, useRef, useState } from 'react';
import { Film, Upload, Play, Download, RotateCcw, Sparkles, Scissors } from 'lucide-react';
import { api, formatBytes } from '../api';
import FileUploader from '../components/FileUploader';

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
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

  const [fps, setFps] = useState(15);
  const [width, setWidth] = useState(480);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(0);
  const [reverse, setReverse] = useState(false);
  const [startSec, setStartSec] = useState('0');
  const [endSec, setEndSec] = useState('');

  const videoRef = useRef(null);

  const sourceUrl = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  const isGifInput = file ? file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif') : false;
  const duration = meta?.duration && Number.isFinite(meta.duration) ? Number(meta.duration) : 0;

  const parsedStart = clamp(startSec, 0, duration || 99999, 0);
  const parsedEnd = endSec === '' ? duration : clamp(endSec, 0, duration || 99999, duration || 0);
  const safeStart = Math.min(parsedStart, parsedEnd || parsedStart);
  const safeEnd = Math.max(parsedEnd, safeStart + 0.05);

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

  const jumpToTime = (time) => {
    const t = Math.max(0, time);
    setCurrentTime(t);
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      videoRef.current.pause();
    }
  };

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
          <div className="subtitle">Create and edit GIFs with live previews from videos or existing GIFs</div>
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
                padding: '10px 12px',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                background: 'var(--bg)',
                fontSize: '13px',
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
              <div style={{ marginTop: '12px' }}>
                {!isGifInput ? (
                  <video
                    ref={videoRef}
                    src={sourceUrl}
                    controls
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
                    onLoadedMetadata={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
                    style={{ width: '100%', borderRadius: '8px', border: '1px solid var(--border)' }}
                  />
                ) : (
                  <img src={sourceUrl} alt="Source GIF" style={{ width: '100%', borderRadius: '8px', border: '1px solid var(--border)' }} />
                )}
              </div>
            )}

            {!isGifInput && file && duration > 0 && (
              <div style={{ marginTop: '12px', padding: '12px', border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--bg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                  <Scissors size={14} /> Visual Trim Editor
                </div>

                <div style={{ position: 'relative', height: '8px', borderRadius: '999px', background: 'var(--bg-card)', border: '1px solid var(--border)', marginBottom: '10px' }}>
                  <div
                    style={{
                      position: 'absolute', height: '100%', borderRadius: '999px',
                      left: `${(safeStart / duration) * 100}%`,
                      width: `${Math.max(((safeEnd - safeStart) / duration) * 100, 1)}%`,
                      background: 'var(--accent)', opacity: 0.5,
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute', top: '-3px',
                      left: `${(Math.min(Math.max(currentTime, 0), duration) / duration) * 100}%`,
                      width: '2px', height: '14px', background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.2)',
                    }}
                  />
                </div>

                <input
                  type="range"
                  min="0"
                  max={duration}
                  step="0.01"
                  value={Math.min(Math.max(currentTime, 0), duration)}
                  onChange={(e) => jumpToTime(Number(e.target.value))}
                  style={{ width: '100%', marginBottom: '8px' }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Start</div>
                    <input
                      type="range"
                      min="0"
                      max={duration}
                      step="0.01"
                      value={safeStart}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setStartSec(String(Math.min(next, safeEnd - 0.05)));
                        jumpToTime(next);
                      }}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>End</div>
                    <input
                      type="range"
                      min="0"
                      max={duration}
                      step="0.01"
                      value={safeEnd}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setEndSec(String(Math.max(next, safeStart + 0.05)));
                        jumpToTime(next);
                      }}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <span>Current: {currentTime.toFixed(2)}s</span>
                  <span>Clip: {safeStart.toFixed(2)}s → {safeEnd.toFixed(2)}s ({(safeEnd - safeStart).toFixed(2)}s)</span>
                </div>
              </div>
            )}

            {loadingMeta && <div style={{ marginTop: '10px', color: 'var(--text-secondary)' }}>Reading metadata...</div>}
          </div>
        </div>

        <div className="card" style={{ marginTop: '16px' }}>
          <div className="card-header">
            <div className="card-title"><Upload size={18} /> Controls</div>
          </div>
          <div className="card-body">
            {!isGifInput && (
              <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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

            <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))', gap: '12px' }}>
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

            <div className="form-group" style={{ marginTop: '4px' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
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

            <div style={{ display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" disabled={!file || processing} onClick={() => handleGenerate(true)}>
                {processing ? <><Play size={16} /> Processing...</> : <><Play size={16} /> Generate Preview</>}
              </button>
              <button className="btn btn-primary" disabled={!file || processing} onClick={() => handleGenerate(false)}>
                {processing ? <><Play size={16} /> Processing...</> : <><Sparkles size={16} /> Render Final GIF</>}
              </button>
              <button className="btn btn-secondary" onClick={resetAll}>
                <RotateCcw size={16} /> Reset
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <div className="card-title"><Play size={18} /> Preview</div>
            </div>
            <div className="card-body" style={{ minHeight: '220px' }}>
              {previewUrl ? (
                <img src={previewUrl} alt="GIF preview" style={{ width: '100%', borderRadius: '8px', border: '1px solid var(--border)' }} />
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
                  <img src={resultUrl} alt="GIF result" style={{ width: '100%', borderRadius: '8px', border: '1px solid var(--border)' }} />
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
