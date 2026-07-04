import { useEffect, useRef, useState } from 'react';

// Combobox — text input + clickable dropdown of suggested values.
// Behaves like a picklist you can also type into:
//
//   • Click the chevron (or focus the input) to open the list.
//   • Click a row to select it.
//   • Type to filter (case-insensitive substring).
//   • Arrow keys navigate the filtered rows; Enter selects; Esc closes.
//   • Anything you leave typed IS the value — free-form is a first-
//     class outcome, not a fallback.
//
// The datalist alternative works but has zero visual "this is a
// dropdown" affordance. Users kept treating it as a plain text
// field. This surfaces the picker explicitly with a chevron.

interface ComboboxProps {
  value: string;
  onChange: (next: string) => void;
  options: readonly string[];
  placeholder?: string;
  ariaLabel?: string;
  style?: React.CSSProperties;
}

export default function Combobox({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  style,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // Only filter while the user is actively typing (mode = 'search').
  // If the picker was opened by chevron / focus / arrow key with the
  // current stored value still in the input, show every option
  // (mode = 'browse'). Fixes: user has an old value in the field,
  // opens the picker to change it, sees only the stale value's
  // match, has to erase the input first to see anything else.
  const [mode, setMode] = useState<'browse' | 'search'>('browse');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = (mode === 'search' && value.trim())
    ? options.filter((o) => o.toLowerCase().includes(value.trim().toLowerCase()))
    : options;

  // Close on outside click. Click inside the input or the dropdown
  // shouldn't count.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Reset highlight when the filter set changes, so ArrowDown from
  // a stale index doesn't jump past the visible list.
  useEffect(() => {
    setHighlight(0);
  }, [value, options]);

  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[highlight]) {
        e.preventDefault();
        commit(filtered[highlight]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', ...style }}>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setMode('search'); setOpen(true); }}
        onFocus={() => { setMode('browse'); setOpen(true); }}
        onKeyDown={onKeyDown}
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 4,
          padding: '6px 32px 6px 10px', // right-pad so text clears the chevron
          fontSize: 13,
          width: '100%',
          background: 'var(--color-surface)',
          boxSizing: 'border-box',
        }}
      />
      <button
        type="button"
        aria-label={open ? 'Close options' : 'Open options'}
        onClick={() => {
          setMode('browse');
          setOpen((v) => !v);
          inputRef.current?.focus();
        }}
        style={{
          position: 'absolute',
          right: 4, top: '50%',
          transform: 'translateY(-50%)',
          background: 'transparent',
          border: 'none',
          padding: '4px 6px',
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        >
          <path d="M6 9 L12 15 L18 9" />
        </svg>
      </button>
      {open && filtered.length > 0 && (
        <ul
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0, right: 0,
            zIndex: 100,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            boxShadow: '0 6px 20px rgba(15, 23, 42, 0.08)',
            maxHeight: 220,
            overflowY: 'auto',
            listStyle: 'none',
            padding: 4,
            margin: 0,
            fontSize: 13,
          }}
        >
          {filtered.map((o, i) => (
            <li
              key={o}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => { e.preventDefault(); commit(o); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: '6px 10px',
                cursor: 'pointer',
                borderRadius: 3,
                background: i === highlight ? 'var(--color-primary-light)' : 'transparent',
                color: 'var(--color-text)',
              }}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
