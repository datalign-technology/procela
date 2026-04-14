import { useEffect } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// ShortcutsModal — opened with `?`. Documents the global keyboard
// shortcuts so users discover them. Add new entries here when wiring up
// new shortcuts in Layout.
// ──────────────────────────────────────────────────────────────────────────

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  shortcuts: Array<{ keys: string[]; description: string }>;
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
const MOD = isMac ? '\u2318' : 'Ctrl';

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    shortcuts: [
      { keys: [MOD, 'K'], description: 'Open quick search' },
      { keys: ['/'], description: 'Focus the search box' },
      { keys: ['?'], description: 'Show this shortcuts list' },
      { keys: ['Esc'], description: 'Close any open modal or dropdown' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['G', 'D'], description: 'Go to Dashboard' },
      { keys: ['G', 'O'], description: 'Go to Organizations' },
      { keys: ['G', 'P'], description: 'Go to People' },
      { keys: ['G', 'C'], description: 'Go to Process Catalog' },
      { keys: ['G', 'A'], description: 'Go to Data Assets' },
    ],
  },
  {
    title: 'Forms & Tables',
    shortcuts: [
      { keys: ['Enter'], description: 'Save / submit form' },
      { keys: ['Esc'], description: 'Cancel form / close dialog' },
      { keys: ['Click column'], description: 'Sort table by that column' },
    ],
  },
];

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  border: '1px solid var(--color-border)',
  borderBottomWidth: 2,
  borderRadius: 4,
  background: 'var(--color-bg)',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text)',
  minWidth: 22,
  textAlign: 'center',
};

export default function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          maxWidth: 560, width: '90vw', maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)' }}
          >
            &times;
          </button>
        </div>

        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} style={{ marginBottom: 18 }}>
            <h3 style={{
              fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
            }}>
              {group.title}
            </h3>
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {group.shortcuts.map((s, i) => (
                <li key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{s.description}</span>
                  <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    {s.keys.map((k, j) => (
                      <span key={j} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {j > 0 && <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>then</span>}
                        <kbd style={kbdStyle}>{k}</kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--color-border)', paddingTop: 12, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px',
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
