import { useEffect, useRef, useState } from 'react';
import { Plus, X, GripVertical, Check } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { formatBytes } from '../api';

// Visual pieces for the PDF tools: sortable file boards for Merge and
// Images → PDF, and a page picker for Split. Everything renders in the
// browser with pdf.js, so nothing is uploaded until the user runs the tool.

let nextId = 1;
export const withIds = (files) => Array.from(files).map((file) => ({ id: nextId++, file }));

export async function openPdf(file) {
  const data = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data }).promise;
}

// Renders one page once it scrolls near the viewport.
export function PdfPageCanvas({ doc, page, width }) {
  const holderRef = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const el = holderRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !doc || !canvasRef.current) return undefined;
    let cancelled = false;
    let task = null;
    setDone(false);
    doc.getPage(page).then((p) => {
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      const scale = (width * (window.devicePixelRatio || 1)) / base.width;
      const viewport = p.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      task = p.render({ canvasContext: canvas.getContext('2d'), viewport });
      return task.promise.then(() => { if (!cancelled) setDone(true); });
    }).catch(() => {});
    return () => { cancelled = true; if (task) task.cancel(); };
  }, [visible, doc, page, width]);

  return (
    <div ref={holderRef} className="pdf-page" style={{ width }}>
      <canvas ref={canvasRef} style={{ display: done ? 'block' : 'none' }} />
      {!done && <div className="pdf-page-skeleton skeleton" />}
    </div>
  );
}

// Drag-to-reorder grid. Items need a stable `id`.
export function SortableGrid({ items, onReorder, renderItem, onFiles, children, className = '' }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const finish = () => {
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) onReorder(dragIndex, overIndex);
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div
      className={`board ${className}`}
      // Files dropped anywhere on the board are added, not opened by the browser.
      onDragOver={(e) => { if (onFiles && dragIndex === null && e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={(e) => {
        if (!onFiles || dragIndex !== null || !e.dataTransfer.files?.length) return;
        e.preventDefault();
        onFiles(e.dataTransfer.files);
      }}
    >
      {items.map((item, index) => (
        <div
          key={item.id}
          className={`board-item${dragIndex === index ? ' is-dragging' : ''}${overIndex === index && dragIndex !== index ? ' is-over' : ''}`}
          draggable
          onDragStart={(e) => { setDragIndex(index); e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={(e) => { if (dragIndex === null) return; e.preventDefault(); setOverIndex(index); }}
          onDrop={(e) => { if (dragIndex === null) return; e.preventDefault(); finish(); }}
          onDragEnd={finish}
        >
          <span className="board-grip" aria-hidden="true"><GripVertical size={14} /></span>
          {renderItem(item, index)}
        </div>
      ))}
      {children}
    </div>
  );
}

export const move = (list, from, to) => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

// A tile that adds files by click or drop, next to the ones already there.
export function AddTile({ accept, label, hint, onFiles, disabled }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      className={`board-add${over ? ' is-over' : ''}`}
      disabled={disabled}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files?.length) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ''; }}
      />
      <span className="board-add-icon"><Plus size={22} /></span>
      <span className="board-add-label">{label}</span>
      {hint && <span className="board-add-hint">{hint}</span>}
    </button>
  );
}

// Merge: one card per PDF with its first page and page count.
export function PdfFileCard({ item, index, onRemove, onInfo }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    let opened = null;
    openPdf(item.file)
      .then((d) => { opened = d; if (alive) { setDoc(d); onInfo?.(item.id, d.numPages); } else d.destroy(); })
      .catch(() => { if (alive) { setError('Cannot read this PDF'); onInfo?.(item.id, null); } });
    return () => { alive = false; if (opened) opened.destroy(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  return (
    <div className="file-card">
      <span className="file-card-order">{index + 1}</span>
      <button type="button" className="file-card-remove" onClick={onRemove} title="Remove" aria-label={`Remove ${item.file.name}`}>
        <X size={14} />
      </button>
      <div className="file-card-preview">
        {doc ? <PdfPageCanvas doc={doc} page={1} width={118} /> : <div className={error ? 'file-card-error' : 'pdf-page-skeleton skeleton'}>{error}</div>}
      </div>
      <div className="file-card-name" title={item.file.name}>{item.file.name}</div>
      <div className="file-card-meta">
        {doc ? `${doc.numPages} ${doc.numPages === 1 ? 'page' : 'pages'}` : error ? '—' : '…'} · {formatBytes(item.file.size)}
      </div>
    </div>
  );
}

// Images → PDF: one card per image, in page order.
export function ImageFileCard({ item, index, onRemove }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(item.file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [item.file]);
  return (
    <div className="file-card">
      <span className="file-card-order">{index + 1}</span>
      <button type="button" className="file-card-remove" onClick={onRemove} title="Remove" aria-label={`Remove ${item.file.name}`}>
        <X size={14} />
      </button>
      <div className="file-card-preview is-image">
        {url && <img src={url} alt="" draggable={false} />}
      </div>
      <div className="file-card-name" title={item.file.name}>{item.file.name}</div>
      <div className="file-card-meta">{formatBytes(item.file.size)}</div>
    </div>
  );
}

export function pagesToRange(pages) {
  const sorted = [...pages].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    let end = start;
    while (sorted[i + 1] === end + 1) end = sorted[++i];
    parts.push(end > start ? `${start}-${end}` : String(start));
  }
  return parts.join(', ');
}

// Split: click pages to pick them, Shift+click for a run.
export function PagePicker({ doc, selected, onChange }) {
  const lastRef = useRef(null);
  const count = doc?.numPages || 0;

  const toggle = (page, shift) => {
    const next = new Set(selected);
    if (shift && lastRef.current) {
      const [a, b] = [Math.min(lastRef.current, page), Math.max(lastRef.current, page)];
      const on = !selected.has(page);
      for (let p = a; p <= b; p++) (on ? next.add(p) : next.delete(p));
    } else if (next.has(page)) next.delete(page);
    else next.add(page);
    lastRef.current = page;
    onChange(next);
  };

  return (
    <div className="page-picker">
      {Array.from({ length: count }, (_, i) => i + 1).map((page) => {
        const on = selected.has(page);
        return (
          <button
            key={page}
            type="button"
            className={`page-pick${on ? ' is-selected' : ''}`}
            onClick={(e) => toggle(page, e.shiftKey)}
            aria-pressed={on}
            title={`Page ${page}`}
          >
            <PdfPageCanvas doc={doc} page={page} width={120} />
            <span className="page-pick-check">{on && <Check size={13} strokeWidth={3} />}</span>
            <span className="page-pick-number">{page}</span>
          </button>
        );
      })}
    </div>
  );
}
