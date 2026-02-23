import { useState, useRef } from 'react';
import { UploadCloud, File as FileIcon, X, CheckCircle } from 'lucide-react';
import { formatBytes } from '../api';

function FileUploader({ onFileSelect, maxSizeMB = 50, accept = "*", selectedFile = null, noLimit = false }) {
    const [isDragging, setIsDragging] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef(null);

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDragIn = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            setIsDragging(true);
        }
    };

    const handleDragOut = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const validateAndProcessFile = (file) => {
        setError('');
        if (!file) return false;

        // Check size (skip for admin/noLimit)
        if (!noLimit) {
            const maxSize = maxSizeMB * 1024 * 1024;
            if (file.size > maxSize) {
                setError(`File is too large. Maximum size is ${maxSizeMB}MB.`);
                return false;
            }
        }

        onFileSelect(file);
        return true;
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            validateAndProcessFile(e.dataTransfer.files[0]);
            e.dataTransfer.clearData();
        }
    };

    const handleChange = (e) => {
        e.preventDefault();
        if (e.target.files && e.target.files.length > 0) {
            validateAndProcessFile(e.target.files[0]);
        }
    };

    const onButtonClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const clearFile = (e) => {
        e.stopPropagation(); // prevent triggering upload dialog
        onFileSelect(null);
        setError('');
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    return (
        <div style={{ width: '100%', marginBottom: '15px' }}>
            <div
                className={`dropzone ${isDragging ? 'dragging' : ''} ${selectedFile ? 'has-file' : ''}`}
                onDragEnter={handleDragIn}
                onDragLeave={handleDragOut}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={onButtonClick}
                style={{
                    border: `2px dashed ${isDragging ? 'var(--accent)' : selectedFile ? 'var(--success)' : 'var(--border)'}`,
                    borderRadius: '8px',
                    padding: '30px 20px',
                    textAlign: 'center',
                    backgroundColor: isDragging ? 'rgba(44, 147, 250, 0.05)' : 'var(--bg-primary)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    position: 'relative'
                }}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={accept}
                    onChange={handleChange}
                    style={{ display: 'none' }}
                />

                {selectedFile ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                        <div style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <CheckCircle size={32} />
                        </div>
                        <div style={{ fontWeight: '500', fontSize: '14px', wordBreak: 'break-all' }}>
                            {selectedFile.name}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                            {formatBytes(selectedFile.size)}
                        </div>
                        <button
                            type="button"
                            onClick={clearFile}
                            className="btn btn-secondary btn-sm"
                            style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '5px' }}
                        >
                            <X size={14} /> Remove File
                        </button>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)' }}>
                        <UploadCloud size={48} style={{ color: isDragging ? 'var(--accent)' : 'var(--text-secondary)' }} />
                        <div style={{ fontSize: '15px', fontWeight: '500', color: isDragging ? 'var(--accent)' : 'var(--text-primary)' }}>
                            {isDragging ? 'Drop file here' : 'Drag & drop a file here'}
                        </div>
                        <div style={{ fontSize: '13px' }}>
                            or click to browse from your computer
                        </div>
                        {error && (
                            <div style={{ color: 'var(--error)', marginTop: '10px', fontSize: '13px' }}>
                                {error}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default FileUploader;
