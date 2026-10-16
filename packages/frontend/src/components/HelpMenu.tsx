import { useEffect, useRef, useState } from 'react';
import { renderNavIcon } from './navIcons';
import { openHelpWindow, openTrainingWindow, openRoadmapWindow } from './navConfig';

// ──────────────────────────────────────────────────────────────────────────
// HelpMenu — the single top-bar "help and support" affordance. Replaces the
// two separate top-bar buttons (Help, Report a problem) with one icon button
// that opens a dropdown gathering every support surface in one place:
//
//   • Help guide         — openHelpWindow() (popup, keeps your view)
//   • Training course    — openTrainingWindow() (generated PDF)
//   • What's new & roadmap — openRoadmapWindow()
//   • Keyboard shortcuts — procela:open-shortcuts (Layout owns the modal)
//   • Replay the intro tour — procela:start-tour (Layout owns the wizard)
//   • Report a problem   — onReportProblem() (Layout owns the SupportModal)
//
// Dismissal (click-outside / Escape) mirrors UserMenu + NotificationsMenu so
// the chrome reads consistent across the three top-bar popovers.
// ──────────────────────────────────────────────────────────────────────────

interface HelpMenuProps {
  /** Opens the in-app "Report a problem" support form (owned by Layout). */
  onReportProblem: () => void;
}

export default function HelpMenu({ onReportProblem }: HelpMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  const run = (fn: () => void) => () => { close(); fn(); };

  const itemStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 2,
    width: '100%', textAlign: 'left',
    padding: '8px 10px', fontSize: 13, color: 'var(--color-text)',
    background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
  };
  const hover = (on: boolean) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = on ? 'var(--color-bg)' : 'transparent';
  };
  const sub: React.CSSProperties = { fontSize: 11, color: 'var(--color-text-muted)' };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Help and support"
        title="Help and support"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 36, height: 36, borderRadius: 'var(--radius-md)',
          background: open ? 'var(--color-bg)' : 'transparent',
          border: '1px solid ' + (open ? 'var(--color-border)' : 'transparent'),
          color: 'var(--color-text)', cursor: 'pointer', transition: 'background 0.15s',
        }}
      >
        {renderNavIcon('/help', { size: 18, strokeWidth: 1.9 })}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Help and support"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            minWidth: 280,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))',
            zIndex: 50, padding: 6,
          }}
        >
          <button type="button" role="menuitem" style={itemStyle} onMouseEnter={hover(true)} onMouseLeave={hover(false)} onClick={run(openHelpWindow)}>
            <span style={{ fontWeight: 600 }}>Help guide</span>
            <span style={sub}>How each page works</span>
          </button>
          <button type="button" role="menuitem" style={itemStyle} onMouseEnter={hover(true)} onMouseLeave={hover(false)} onClick={run(openTrainingWindow)}>
            <span style={{ fontWeight: 600 }}>Training course</span>
            <span style={sub}>Hands-on lessons, about 90 minutes</span>
          </button>
          <button type="button" role="menuitem" style={itemStyle} onMouseEnter={hover(true)} onMouseLeave={hover(false)} onClick={run(openRoadmapWindow)}>
            <span style={{ fontWeight: 600 }}>What&rsquo;s new and roadmap</span>
          </button>
          <button
            type="button" role="menuitem"
            style={{ ...itemStyle, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            onMouseEnter={hover(true)} onMouseLeave={hover(false)}
            onClick={run(() => window.dispatchEvent(new Event('procela:open-shortcuts')))}
          >
            <span style={{ fontWeight: 600 }}>Keyboard shortcuts</span>
            <kbd style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '0 6px' }}>?</kbd>
          </button>
          <button type="button" role="menuitem" style={itemStyle} onMouseEnter={hover(true)} onMouseLeave={hover(false)} onClick={run(() => window.dispatchEvent(new Event('procela:start-tour')))}>
            <span style={{ fontWeight: 600 }}>Replay the intro tour</span>
          </button>
          <div style={{ height: 1, background: 'var(--color-border)', margin: '6px 4px' }} />
          <button type="button" role="menuitem" style={{ ...itemStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }} onMouseEnter={hover(true)} onMouseLeave={hover(false)} onClick={run(onReportProblem)}>
            <span style={{ fontWeight: 600 }}>Report a problem</span>
          </button>
        </div>
      )}
    </div>
  );
}
