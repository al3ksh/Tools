import { useState, useRef, useEffect, useCallback } from 'react';
import { Files, Upload, Layers, Scissors, RotateCw, Trash2, Image, X, Clock, Download, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Eye, GripVertical, RotateCcw, File as FileIcon } from 'lucide-react';
import { api, formatBytes } from '../api';
import * as pdfjsLib from 'pdfjs-dist';
import FileUploader from '../components/FileUploader';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

const THUMB_WIDTH = 160;

function parsePageRange(input, maxPage) {
  const pages = new Set();
  for (const part of input.split(',')) {
    const t = part.trim();
    if (!t) continue;
    if (t.includes('-')) {
      const [s, e] = t.split('-').map(Number);
      if (!isNaN(s) && !isNaN(e)) for (let i = Math.max(1, s); i <= Math.min(maxPage, e); i++) pages.add(i);
    } else {
      const n = parseInt(t);
      if (!isNaN(n) && n >= 1 && n <= maxPage) pages.add(n);
    }
  }
  return Array.from(pages).sort((a, b) => a - b);
}

async function renderPage(pdfDoc, pageNum, canvas, width) {
  const page = await pdfDoc.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  const scale = width / vp.width;
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
}

const thumbBtnStyle = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
  color: 'var(--text-secondary)', borderRadius: '4px', display: 'flex',
  alignItems: 'center', transition: 'color 0.2s',
};

function PageThumb({ pageNum, positionIndex, pdfDoc, selected, rotation, onToggle, onRotateCW, onRotateCCW, onDelete, dragHandlers, isDragOver, style }) {
  const canvasRef = useRef(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    setRendered(false);
    renderPage(pdfDoc, pageNum, canvasRef.current, THUMB_WIDTH).then(() => setRendered(true)).catch(() => {});
  }, [pdfDoc, pageNum]);

  return (
    <div
      {...dragHandlers}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
        padding: '8px', borderRadius: '8px', cursor: 'pointer', userSelect: 'none',
        border: `2px solid ${selected ? 'var(--accent)' : isDragOver ? 'var(--accent)' : 'var(--border)'}`,
        background: selected ? 'rgba(59, 130, 246, 0.08)' : isDragOver ? 'rgba(59, 130, 246, 0.04)' : 'var(--bg-card)',
        transition: 'border-color 0.15s, background 0.15s, opacity 0.15s',
        position: 'relative', minWidth: THUMB_WIDTH + 16,
        ...style,
      }}
      onClick={(e) => { if (!e.defaultPrevented) onToggle(); }}
    >
      <div style={{ position: 'absolute', top: '4px', left: '4px', color: 'var(--text-secondary)', opacity: 0.4, cursor: 'grab' }}>
        <GripVertical size={14} />
      </div>
      <div style={{
        position: 'absolute', bottom: '32px', right: '6px',
        background: 'var(--accent)', color: '#fff', borderRadius: '4px',
        padding: '1px 6px', fontSize: '11px', fontWeight: 700, lineHeight: '18px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)', zIndex: 2,
      }}>
        {pageNum}
      </div>
      <div style={{
        width: THUMB_WIDTH, minHeight: THUMB_WIDTH * 1.4, display: 'flex',
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        borderRadius: '4px', background: '#fff', position: 'relative',
        transform: `rotate(${rotation || 0}deg)`, transition: 'transform 0.3s',
      }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: 'auto', display: rendered ? 'block' : 'none' }} />
        {!rendered && <div style={{ color: '#999', fontSize: '12px' }}>Loading...</div>}
      </div>
      <div style={{ display: 'flex', gap: '2px', marginTop: '2px' }}>
        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRotateCCW(); }}
          title="Rotate left" style={thumbBtnStyle}><RotateCcw size={13} /></button>
        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRotateCW(); }}
          title="Rotate right" style={thumbBtnStyle}><RotateCw size={13} /></button>
        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
          title="Remove page" style={{ ...thumbBtnStyle, color: 'var(--error, #e74c3c)' }}><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

