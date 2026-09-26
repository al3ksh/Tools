import { useState, useRef } from 'react';
import { UploadCloud, File as FileIcon, Files, X } from 'lucide-react';
import { formatBytes } from '../api';

function FileUploader({ onFileSelect, maxSizeMB = 50, accept = "*", selectedFile = null, noLimit = false, multiple = false, disabled = false }) {
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
        if (disabled) return;
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
        if (disabled) return;

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const droppedFiles = Array.from(e.dataTransfer.files);
            validateAndProcessFile(multiple ? droppedFiles : droppedFiles[0]);
            e.dataTransfer.clearData();
        }
    };

    const handleChange = (e) => {
        e.preventDefault();
        if (disabled) return;
        if (e.target.files && e.target.files.length > 0) {
            const selected = Array.from(e.target.files);
            validateAndProcessFile(multiple ? selected : selected[0]);
        }
    };

    const onButtonClick = () => {
        if (disabled) return;
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const clearFile = (e) => {
        e.stopPropagation(); // prevent triggering upload dialog
        if (disabled) return;
        onFileSelect(multiple ? [] : null);
        setError('');
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const dropHandlers = {
        onDragEnter: handleDragIn,
        onDragLeave: handleDragOut,
        onDragOver: handleDrag,
        onDrop: handleDrop,
    };
    const onKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onButtonClick();
        }
    };

    // Kadron's DropZone: a large dashed target; once a file is chosen it
    // collapses into a file row that still accepts a drop to replace it.
    return (
        <div className="uploader">
            <input
                ref={fileInputRef}
                type="file"
                accept={accept}
                multiple={multiple}
                onChange={handleChange}
                disabled={disabled}
                style={{ display: 'none' }}
            />

            {hasFiles ? (
                <div className={`file-row${isDragging ? ' dragging' : ''}`} {...dropHandlers}>
                    <span className="file-row-icon">{multiple ? <Files size={18} /> : <FileIcon size={18} />}</span>
                    <div className="file-row-main">
                        <div className="file-row-name" title={multiple ? undefined : selectedFiles[0].name}>
                            {isDragging ? 'Drop to replace' : multiple ? `${selectedFiles.length} files selected` : selectedFiles[0].name}
                        </div>
                        {multiple ? (
                            <div className="file-row-list">
                                {selectedFiles.slice(0, 5).map((file, index) => (
                                    <span key={`${file.name}-${index}`}>{file.name} · {formatBytes(file.size)}</span>
                                ))}
                                {selectedFiles.length > 5 && <span>and {selectedFiles.length - 5} more</span>}
                            </div>
                        ) : (
                            <div className="file-row-meta">{formatBytes(selectedFiles[0].size)}</div>
                        )}
                    </div>
                    <button type="button" className="file-row-action" onClick={onButtonClick} disabled={disabled}>
                        Change
                    </button>
                    <button type="button" className="file-row-clear" onClick={clearFile} disabled={disabled} aria-label="Remove file" title="Remove">
                        <X size={16} />
                    </button>
                </div>
            ) : (
                <div
                    className={`dropzone${isDragging ? ' dragging' : ''}${disabled ? ' disabled' : ''}`}
                    {...dropHandlers}
                    onClick={onButtonClick}
                    onKeyDown={onKeyDown}
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                >
                    <span className="dropzone-icon"><UploadCloud size={26} /></span>
                    <div className="dropzone-title">
                        {isDragging ? (multiple ? 'Drop the files' : 'Drop the file') : (multiple ? 'Drop files here' : 'Drop a file here')}
                    </div>
                    <div className="dropzone-sub">or click to browse</div>
                    {error && <div className="dropzone-error">{error}</div>}
                </div>
            )}
            {hasFiles && error && <div className="dropzone-error">{error}</div>}
        </div>
    );
}

export default FileUploader;
