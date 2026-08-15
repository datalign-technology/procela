import { useEffect, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// ShortcutsHint — first-run nudge telling users about keyboard shortcuts.
// Dismissed permanently via localStorage after the first close. Appears
// bottom-left (doesn't collide with the toast stack bottom-right).
// ──────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'procela:shortcuts-hint-dismissed';

interface ShortcutsHintProps {
  onOpenShortcuts: () => void;
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

export default function ShortcutsHint({ onOpenShortcuts }: ShortcutsHintProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let dismissed = true;
    try { dismissed = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* */ }
    if (!dismissed) {
      // Delay a beat so the hint doesn't land on top of an in-progress
      // first render — lets the app settle first.
      const t = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(t);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* */ }
    setVisible(false);
  };

  return (
    <div
      role="complementary"
      aria-label="Keyboard shortcuts hint"
      className="no-print"
      style={{
        position: 'fixed', bottom: 20, left: 20, zIndex: 850,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        background: '#0f172a', color: '#fff',
        borderRadius: 8,
        boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
        fontSize: 12, maxWidth: 320,
        animation: 'scut-slide 0.25s ease-out',
      }}
    >
      <span>
        Press{' '}
        <kbd style={{
          display: 'inline-block', padding: '1px 7px',
          background: '#1e293b', border: '1px solid #334155',
          borderRadius: 3, fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          fontSize: 11, color: '#e2e8f0', fontWeight: 600,
        }}>?</kbd>
        {' '}anywhere for shortcuts, or{' '}
        <kbd style={{
          display: 'inline-block', padding: '1px 7px',
          background: '#1e293b', border: '1px solid #334155',
          borderRadius: 3, fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          fontSize: 11, color: '#e2e8f0', fontWeight: 600,
        }}>{isMac ? '\u2318K' : 'Ctrl K'}</kbd>
        {' '}to search.
      </span>
      <button
        onClick={() => { onOpenShortcuts(); dismiss(); }}
        style={{
          background: '#1e293b', border: 'none', color: '#e2e8f0',
          cursor: 'pointer', fontSize: 11, padding: '4px 8px', borderRadius: 4,
          flexShrink: 0,
        }}
      >
        Show all
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss keyboard shortcuts hint"
        style={{
          background: 'transparent', border: 'none', color: '#94a3b8',
          cursor: 'pointer', fontSize: 14, padding: '0 4px', flexShrink: 0, lineHeight: 1,
        }}
      ><span aria-hidden="true">&times;</span></button>
      <style>{`
        @keyframes scut-slide {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
