import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';

// ──────────────────────────────────────────────────────────────────────────
// DetailDrawer — the shared right-side slide-in panel used to inspect a
// row/entity without leaving the page (drill-downs, role details, asset
// metadata, agent runs). Replaces the bespoke <aside style={{ position:
// 'fixed', right: 0, … }}> blocks that drifted into different widths,
// header styles, scrim opacities and close-button shapes across the app.
//
// Modes:
//   modal   — scrim + click-outside + Escape close (default; matches the
//             RoleDetailDrawer pattern, used when the drawer is the user's
//             primary focus).
//   panel   — no scrim, content stays interactive behind the drawer
//             (matches the AnalysisPage drill-down, used when the user
//             still wants to scan the parent surface while exploring).
//
// Usage:
//   <DetailDrawer
//     open={open}
//     onClose={close}
//     title="Customer 360"
//     subtitle="Salesforce · Updated 2h ago"
//     kicker="DATA ASSET"
//     actions={<button>Edit</button>}
//     footer={<button onClick={save}>Save</button>}
//     mode="modal"
//     width={520}
//   >
//     ...body…
//   </DetailDrawer>
// ──────────────────────────────────────────────────────────────────────────

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Small uppercase label above the title, e.g. "DRILL-DOWN", "ROLE". */
  kicker?: string;
  /** Sub-line under the title (description, meta). */
  subtitle?: ReactNode;
  /** Right-aligned header controls (badges, Edit button) sitting next to
   *  the close button. */
  actions?: ReactNode;
  /** Sticky footer (Save / Cancel). Omit for read-only drawers. */
  footer?: ReactNode;
  /** Width in pixels (clamped by `min(width, 95vw)`). Defaults to 480. */
  width?: number;
  /** modal (default) = scrim + click-outside close. panel = no scrim. */
  mode?: 'modal' | 'panel';
  /** Accessible label override. Defaults to the title when it's a string. */
  ariaLabel?: string;
  children: ReactNode;
}

export default function DetailDrawer({
  open,
  onClose,
  title,
  kicker,
  subtitle,
  actions,
  footer,
  width = 480,
  mode = 'modal',
  ariaLabel,
  children,
}: DetailDrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);

  // Escape-to-close in both modes; the panel mode loses click-outside but
  // keeps the keyboard exit so users aren't trapped.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const label = ariaLabel || (typeof title === 'string' ? title : 'Details');

  return (
    <>
      {mode === 'modal' && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15, 23, 42, 0.35)',
            zIndex: 200,
          }}
        />
      )}
      <aside
        ref={ref}
        role="dialog"
        aria-modal={mode === 'modal'}
        aria-label={label}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: `min(${width}px, 95vw)`,
          background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-4px 0 24px rgba(15, 23, 42, 0.18)',
          zIndex: 201,
          display: 'flex', flexDirection: 'column',
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
      </aside>
    </>
  );
}
