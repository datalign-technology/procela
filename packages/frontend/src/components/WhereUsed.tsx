import { ReactNode } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// WhereUsed — a consistent cross-layer detail panel.
//
// Procela's three-layer model (Business / Data / People+Governance) only
// works as a navigation aid if every entity surfaces its connections to
// the other layers in the same shape. This component is that shape: a
// titled card with a stack of labelled sections, each showing chips or
// short rows of related entities, with optional click-through.
//
// Pages give it `groups`; each group is one section ("Linked Systems",
// "Owned by", "Mapped Activities", etc.). Each item in a group is a
// chip that may navigate when clicked.
// ──────────────────────────────────────────────────────────────────────────

export interface WhereUsedItem {
  id: string;
  label: string;
  /** Optional sub-line shown beneath the label (e.g. role, status). */
  sublabel?: string;
  /** Optional navigation target — string path, or callback. */
  href?: string;
  onClick?: () => void;
  /** Optional small badge to the right of the label (e.g. "Owner"). */
  badge?: string;
}

export interface WhereUsedGroup {
  title: string;
  /** Short descriptive subtitle shown below the title. Keep under ~80 chars. */
  hint?: string;
  items: WhereUsedItem[];
  /** Text to show in place of the list when items is empty. Defaults
   *  to "None yet." */
  emptyText?: string;
  /** Optional action button rendered in the group header (e.g. "+ Link"). */
  action?: { label: string; onClick: () => void };
}

interface WhereUsedProps {
  /** Optional title for the whole panel; default "Where used". */
  title?: string;
  /** Optional one-line description shown under the title. */
  hint?: ReactNode;
  groups: WhereUsedGroup[];
}

export default function WhereUsed({
  title = 'Where used',
  hint,
  groups,
}: WhereUsedProps) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: 16,
    }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{title}</h3>
        {hint && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {hint}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {groups.map((g) => (
          <div key={g.title}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {g.title}
                </div>
                {g.hint && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>
                    {g.hint}
                  </div>
                )}
              </div>
              {g.action && (
                <button
                  onClick={g.action.onClick}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 500, color: 'var(--color-primary)', padding: 0,
                  }}
                >
                  {g.action.label}
                </button>
              )}
            </div>
            {g.items.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                {g.emptyText || 'None yet.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {g.items.map((item) => {
                  const baseStyle: React.CSSProperties = {
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 10px', borderRadius: 999,
                    background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                    fontSize: 12,
                    cursor: (item.href || item.onClick) ? 'pointer' : 'default',
                    color: 'var(--color-text)',
                  };
                  const inner = (
                    <>
                      <span style={{ fontWeight: 500 }}>{item.label}</span>
                      {item.sublabel && (
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
                          · {item.sublabel}
                        </span>
                      )}
                      {item.badge && (
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: '1px 5px',
                          borderRadius: 3, background: '#dbeafe', color: '#1e40af',
                        }}>
                          {item.badge}
                        </span>
                      )}
                    </>
                  );
                  if (item.href) {
                    return <a key={item.id} href={item.href} style={{ ...baseStyle, textDecoration: 'none' }}>{inner}</a>;
                  }
                  if (item.onClick) {
                    return (
                      <button key={item.id} onClick={item.onClick} style={{ ...baseStyle, border: '1px solid var(--color-border)' }}>
                        {inner}
                      </button>
                    );
                  }
                  return <span key={item.id} style={baseStyle}>{inner}</span>;
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
