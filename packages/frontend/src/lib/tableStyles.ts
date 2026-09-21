// Shared table cell styles for list pages. Eighteen-odd pages had
// byte-identical copies of these two constants defined locally —
// extracting them here makes a future tweak (padding, font, accent
// colour) a one-point change instead of a search-and-replace.
//
// Two surfaces deliberately don't use these: RaciMatrixPage
// (bordered matrix cells with different padding) and lib/markdown.tsx
// (rendered-markdown tables). Both have visually distinct table
// semantics and shouldn't be coerced into the list-table look.

import type { CSSProperties } from 'react';

// Row padding is intentionally tight (7px vertical) so list pages read at
// catalog density — more rows on screen without horizontal cramping (14px
// sides stay). The opt-in `data-density="compact"` mode drops the vertical
// padding further still (5–6px), so the cozy/compact toggle keeps a visible
// difference.
export const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '7px 14px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

export const tdStyle: CSSProperties = {
  padding: '7px 14px',
  fontSize: 13,
  borderTop: '1px solid var(--color-border)',
};
