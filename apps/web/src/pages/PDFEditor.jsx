import { useState, useRef } from 'react';
import { Files, Upload, Layers, Scissors, RotateCw, Trash2, Image, X, Clock, CheckCircle, Download, ChevronUp, ChevronDown, File } from 'lucide-react';
import { api, formatBytes } from '../api';

function parsePageRange(input, maxPage) {
  const pages = new Set();
  const parts = input.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr);
      const end = parseInt(endStr);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.max(1, start); i <= Math.min(maxPage, end); i++) {
          pages.add(i);
        }
      }
    } else {
      const num = parseInt(trimmed);
      if (!isNaN(num) && num >= 1 && num <= maxPage) {
        pages.add(num);
      }
    }
  }
  return Array.from(pages).sort((a, b) => a - b);
}

const OPERATIONS = [
  { id: 'merge', label: 'Merge', icon: Layers, desc: 'Combine multiple PDFs', multi: true, accept: 'application/pdf' },
  { id: 'split', label: 'Split', icon: Scissors, desc: 'Extract pages', multi: false, accept: 'application/pdf' },
  { id: 'rotate', label: 'Rotate', icon: RotateCw, desc: 'Rotate pages', multi: false, accept: 'application/pdf' },
  { id: 'remove', label: 'Remove Pages', icon: Trash2, desc: 'Remove pages', multi: false, accept: 'application/pdf' },
  { id: 'images', label: 'Images → PDF', icon: Image, desc: 'Images to PDF', multi: true, accept: 'image/jpeg,image/png' },
];

