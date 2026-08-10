import type { CSSProperties, ReactNode } from 'react';

// ── FieldStack — the vertical-rhythm primitive ──────────────────────
//
// A flex column that owns the spacing between its children so pages
// don't hand-roll per-field `marginTop` / `marginBottom` (which drift
// apart and make the gap between fields jump around depending on which
// fields happen to render). Compose this instead:
//
//   <FieldStack>                      {/* field rhythm — form/detail rows */}
//     <DocField … />
//     <DocRoleField … />
//     <DocSystemsField … />
//   </FieldStack>
//
//   <FieldStack gap="section">        {/* section rhythm — stacked panels */}
//     <FieldStack>{/* the fields */}</FieldStack>
//     <IOPanel … />
//     <DependenciesPanel … />
//   </FieldStack>
//
// The gap comes from a single spacing token (--space-*), so every
// stack on every page reads the same rhythm. Children must NOT add
// their own vertical margins — the stack owns that axis. If a child
// needs to sit tighter/looser, it belongs in a different gap tier, not
// an ad-hoc margin.

export type FieldStackGap = 'tight' | 'field' | 'section';

const GAP_TOKEN: Record<FieldStackGap, string> = {
  tight: 'var(--space-tight)',
  field: 'var(--space-field)',
  section: 'var(--space-section)',
};

export default function FieldStack({
  gap = 'field',
  children,
  style,
  className,
}: {
  /** Vertical rhythm tier. Defaults to `field` (form/detail rows). */
  gap?: FieldStackGap;
  children: ReactNode;
  /** Escape hatch for layout that isn't spacing — e.g. `marginTop`,
   *  `paddingLeft`. Do not set `gap` here; use the `gap` prop. */
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: GAP_TOKEN[gap], ...style }}
    >
      {children}
    </div>
  );
}
