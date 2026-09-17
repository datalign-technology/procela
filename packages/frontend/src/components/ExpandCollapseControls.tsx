import type { CSSProperties } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// ExpandCollapseControls — the standard "Expand All" / "Collapse All" pair
// for a list/tree toolbar. Borderless primary-text buttons: the style the
// Process Catalog, Organizations, Governance Groups and Agents toolbars
// already used. Composed everywhere those controls appear so the affordance
// reads identically across pages (was hand-rolled per page — some as bordered
// <Button>s, some as a dot-separated text pair, one as a single toggle).
// ──────────────────────────────────────────────────────────────────────────

interface ExpandCollapseControlsProps {
  onExpandAll: () => void;
  onCollapseAll: () => void;
  /** Match the surrounding toolbar's text size (default 12). */
  size?: number;
  disabled?: boolean;
}

export default function ExpandCollapseControls({
  onExpandAll,
  onCollapseAll,
  size = 12,
  disabled = false,
}: ExpandCollapseControlsProps) {
  const btn: CSSProperties = {
    background: 'none',
    border: 'none',
    padding: '2px 4px',
    color: disabled ? 'var(--color-text-muted)' : 'var(--color-primary)',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: size,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  };
  return (
    <>
      <button type="button" style={btn} onClick={onExpandAll} disabled={disabled}>Expand All</button>
      <button type="button" style={btn} onClick={onCollapseAll} disabled={disabled}>Collapse All</button>
    </>
  );
}
