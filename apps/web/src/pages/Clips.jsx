import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Film, Upload, Play, Pause, SkipBack, SkipForward, Copy, Trash2, Clock, CheckCircle, XCircle, Scissors, Video, Loader, Eye, ExternalLink } from 'lucide-react';
import { api, formatBytes, formatDate, getClipUrl, getClipStreamUrl, uploadChunks, finalizeUpload } from '../api';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import FileUploader from '../components/FileUploader';
import useToast from '../hooks/useToast';
import JobProgress from '../components/JobProgress';

function formatTime(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getExpiryStyle(expiresAt) {
  if (!expiresAt) return null;
  const now = Date.now();
  const exp = new Date(expiresAt).getTime();
  if (exp <= now) return { color: '#e74c3c', text: 'Expired' };
  const hoursLeft = (exp - now) / (1000 * 60 * 60);
  if (hoursLeft < 2) return { color: '#e74c3c', text: `${Math.ceil(hoursLeft * 60)}m left` };
  if (hoursLeft < 6) return { color: '#f39c12', text: `${Math.ceil(hoursLeft)}h left` };
  return { color: '#3498db', text: formatDate(expiresAt) };
}

function parseTime(str) {
  if (!str) return 0;
  const parts = str.trim().split(':');
  if (parts.length === 2) {
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  }
  if (parts.length === 3) {
    return (parseInt(parts[0], 10) || 0) * 3600 + (parseInt(parts[1], 10) || 0) * 60 + (parseInt(parts[2], 10) || 0);
  }
  const num = parseFloat(str);
  return Number.isNaN(num) ? 0 : Math.max(0, num);
}

function Clips({ sessionId, isAdmin }) {
  const [file, setFile] = useState(null);
  const [clips, setClips] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [currentJob, setCurrentJob] = useState(null);
  const [error, setError] = useState(null);
  const [createdClip, setCreatedClip] = useState(null);
  const [toast, showToast] = useToast();

  const videoRef = useRef(null);
  const objectUrlRef = useRef(null);
  const isSeekingRef = useRef(false);
  const timelineRef = useRef(null);
  const dragModeRef = useRef(null);
  const regionDragRef = useRef(null);
  const [timelineDragMode, setTimelineDragMode] = useState(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimStartInput, setTrimStartInput] = useState('0:00');
  const [trimEndInput, setTrimEndInput] = useState('0:00');

  const [myClipsPage, setMyClipsPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const safeTrimEnd = trimEnd > 0 ? trimEnd : duration;
  const trimStartPct = duration > 0 ? (Math.min(trimStart, duration) / duration) * 100 : 0;
  const trimEndPct = duration > 0 ? (Math.min(safeTrimEnd, duration) / duration) * 100 : 0;
  const playheadPct = duration > 0 ? (Math.min(currentTime, duration) / duration) * 100 : 0;
  const trimDuration = Math.max(safeTrimEnd - trimStart, 0);
  const minTrimDuration = Math.min(0.15, Math.max(duration / 100, 0.05));

  const fetchClips = async () => {
    try {
      const data = await api.getClips(sessionId);
      setClips(data);
    } catch (err) {
      console.error('Failed to fetch clips:', err);
    }
  };

  useEffect(() => {
    fetchClips();
    const interval = setInterval(fetchClips, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleFileSelect = (selectedFile) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (!selectedFile) {
      setFile(null);
      setDuration(0);
      setTrimStart(0);
      setTrimEnd(0);
      setTrimStartInput('0:00');
      setTrimEndInput('0:00');
      setCurrentTime(0);
      setIsPlaying(false);
      setCreatedClip(null);
      setError(null);
      setUploadProgress(null);
      setUploadPhase(null);
      setCurrentJob(null);
      return;
    }
    objectUrlRef.current = URL.createObjectURL(selectedFile);
    setFile(selectedFile);
    setTrimStart(0);
    setTrimEnd(0);
    setTrimStartInput('0:00');
    setTrimEndInput('0:00');
    setCurrentTime(0);
    setIsPlaying(false);
    setCreatedClip(null);
    setError(null);
    setUploadProgress(null);
    setUploadPhase(null);
    setCurrentJob(null);
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration || 0;
      setDuration(dur);
      setTrimEnd(dur);
      setTrimEndInput(formatTime(dur));
    }
  };

  const handleTimeUpdate = () => {
    if (isSeekingRef.current) return;
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime || 0);
    }
  };

  const clampTrimTime = (value) => {
    if (!duration || duration <= 0) return 0;
    return Math.min(Math.max(value, 0), duration);
  };

  const snapTimelineTime = (value) => {
    const next = clampTrimTime(value);
    if (next < 0.12) return 0;
    if (duration - next < 0.12) return duration;
    return Math.round(next * 100) / 100;
  };

  const syncTrimStart = (value) => {
    const next = Math.min(snapTimelineTime(value), Math.max(safeTrimEnd - minTrimDuration, 0));
    setTrimStart(next);
    setTrimStartInput(formatTime(next));
    if (videoRef.current) videoRef.current.currentTime = next;
    setCurrentTime(next);
  };

  const syncTrimEnd = (value) => {
    const next = Math.max(snapTimelineTime(value), Math.min(trimStart + minTrimDuration, duration));
    setTrimEnd(next);
    setTrimEndInput(formatTime(next));
    if (videoRef.current) videoRef.current.currentTime = next;
    setCurrentTime(next);
  };

  const timeFromPointer = (clientX) => {
    if (!timelineRef.current || !duration || duration <= 0) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return clampTrimTime(Math.min(Math.max(ratio, 0), 1) * duration);
  };

  const getPointerX = (e) => {
    if (e.touches && e.touches.length > 0) return e.touches[0].clientX;
    if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientX;
    return e.clientX;
  };

  const seekVideo = (time) => {
    const next = snapTimelineTime(time);
    if (videoRef.current) videoRef.current.currentTime = next;
    setCurrentTime(next);
  };

  const getTimelineMode = (clientX) => {
    if (!timelineRef.current || !duration || duration <= 0) return 'seek';
    const t = timeFromPointer(clientX);
    const pxPerSec = timelineRef.current.getBoundingClientRect().width / duration;
    const handleRadius = Math.max(14 / pxPerSec, 0.08);
    if (Math.abs(t - trimStart) <= handleRadius) return 'start';
    if (Math.abs(t - safeTrimEnd) <= handleRadius) return 'end';
    if (t > trimStart && t < safeTrimEnd) return 'region';
    return 'seek';
  };

  const updateTimelineDrag = (clientX) => {
    const mode = dragModeRef.current;
    if (!mode) return;
    const time = timeFromPointer(clientX);
    if (mode === 'start') {
      syncTrimStart(time);
    } else if (mode === 'end') {
      syncTrimEnd(time);
    } else if (mode === 'region' && regionDragRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      const startRatio = rect.width > 0 ? (regionDragRef.current.mouseX - rect.left) / rect.width : 0;
      const currentRatio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      const delta = (currentRatio - startRatio) * duration;
      const length = regionDragRef.current.end - regionDragRef.current.start;
      let nextStart = regionDragRef.current.start + delta;
      let nextEnd = regionDragRef.current.end + delta;

      if (nextStart < 0) {
        nextStart = 0;
        nextEnd = length;
      }
      if (nextEnd > duration) {
        nextEnd = duration;
        nextStart = Math.max(0, duration - length);
      }

      nextStart = snapTimelineTime(nextStart);
      nextEnd = snapTimelineTime(nextEnd);
      if (nextEnd - nextStart < minTrimDuration) return;

      setTrimStart(nextStart);
      setTrimEnd(nextEnd);
      setTrimStartInput(formatTime(nextStart));
      setTrimEndInput(formatTime(nextEnd));
      seekVideo(nextStart);
    } else {
      seekVideo(time);
    }
  };

  const beginTimelineDrag = (mode, e) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = getPointerX(e);
    const resolvedMode = mode || getTimelineMode(clientX);
    dragModeRef.current = resolvedMode;
    setTimelineDragMode(resolvedMode);
    if (resolvedMode === 'region') {
      regionDragRef.current = { mouseX: clientX, start: trimStart, end: safeTrimEnd };
      seekVideo(trimStart);
      return;
    }
    regionDragRef.current = null;
    updateTimelineDrag(clientX);
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragModeRef.current) return;
      if (e.cancelable) e.preventDefault();
      updateTimelineDrag(getPointerX(e));
    };
    const onUp = () => {
      dragModeRef.current = null;
      regionDragRef.current = null;
      setTimelineDragMode(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
    };
  }, [duration, trimStart, safeTrimEnd, minTrimDuration]);

  const handleVideoSeeked = () => {
    isSeekingRef.current = false;
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime || 0);
    }
  };

  const handlePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleTrimStartBlur = () => {
    const val = parseTime(trimStartInput);
    syncTrimStart(val);
  };

  const handleTrimEndBlur = () => {
    const val = parseTime(trimEndInput);
    const clamped = Math.max(val, 0);
    syncTrimEnd(clamped || duration);
  };

  const handleSetStart = () => {
    syncTrimStart(currentTime);
    showToast(`Start set to ${formatTime(currentTime)}`);
  };

  const handleSetEnd = () => {
    syncTrimEnd(currentTime);
    showToast(`End set to ${formatTime(currentTime)}`);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;

    setUploading(true);
    setError('');
    setCreatedClip(null);
    setCurrentJob(null);

    try {
      const hasTrim = trimEnd > 0 && trimEnd > trimStart;

      const trimOptions = hasTrim ? {
        trimStart,
        trimEnd,
        duration: duration || null,
      } : null;

      setUploadPhase('uploading');
      setUploadProgress(0);

      const uploadId = await uploadChunks(file, (progress) => setUploadProgress(progress.percent));

      setUploadPhase('processing');
      setUploadProgress(null);

      const result = await finalizeUpload(uploadId, file.name, sessionId, trimOptions, { onJobUpdate: setCurrentJob });

      setCreatedClip(result);
      setFile(null);
      showToast('Clip uploaded successfully!');
      fetchClips();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setUploadPhase(null);
      setCurrentJob(null);
    }
  };

  const handleDelete = async (clip) => {
    try {
      await api.deleteClip(clip.token, sessionId);
      showToast('Clip deleted');
      fetchClips();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!');
  };

  const isExpired = (clip) => clip.deleted === 1 || (clip.expiresAt && new Date(clip.expiresAt) < new Date());

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Film size={24} /> Clips
          </h2>
          <div className="subtitle">Upload, trim, and share video clips</div>
        </div>
      </div>

      <div className="content">
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Upload size={18} /> Upload Clip</div>
          </div>
          <div className="card-body">
            <form onSubmit={handleUpload}>
              <div className="form-group">
                <label className="form-label">Choose Video</label>
                <FileUploader
                  onFileSelect={handleFileSelect}
                  maxSizeMB={200}
                  accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv,.mov"
                  selectedFile={file}
                  noLimit={isAdmin}
                />
                <div className="form-help">
                  Supported: MP4, WEBM, MOV, MKV (max {isAdmin ? '5GB' : '200MB'})
                </div>
              </div>

              {file && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{
                    position: 'relative', borderRadius: '8px', overflow: 'hidden',
                    background: '#000', marginBottom: '8px'
                  }}>
                    <video
                      ref={videoRef}
                      src={objectUrlRef.current}
                      onLoadedMetadata={handleLoadedMetadata}
                      onTimeUpdate={handleTimeUpdate}
                      onSeeked={handleVideoSeeked}
                      onEnded={() => setIsPlaying(false)}
                      preload="auto"
                      playsInline
                      style={{ width: '100%', maxHeight: '360px', display: 'block' }}
                    />
                  </div>

                  {duration > 0 && (
                    <div style={{
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '12px',
                      background: 'var(--bg)',
                      marginBottom: '12px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '10px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          Playhead <strong style={{ color: 'var(--text-primary)' }}>{formatTime(currentTime)}</strong>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => syncTrimStart(currentTime)}>
                            Set start here
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => syncTrimEnd(currentTime)}>
                            Set end here
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
                            syncTrimStart(0);
                            syncTrimEnd(duration);
                            seekVideo(0);
                          }}>
                            Full video
                          </button>
                        </div>
                      </div>
                      <div
                        ref={timelineRef}
                        style={{
                          position: 'relative',
                          height: '64px',
                          borderRadius: '8px',
                          background: 'var(--bg-secondary)',
                          overflow: 'visible',
                          cursor: timelineDragMode === 'region' ? 'grabbing' : 'pointer',
                          userSelect: 'none'
                        }}
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          beginTimelineDrag(null, e);
                        }}
                        onTouchStart={(e) => beginTimelineDrag(null, e)}
                      >
                        <div style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          left: 0,
                          width: `${trimStartPct}%`,
                          background: 'rgba(0,0,0,0.28)',
                          pointerEvents: 'none'
                        }} />
                        <div style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          left: `${trimEndPct}%`,
                          right: 0,
                          background: 'rgba(0,0,0,0.28)',
                          pointerEvents: 'none'
                        }} />
                        <div style={{
                          position: 'absolute',
                          top: '8px',
                          bottom: '8px',
                          left: `${trimStartPct}%`,
                          width: `${Math.max(trimEndPct - trimStartPct, 0)}%`,
                          background: 'rgba(52, 152, 219, 0.28)',
                          border: '1px solid rgba(52, 152, 219, 0.75)',
                          borderRadius: '7px',
                          boxShadow: timelineDragMode === 'region' ? '0 0 0 2px rgba(52, 152, 219, 0.35)' : 'none',
                          cursor: 'grab'
                        }} />
                        <div style={{
                          position: 'absolute',
                          top: '50%',
                          left: `${trimStartPct + Math.max((trimEndPct - trimStartPct) / 2, 0)}%`,
                          transform: 'translate(-50%, -50%)',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          background: 'rgba(0,0,0,0.55)',
                          color: '#fff',
                          fontSize: '12px',
                          fontWeight: 700,
                          pointerEvents: 'none',
                          whiteSpace: 'nowrap',
                          zIndex: 1
                        }}>
                          {formatTime(trimDuration)}
                        </div>
                        <div style={{
                          position: 'absolute',
                          top: '8px',
                          bottom: '8px',
                          left: `${trimStartPct}%`,
                          width: `${Math.max(trimEndPct - trimStartPct, 0)}%`,
                          cursor: 'grab',
                          zIndex: 1
                        }} />
                        <button
                          type="button"
                          onMouseDown={(e) => beginTimelineDrag('start', e)}
                          onTouchStart={(e) => beginTimelineDrag('start', e)}
                          title="Trim start"
                          style={{
                            position: 'absolute',
                            top: '6px',
                            bottom: '6px',
                            left: `${trimStartPct}%`,
                            width: '34px',
                            marginLeft: '-17px',
                            border: 'none',
                            borderRadius: '6px',
                            background: 'var(--accent)',
                            cursor: 'ew-resize',
                            zIndex: 4,
                            color: '#fff',
                            fontSize: '10px',
                            fontWeight: 700,
                            boxShadow: timelineDragMode === 'start' ? '0 0 0 3px rgba(52, 152, 219, 0.35)' : '0 2px 8px rgba(0,0,0,0.25)'
                          }}
                        >
                          <span style={{ display: 'block', lineHeight: 1 }}>IN</span>
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => beginTimelineDrag('end', e)}
                          onTouchStart={(e) => beginTimelineDrag('end', e)}
                          title="Trim end"
                          style={{
                            position: 'absolute',
                            top: '6px',
                            bottom: '6px',
                            left: `${trimEndPct}%`,
                            width: '34px',
                            marginLeft: '-17px',
                            border: 'none',
                            borderRadius: '6px',
                            background: 'var(--accent)',
                            cursor: 'ew-resize',
                            zIndex: 4,
                            color: '#fff',
                            fontSize: '10px',
                            fontWeight: 700,
                            boxShadow: timelineDragMode === 'end' ? '0 0 0 3px rgba(52, 152, 219, 0.35)' : '0 2px 8px rgba(0,0,0,0.25)'
                          }}
                        >
                          <span style={{ display: 'block', lineHeight: 1 }}>OUT</span>
                        </button>
                        <div style={{
                          position: 'absolute',
                          top: '4px',
                          bottom: '4px',
                          left: `${playheadPct}%`,
                          width: '2px',
                          background: '#fff',
                          boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
                          pointerEvents: 'none',
                          zIndex: 5
                        }}>
                          <div style={{
                            position: 'absolute',
                            top: '-1px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            width: 0,
                            height: 0,
                            borderLeft: '5px solid transparent',
                            borderRight: '5px solid transparent',
                            borderTop: '7px solid #fff'
                          }} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                        <span>0:00</span>
                        <span>Start {formatTime(trimStart)}</span>
                        <span>End {formatTime(safeTrimEnd)}</span>
                        <span>{formatTime(duration)}</span>
                      </div>
                    </div>
                  )}

                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap'
                  }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handlePlayPause}>
                      {isPlaying ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
                      if (videoRef.current) videoRef.current.currentTime = 0;
                    }}>
                      <SkipBack size={14} /> Start
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
                      if (videoRef.current) videoRef.current.currentTime = duration;
                    }}>
                      <SkipForward size={14} /> End
                    </button>
                  </div>

                  <div style={{
                    border: '1px solid var(--border)', borderRadius: '8px', padding: '12px',
                    background: 'var(--bg)', marginBottom: '12px',
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px'
                  }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">
                        <Scissors size={13} style={{ marginRight: '4px' }} /> Start
                      </label>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <input
                          className="form-input"
                          type="text"
                          value={trimStartInput}
                          onChange={(e) => setTrimStartInput(e.target.value)}
                          onBlur={handleTrimStartBlur}
                          style={{ fontSize: '13px', background: 'var(--bg-secondary)' }}
                          placeholder="0:00"
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={handleSetStart}
                          title="Set to current time"
                        >
                          Set
                        </button>
                      </div>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">
                        <Scissors size={13} style={{ marginRight: '4px' }} /> End
                      </label>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <input
                          className="form-input"
                          type="text"
                          value={trimEndInput}
                          onChange={(e) => setTrimEndInput(e.target.value)}
                          onBlur={handleTrimEndBlur}
                          style={{ fontSize: '13px', background: 'var(--bg-secondary)' }}
                          placeholder="0:00"
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={handleSetEnd}
                          title="Set to current time"
                        >
                          Set
                        </button>
                      </div>
                    </div>
                  </div>

                  {safeTrimEnd > trimStart && safeTrimEnd > 0 && isFinite(duration) && duration > 0 && (
                    <div style={{
                      fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px',
                      padding: '8px 10px', borderRadius: '6px', background: 'rgba(52, 152, 219, 0.1)',
                      border: '1px solid rgba(52, 152, 219, 0.2)'
                    }}>
                      <Video size={12} style={{ marginRight: '4px' }} />
                      Trimmed: {formatTime(trimDuration)} ({Math.round(trimDuration / duration * 100)}% of original), ffmpeg trim
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div style={{ color: 'var(--error)', marginBottom: '15px', padding: '10px', background: 'rgba(231, 76, 60, 0.1)', borderRadius: '6px' }}>
                  {error}
                </div>
              )}

              {uploadProgress != null && (
                <div style={{ marginBottom: '15px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {uploadPhase === 'processing' && <Loader size={14} className="spin" />}
                    {uploadPhase === 'processing' ? 'Processing...' : 'Uploading...'}
                    <span style={{ marginLeft: 'auto', fontWeight: 500 }}>{Math.round(uploadProgress)}%</span>
                  </div>
                  <div style={{
                    height: '8px', borderRadius: '4px', overflow: 'hidden',
                    background: 'var(--bg-secondary)', marginBottom: '6px'
                  }}>
                    <div style={{
                      width: `${uploadProgress}%`,
                      height: '100%', borderRadius: '4px',
                      background: 'var(--success)',
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                </div>
              )}

              {uploadPhase === 'processing' && uploadProgress == null && (
                <div style={{ marginBottom: '15px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <Loader size={14} className="spin" />
                    Merging and processing video...
                  </div>
                </div>
              )}

              <JobProgress
                job={currentJob}
                title={currentJob?.status === 'queued' ? 'Waiting to create clip' : 'Creating clip'}
                fallbackMessage="Worker is preparing the clip"
              />

              {createdClip && (
                <div style={{
                  background: 'rgba(46, 204, 113, 0.1)', padding: '15px',
                  borderRadius: '6px', marginBottom: '15px',
                  border: '1px solid rgba(46, 204, 113, 0.3)'
                }}>
                  <div style={{ marginBottom: '8px', fontWeight: '500', color: 'var(--success)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <CheckCircle size={16} /> Clip uploaded successfully!
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <code style={{ background: 'var(--bg)', padding: '8px 12px', borderRadius: '4px', flex: 1, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {createdClip.url}
                    </code>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => copyToClipboard(createdClip.url)}>
                      <Copy size={14} /> Copy
                    </button>
                  </div>
                </div>
              )}

              <button type="submit" className="btn btn-primary" disabled={uploading || !file}>
                {uploading ? (
                  <><Loader size={16} className="spin" /> {uploadPhase === 'processing' ? 'Processing...' : 'Uploading...'}</>
                ) : (
                  <><Upload size={16} /> Upload Clip</>
                )}
              </button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title"><Film size={18} /> My Clips ({clips.length})</div>
          </div>
          <div className="card-body">
            {clips.length === 0 ? (
              <EmptyState icon={Film} title="No clips yet" description="Upload your first video clip above" />
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '12px'
              }}>
                {clips.slice((myClipsPage - 1) * ITEMS_PER_PAGE, myClipsPage * ITEMS_PER_PAGE).map(clip => {
                  const expired = isExpired(clip);
                  const fullUrl = `${window.location.origin}${getClipUrl(clip.token)}`;
                  return (
                    <Link
                      key={clip.token}
                      to={getClipUrl(clip.token)}
                      style={{
                        textDecoration: 'none', color: 'inherit',
                        borderRadius: '8px', overflow: 'hidden',
                        border: '1px solid var(--border)',
                        background: 'var(--bg)',
                        transition: 'border-color 0.2s, box-shadow 0.2s',
                        opacity: expired ? 0.6 : 1,
                        cursor: expired ? 'default' : 'pointer',
                      }}
                      onMouseOver={(e) => {
                        if (!expired) {
                          e.currentTarget.style.borderColor = 'var(--accent)';
                          e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.15)';
                        }
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div style={{
                        width: '100%', aspectRatio: '16/9', background: '#000',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        position: 'relative', overflow: 'hidden',
                      }}>
                        {expired ? (
                          <div style={{ color: '#666', fontSize: '13px' }}>Expired</div>
                        ) : (
                          <video
                            src={getClipStreamUrl(clip.token)}
                            preload="metadata"
                            muted
                            playsInline
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        )}
                        <div style={{
                          position: 'absolute', bottom: '6px', left: '6px',
                          background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '2px 6px',
                          borderRadius: '4px', fontSize: '11px', fontWeight: '500',
                        }}>
                          {clip.duration ? formatTime(clip.duration) : '--:--'}
                        </div>
                        {!expired && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              copyToClipboard(fullUrl);
                            }}
                            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
                            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.5)'}
                            style={{
                              position: 'absolute', top: '6px', right: '6px',
                              background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff',
                              width: '28px', height: '28px', borderRadius: '6px',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', transition: 'background 0.15s',
                            }}
                            title="Copy link"
                          >
                            <Copy size={14} />
                          </button>
                        )}
                      </div>
                      <div style={{ padding: '10px 12px' }}>
                        <div style={{
                          fontSize: '13px', fontWeight: '500', marginBottom: '6px',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {clip.filename}
                        </div>
                        <div style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          fontSize: '11px', color: 'var(--text-secondary)',
                        }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Eye size={12} /> {clip.downloads}
                          </span>
                          <span>{formatBytes(clip.size)}</span>
                          <span>{formatDate(clip.createdAt)}</span>
                        </div>
                        {(() => {
                          const exp = getExpiryStyle(clip.expiresAt);
                          if (!exp) return null;
                          return (
                            <div style={{
                              fontSize: '11px', color: exp.color, marginTop: '4px',
                              display: 'flex', alignItems: 'center', gap: '4px',
                            }}>
                              <Clock size={11} />
                              {exp.text}
                            </div>
                          );
                        })()}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
          {clips.length > 0 && (
            <div style={{ padding: '0 16px 16px' }}>
              <Pagination
                currentPage={myClipsPage}
                totalItems={clips.length}
                itemsPerPage={ITEMS_PER_PAGE}
                onPageChange={setMyClipsPage}
              />
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />} {toast.message}
        </div>
      )}
    </>
  );
}

export default Clips;
