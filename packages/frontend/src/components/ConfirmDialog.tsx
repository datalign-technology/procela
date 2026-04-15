import { useEffect, useRef, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// ConfirmDialog — standard Yes/No confirmation. Two hardening features
// on top of the basic dialog:
//
// 1. `requireTypedConfirmation`: forces the user to type a specific phrase
//    before the confirm button enables. Use this for "Delete all" and
//    other irreversible bulk operations — the small friction stops a
//    mis-click from wiping everything.
//
// 2. Focus trap: Tab/Shift-Tab cycles inside the dialog, so keyboard users
//    can't accidentally tab out into the page behind.
//
// Esc cancels, Enter confirms (Enter is suppressed while typed-confirm is
// armed but not yet matched, so you can't fat-finger your way past it).
// ──────────────────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'primary';
  requireTypedConfirmation?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  variant = 'danger',
  requireTypedConfirmation = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');

  const canConfirm = !requireTypedConfirmation || typed === requireTypedConfirmation;

  useEffect(() => {
    if (!open) return;
    // Reset the typed input each time the dialog opens.
    setTyped('');
    // Focus the input (typed-confirm mode) or the Cancel button (default)
    // so keyboard users start somewhere predictable.
    const t = setTimeout(() => {
      if (requireTypedConfirmation) confirmInputRef.current?.focus();
      else cancelBtnRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open, requireTypedConfirmation]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
      if (e.key === 'Enter') {
        // Don't allow Enter to race past a typed-confirm that hasn't matched.
        if (canConfirm) onConfirm();
        return;
      }
      if (e.key === 'Tab') {
        // Focus trap: cycle within the dialog.
        const root = dialogRef.current;
        if (!root) return;
        const focusable = root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onCancel, onConfirm, canConfirm]);

  if (!open) return null;

  const confirmBg = variant === 'danger' ? '#dc2626' : 'var(--color-primary)';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.5)',
      }}
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        style={{
          background: '#fff',
          borderRadius: '12px',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.15)',
          padding: '24px',
          maxWidth: '460px',
          width: '100%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="confirm-dialog-title"
          style={{
            margin: '0 0 8px 0',
            fontSize: '1.125rem',
            fontWeight: 600,
            color: '#111827',
          }}
        >
          {title}
        </h3>
        <p
          style={{
            margin: '0 0 16px 0',
            fontSize: '0.875rem',
            color: '#6b7280',
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>
        {requireTypedConfirmation && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: '0.8125rem', color: '#374151', marginBottom: 6 }}>
              Type <code style={{ background: '#fef2f2', color: '#991b1b', padding: '1px 6px', borderRadius: 3, fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontWeight: 600 }}>
                {requireTypedConfirmation}
              </code> to confirm:
            </label>
            <input
              ref={confirmInputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: 13,
                border: `1px solid ${canConfirm ? '#16a34a' : '#d1d5db'}`,
                borderRadius: 6,
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              }}
            />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            ref={cancelBtnRef}
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              fontSize: '0.875rem',
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              color: '#374151',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            style={{
              padding: '8px 16px',
              fontSize: '0.875rem',
              background: canConfirm ? confirmBg : '#e5e7eb',
              border: 'none',
              borderRadius: '6px',
              color: canConfirm ? '#fff' : '#9ca3af',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontWeight: 500,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
