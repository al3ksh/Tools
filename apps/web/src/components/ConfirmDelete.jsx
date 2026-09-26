import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

// A delete button that asks once: the first click arms it, a second click
// within a few seconds deletes. Waiting or focusing elsewhere disarms it.
export default function ConfirmDelete({ onConfirm, label = '', title = 'Delete', className = 'btn btn-danger btn-sm', style }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const disarm = () => {
    clearTimeout(timer.current);
    setArmed(false);
  };

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!armed) {
      setArmed(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    disarm();
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`${className}${armed ? ' confirm-armed' : ''}`}
      onClick={handleClick}
      onBlur={() => armed && disarm()}
      disabled={busy}
      title={armed ? 'Click again to delete' : title}
      aria-label={armed ? 'Confirm delete' : title}
      style={style}
    >
      <Trash2 size={14} />
      {armed ? 'Delete?' : label}
    </button>
  );
}
