import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';

// ──────────────────────────────────────────────────────────────────────────
// Modal — centered overlay used for rich content (Data Asset 360, System
// detail, version history, attachments form). Sibling to <DetailDrawer>
// for the side-panel pattern; sibling to <ConfirmDialog> for the
// simple yes/no prompt. Replaces the recurring
//   <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
//                 display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={close}>
//     <div onClick={stop} style={{ maxWidth: 700, width: '90vw', maxHeight: '80vh', … }}>
// pattern that drifted into different paddings, close-button glyphs and
// border-radius values across the app.
//
// Size presets keep the API simple:
//   sm  480px   small forms (add attachment, new comment)
//   md  600px   read-only detail (version snapshot, asset summary)
//   lg  720px   rich detail (system 360, asset 360)
//
// Usage:
//   <Modal
//     open={open}
//     onClose={close}
//     title="Customer accounts"
//     kicker="DATA ASSET"
//     subtitle="Salesforce · updated 2h ago"
//     size="lg"
//     actions={<button>Edit</button>}
//     footer={<button onClick={save}>Save</button>}
//   >
//     …body…
//   </Modal>
// ──────────────────────────────────────────────────────────────────────────

const SIZE_MAP = { sm: 480, md: 600, lg: 720 } as const;

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Small uppercase label above the title, e.g. "DATA ASSET". */
  kicker?: string;
  /** Sub-line under the title (description, meta). */
  subtitle?: ReactNode;
  /** Right-aligned header controls (badges, Edit button) sitting next to
   *  the close button. */
  actions?: ReactNode;
  /** Sticky footer (Save / Cancel). Omit for read-only modals. */
  footer?: ReactNode;
  /** Width preset. Defaults to "md" (600px). */
  size?: 'sm' | 'md' | 'lg';
  /** Accessible label override. Defaults to the title when it's a string. */
  ariaLabel?: string;
  children: ReactNode;
}

export default function Modal({
  open,
  onClose,
  title,
  kicker,
  subtitle,
  actions,
  footer,
  size = 'md',
  ariaLabel,
  children,
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const label = ariaLabel || (typeof title === 'string' ? title : 'Dialog');
  const width = SIZE_MAP[size];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          width: `min(${width}px, 100%)`,
          maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(15, 23, 42, 0.35)',
          overflow: 'hidden',
        }}
      >
        <header style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
          flexShrink: 0,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {kicker && (
              <div style={{
                fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
              }}>
                {kicker}
              </div>
            )}
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>
              {title}
            </h2>
            {subtitle && (
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
                {subtitle}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {actions}
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--color-text-muted)', padding: 4, lineHeight: 0,
                display: 'inline-flex', borderRadius: 'var(--radius-sm)',
              }}
            >
              <X size={18} strokeWidth={2.2} />
            </button>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {children}
        </div>

        {footer && (
          <div style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--color-border)',
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            background: 'var(--color-bg)',
            flexShrink: 0,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
