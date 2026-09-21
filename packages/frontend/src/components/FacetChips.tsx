// ──────────────────────────────────────────────────────────────────────────
// FacetChips — the shared "type filter" chip row used across the entity-list
// pages (Data Assets classification/origin, Decision Rights categories,
// Glossary categories, Systems/Connections types).
//
// Six pages hand-rolled a byte-identical version of this strip. Two things
// they all did — dropping any chip whose count was 0, and hiding the whole
// row unless ≥2 populated values remained — fought the catalog convention
// this consolidates toward: show the *whole* taxonomy, including the types
// you have none of, so the set of possible types reads at a glance (the way
// a catalog lists "Tables 12 · Views 0 · Functions 3"). A zero-count chip
// renders muted but present, and stays clickable — selecting it just shows
// the (empty) filtered list.
//
// The caller owns which facets exist and the count for each (it knows the
// taxonomy and the data); FacetChips only renders. A fixed-taxonomy caller
// passes every value including the zero ones; a data-derived caller passes
// only the values present, and simply never has a zero to dim.
// ──────────────────────────────────────────────────────────────────────────

export interface FacetChip {
  /** Filter value this chip selects; the "All" chip typically uses '' or 'ALL'. */
  key: string;
  label: string;
  count: number;
  /** Optional tooltip on hover. */
  hint?: string;
  /** Optional leading colour dot (e.g. Glossary category colours). */
  dot?: string;
}

interface FacetChipsProps {
  /** Optional uppercase section label shown before the chips (e.g. "Classification"). */
  label?: string;
  facets: FacetChip[];
  /** The currently-selected chip key. */
  activeKey: string;
  onSelect: (key: string) => void;
  /** Accessible name for the group. */
  ariaLabel?: string;
}

export default function FacetChips({ label, facets, activeKey, onSelect, ariaLabel }: FacetChipsProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel || label || 'Filter by type'}
      style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}
    >
      {label && (
        <span style={{
          fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
          color: 'var(--color-text-muted)', marginRight: 2,
        }}>
          {label}
        </span>
      )}
      {facets.map((o) => {
        const active = o.key === activeKey;
        // A type with nothing in it: show it (that's the point) but mute it so
        // the populated types still lead the eye. Never mute the active chip.
        const empty = o.count === 0 && !active;
        return (
          <button
            key={o.key || 'all'}
            onClick={() => onSelect(o.key)}
            title={o.hint}
            aria-pressed={active}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', fontSize: 11, fontWeight: 500, borderRadius: 999,
              border: `1px solid ${active
                ? 'var(--color-primary)'
                : empty ? 'var(--color-border-subtle)' : 'var(--color-border)'}`,
              background: active ? 'var(--color-primary-light)' : 'var(--color-surface)',
              color: active
                ? 'var(--color-primary)'
                : empty ? 'var(--color-text-muted)' : 'var(--color-text)',
              cursor: 'pointer',
            }}
          >
            {o.dot && (
              <span style={{
                display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                background: o.dot, opacity: empty ? 0.5 : 1,
              }} />
            )}
            {o.label}{' '}
            <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>({o.count})</span>
          </button>
        );
      })}
    </div>
  );
}
