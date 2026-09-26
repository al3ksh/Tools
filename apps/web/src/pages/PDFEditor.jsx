import { useState, useRef, useEffect, useCallback } from 'react';
import { Files, Layers, Scissors, RotateCw, Trash2, Image, X, Clock, Download, ZoomIn, ZoomOut, Eye, GripVertical, RotateCcw, File as FileIcon } from 'lucide-react';
import { api, downloadBlob } from '../api';
import * as pdfjsLib from 'pdfjs-dist';
import FileUploader from '../components/FileUploader';
import useToast from '../hooks/useToast';
import JobProgress from '../components/JobProgress';
import { withIds, openPdf, move, SortableGrid, AddTile, PdfFileCard, ImageFileCard, PagePicker, pagesToRange } from '../components/PdfBoards';

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
        background: selected ? 'var(--accent-wash)' : isDragOver ? 'var(--accent-faint)' : 'var(--bg-card)',
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
        background: 'var(--accent)', color: 'var(--accent-btn-text)', borderRadius: '4px',
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
  { id: 'split', label: 'Extract pages', icon: Scissors, desc: 'Pick pages for a new PDF' },
  { id: 'images', label: 'Images → PDF', icon: Image, desc: 'Convert images to PDF' },
];

export default function PDFEditor({ sessionId, isAdmin }) {
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
  const [mergeItems, setMergeItems] = useState([]);
  const [mergePages, setMergePages] = useState({});
  const [splitFile, setSplitFile] = useState(null);
  const [splitDoc, setSplitDoc] = useState(null);
  const [splitSelected, setSplitSelected] = useState(new Set());
  const [splitInput, setSplitInput] = useState('');
  const [imageItems, setImageItems] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [currentJob, setCurrentJob] = useState(null);
  const [jobTitle, setJobTitle] = useState('');
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

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
    setCurrentJob(null);
    setJobTitle('Saving edited PDF');
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
          const blob = await api.pdfRotate(currentFile, rots, sessionId, { onJobUpdate: setCurrentJob });
          currentFile = new File([blob], pdfFile.name, { type: 'application/pdf' });
        }
      }

      if (hasReorder || hasDeleted) {
        const blob = await api.pdfReorder(currentFile, activePages, sessionId, { onJobUpdate: setCurrentJob });
        currentFile = new File([blob], pdfFile.name, { type: 'application/pdf' });
      }

      downloadBlob(currentFile, pdfFile.name.replace('.pdf', '_edited.pdf'));
      showToast('PDF saved!');
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
      setCurrentJob(null);
    }
  };

  // ===== MERGE =====
  const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const isImage = (f) => /^image\/(jpeg|png)$/.test(f.type) || /\.(jpe?g|png)$/i.test(f.name);

  const addMergeFiles = (files) => {
    const pdfs = Array.from(files).filter(isPdf);
    if (pdfs.length < files.length) showToast('Only PDF files can be merged', 'error');
    if (pdfs.length) setMergeItems((prev) => [...prev, ...withIds(pdfs)]);
  };
  const removeMergeItem = (id) => {
    setMergeItems((prev) => prev.filter((it) => it.id !== id));
    setMergePages((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };
  const mergeTotalPages = mergeItems.reduce((sum, it) => sum + (mergePages[it.id] || 0), 0);

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

  // ===== SPLIT =====
  const clearSplit = () => {
    if (splitDoc) splitDoc.destroy();
    setSplitFile(null);
    setSplitDoc(null);
    setSplitSelected(new Set());
    setSplitInput('');
  };

  const handleSplitSelect = async (selected) => {
    clearSplit();
    if (!selected) return;
    setSplitFile(selected);
    try {
      setSplitDoc(await openPdf(selected));
      setError('');
    } catch (err) {
      setError('Cannot read this PDF: ' + err.message);
    }
  };

  const setSplitPages = (pages) => {
    setSplitSelected(pages);
    setSplitInput(pagesToRange(pages));
  };

  const handleSplitInput = (value) => {
    setSplitInput(value);
    if (splitDoc) setSplitSelected(new Set(parsePageRange(value, splitDoc.numPages)));
  };

  const selectSplitPages = (which) => {
    const count = splitDoc?.numPages || 0;
    const all = Array.from({ length: count }, (_, i) => i + 1);
    if (which === 'all') setSplitPages(new Set(all));
    else if (which === 'odd') setSplitPages(new Set(all.filter((p) => p % 2 === 1)));
    else if (which === 'even') setSplitPages(new Set(all.filter((p) => p % 2 === 0)));
    else setSplitPages(new Set());
  };

  // ===== IMAGES =====
  const addImages = (files) => {
    const images = Array.from(files).filter(isImage);
    if (images.length < files.length) showToast('Only JPG and PNG images can be added', 'error');
    if (images.length) setImageItems((prev) => [...prev, ...withIds(images)]);
  };

  // ===== GENERAL =====
  const resetAll = () => {
    setPdfFile(null); setPdfDoc(null); setPageCount(0); setPageOrder([]); setRotations({});
    setDeletedPages(new Set()); setSelectedPages(new Set()); setMergeItems([]); setMergePages({});
    clearSplit(); setImageItems([]); setError(''); setCurrentJob(null);
  };

  const baseName = (file, fallback) => (file ? file.name.replace(/\.[^.]+$/, '') : fallback);

  const handleProcess = async () => {
    setProcessing(true);
    setCurrentJob(null);
    setError('');
    try {
      let blob, filename;
      if (mode === 'merge') {
        if (mergeItems.length < 2) throw new Error('Add at least 2 PDFs');
        setJobTitle('Merging PDF');
        blob = await api.pdfMerge(mergeItems.map((it) => it.file), sessionId, { onJobUpdate: setCurrentJob });
        filename = `${baseName(mergeItems[0].file, 'merged')} (merged).pdf`;
      } else if (mode === 'split') {
        if (!splitFile) throw new Error('Choose a PDF first');
        const pages = [...splitSelected].sort((a, b) => a - b);
        if (!pages.length) throw new Error('Pick at least one page');
        setJobTitle('Extracting pages');
        blob = await api.pdfSplit(splitFile, pages, sessionId, { onJobUpdate: setCurrentJob });
        filename = `${baseName(splitFile, 'document')} (pages ${pagesToRange(pages).replace(/ /g, '')}).pdf`;
      } else if (mode === 'images') {
        if (!imageItems.length) throw new Error('Add at least one image');
        setJobTitle('Creating PDF');
        blob = await api.pdfImagesToPdf(imageItems.map((it) => it.file), sessionId, { onJobUpdate: setCurrentJob });
        filename = `${baseName(imageItems[0].file, 'images')}.pdf`;
      }
      downloadBlob(blob, filename);
      showToast(`Saved ${filename} to your downloads`);
    } catch (err) { setError(err.message); }
    finally { setProcessing(false); setCurrentJob(null); }
  };

  const modeTabStyle = (active) => ({
    padding: '10px 16px', borderRadius: '8px', cursor: 'pointer',
    border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-wash)' : 'var(--bg-card)',
    color: active ? 'var(--accent-text)' : 'var(--text)',
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
                    maxSizeMB={isAdmin ? 150 : 50}
                    accept="application/pdf"
                    selectedFile={pdfFile}
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
                          <span style={{ fontSize: '12px', color: 'var(--accent-text)', fontWeight: 600 }}>{selectedPages.size} selected</span>
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
                  <div style={{ color: 'var(--error)', marginTop: '12px', padding: '10px', background: 'rgba(231, 170, 164, 0.12)', borderRadius: '6px', fontSize: '13px' }}>
                    {error}
                  </div>
                )}

                <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
                  <button className="btn btn-primary" onClick={handleEditorSave} disabled={processing}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {processing ? <><Clock size={16} /> Processing...</> : <><Download size={16} /> Save & Download PDF</>}
                  </button>
                </div>
                <JobProgress job={currentJob} title={jobTitle || 'Processing PDF'} fallbackMessage="Worker is processing PDF changes" />
              </>
            )}
          </>
        )}

        {/* ===== MERGE MODE ===== */}
        {mode === 'merge' && (
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <div className="card-title"><Layers size={18} /> Merge PDFs</div>
              {mergeItems.length > 0 && (
                <div className="card-header-note">
                  {mergeItems.length} files · {mergeTotalPages} pages
                  <button className="btn btn-secondary btn-sm" onClick={() => { setMergeItems([]); setMergePages({}); }}>Clear</button>
                </div>
              )}
            </div>
            <div className="card-body">
              {mergeItems.length === 0 ? (
                <FileUploader
                  onFileSelect={(files) => files?.length && addMergeFiles(files)}
                  maxSizeMB={isAdmin ? 150 : 50}
                  accept="application/pdf"
                  selectedFile={[]}
                  multiple={true}
                />
              ) : (
                <SortableGrid
                  items={mergeItems}
                  onReorder={(from, to) => setMergeItems((prev) => move(prev, from, to))}
                  onFiles={addMergeFiles}
                  renderItem={(item, index) => (
                    <PdfFileCard
                      item={item}
                      index={index}
                      onRemove={() => removeMergeItem(item.id)}
                      onInfo={(id, pages) => setMergePages((prev) => ({ ...prev, [id]: pages || 0 }))}
                    />
                  )}
                >
                  <AddTile accept="application/pdf" label="Add PDFs" hint="or drop them here" onFiles={addMergeFiles} disabled={processing} />
                </SortableGrid>
              )}
              <div className="form-help">
                {mergeItems.length < 2
                  ? 'Add two or more PDFs. You can pick several at once, or add more later.'
                  : 'Drag the cards to set the order. The first card comes first in the merged PDF.'}
              </div>
              {error && <div style={{ color: 'var(--error)', marginTop: '12px', padding: '10px', background: 'rgba(231, 170, 164, 0.12)', borderRadius: '6px', fontSize: '13px' }}>{error}</div>}
              <button className="btn btn-primary" style={{ marginTop: '16px' }}
                onClick={handleProcess} disabled={processing || mergeItems.length < 2}>
                {processing ? <><Clock size={16} /> Merging...</> : <><Download size={16} /> Merge & Download</>}
              </button>
              <JobProgress job={currentJob} title={jobTitle || 'Merging PDF'} fallbackMessage="Worker is merging files" />
            </div>
          </div>
        )}

        {/* ===== SPLIT MODE ===== */}
        {mode === 'split' && (
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <div className="card-title"><Scissors size={18} /> Extract Pages</div>
              {splitFile && (
                <div className="card-header-note">
                  <FileIcon size={14} /> {splitFile.name}{splitDoc ? ` · ${splitDoc.numPages} pages` : ''}
                  <button className="btn btn-secondary btn-sm" onClick={clearSplit}><X size={13} /> Close</button>
                </div>
              )}
            </div>
            <div className="card-body">
              {!splitFile ? (
                <FileUploader
                  onFileSelect={handleSplitSelect}
                  maxSizeMB={isAdmin ? 150 : 50}
                  accept="application/pdf"
                  selectedFile={null}
                />
              ) : (
                <>
                  <div className="picker-toolbar">
                    <div className="form-group" style={{ margin: 0, flex: '1 1 260px' }}>
                      <input
                        type="text"
                        className="form-input"
                        value={splitInput}
                        onChange={(e) => handleSplitInput(e.target.value)}
                        placeholder="Click pages below, or type e.g. 1, 3, 5-8"
                        aria-label="Pages to extract"
                      />
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={() => selectSplitPages('all')}>All</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => selectSplitPages('odd')}>Odd</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => selectSplitPages('even')}>Even</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => selectSplitPages('none')} disabled={!splitSelected.size}>None</button>
                  </div>
                  {splitDoc
                    ? <PagePicker doc={splitDoc} selected={splitSelected} onChange={setSplitPages} />
                    : !error && <div className="form-help">Reading pages…</div>}
                  <div className="form-help">
                    {splitSelected.size
                      ? `${splitSelected.size} ${splitSelected.size === 1 ? 'page' : 'pages'} selected · they are saved as one new PDF`
                      : 'Click the pages to keep. Shift+click selects a run of pages.'}
                  </div>
                  {error && <div style={{ color: 'var(--error)', marginTop: '12px', padding: '10px', background: 'rgba(231, 170, 164, 0.12)', borderRadius: '6px', fontSize: '13px' }}>{error}</div>}
                  <button className="btn btn-primary" style={{ marginTop: '16px' }}
                    onClick={handleProcess} disabled={processing || !splitSelected.size}>
                    {processing ? <><Clock size={16} /> Extracting...</> : <><Download size={16} /> Extract & Download</>}
                  </button>
                  <JobProgress job={currentJob} title={jobTitle || 'Extracting pages'} fallbackMessage="Worker is creating the extracted PDF" />
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
              {imageItems.length > 0 && (
                <div className="card-header-note">
                  {imageItems.length} {imageItems.length === 1 ? 'page' : 'pages'}
                  <button className="btn btn-secondary btn-sm" onClick={() => setImageItems([])}>Clear</button>
                </div>
              )}
            </div>
            <div className="card-body">
              {imageItems.length === 0 ? (
                <FileUploader
                  onFileSelect={(files) => files?.length && addImages(files)}
                  maxSizeMB={50}
                  accept="image/jpeg,image/png"
                  selectedFile={[]}
                  multiple={true}
                />
              ) : (
                <SortableGrid
                  items={imageItems}
                  onReorder={(from, to) => setImageItems((prev) => move(prev, from, to))}
                  onFiles={addImages}
                  renderItem={(item, index) => (
                    <ImageFileCard item={item} index={index} onRemove={() => setImageItems((prev) => prev.filter((it) => it.id !== item.id))} />
                  )}
                >
                  <AddTile accept="image/jpeg,image/png" label="Add images" hint="JPG or PNG" onFiles={addImages} disabled={processing} />
                </SortableGrid>
              )}
              <div className="form-help">
                Each image becomes one page of a new PDF, in this order. Drag to reorder.
              </div>
              {error && <div style={{ color: 'var(--error)', marginTop: '12px', padding: '10px', background: 'rgba(231, 170, 164, 0.12)', borderRadius: '6px', fontSize: '13px' }}>{error}</div>}
              <button className="btn btn-primary" style={{ marginTop: '16px' }}
                onClick={handleProcess} disabled={processing || !imageItems.length}>
                {processing ? <><Clock size={16} /> Creating...</> : <><Download size={16} /> Create PDF</>}
              </button>
              <JobProgress job={currentJob} title={jobTitle || 'Creating PDF'} fallbackMessage="Worker is building the PDF" />
            </div>
          </div>
        )}
      </div>

      {previewPage && (
        <PagePreviewModal pdfDoc={pdfDoc} pageNum={previewPage} rotation={rotations[previewPage] || 0} onClose={() => setPreviewPage(null)} />
      )}

      {toast && (
        <div className={`toast toast-${toast.type === 'error' ? 'error' : 'success'}`}>
          {toast.message}
        </div>
      )}
    </>
  );
}