function PagePreviewModal({ pdfDoc, pageNum, rotation, onClose }) {
  const canvasRef = useRef(null);
  const [scale, setScale] = useState(0.75);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !pageNum) return;
    const canvas = canvasRef.current;
    pdfDoc.getPage(pageNum).then((page) => {
      const vp = page.getViewport({ scale });
      canvas.width = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      page.render({ canvasContext: ctx, viewport: vp }).promise;
    });
  }, [pdfDoc, pageNum, scale]);

  if (!pageNum) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 10000 }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-card)', borderRadius: '12px', maxWidth: '90vw', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontWeight: 600, fontSize: '14px' }}>Page {pageNum}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button onClick={() => setScale(s => Math.max(0.5, s - 0.25))} style={thumbBtnStyle} title="Zoom out"><ZoomOut size={16} /></button>
            <span style={{ fontSize: '12px', minWidth: '40px', textAlign: 'center' }}>{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale(s => Math.min(4, s + 0.25))} style={thumbBtnStyle} title="Zoom in"><ZoomIn size={16} /></button>
            <button onClick={onClose} style={thumbBtnStyle}><X size={18} /></button>
          </div>
        </div>
        <div style={{ overflow: 'auto', padding: '16px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
          <canvas ref={canvasRef} style={{
            transform: `rotate(${rotation || 0}deg)`,
            transition: 'transform 0.3s', boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
          }} />
        </div>
      </div>
    </div>
  );
}

const MODES = [
  { id: 'edit', label: 'Visual Editor', icon: Eye, desc: 'View, reorder, rotate & remove pages' },
  { id: 'merge', label: 'Merge', icon: Layers, desc: 'Combine multiple PDFs' },
  { id: 'split', label: 'Split', icon: Scissors, desc: 'Extract page ranges' },
  { id: 'images', label: 'Images → PDF', icon: Image, desc: 'Convert images to PDF' },
];