export default function PDFEditor() {
  const [activeOp, setActiveOp] = useState('merge');
  const [files, setFiles] = useState([]);
  const [fileInfos, setFileInfos] = useState([]);
  const [pageInput, setPageInput] = useState('');
  const [rotateAngle, setRotateAngle] = useState(90);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  const currentOp = OPERATIONS.find(o => o.id === activeOp);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const resetState = () => {
    setFiles([]);
    setFileInfos([]);
    setPageInput('');
    setError('');
  };

  const handleFileAdd = async (newFiles) => {
    const fileArray = Array.from(newFiles);
    setFiles(prev => [...prev, ...fileArray]);

    const newInfos = [];
    for (const file of fileArray) {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        try {
          const info = await api.pdfInfo(file);
          newInfos.push({ name: file.name, size: file.size, pageCount: info.pageCount });
        } catch {
          newInfos.push({ name: file.name, size: file.size, pageCount: null });
        }
      } else {
        newInfos.push({ name: file.name, size: file.size, pageCount: null });
      }
    }
    setFileInfos(prev => [...prev, ...newInfos]);
  };

  const handleRemoveFile = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
    setFileInfos(prev => prev.filter((_, i) => i !== idx));
  };

  const moveFile = (fromIdx, toIdx) => {
    if (toIdx < 0 || toIdx >= files.length) return;
    const newFiles = [...files];
    const [moved] = newFiles.splice(fromIdx, 1);
    newFiles.splice(toIdx, 0, moved);
    setFiles(newFiles);
    const newInfos = [...fileInfos];
    const [movedInfo] = newInfos.splice(fromIdx, 1);
    newInfos.splice(toIdx, 0, movedInfo);
    setFileInfos(newInfos);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer?.files?.length) {
      handleFileAdd(e.dataTransfer.files);
    }
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

  const handleProcess = async () => {
    setProcessing(true);
    setError('');

    try {
      let blob;
      let filename;

      switch (activeOp) {
        case 'merge': {
          if (files.length < 2) throw new Error('Upload at least 2 PDF files');
          blob = await api.pdfMerge(files);
          filename = 'merged.pdf';
          break;
        }
        case 'split': {
          if (files.length === 0) throw new Error('Upload a PDF file first');
          const pages = parsePageRange(pageInput, fileInfos[0]?.pageCount || 0);
          if (pages.length === 0) throw new Error('Enter valid page numbers');
          blob = await api.pdfSplit(files[0], pages);
          filename = 'extracted.pdf';
          break;
        }
        case 'rotate': {
          if (files.length === 0) throw new Error('Upload a PDF file first');
          const maxPage = fileInfos[0]?.pageCount || 0;
          const pagesToRotate = pageInput.trim()
            ? parsePageRange(pageInput, maxPage)
            : Array.from({ length: maxPage }, (_, i) => i + 1);
          const rotations = {};
          pagesToRotate.forEach(p => { rotations[p] = rotateAngle; });
          blob = await api.pdfRotate(files[0], rotations);
          filename = 'rotated.pdf';
          break;
        }
        case 'remove': {
          if (files.length === 0) throw new Error('Upload a PDF file first');
          const pagesToRemove = parsePageRange(pageInput, fileInfos[0]?.pageCount || 0);
          if (pagesToRemove.length === 0) throw new Error('Enter valid page numbers to remove');
          blob = await api.pdfRemovePages(files[0], pagesToRemove);
          filename = 'modified.pdf';
          break;
        }
        case 'images': {
          if (files.length === 0) throw new Error('Upload at least one image');
          blob = await api.pdfImagesToPdf(files);
          filename = 'images.pdf';
          break;
        }
        default:
          throw new Error('Unknown operation');
      }

      downloadBlob(blob, filename);
      showToast('Done! File downloading.');
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const getButtonLabel = () => {
    switch (activeOp) {
      case 'merge': return 'Merge PDFs';
      case 'split': return 'Extract Pages';
      case 'rotate': return 'Rotate Pages';
      case 'remove': return 'Remove Pages';
      case 'images': return 'Create PDF';
      default: return 'Process';
    }
  };

  const iconBtnStyle = {
    background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
    color: 'var(--text-secondary)', display: 'flex', alignItems: 'center',
    borderRadius: '4px', transition: 'color 0.2s',
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Files size={24} /> PDF Editor
          </h2>
          <div className="subtitle">Merge, split, rotate, remove pages & convert images to PDF</div>
        </div>
      </div>

      <div className="content">
        {/* Operation Selector */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px', marginBottom: '20px' }}>
          {OPERATIONS.map(op => {
            const Icon = op.icon;
            const isActive = activeOp === op.id;
            return (
              <button
                key={op.id}
                onClick={() => { setActiveOp(op.id); resetState(); }}
                style={{
                  padding: '14px 10px', borderRadius: '8px', cursor: 'pointer',
                  border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                  background: isActive ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-card)',
                  color: isActive ? 'var(--accent)' : 'var(--text)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                  transition: 'all 0.2s', fontSize: '12px', fontWeight: 500,
                }}
              >
                <Icon size={22} />
                <span>{op.label}</span>
              </button>
            );
          })}
        </div>

        {/* Main Work Area */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header">
            <div className="card-title">
              {(() => { const Icon = currentOp.icon; return <Icon size={18} />; })()}
              {' '}{currentOp.label}
            </div>
          </div>
          <div className="card-body">
            {/* Upload Zone */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragActive ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '12px', padding: '30px 20px', textAlign: 'center',
                cursor: 'pointer', transition: 'all 0.2s',
                background: dragActive ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
              }}
            >
              <Upload size={36} style={{ opacity: 0.25, marginBottom: '8px' }} />
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                {activeOp === 'images'
                  ? 'Drop images here or click to upload (JPG, PNG)'
                  : activeOp === 'merge'
                    ? 'Drop PDF files here or click to upload (2+ files)'
                    : 'Drop a PDF file here or click to upload'}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple={currentOp.multi}
                accept={currentOp.accept}
                style={{ display: 'none' }}
                onChange={(e) => { handleFileAdd(e.target.files); e.target.value = ''; }}
              />
            </div>

            {/* File List */}
            {files.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  {files.length} file{files.length > 1 ? 's' : ''} uploaded
                </div>
                {files.map((file, idx) => (
                  <div key={idx} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '8px 12px', background: 'var(--bg)', borderRadius: '6px',
                    marginBottom: '4px', fontSize: '13px'
                  }}>
                    <File size={16} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {file.name}
                    </span>
                    {fileInfos[idx]?.pageCount && (
                      <span style={{ color: 'var(--accent)', fontSize: '12px', fontWeight: 500, flexShrink: 0 }}>
                        {fileInfos[idx].pageCount} pg
                      </span>
                    )}
                    <span style={{ color: 'var(--text-secondary)', fontSize: '12px', flexShrink: 0 }}>
                      {formatBytes(file.size)}
                    </span>
                    {currentOp.multi && (
                      <>
                        <button style={iconBtnStyle} onClick={(e) => { e.stopPropagation(); moveFile(idx, idx - 1); }}
                          disabled={idx === 0} title="Move up">
                          <ChevronUp size={14} />
                        </button>
                        <button style={iconBtnStyle} onClick={(e) => { e.stopPropagation(); moveFile(idx, idx + 1); }}
                          disabled={idx === files.length - 1} title="Move down">
                          <ChevronDown size={14} />
                        </button>
                      </>
                    )}
                    <button style={{ ...iconBtnStyle, color: 'var(--error)' }}
                      onClick={(e) => { e.stopPropagation(); handleRemoveFile(idx); }} title="Remove">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Operation-specific options */}
            {(activeOp === 'split' || activeOp === 'remove') && files.length > 0 && (
              <div className="form-group" style={{ marginTop: '16px', marginBottom: 0 }}>
                <label className="form-label">
                  {activeOp === 'split' ? 'Pages to extract' : 'Pages to remove'}
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  placeholder="e.g. 1, 3, 5-8"
                />
                <div className="form-help">
                  Separate page numbers with commas. Use dash for ranges (e.g., 5-8).
                  {fileInfos[0]?.pageCount && ` Total pages: ${fileInfos[0].pageCount}`}
                </div>
              </div>
            )}

            {activeOp === 'rotate' && files.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <label className="form-label">Rotation Angle</label>
                  <select className="form-input" value={rotateAngle} onChange={(e) => setRotateAngle(parseInt(e.target.value))}>
                    <option value={90}>90° clockwise</option>
                    <option value={180}>180°</option>
                    <option value={270}>90° counter-clockwise</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Pages to rotate (leave empty for all)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    placeholder="e.g. 1, 3, 5-8 (empty = all pages)"
                  />
                  {fileInfos[0]?.pageCount && (
                    <div className="form-help">Total pages: {fileInfos[0].pageCount}</div>
                  )}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{
                color: 'var(--error)', marginTop: '16px', padding: '10px',
                background: 'rgba(231, 76, 60, 0.1)', borderRadius: '6px', fontSize: '13px'
              }}>
                {error}
              </div>
            )}

            {/* Process Button */}
            {files.length > 0 && (
              <button
                className="btn btn-primary"
                style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}
                onClick={handleProcess}
                disabled={processing}
              >
                {processing
                  ? <><Clock size={16} /> Processing...</>
                  : <><Download size={16} /> {getButtonLabel()}</>
                }
              </button>
            )}
          </div>
        </div>

        {/* Info note for images operation */}
        {activeOp === 'images' && (
          <div style={{
            marginTop: '16px', padding: '12px 16px', borderRadius: '8px',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            fontSize: '13px', color: 'var(--text-secondary)'
          }}>
            <strong>Note:</strong> Only JPG and PNG images are supported. Each image becomes a full page in the PDF,
            preserving the original image dimensions.
          </div>
        )}
      </div>

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
