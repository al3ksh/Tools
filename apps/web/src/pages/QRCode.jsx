import { useState, useRef } from 'react';
import { QrCode as QrCodeIcon, Download, Upload, Copy, ExternalLink, Settings, CheckCircle, XCircle } from 'lucide-react';
import { api } from '../api';
import jsQR from 'jsqr';
import useToast from '../hooks/useToast';

export default function QRCode() {
  const [activeTab, setActiveTab] = useState('generate');

  // Generate state
  const [text, setText] = useState('');
  const [size, setSize] = useState(400);
  const [darkColor, setDarkColor] = useState('#000000');
  const [lightColor, setLightColor] = useState('#ffffff');
  const [errorCorrection, setErrorCorrection] = useState('M');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [qrSvg, setQrSvg] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  // Read state
  const [decodedText, setDecodedText] = useState(null);
  const [readError, setReadError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [previewSrc, setPreviewSrc] = useState(null);
  const fileInputRef = useRef(null);

  const [toast, showToast] = useToast();

  const handleGenerate = async () => {
    if (!text.trim()) return;
    setGenerating(true);
    setError('');
    setQrDataUrl(null);
    setQrSvg(null);

    try {
      const opts = { size, darkColor, lightColor, errorCorrection };
      const [pngResult, svgResult] = await Promise.all([
        api.generateQR(text, opts),
        api.generateQRSvg(text, opts),
      ]);
      setQrDataUrl(pngResult.dataUrl);
      setQrSvg(svgResult.svg);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadPng = () => {
    if (!qrDataUrl) return;
    const [header, data] = qrDataUrl.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const binary = atob(data);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
    const blob = new Blob([array], { type: mime });
    downloadBlob(blob, 'qrcode.png');
  };

  const handleDownloadSvg = () => {
    if (!qrSvg) return;
    const blob = new Blob([qrSvg], { type: 'image/svg+xml' });
    downloadBlob(blob, 'qrcode.svg');
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

  const handleReadFile = (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setReadError('Please upload an image file');
      return;
    }
    setDecodedText(null);
    setReadError('');
    setPreviewSrc(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewSrc(e.target.result);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code) {
          setDecodedText(code.data);
        } else {
          setReadError('No QR code found in the image. Try a clearer image.');
        }
      };
      img.onerror = () => setReadError('Failed to load image');
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleReadFile(file);
  };

  const tabStyle = (isActive) => ({
    flex: 1, padding: '10px 20px', border: 'none', cursor: 'pointer',
    background: isActive ? 'var(--accent)' : 'var(--bg-card)',
    color: isActive ? '#fff' : 'var(--text)',
    fontWeight: 500, fontSize: '14px', transition: 'all 0.2s',
  });

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <QrCodeIcon size={24} /> QR Code
          </h2>
          <div className="subtitle">Generate and read QR codes</div>
        </div>
      </div>

      <div className="content">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: '20px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)' }}>
          <button style={tabStyle(activeTab === 'generate')} onClick={() => setActiveTab('generate')}>
            Generate
          </button>
          <button style={tabStyle(activeTab === 'read')} onClick={() => setActiveTab('read')}>
            Read / Scan
          </button>
        </div>

        {/* GENERATE TAB */}
        {activeTab === 'generate' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', alignItems: 'start' }}>
            {/* Form */}
            <div className="card" style={{ margin: 0 }}>
              <div className="card-header">
                <div className="card-title"><QrCodeIcon size={18} /> Generate QR Code</div>
              </div>
              <div className="card-body">
                <div className="form-group">
                  <label className="form-label">Text or URL</label>
                  <textarea
                    className="form-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="https://example.com or any text..."
                    rows={3}
                    style={{ resize: 'vertical', fontFamily: 'inherit' }}
                    maxLength={4296}
                  />
                  <div className="form-help">{text.length}/4296 characters</div>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  <Settings size={14} /> Customize {showAdvanced ? '▲' : '▼'}
                </button>

                {showAdvanced && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px', padding: '12px', background: 'var(--bg)', borderRadius: '8px' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Size (px)</label>
                      <select className="form-input" value={size} onChange={(e) => setSize(parseInt(e.target.value))}>
                        <option value={200}>200 × 200</option>
                        <option value={400}>400 × 400</option>
                        <option value={600}>600 × 600</option>
                        <option value={800}>800 × 800</option>
                        <option value={1000}>1000 × 1000</option>
                      </select>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Foreground</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input type="color" value={darkColor} onChange={(e) => setDarkColor(e.target.value)}
                            style={{ width: '36px', height: '36px', border: 'none', borderRadius: '6px', cursor: 'pointer', padding: 0 }} />
                          <input type="text" className="form-input" value={darkColor} onChange={(e) => setDarkColor(e.target.value)}
                            style={{ flex: 1, fontFamily: 'monospace', fontSize: '13px' }} />
                        </div>
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Background</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input type="color" value={lightColor} onChange={(e) => setLightColor(e.target.value)}
                            style={{ width: '36px', height: '36px', border: 'none', borderRadius: '6px', cursor: 'pointer', padding: 0 }} />
                          <input type="text" className="form-input" value={lightColor} onChange={(e) => setLightColor(e.target.value)}
                            style={{ flex: 1, fontFamily: 'monospace', fontSize: '13px' }} />
                        </div>
                      </div>
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Error Correction</label>
                      <select className="form-input" value={errorCorrection} onChange={(e) => setErrorCorrection(e.target.value)}>
                        <option value="L">Low (7%) — smallest size</option>
                        <option value="M">Medium (15%) — default</option>
                        <option value="Q">Quartile (25%)</option>
                        <option value="H">High (30%) — most durable</option>
                      </select>
                    </div>
                  </div>
                )}

                {error && (
                  <div style={{ color: 'var(--error)', marginBottom: '12px', padding: '10px', background: 'rgba(231, 76, 60, 0.1)', borderRadius: '6px', fontSize: '13px' }}>
                    {error}
                  </div>
                )}

                <button className="btn btn-primary" onClick={handleGenerate} disabled={generating || !text.trim()}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {generating ? 'Generating...' : <><QrCodeIcon size={16} /> Generate</>}
                </button>
              </div>
            </div>

            {/* Preview */}
            <div className="card" style={{ margin: 0 }}>
              <div className="card-header">
                <div className="card-title"><Download size={18} /> Preview & Download</div>
              </div>
              <div className="card-body" style={{ textAlign: 'center' }}>
                {qrDataUrl ? (
                  <>
                    <div style={{ padding: '16px', background: lightColor, borderRadius: '8px', display: 'inline-block' }}>
                      <img src={qrDataUrl} alt="QR Code" style={{ maxWidth: '100%', maxHeight: '360px', display: 'block' }} />
                    </div>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
                      <button className="btn btn-primary" onClick={handleDownloadPng} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Download size={16} /> PNG
                      </button>
                      <button className="btn btn-secondary" onClick={handleDownloadSvg} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Download size={16} /> SVG
                      </button>
                      <button className="btn btn-secondary" onClick={() => {
                        navigator.clipboard.writeText(text);
                        showToast('Text copied!');
                      }} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Copy size={16} /> Copy Text
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '60px 20px', color: 'var(--text-secondary)' }}>
                    <QrCodeIcon size={64} strokeWidth={1} style={{ opacity: 0.2, marginBottom: '12px' }} />
                    <div style={{ fontSize: '14px', opacity: 0.6 }}>Your QR code will appear here</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* READ / SCAN TAB */}
        {activeTab === 'read' && (
          <div style={{ maxWidth: '600px' }}>
            <div className="card" style={{ margin: 0 }}>
              <div className="card-header">
                <div className="card-title"><Upload size={18} /> Upload QR Code Image</div>
              </div>
              <div className="card-body">
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragActive ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '12px', padding: '40px 20px', textAlign: 'center',
                    cursor: 'pointer', transition: 'all 0.2s',
                    background: dragActive ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                  }}
                >
                  <Upload size={48} style={{ opacity: 0.25, marginBottom: '12px' }} />
                  <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                    Drop an image with a QR code here, or click to upload
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => { if (e.target.files[0]) handleReadFile(e.target.files[0]); e.target.value = ''; }}
                  />
                </div>

                {previewSrc && (
                  <div style={{ marginTop: '16px', textAlign: 'center' }}>
                    <img src={previewSrc} alt="Uploaded" style={{
                      maxWidth: '100%', maxHeight: '200px', borderRadius: '8px',
                      border: '1px solid var(--border)'
                    }} />
                  </div>
                )}

                {readError && (
                  <div style={{
                    marginTop: '16px', padding: '12px', borderRadius: '8px',
                    background: 'rgba(231, 76, 60, 0.1)', color: 'var(--error)',
                    display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px'
                  }}>
                    <XCircle size={16} /> {readError}
                  </div>
                )}

                {decodedText && (
                  <div style={{ marginTop: '16px' }}>
                    <div style={{
                      padding: '12px', background: 'rgba(46, 204, 113, 0.1)', borderRadius: '8px',
                      border: '1px solid rgba(46, 204, 113, 0.3)', marginBottom: '12px',
                      display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--success, #2ecc71)'
                    }}>
                      <CheckCircle size={16} /> QR code decoded successfully
                    </div>
                    <div style={{
                      padding: '12px', background: 'var(--bg)', borderRadius: '6px',
                      wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '14px',
                      border: '1px solid var(--border)', color: 'var(--text)'
                    }}>
                      {decodedText}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                      <button className="btn btn-primary btn-sm" onClick={() => {
                        navigator.clipboard.writeText(decodedText);
                        showToast('Copied to clipboard!');
                      }} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Copy size={14} /> Copy
                      </button>
                      {(decodedText.startsWith('http://') || decodedText.startsWith('https://')) && (
                        <a href={decodedText} target="_blank" rel="noopener noreferrer"
                          className="btn btn-secondary btn-sm"
                          style={{ display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}>
                          <ExternalLink size={14} /> Open Link
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
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
