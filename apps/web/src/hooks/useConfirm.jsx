import { useState, useCallback, useRef, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

function useConfirm() {
  const [confirmState, setConfirmState] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((message) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setConfirmState({ message });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setConfirmState(null);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setConfirmState(null);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') handleCancel();
  }, [handleCancel]);

  useEffect(() => {
    if (confirmState) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [confirmState, handleKeyDown]);

  const ConfirmDialog = confirmState ? (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px' }}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={18} style={{ color: 'var(--warning)' }} />
            Confirm
          </h3>
          <button className="btn-icon" onClick={handleCancel}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.5' }}>
            {confirmState.message}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
            <button className="btn btn-primary" onClick={handleConfirm}>Delete</button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return [confirm, ConfirmDialog];
}

export default useConfirm;
