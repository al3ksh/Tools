import { Children, Fragment, isValidElement, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

function collectOptions(children, out = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) collectOptions(child.props.children, out);
    else if (child.type === 'option') {
      const label = Children.toArray(child.props.children).join('');
      out.push({ value: String(child.props.value ?? label), label, disabled: !!child.props.disabled });
    }
  });
  return out;
}

// Drop-in for <select>: takes <option> children and calls onChange with { target: { value } },
// but draws its own list so it matches the theme instead of the browser's native popup.
export default function Select({ value, onChange, children, className = '', style, disabled, ...rest }) {
  const options = collectOptions(children);
  const current = String(value);
  const selectedIndex = options.findIndex((o) => o.value === current);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selectedIndex);
  const [place, setPlace] = useState(null);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target) && !listRef.current?.contains(e.target)) setOpen(false);
    };
    const onScroll = (e) => { if (!listRef.current?.contains(e.target)) setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const openList = () => {
    const box = rootRef.current.getBoundingClientRect();
    const needed = Math.min(options.length * 36 + 10, 280);
    const below = window.innerHeight - box.bottom;
    const above = below < needed && box.top > below;
    setPlace({
      left: box.left,
      minWidth: box.width,
      ...(above ? { bottom: window.innerHeight - box.top + 6 } : { top: box.bottom + 6 }),
      maxHeight: Math.max(120, Math.min(280, (above ? box.top : below) - 12)),
    });
    setActive(selectedIndex < 0 ? 0 : selectedIndex);
    setOpen(true);
  };

  const choose = (index) => {
    const option = options[index];
    setOpen(false);
    if (!option || option.disabled) return;
    if (option.value !== current) onChange?.({ target: { value: option.value } });
  };

  const step = (from, delta) => {
    for (let i = from + delta; i >= 0 && i < options.length; i += delta) {
      if (!options[i].disabled) return i;
    }
    return from;
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openList();
      setActive((a) => step(a, e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Home' || e.key === 'End') {
      if (!open) return;
      e.preventDefault();
      setActive(e.key === 'Home' ? step(-1, 1) : step(options.length, -1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) choose(active);
      else openList();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      if (open && e.key === 'Escape') e.preventDefault();
      setOpen(false);
    } else if (e.key.length === 1) {
      const now = Date.now();
      typed.current.text = (now - typed.current.at > 600 ? '' : typed.current.text) + e.key.toLowerCase();
      typed.current.at = now;
      const match = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
      if (match < 0) return;
      if (open) setActive(match);
      else choose(match);
    }
  };

  return (
    <div ref={rootRef} className={`select${open ? ' open' : ''}`}>
      <button
        type="button"
        className={`${className} select-trigger`}
        style={style}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        {...rest}
      >
        <span className="select-value">{options[selectedIndex]?.label ?? ''}</span>
        <ChevronDown size={16} className="select-chevron" />
      </button>
      {open && place && createPortal(
        <ul ref={listRef} id={listId} role="listbox" className="select-menu" style={place}>
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === current}
              aria-disabled={o.disabled || undefined}
              className={`select-option${i === active ? ' active' : ''}${o.value === current ? ' selected' : ''}`}
              onPointerEnter={() => !o.disabled && setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              <span>{o.label}</span>
              {o.value === current && <Check size={14} />}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}
