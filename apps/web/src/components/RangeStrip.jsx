import { useEffect, useRef, useState } from 'react';

// Range picker shared by the audio trimmer and GIF Maker, modelled on Kadron's
// RangeStrip: a lane (waveform or filmstrip) with a lime selection, draggable
// edges, a draggable selection body, and a playhead with a grabbable pin.
//
// renderLane(tone) draws the lane content; it is called twice, with 'base' for
// the full width and 'selected' for the copy clipped to the selection.

export function formatStripTime(seconds, duration = seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  if (duration < 60) return `${seconds.toFixed(2)} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// Evenly spaced video frames for the lane; a shimmer until they are ready.
export function Filmstrip({ frames, tone, placeholders = 9 }) {
  if (!frames || frames.length === 0) {
    return (
      <div className="filmstrip">
        {Array.from({ length: placeholders }, (_, i) => <div key={i} className="filmstrip-cell skeleton" />)}
      </div>
    );
  }
  return (
    <div className={`filmstrip${tone === 'selected' ? ' is-selected' : ''}`}>
      {frames.map((frame, i) => (
        <div key={i} className="filmstrip-cell">
          <img src={frame.url} alt="" draggable={false} />
        </div>
      ))}
    </div>
  );
}

const HANDLE_REACH = 10; // px either side of an edge that grabs it
const DRAG_THRESHOLD = 4; // px before a press on the selection becomes a move

export default function RangeStrip({
  duration,
  start,
  end,
  position = 0,
  onChange,
  onSeek,
  onScrubEnd,
  onTogglePlay,
  renderLane,
  laneHeight = 72,
  step = 0.1,
  minLength = 0.1,
  snap = (t) => t,
  disabled = false,
}) {
  const laneRef = useRef(null);
  const dragRef = useRef(null);
  const [hoverMode, setHoverMode] = useState(null);
  const [dragMode, setDragMode] = useState(null);
  const [dragTime, setDragTime] = useState(0);

  const ready = duration > 0 && !disabled;
  const pct = (t) => (duration > 0 ? (Math.min(Math.max(t, 0), duration) / duration) * 100 : 0);
  const scrubbing = dragMode === 'scrub' || dragMode === 'pin';
  const shownPosition = scrubbing ? dragTime : position;

  const timeAt = (clientX) => {
    const rect = laneRef.current.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.min(Math.max(ratio, 0), 1) * duration;
  };

  const modeAt = (clientX) => {
    const rect = laneRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const startX = (pct(start) / 100) * rect.width;
    const endX = (pct(end) / 100) * rect.width;
    const toStart = Math.abs(x - startX);
    const toEnd = Math.abs(x - endX);
    if (Math.min(toStart, toEnd) <= HANDLE_REACH) return toStart < toEnd || (toStart === toEnd && x < startX) ? 'start' : 'end';
    if (x > startX && x < endX) return 'move';
    return 'scrub';
  };

  const seek = (t) => {
    setDragTime(t);
    onSeek?.(t);
  };

  const applyDrag = (clientX) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === 'start') {
      const next = Math.min(Math.max(0, snap(timeAt(clientX))), end - minLength);
      onChange?.({ start: next, end });
      onSeek?.(next);
    } else if (drag.mode === 'end') {
      const next = Math.max(Math.min(duration, snap(timeAt(clientX))), start + minLength);
      onChange?.({ start, end: next });
      onSeek?.(next);
    } else if (drag.mode === 'move') {
      if (!drag.moved && Math.abs(clientX - drag.x) < DRAG_THRESHOLD) return;
      drag.moved = true;
      const length = drag.end - drag.start;
      const delta = timeAt(clientX) - timeAt(drag.x);
      const nextStart = Math.min(Math.max(0, snap(drag.start + delta)), duration - length);
      onChange?.({ start: nextStart, end: nextStart + length });
      onSeek?.(Math.min(Math.max(position, nextStart), nextStart + length));
    } else if (drag.mode === 'scrub') {
      seek(timeAt(clientX));
    } else if (drag.mode === 'pin') {
      seek(timeAt(clientX - drag.grabOffset));
    }
  };

  const beginDrag = (event, mode, extra = {}) => {
    if (!ready || event.button > 0) return;
    // No preventDefault: the native mousedown focuses the strip for the
    // keyboard shortcuts without a focus ring (touch-action and user-select
    // already stop scrolling and text selection).
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { mode, x: event.clientX, start, end, moved: false, ...extra };
    setDragMode(mode);
    if (mode === 'scrub') seek(timeAt(event.clientX));
    else if (mode === 'pin') setDragTime(position);
    else applyDrag(event.clientX);
  };

  const endDrag = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    // A press on the selection that never moved is a click: seek there.
    if (drag.mode === 'move' && !drag.moved) onSeek?.(timeAt(event.clientX));
    if (drag.mode === 'scrub' || drag.mode === 'pin' || (drag.mode === 'move' && !drag.moved)) onScrubEnd?.();
    dragRef.current = null;
    setDragMode(null);
  };

  const onLanePointerDown = (event) => {
    if (!ready) return;
    beginDrag(event, modeAt(event.clientX));
  };

  const onPinPointerDown = (event) => {
    if (!ready) return;
    const rect = laneRef.current.getBoundingClientRect();
    const playheadX = rect.left + (pct(position) / 100) * rect.width;
    beginDrag(event, 'pin', { grabOffset: event.clientX - playheadX });
  };

  const onKeyDown = (event) => {
    if (!ready) return;
    const amount = event.altKey ? step * 10 : step;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      if (event.shiftKey) {
        const next = Math.min(duration, Math.max(start + minLength, snap(end + direction * amount)));
        onChange?.({ start, end: next });
        onSeek?.(next);
      } else {
        const next = Math.max(0, Math.min(end - minLength, snap(start + direction * amount)));
        onChange?.({ start: next, end });
        onSeek?.(next);
      }
    } else if (event.key === ' ') {
      event.preventDefault();
      onTogglePlay?.();
    } else if (event.key === 'Home') {
      event.preventDefault();
      onSeek?.(start);
    } else if (event.key === 'End') {
      event.preventDefault();
      onSeek?.(end);
    }
  };

  // Release a drag if the component goes away mid-gesture.
  useEffect(() => () => { dragRef.current = null; }, []);

  const startPct = pct(start);
  const endPct = pct(end);
  const activeHandle = dragMode === 'start' || dragMode === 'end' ? dragMode : hoverMode === 'start' || hoverMode === 'end' ? hoverMode : null;
  const laneCursor = !ready ? 'default'
    : dragMode === 'move' ? 'grabbing'
    : (dragMode || hoverMode) === 'start' || (dragMode || hoverMode) === 'end' ? 'ew-resize'
    : (dragMode || hoverMode) === 'move' ? 'grab'
    : 'pointer';

  return (
    <div
      className={`range-strip${ready ? '' : ' is-disabled'}${dragMode ? ' is-dragging' : ''}`}
      tabIndex={ready ? 0 : -1}
      onKeyDown={onKeyDown}
      role="group"
      aria-label={`Selection ${formatStripTime(start, duration)} to ${formatStripTime(end, duration)}`}
    >
      <div className="range-labels">
        {ready && (
          <>
            <span className={`range-label${activeHandle === 'start' ? ' is-active' : ''}`}
                  style={{ left: `clamp(0px, calc(${startPct}% - 4px), calc(100% - 64px))` }}>
              {formatStripTime(start, duration)}
            </span>
            <span className={`range-label is-end${activeHandle === 'end' ? ' is-active' : ''}`}
                  style={{ right: `clamp(0px, calc(${100 - endPct}% - 4px), calc(100% - 64px))` }}>
              {formatStripTime(end, duration)}
            </span>
          </>
        )}
      </div>

      <div
        ref={laneRef}
        className="range-lane"
        style={{ height: laneHeight, cursor: laneCursor }}
        onPointerDown={onLanePointerDown}
        onPointerMove={(e) => {
          if (dragRef.current) applyDrag(e.clientX);
          else if (ready) setHoverMode(modeAt(e.clientX));
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => { if (!dragRef.current) setHoverMode(null); }}
      >
        <div className="range-layer">{renderLane?.('base')}</div>
        <div className="range-layer range-selected-layer"
             style={{ clipPath: `inset(0 ${100 - endPct}% 0 ${startPct}%)` }}>
          {renderLane?.('selected')}
        </div>
        {ready && (
          <>
            <div className="range-dim" style={{ left: 0, width: `${startPct}%` }} />
            <div className="range-dim" style={{ left: `${endPct}%`, right: 0 }} />
            <div className="range-selection" style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }} />
            <div className={`range-handle is-start${activeHandle === 'start' ? ' is-active' : ''}`} style={{ left: `${startPct}%` }}>
              <span className="range-grip" />
            </div>
            <div className={`range-handle is-end${activeHandle === 'end' ? ' is-active' : ''}`} style={{ left: `${endPct}%` }}>
              <span className="range-grip" />
            </div>
          </>
        )}
      </div>

      {ready && (
        <div className="range-playhead" style={{ left: `${pct(shownPosition)}%`, '--lane-height': `${laneHeight}px` }}>
          <div className="range-playhead-line" />
          {/* The tip stays on the playhead; the label box is kept inside the strip. */}
          <span className={`range-pin-tip${dragMode === 'pin' ? ' is-grabbed' : ''}`} />
          <div
            className={`range-pin${dragMode === 'pin' ? ' is-grabbed' : ''}`}
            style={{ '--pin-shift': `clamp(calc(-1 * ${pct(shownPosition)}cqw), -50%, calc(${100 - pct(shownPosition)}cqw - 100%))` }}
            onPointerDown={onPinPointerDown}
            onPointerMove={(e) => { if (dragRef.current) applyDrag(e.clientX); }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {formatStripTime(shownPosition, duration)}
          </div>
        </div>
      )}
    </div>
  );
}
