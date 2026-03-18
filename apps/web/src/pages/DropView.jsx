import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, FileBox, AlertCircle, ArrowLeft, File as FileIcon, Lock, KeyRound, XCircle, Eye, EyeOff } from 'lucide-react';
import { api, getDropUrl, formatBytes, formatDate } from '../api';
import useToast from '../hooks/useToast';

function DropView() {
    const { token } = useParams();
    const [info, setInfo] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [password, setPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [downloading, setDownloading] = useState(false);
    const [unlocked, setUnlocked] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [toast, showToast] = useToast();

    useEffect(() => {
        const fetchInfo = async () => {
            try {
                const data = await api.getDropInfo(token);
                setInfo(data);
            } catch (err) {
                setError(err.message || 'File not found');
            } finally {
                setLoading(false);
            }
        };
        fetchInfo();
    }, [token]);

    const triggerDownload = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleDownload = async () => {
        if (info.hasPassword && !unlocked) {
            if (!password.trim()) {
                setPasswordError('Password is required');
                return;
            }
            setDownloading(true);
            setPasswordError('');
            try {
                const { blob, filename } = await api.downloadDrop(token, password);
                setUnlocked(true);
                triggerDownload(blob, filename);
            } catch (err) {
                setPasswordError(err.message);
            } finally {
                setDownloading(false);
            }
        } else {
            try {
                const { blob, filename } = await api.downloadDrop(token);
                triggerDownload(blob, filename);
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '50px', width: '100%' }}>
                <div className="skeleton-box" style={{ width: '100%', maxWidth: '600px', height: '400px', borderRadius: '8px' }} />
            </div>
        );
    }

    if (error || !info) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '50px', width: '100%' }}>
                <div className="card" style={{ maxWidth: '500px', width: '100%', textAlign: 'center', padding: '40px 20px' }}>
                    <AlertCircle size={64} style={{ color: 'var(--error)', margin: '0 auto 20px' }} />
                    <h2 style={{ marginBottom: '10px' }}>Oops! File Not Found</h2>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>{error}</p>
                    <Link to="/" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <ArrowLeft size={16} /> Go Back to Dashboard
                    </Link>
                </div>
            </div>
        );
    }

    const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(info.filename);
    const isVideo = /\.(mp4|webm|ogg)$/i.test(info.filename);
    const isAudio = /\.(mp3|wav|ogg|flac)$/i.test(info.filename);
    const needsPassword = info.hasPassword && !unlocked;
    const previewUrl = needsPassword ? null : getDropUrl(info.token);

    return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '30px 20px', width: '100%' }}>
            <div className="card" style={{ maxWidth: '600px', width: '100%' }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileBox size={20} /> Shared File
                        {info.hasPassword && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: 'rgba(230, 126, 34, 0.15)', color: 'var(--warning)' }}>
                                <Lock size={11} /> Protected
                            </span>
                        )}
                    </div>
                    <Link to="/" style={{ color: 'var(--text-secondary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        Go to Tools <ArrowLeft size={16} style={{ transform: 'rotate(180deg)' }} />
                    </Link>
                </div>

                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '30px' }}>

                    <div style={{
                        width: '100%',
                        backgroundColor: 'var(--bg-primary)',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        minHeight: '200px',
                        marginBottom: '20px',
                        border: '1px solid var(--border)',
                        position: 'relative'
                    }}>
                        {needsPassword ? (
                            <div style={{
                                position: 'absolute', inset: 0,
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                background: 'var(--bg)', gap: '8px', color: 'var(--text-secondary)'
                            }}>
                                <Lock size={40} style={{ opacity: 0.4 }} />
                                <span style={{ fontSize: '13px' }}>Enter password to preview</span>
                            </div>
                        ) : isImage ? (
                            <img src={previewUrl} alt={info.filename} style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain' }} />
                        ) : isVideo ? (
                            <video src={previewUrl} controls style={{ maxWidth: '100%', maxHeight: '400px' }} />
                        ) : isAudio ? (
                            <audio src={previewUrl} controls style={{ width: '90%' }} />
                        ) : !unlocked ? (
                            <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                                <FileIcon size={64} style={{ margin: '0 auto 10px' }} />
                                <div>Preview not available</div>
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                                <FileIcon size={64} style={{ margin: '0 auto 10px' }} />
                                <div>Preview not available</div>
                            </div>
                        )}
                    </div>

                    <h2 style={{ marginBottom: '10px', wordBreak: 'break-all', textAlign: 'center' }}>{info.filename}</h2>

                    <div style={{ display: 'flex', gap: '15px', color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <span>Size: <strong style={{ color: 'var(--text-primary)' }}>{formatBytes(info.size)}</strong></span>
                        <span>•</span>
                        <span>Uploaded: <strong style={{ color: 'var(--text-primary)' }}>{formatDate(info.createdAt)}</strong></span>
                        <span>•</span>
                        <span>Downloads: <strong style={{ color: 'var(--text-primary)' }}>{info.downloads}</strong></span>
                    </div>

                    {needsPassword && (
                        <div style={{ width: '100%', marginBottom: '20px' }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '14px', borderRadius: '8px', marginBottom: '12px',
                                background: 'rgba(230, 126, 34, 0.08)', border: '1px solid rgba(230, 126, 34, 0.2)',
                                color: 'var(--warning)', fontSize: '13px'
                            }}>
                                <KeyRound size={16} /> This file requires a password to download
                            </div>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    className="form-input"
                                    placeholder="Enter password"
                                    value={password}
                                    onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleDownload(); }}
                                    autoFocus
                                    style={{ paddingRight: '40px' }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    style={{
                                        position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                                        background: 'none', border: 'none', color: 'var(--text-secondary)',
                                        cursor: 'pointer', padding: '2px', display: 'flex'
                                    }}
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                            {passwordError && (
                                <div style={{ color: 'var(--error)', fontSize: '12px', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <XCircle size={12} /> {passwordError}
                                </div>
                            )}
                        </div>
                    )}

                    <button
                        onClick={handleDownload}
                        disabled={downloading || (needsPassword && !password.trim())}
                        className="btn btn-success"
                        style={{ padding: '12px 30px', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}
                    >
                        {downloading ? 'Downloading...' : <><Download size={20} /> Download File</>}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default DropView;
