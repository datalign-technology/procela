import type { ReactNode } from 'react';
import SectionLabel from './SectionLabel';

// ──────────────────────────────────────────────────────────────────────────
// AttentionCards — the "Needs attention" tile strip: a row of count cards
// that each double as a one-click action (toggle a list filter, or jump to a
// related view). The pattern recurred across the registry pages (Data Assets,
// Data Domains, Data Quality, Process↔Data map) with hand-rolled, drifting
// copies; this is the one source of truth.
//
//   <AttentionCards
//     caption="Click a card to filter the list"
//     cards={[
//       { key: 'unmapped', count: 4, label: 'Unmapped',
//         hint: 'Not linked to a process step', priority: true,
//         active: filter === 'unmapped', onClick: () => toggle('unmapped') },
//       { key: 'noDomain', count: 2, label: 'Assets in no domain',
//         hint: 'Opens Data Assets → Unassigned',
//         onClick: () => navigate('/data-assets?attention=noDomain') },
//     ]}
//   />
//
// A card is a *filter* when `active` is a boolean (it renders aria-pressed and,
// when its count is 0 and it isn't the active filter, goes disabled so you
// can't select an empty bucket). A card is a *link* when `active` is left
// undefined (always clickable — the count is informational and the click
// navigates elsewhere). `priority` adds the amber "Fix first" tag when the
// count is non-zero — reserve it for the gaps that make a row untrustworthy
// outright (no owner, no mapping). `tag` overrides that label for a softer
// worklist (e.g. 'Review'). `loading` renders the count as "—" and disables
// the card while its (best-effort) source is still resolving — distinct from
// a real 0.
// ──────────────────────────────────────────────────────────────────────────

export interface AttentionCard {
  /** Stable identity for the card (also the React key). */
  key: string;
  count: number;
  label: string;
  /** One-line explanation under the label (also the title tooltip). */
  hint: string;
  /** Lead with the amber "Fix first" tag when count > 0. */
  priority?: boolean;
  /** Amber tag label shown when count > 0. Overrides the `priority`
   *  "Fix first" default — e.g. pass 'Review' for a soft worklist. */
  tag?: string;
  /** Filter cards pass their selected state here; link cards leave it unset. */
  active?: boolean;
  /** Force-disable regardless of the derived rule. */
  disabled?: boolean;
  /** Data for this card isn't available yet: render the count as "—",
   *  suppress the tag, and disable the card (distinct from a real 0). */
  loading?: boolean;
  onClick: () => void;
}

interface AttentionCardsProps {
  cards: AttentionCard[];
  /** Section heading. Defaults to "Needs attention". */
  title?: string;
  /** Muted text aligned to the right of the heading. */
  caption?: ReactNode;
  /** Minimum tile width; tiles pack left with auto-fill. Defaults to 170. */
  minCardWidth?: number;
}

export default function AttentionCards({ cards, title = 'Needs attention', caption, minCardWidth = 170 }: AttentionCardsProps) {
  if (cards.length === 0) return null;
  return (
    <section aria-label={title} style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <SectionLabel marginBottom={0}>{title}</SectionLabel>
        {caption && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{caption}</span>}
      </div>
      {/* auto-fill (not auto-fit) so a short card set stays tile-sized and
          left-aligned instead of ballooning to full width. */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${minCardWidth}px, 1fr))`, gap: 10 }}>
        {cards.map((c) => {
          const isFilter = typeof c.active === 'boolean';
          const zero = c.count === 0;
          const loading = c.loading ?? false;
          const disabled = c.disabled ?? (loading || (isFilter && zero && !c.active));
          const tagLabel = c.tag ?? (c.priority ? 'Fix first' : undefined);
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={isFilter ? c.active : undefined}
              disabled={disabled}
              onClick={c.onClick}
              style={{
                textAlign: 'left', cursor: disabled ? 'default' : 'pointer',
                borderRadius: 'var(--radius-md)', padding: '12px 14px',
                display: 'flex', flexDirection: 'column', gap: 3, minHeight: 82,
                background: c.active ? 'var(--color-primary-light)' : 'var(--color-surface)',
                border: `1px solid ${c.active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                boxShadow: c.active ? '0 0 0 1px var(--color-primary)' : 'var(--shadow-sm)',
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: (loading || zero) ? 'var(--color-text-muted)' : 'var(--color-text)' }}>{loading ? '—' : c.count}</span>
                {tagLabel && !loading && c.count > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', color: 'var(--color-warning)' }}>{tagLabel}</span>
                )}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{c.label}</span>
              <span className="na-card-hint" title={c.hint}>{c.hint}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