export default function PDFEditor() {
  const [mode, setMode] = useState('edit');
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageOrder, setPageOrder] = useState([]);
  const [rotations, setRotations] = useState({});
  const [deletedPages, setDeletedPages] = useState(new Set());
  const [selectedPages, setSelectedPages] = useState(new Set());
  const [previewPage, setPreviewPage] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [mergeFiles, setMergeFiles] = useState([]);
  const [mergeInfos, setMergeInfos] = useState([]);
  const [splitFile, setSplitFile] = useState(null);
  const [splitPageCount, setSplitPageCount] = useState(0);
  const [splitInput, setSplitInput] = useState('');
  const [imageFiles, setImageFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const showToast = (msg, type = 'success') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ===== VISUAL EDITOR =====
  const loadPdf = useCallback(async (file) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdfFile(file);
      setPdfDoc(doc);
      const count = doc.numPages;
      setPageCount(count);
      setPageOrder(Array.from({ length: count }, (_, i) => i + 1));
      setRotations({});
      setDeletedPages(new Set());
      setSelectedPages(new Set());
      setError('');
    } catch (err) {
      setError('Failed to load PDF: ' + err.message);
    }
  }, []);

  const activePages = pageOrder.filter(p => !deletedPages.has(p));

  const togglePage = (pageNum) => {
    setSelectedPages(prev => {
      const next = new Set(prev);
      if (next.has(pageNum)) next.delete(pageNum);
      else next.add(pageNum);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedPages.size === activePages.length) setSelectedPages(new Set());
    else setSelectedPages(new Set(activePages));
  };

  const rotatePage = (pageNum, angle) => {
    setRotations(prev => ({ ...prev, [pageNum]: ((prev[pageNum] || 0) + angle) % 360 }));
  };

  const rotateSelected = (angle) => {
    if (selectedPages.size === 0) return;
    setRotations(prev => {
      const next = { ...prev };
      selectedPages.forEach(p => { next[p] = ((next[p] || 0) + angle) % 360; });
      return next;
    });
  };

  const deletePage = (pageNum) => {
    if (activePages.length <= 1) return;
    setDeletedPages(prev => new Set([...prev, pageNum]));
    setSelectedPages(prev => { const n = new Set(prev); n.delete(pageNum); return n; });
  };

  const deleteSelected = () => {
    if (selectedPages.size === 0) return;
    if (activePages.length - selectedPages.size < 1) { setError('Cannot delete all pages'); return; }
    setDeletedPages(prev => new Set([...prev, ...selectedPages]));
    setSelectedPages(new Set());
  };

  const handleDragStart = (idx) => setDragIdx(idx);
  const handleDragOver = (e, idx) => { e.preventDefault(); setDragOverIdx(idx); };
  const handleDragEnd = () => {
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      setPageOrder(prev => {
        const filtered = prev.filter(p => !deletedPages.has(p));
        const newOrder = [...filtered];
        const [moved] = newOrder.splice(dragIdx, 1);
        newOrder.splice(dragOverIdx, 0, moved);
        const deleted = prev.filter(p => deletedPages.has(p));
        return [...newOrder, ...deleted];
      });
    }
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleEditorSave = async () => {
    if (!pdfFile || activePages.length === 0) return;
    setProcessing(true);
    setError('');
    try {
      const hasRotations = activePages.some(p => (rotations[p] || 0) !== 0);
      const originalOrder = Array.from({ length: pageCount }, (_, i) => i + 1).filter(p => !deletedPages.has(p));
      const hasReorder = JSON.stringify(activePages) !== JSON.stringify(originalOrder);
      const hasDeleted = deletedPages.size > 0;

      let currentFile = pdfFile;

      if (hasRotations) {
        const rots = {};
        activePages.forEach(p => { if (rotations[p]) rots[p] = rotations[p]; });
        if (Object.keys(rots).length > 0) {
          const blob = await api.pdfRotate(currentFile, rots);
          currentFile = new File([blob], pdfFile.name, { type: 'application/pdf' });
        }
      }

      if (hasReorder || hasDeleted) {
        const blob = await api.pdfReorder(currentFile, activePages);
        currentFile = new File([blob], pdfFile.name, { type: 'application/pdf' });
      }

      downloadBlob(currentFile, pdfFile.name.replace('.pdf', '_edited.pdf'));
      showToast('PDF saved!');
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  // ===== MERGE =====
  const addMergeFiles = async (newFiles) => {
    const arr = Array.from(newFiles);
    setMergeFiles(prev => [...prev, ...arr]);
    const infos = [];
    for (const f of arr) {
      try {
        const info = await api.pdfInfo(f);
        infos.push({ name: f.name, size: f.size, pageCount: info.pageCount });
      } catch { infos.push({ name: f.name, size: f.size, pageCount: null }); }
    }
    setMergeInfos(prev => [...prev, ...infos]);
  };

  const moveMergeFile = (from, to) => {
    if (to < 0 || to >= mergeFiles.length) return;
    const nf = [...mergeFiles]; const [m] = nf.splice(from, 1); nf.splice(to, 0, m);
    setMergeFiles(nf);
    const ni = [...mergeInfos]; const [mi] = ni.splice(from, 1); ni.splice(to, 0, mi);
    setMergeInfos(ni);
  };

  const handleEditSelect = (selected) => {
    if (!selected) {
      setPdfFile(null);
      setPdfDoc(null);
      setPageCount(0);
      setPageOrder([]);
      setRotations({});
      setDeletedPages(new Set());
      setSelectedPages(new Set());
      return;
    }
    loadPdf(selected);
  };

  const handleMergeSelect = (selected) => {
    if (!selected || selected.length === 0) {
      setMergeFiles([]);
      setMergeInfos([]);
      return;
    }
    addMergeFiles(selected);
  };

  const handleSplitSelect = async (selected) => {
    if (!selected) {
      setSplitFile(null);
      setSplitPageCount(0);
      setSplitInput('');
      return;
    }
    setSplitFile(selected);
    try {
      const info = await api.pdfInfo(selected);
      setSplitPageCount(info.pageCount);
    } catch {
      setSplitPageCount(0);
    }
  };

  const handleImagesSelect = (selected) => {
    if (!selected || selected.length === 0) {
      setImageFiles([]);
      return;
    }
    setImageFiles(selected);
  };

  // ===== GENERAL =====
  const handleFileDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    if (mode === 'edit') loadPdf(files[0]);
    else if (mode === 'merge') addMergeFiles(files);
    else if (mode === 'split') { setSplitFile(files[0]); api.pdfInfo(files[0]).then(i => setSplitPageCount(i.pageCount)).catch(() => {}); }
    else if (mode === 'images') setImageFiles(prev => [...prev, ...Array.from(files)]);
  };

  const handleFileInput = (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    if (mode === 'edit') loadPdf(files[0]);
    else if (mode === 'merge') addMergeFiles(files);
    else if (mode === 'split') { setSplitFile(files[0]); api.pdfInfo(files[0]).then(i => setSplitPageCount(i.pageCount)).catch(() => {}); }
    else if (mode === 'images') setImageFiles(prev => [...prev, ...Array.from(files)]);
    e.target.value = '';
  };

  const resetAll = () => {
    setPdfFile(null); setPdfDoc(null); setPageCount(0); setPageOrder([]); setRotations({});
    setDeletedPages(new Set()); setSelectedPages(new Set()); setMergeFiles([]); setMergeInfos([]);
    setSplitFile(null); setSplitPageCount(0); setSplitInput(''); setImageFiles([]); setError('');
  };

  const handleProcess = async () => {
    setProcessing(true);
    setError('');
    try {
      let blob, filename;
      if (mode === 'merge') {
        if (mergeFiles.length < 2) throw new Error('Add at least 2 PDFs');
        blob = await api.pdfMerge(mergeFiles);
        filename = 'merged.pdf';
      } else if (mode === 'split') {
        if (!splitFile) throw new Error('Upload a PDF first');
        const pages = parsePageRange(splitInput, splitPageCount);
        if (!pages.length) throw new Error('Enter valid page numbers');
        blob = await api.pdfSplit(splitFile, pages);
        filename = 'extracted.pdf';
      } else if (mode === 'images') {
        if (!imageFiles.length) throw new Error('Add at least one image');
        blob = await api.pdfImagesToPdf(imageFiles);
        filename = 'images.pdf';
      }
      downloadBlob(blob, filename);
      showToast('Done!');
    } catch (err) { setError(err.message); }
    finally { setProcessing(false); }
  };

  const fileAccept = mode === 'images' ? 'image/jpeg,image/png' : 'application/pdf';
  const fileMulti = mode === 'merge' || mode === 'images';

  const modeTabStyle = (active) => ({
    padding: '10px 16px', borderRadius: '8px', cursor: 'pointer',
    border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-card)',
    color: active ? 'var(--accent)' : 'var(--text)',
    display: 'flex', alignItems: 'center', gap: '8px',
    fontSize: '13px', fontWeight: 500, transition: 'all 0.2s', whiteSpace: 'nowrap',
  });

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Files size={24} /> PDF Editor
          </h2>
          <div className="subtitle">Visual page editor — reorder, rotate, delete, merge, split & more</div>
        </div>
      </div>

      <div className="content">
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {MODES.map(m => {
            const Icon = m.icon;
            return (
              <button key={m.id} onClick={() => { setMode(m.id); resetAll(); }} style={modeTabStyle(mode === m.id)}>
                <Icon size={16} /> {m.label}
              </button>
            );
          })}
        </div>

        {/* ===== VISUAL EDITOR MODE ===== */}
        {mode === 'edit' && (
          <>
            {!pdfDoc ? (
              <div className="card" style={{ margin: 0 }}>
                <div className="card-body">
                  <FileUploader
                    onFileSelect={handleEditSelect}
                    maxSizeMB={100}
                    accept="application/pdf"
                    selectedFile={pdfFile}
                    noLimit={!!localStorage.getItem('adminToken')}
                  />
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', opacity: 0.6, marginTop: '-6px' }}>
                    View pages, drag to reorder, rotate and remove, then download.
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Toolbar */}
                <div className="card" style={{ margin: '0 0 16px 0' }}>
                  <div className="card-body" style={{ padding: '10px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{pdfFile?.name}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{activePages.length} / {pageCount} pages</span>
                      <div style={{ flex: 1 }} />
                      <button className="btn btn-secondary btn-sm" onClick={selectAll}
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                        {selectedPages.size === activePages.length ? 'Deselect All' : 'Select All'}
                      </button>
                      {selectedPages.size > 0 && (
                        <>
                          <span style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: 600 }}>{selectedPages.size} selected</span>
                          <button className="btn btn-secondary btn-sm" onClick={() => rotateSelected(90)}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                            <RotateCw size={13} /> 90°
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => rotateSelected(-90)}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                            <RotateCcw size={13} /> -90°
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={deleteSelected}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--error, #e74c3c)' }}>
                            <Trash2 size={13} /> Delete
                          </button>
                        </>
                      )}
                      <button className="btn btn-secondary btn-sm" onClick={() => { setPdfDoc(null); setPdfFile(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                        <X size={13} /> Close
                      </button>
                    </div>
                  </div>
                </div>

                {/* Page grid */}
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '16px',
                  background: 'var(--bg)', borderRadius: '12px', border: '1px solid var(--border)', minHeight: '250px',
                }}>
                  {activePages.map((pageNum, idx) => (
                    <PageThumb
                      key={`page-${pageNum}`}
                      pageNum={pageNum}
                      positionIndex={idx + 1}
                      pdfDoc={pdfDoc}
                      selected={selectedPages.has(pageNum)}
                      rotation={rotations[pageNum] || 0}
                      onToggle={() => togglePage(pageNum)}
                      onRotateCW={() => rotatePage(pageNum, 90)}
                      onRotateCCW={() => rotatePage(pageNum, -90)}
                      onDelete={() => deletePage(pageNum)}
                      isDragOver={dragOverIdx === idx}
                      dragHandlers={{
                        draggable: true,
                        onDragStart: () => handleDragStart(idx),
                        onDragOver: (e) => handleDragOver(e, idx),
                        onDragEnd: handleDragEnd,
                        onDoubleClick: (e) => { e.preventDefault(); setPreviewPage(pageNum); },
                      }}
                      style={dragIdx === idx ? { opacity: 0.4 } : {}}
                    />
                  ))}
                </div>

                <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-secondary)', opacity: 0.7 }}>
                  Drag pages to reorder • Click to select • Double-click to preview full size • Use toolbar for bulk actions
                </div>

                {error && (
                  <div style={{ color: 'var(--error)', marginTop: '12px', padding: '10px', background: 'rgba(231,76,60,0.1)', borderRadius: '6px', fontSize: '13px' }}>
                    {error}
                  </div>
                )}

                <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
                  <button className="btn btn-primary" onClick={handleEditorSave} disabled={processing}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {processing ? <><Clock size={16} /> Processing...</> : <><Download size={16} /> Save & Download PDF</>}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* ===== MERGE MODE ===== */}
        {mode === 'merge' && (
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <div className="card-title"><Layers size={18} /> Merge PDFs</div>
            </div>
            <div className="card-body">
              <FileUploader
                onFileSelect={handleMergeSelect}
                maxSizeMB={100}
                accept="application/pdf"
                selectedFile={mergeFiles}
                multiple={true}
                noLimit={!!localStorage.getItem('adminToken')}
              />
              {mergeFiles.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  {mergeFiles.map((f, idx) => (
                    <div key={idx} style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '8px 12px', background: 'var(--bg)', borderRadius: '6px', marginBottom: '4px', fontSize: '13px',
                    }}>
                      <FileIcon size={16} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      {mergeInfos[idx]?.pageCount && <span style={{ color: 'var(--accent)', fontSize: '12px', fontWeight: 500 }}>{mergeInfos[idx].pageCount} pg</span>}
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{formatBytes(f.size)}</span>
                      <button style={thumbBtnStyle} onClick={() => moveMergeFile(idx, idx - 1)} disabled={idx === 0}><ChevronLeft size={14} /></button>
                      <button style={thumbBtnStyle} onClick={() => moveMergeFile(idx, idx + 1)} disabled={idx === mergeFiles.length - 1}><ChevronRight size={14} /></button>
                      <button style={{ ...thumbBtnStyle, color: 'var(--error, #e74c3c)' }} onClick={() => {
                        setMergeFiles(p => p.filter((_, i) => i !== idx));
                        setMergeInfos(p => p.filter((_, i) => i !== idx));
                      }}><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
              {error && <div style={{ color: 'var(--error)', marginTop: '12px', padding: '10px', background: 'rgba(231,76,60,0.1)', borderRadius: '6px', fontSize: '13px' }}>{error}</div>}
              {mergeFiles.length >= 2 && (
                <button className="btn btn-primary" style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}
                  onClick={handleProcess} disabled={processing}>
                  {processing ? <><Clock size={16} /> Merging...</> : <><Download size={16} /> Merge & Download</>}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ===== SPLIT MODE ===== */}
        {mode === 'split' && (
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <div className="card-title"><Scissors size={18} /> Split / Extract Pages</div>
            </div>
            <div className="card-body">
              {!splitFile ? (
                <FileUploader
                  onFileSelect={handleSplitSelect}
                  maxSizeMB={100}
                  accept="application/pdf"
                  selectedFile={splitFile}
                  noLimit={!!localStorage.getItem('adminToken')}
                />
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <FileIcon size={16} />
                    <span style={{ fontWeight: 500 }}>{splitFile.name}</span>
                    <span style={{ fontSize: '12px', color: 'var(--accent)' }}>{splitPageCount} pages</span>
                    <button style={thumbBtnStyle} onClick={() => { setSplitFile(null); setSplitPageCount(0); setSplitInput(''); }}><X size={14} /></button>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Pages to extract</label>
                    <input type="text" className="form-input" value={splitInput} onChange={(e) => setSplitInput(e.target.value)} placeholder="e.g. 1, 3, 5-8" />
                    <div className="form-help">Separate with commas. Use dash for ranges.</div>
                  </div>
                  {error && <div style={{ color: 'var(--error)', marginTop: '12px', padding: '10px', background: 'rgba(231,76,60,0.1)', borderRadius: '6px', fontSize: '13px' }}>{error}</div>}
                  <button className="btn btn-primary" style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}
                    onClick={handleProcess} disabled={processing || !splitInput.trim()}>
                    {processing ? <><Clock size={16} /> Extracting...</> : <><Download size={16} /> Extract & Download</>}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ===== IMAGES MODE ===== */}
        {mode === 'images' && (
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <div className="card-title"><Image size={18} /> Images → PDF</div>
            </div>
            <div className="card-body">
              <FileUploader
                onFileSelect={handleImagesSelect}
                maxSizeMB={50}
                accept="image/jpeg,image/png"
                selectedFile={imageFiles}
                multiple={true}
                noLimit={!!localStorage.getItem('adminToken')}
              />
              {imageFiles.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  {imageFiles.map((f, idx) => (
                    <div key={idx} style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '8px 12px', background: 'var(--bg)', borderRadius: '6px', marginBottom: '4px', fontSize: '13px',
                    }}>
                      <Image size={16} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{formatBytes(f.size)}</span>
                      <button style={{ ...thumbBtnStyle, color: 'var(--error, #e74c3c)' }} onClick={() => setImageFiles(p => p.filter((_, i) => i !== idx))}><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
              {error && <div style={{ color: 'var(--error)', marginTop: '12px', padding: '10px', background: 'rgba(231,76,60,0.1)', borderRadius: '6px', fontSize: '13px' }}>{error}</div>}
              {imageFiles.length > 0 && (
                <button className="btn btn-primary" style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}
                  onClick={handleProcess} disabled={processing}>
                  {processing ? <><Clock size={16} /> Creating...</> : <><Download size={16} /> Create PDF</>}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {previewPage && (
        <PagePreviewModal pdfDoc={pdfDoc} pageNum={previewPage} rotation={rotations[previewPage] || 0} onClose={() => setPreviewPage(null)} />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999,
          padding: '12px 20px', borderRadius: '8px', fontWeight: 500, fontSize: '14px',
          background: toast.type === 'error' ? 'var(--error)' : 'var(--accent)',
          color: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {toast.message}
        </div>
      )}
    </>
  );
}
