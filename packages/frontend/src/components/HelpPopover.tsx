import { useState, useEffect } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// HelpPopover — small `?` chip with a popover. Used inline next to a
// feature to explain it on the spot, instead of sending users to a
// separate /help page. Persists "dismissed" state per `id` in
// localStorage so users only see the first-run hint once.
//
//   <HelpPopover id="dq-templates" title="Out-of-the-box rules">
//     Pick from common quality checks (uniqueness, regex, range, ...) and
//     run them against the column you select.
//   </HelpPopover>
// ──────────────────────────────────────────────────────────────────────────

interface HelpPopoverProps {
  id: string;             // dismissal key in localStorage
  title?: string;
  children: React.ReactNode;
  showInitially?: boolean;  // if true and not dismissed yet, auto-open on mount
}

const STORAGE_KEY = 'procela:help-dismissed';

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function persistDismissed(set: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch { /* */ }
}

export default function HelpPopover({ id, title, children, showInitially = false }: HelpPopoverProps) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(true);  // assume dismissed until we read storage

  useEffect(() => {
    const set = readDismissed();
    const isDismissed = set.has(id);
    setDismissed(isDismissed);
    if (showInitially && !isDismissed) setOpen(true);
  }, [id, showInitially]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const dismiss = () => {
    const set = readDismissed();
    set.add(id);
    persistDismissed(set);
    setDismissed(true);
    setOpen(false);
  };

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Help: ${title || id}`}
        style={{
          width: 16, height: 16, borderRadius: '50%',
          border: `1px solid ${dismissed ? 'var(--color-text-muted)' : 'var(--color-primary)'}`,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 600,
          color: dismissed ? 'var(--color-text-muted)' : 'var(--color-primary)',
          background: dismissed ? 'transparent' : 'var(--color-primary-light)',
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        ?
      </button>
      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: '50%',
            transform: 'translateX(-50%)',
            width: 280, zIndex: 950,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: 12,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {title && <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{title}</div>}
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
            {children}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <button
              onClick={dismiss}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--color-text-muted)', padding: 0 }}
            >
              Don't show again
            </button>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 4 }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
