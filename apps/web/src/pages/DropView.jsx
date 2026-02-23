import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, FileBox, AlertCircle, ArrowLeft, File as FileIcon } from 'lucide-react';
import { api, getDropUrl, formatBytes, formatDate } from '../api';

function DropView() {
    const { token } = useParams();
    const [info, setInfo] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

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

    return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '30px 20px', width: '100%' }}>
            <div className="card" style={{ maxWidth: '600px', width: '100%' }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileBox size={20} /> Shared File
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
                        border: '1px solid var(--border)'
                    }}>
                        {isImage ? (
                            <img src={getDropUrl(info.token)} alt={info.filename} style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain' }} />
                        ) : isVideo ? (
                            <video src={getDropUrl(info.token)} controls style={{ maxWidth: '100%', maxHeight: '400px' }} />
                        ) : isAudio ? (
                            <audio src={getDropUrl(info.token)} controls style={{ width: '90%' }} />
                        ) : (
                            <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                                <FileIcon size={64} style={{ margin: '0 auto 10px' }} />
                                <div>Preview not available</div>
                            </div>
                        )}
                    </div>

                    <h2 style={{ marginBottom: '10px', wordBreak: 'break-all', textAlign: 'center' }}>{info.filename}</h2>

                    <div style={{ display: 'flex', gap: '15px', color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '30px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <span>Size: <strong style={{ color: 'var(--text-primary)' }}>{formatBytes(info.size)}</strong></span>
                        <span>•</span>
                        <span>Uploaded: <strong style={{ color: 'var(--text-primary)' }}>{formatDate(info.createdAt)}</strong></span>
                        <span>•</span>
                        <span>Downloads: <strong style={{ color: 'var(--text-primary)' }}>{info.downloads}</strong></span>
                    </div>

                    <a href={getDropUrl(info.token)} download={info.filename} className="btn btn-success" style={{ padding: '12px 30px', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Download size={20} /> Download File
                    </a>
                </div>
            </div>
        </div>
    );
}

export default DropView;
