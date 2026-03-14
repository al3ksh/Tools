import { useState, useRef } from 'react';
import { UploadCloud, File as FileIcon, X, CheckCircle } from 'lucide-react';
import { formatBytes } from '../api';

function FileUploader({ onFileSelect, maxSizeMB = 50, accept = "*", selectedFile = null, noLimit = false, multiple = false }) {
    const [isDragging, setIsDragging] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef(null);

    const selectedFiles = Array.isArray(selectedFile)
        ? selectedFile
        : selectedFile
            ? [selectedFile]
            : [];
    const hasFiles = selectedFiles.length > 0;

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

    const validateAndProcessFile = (files) => {
        setError('');
        const fileList = Array.isArray(files) ? files : files ? [files] : [];
        if (fileList.length === 0) return false;

        if (!noLimit) {
            const maxSize = maxSizeMB * 1024 * 1024;
            for (const file of fileList) {
                if (file.size > maxSize) {
                    setError(`File is too large. Maximum size is ${maxSizeMB}MB.`);
                    return false;
                }
            }
        }

        onFileSelect(multiple ? fileList : fileList[0]);
        return true;
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const droppedFiles = Array.from(e.dataTransfer.files);
            validateAndProcessFile(multiple ? droppedFiles : droppedFiles[0]);
            e.dataTransfer.clearData();
        }
    };

    const handleChange = (e) => {
        e.preventDefault();
        if (e.target.files && e.target.files.length > 0) {
            const selected = Array.from(e.target.files);
            validateAndProcessFile(multiple ? selected : selected[0]);
        }
    };

    const onButtonClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const clearFile = (e) => {
        e.stopPropagation(); // prevent triggering upload dialog
        onFileSelect(multiple ? [] : null);
        setError('');
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    return (
        <div style={{ width: '100%', marginBottom: '15px' }}>
            <div
                className={`dropzone ${isDragging ? 'dragging' : ''} ${hasFiles ? 'has-file' : ''}`}
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
                    multiple={multiple}
                    onChange={handleChange}
                    style={{ display: 'none' }}
                />

                {hasFiles ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                        <div style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <CheckCircle size={32} />
                        </div>
                        {multiple ? (
                            <>
                                <div style={{ fontWeight: '500', fontSize: '14px' }}>
                                    {selectedFiles.length} files selected
                                </div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '13px', maxHeight: '90px', overflowY: 'auto', width: '100%' }}>
                                    {selectedFiles.slice(0, 5).map((file, index) => (
                                        <div key={`${file.name}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                                            <span>{formatBytes(file.size)}</span>
                                        </div>
                                    ))}
                                    {selectedFiles.length > 5 && <div>... and {selectedFiles.length - 5} more</div>}
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={{ fontWeight: '500', fontSize: '14px', wordBreak: 'break-all' }}>
                                    {selectedFiles[0].name}
                                </div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                                    {formatBytes(selectedFiles[0].size)}
                                </div>
                            </>
                        )}
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
                            {isDragging ? (multiple ? 'Drop files here' : 'Drop file here') : (multiple ? 'Drag & drop files here' : 'Drag & drop a file here')}
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
