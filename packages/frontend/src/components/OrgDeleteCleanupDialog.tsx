import { useEffect, useMemo, useRef, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// OrgDeleteCleanupDialog — replaces a generic ConfirmDialog for the
// "delete organization" flow with per-category cleanup choices.
//
// Each entity category attached to the org gets one of three actions:
//   - "delete": drop the rows with the org (default)
//   - "move":   re-home them to a target org chosen from a picker
//   - "orphan": drop the org from the row's orgIds[] but keep the row
//               (only allowed for People and Processes — single-org rows
//                require a home)
//
// The dialog enforces a typed "DELETE" confirmation and disables the
// confirm button until every Move action has a target org chosen.
// ──────────────────────────────────────────────────────────────────────────

export type ActionType = 'delete' | 'move' | 'orphan';
export interface CleanupAction { type: ActionType; targetOrgId?: string }

export type CategoryKey =
  | 'childOrgs' | 'people' | 'processes' | 'dataAssets' | 'systems'
  | 'dataDomains' | 'mappings' | 'governanceGroups' | 'damaRoles'
  | 'tasks' | 'issues' | 'policies' | 'controls'
  | 'glossaryTerms' | 'sops' | 'calendarEvents' | 'decisionRights';

export type CleanupActions = Partial<Record<CategoryKey, CleanupAction>>;

type GroupKey = 'structure' | 'identity' | 'catalog' | 'governance';

interface CategoryConfig {
  key: CategoryKey;
  label: string;
  group: GroupKey;
  canOrphan: boolean;
}

const CATEGORIES: CategoryConfig[] = [
  { key: 'childOrgs',        label: 'Child organizations', group: 'structure',  canOrphan: false },
  { key: 'people',           label: 'People',              group: 'identity',   canOrphan: true  },
  { key: 'processes',        label: 'Processes',           group: 'identity',   canOrphan: true  },
  { key: 'dataAssets',       label: 'Data assets',         group: 'catalog',    canOrphan: false },
  { key: 'systems',          label: 'Systems',             group: 'catalog',    canOrphan: false },
  { key: 'dataDomains',      label: 'Data domains',        group: 'catalog',    canOrphan: false },
  { key: 'mappings',         label: 'Mappings',            group: 'catalog',    canOrphan: false },
  { key: 'glossaryTerms',    label: 'Glossary terms',      group: 'catalog',    canOrphan: false },
  { key: 'governanceGroups', label: 'Governance groups',   group: 'governance', canOrphan: false },
  { key: 'damaRoles',        label: 'Governance roles',    group: 'governance', canOrphan: false },
  { key: 'tasks',            label: 'Tasks',               group: 'governance', canOrphan: false },
  { key: 'issues',           label: 'Issues',              group: 'governance', canOrphan: false },
  { key: 'policies',         label: 'Policies',            group: 'governance', canOrphan: false },
  { key: 'controls',         label: 'Controls',            group: 'governance', canOrphan: false },
  { key: 'decisionRights',   label: 'Decision rights',     group: 'governance', canOrphan: false },
  { key: 'sops',             label: 'Procedures (SOPs)',   group: 'governance', canOrphan: false },
  { key: 'calendarEvents',   label: 'Calendar events',     group: 'governance', canOrphan: false },
];

const GROUP_LABELS: Record<GroupKey, string> = {
  structure: 'Org structure',
  identity: 'Identity',
  catalog: 'Catalog',
  governance: 'Governance & operations',
};

const GROUP_ORDER: GroupKey[] = ['structure', 'identity', 'catalog', 'governance'];

interface ImpactCounts { [k: string]: number }
interface OrgOption { id: string; name: string; type: string }

interface Props {
  open: boolean;
  orgName: string;
  impact: ImpactCounts | null;
  /** Orgs the user can pick as a Move target (already filtered to accessible). */
  accessibleOrgs: OrgOption[];
  /** Org IDs in the deleted subtree — excluded from move-target dropdowns. */
  excludedTargetIds: Set<string>;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (actions: CleanupActions) => Promise<void> | void;
}

export default function OrgDeleteCleanupDialog({
  open, orgName, impact, accessibleOrgs, excludedTargetIds, busy, onCancel, onConfirm,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [defaultAction, setDefaultAction] = useState<ActionType>('delete');
  const [defaultTarget, setDefaultTarget] = useState<string>('');
  const [perCategory, setPerCategory] = useState<Partial<Record<CategoryKey, CleanupAction>>>({});
  const [typed, setTyped] = useState('');

  // Reset on open. We keep a separate per-category override map and only
  // fall back to the "default for everything" picker when the user hasn't
  // explicitly touched a category.
  useEffect(() => {
    if (!open) return;
    setDefaultAction('delete');
    setDefaultTarget('');
    setPerCategory({});
    setTyped('');
  }, [open]);

  // Move target options — exclude the deleted subtree itself.
  const targetOptions = useMemo(
    () => accessibleOrgs.filter((o) => !excludedTargetIds.has(o.id)),
    [accessibleOrgs, excludedTargetIds],
  );

  // Only show categories that actually have data (count > 0). If impact
  // hasn't loaded yet we show nothing (the parent gates open=true on impact).
  const visibleCategories = useMemo(() => {
    if (!impact) return [];
    return CATEGORIES.filter((c) => (impact[c.key] || 0) > 0);
  }, [impact]);

  // Resolved action for a given category — explicit override > default.
  const getAction = (key: CategoryKey): CleanupAction => {
    if (perCategory[key]) return perCategory[key]!;
    if (defaultAction === 'orphan' && !CATEGORIES.find((c) => c.key === key)?.canOrphan) {
      // Default-orphan can't apply to single-org categories; they fall through to delete.
      return { type: 'delete' };
    }
    if (defaultAction === 'move') return { type: 'move', targetOrgId: defaultTarget || undefined };
    return { type: defaultAction };
  };

  const setAction = (key: CategoryKey, type: ActionType) => {
    setPerCategory((prev) => {
      const next = { ...prev };
      if (type === 'move') {
        const existingTarget = prev[key]?.targetOrgId || defaultTarget || '';
        next[key] = { type, targetOrgId: existingTarget || undefined };
      } else {
        next[key] = { type };
      }
      return next;
    });
  };

  const setTarget = (key: CategoryKey, targetOrgId: string) => {
    setPerCategory((prev) => ({ ...prev, [key]: { type: 'move', targetOrgId } }));
  };

  // Live tally for the summary line and the missing-target check.
  const tally = useMemo(() => {
    let deleted = 0, moved = 0, orphaned = 0, missingTarget = 0;
    if (!impact) return { deleted, moved, orphaned, missingTarget };
    for (const c of visibleCategories) {
      const count = impact[c.key] || 0;
      const a = getAction(c.key);
      if (a.type === 'move') {
        if (!a.targetOrgId) missingTarget += 1; // count categories not rows
        moved += count;
      } else if (a.type === 'orphan' && c.canOrphan) {
        orphaned += count;
      } else {
        deleted += count;
      }
    }
    return { deleted, moved, orphaned, missingTarget };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impact, visibleCategories, defaultAction, defaultTarget, perCategory]);

  const canConfirm = typed === 'DELETE' && tally.missingTarget === 0 && !busy;

  // Esc cancels.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const buildPayload = (): CleanupActions => {
    const out: CleanupActions = {};
    for (const c of visibleCategories) out[c.key] = getAction(c.key);
    return out;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="org-cleanup-title"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.55)', padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
          width: '100%', maxWidth: 720, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid var(--color-border)' }}>
          <h3 id="org-cleanup-title" style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#111827' }}>
            Delete &ldquo;{orgName}&rdquo;
          </h3>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
            Choose what should happen to data linked to this organization. Anything you don&rsquo;t
            move will be deleted permanently.
          </p>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {/* Default-for-everything picker */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            background: '#f8fafc', border: '1px solid var(--color-border)', borderRadius: 8,
            marginBottom: 16,
          }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Default for everything:</label>
            <select
              value={defaultAction}
              onChange={(e) => {
                const v = e.target.value as ActionType;
                setDefaultAction(v);
                // Wipe per-category overrides so the new default sticks.
                setPerCategory({});
              }}
              style={{
                padding: '5px 8px', fontSize: 12, border: '1px solid var(--color-border)',
                borderRadius: 4, background: '#fff',
              }}
            >
              <option value="delete">Delete</option>
              <option value="move">Move to…</option>
              <option value="orphan">Orphan (where allowed)</option>
            </select>
            {defaultAction === 'move' && (
              <select
                value={defaultTarget}
                onChange={(e) => { setDefaultTarget(e.target.value); setPerCategory({}); }}
                style={{
                  padding: '5px 8px', fontSize: 12, border: '1px solid var(--color-border)',
                  borderRadius: 4, background: '#fff', flex: 1, minWidth: 180,
                }}
              >
                <option value="">-- pick target org --</option>
                {targetOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.name} ({o.type})</option>
                ))}
              </select>
            )}
            {defaultAction === 'orphan' && (
              <span style={{ fontSize: 11, color: '#92400e' }}>
                Orphan only applies to People and Processes; other rows fall back to Delete.
              </span>
            )}
          </div>

          {/* Per-category dropdowns, grouped */}
          {visibleCategories.length === 0 ? (
            <div style={{ fontSize: 13, color: '#6b7280', padding: '8px 4px' }}>
              This organization has no associated data. It will be permanently deleted.
            </div>
          ) : (
            GROUP_ORDER.map((g) => {
              const inGroup = visibleCategories.filter((c) => c.group === g);
              if (inGroup.length === 0) return null;
              return (
                <div key={g} style={{ marginBottom: 14 }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                    color: '#64748b', marginBottom: 6,
                  }}>
                    {GROUP_LABELS[g]}
                  </div>
                  <div style={{
                    border: '1px solid var(--color-border)', borderRadius: 8,
                    background: '#fff', overflow: 'hidden',
                  }}>
                    {inGroup.map((c, idx) => {
                      const a = getAction(c.key);
                      const count = impact?.[c.key] || 0;
                      const moveMissing = a.type === 'move' && !a.targetOrgId;
                      return (
                        <div
                          key={c.key}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(0,1fr) auto auto',
                            alignItems: 'center', gap: 10,
                            padding: '10px 12px',
                            borderTop: idx === 0 ? 'none' : '1px solid var(--color-border)',
                            background: moveMissing ? '#fff7ed' : '#fff',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                            <span style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</span>
                            <span style={{ fontSize: 11, color: '#6b7280' }}>{count}</span>
                          </div>
                          <select
                            value={a.type}
                            onChange={(e) => setAction(c.key, e.target.value as ActionType)}
                            style={{
                              padding: '4px 8px', fontSize: 12,
                              border: '1px solid var(--color-border)', borderRadius: 4,
                              background: '#fff', minWidth: 110,
                            }}
                          >
                            <option value="delete">Delete</option>
                            <option value="move">Move to…</option>
                            <option value="orphan" disabled={!c.canOrphan}>
                              Orphan {c.canOrphan ? '' : '(N/A)'}
                            </option>
                          </select>
                          {a.type === 'move' ? (
                            <select
                              value={a.targetOrgId || ''}
                              onChange={(e) => setTarget(c.key, e.target.value)}
                              style={{
                                padding: '4px 8px', fontSize: 12,
                                border: `1px solid ${moveMissing ? '#f97316' : 'var(--color-border)'}`,
                                borderRadius: 4, background: '#fff',
                                minWidth: 180, maxWidth: 220,
                              }}
                            >
                              <option value="">-- target --</option>
                              {targetOptions.map((o) => (
                                <option key={o.id} value={o.id}>{o.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span style={{ width: 180 }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}

          {/* Summary */}
          {visibleCategories.length > 0 && (
            <div style={{
              padding: '8px 12px', background: '#f1f5f9', borderRadius: 6,
              fontSize: 12, color: '#334155', marginTop: 4,
            }}>
              <strong style={{ color: '#dc2626' }}>{tally.deleted}</strong> deleted
              {tally.moved > 0 && <>, <strong style={{ color: '#16a34a' }}>{tally.moved}</strong> moved</>}
              {tally.orphaned > 0 && <>, <strong style={{ color: '#d97706' }}>{tally.orphaned}</strong> orphaned</>}
              {tally.missingTarget > 0 && (
                <span style={{ color: '#9a3412', marginLeft: 8 }}>
                  · {tally.missingTarget} categor{tally.missingTarget === 1 ? 'y' : 'ies'} need a move target
                </span>
              )}
            </div>
          )}

          {/* Type-DELETE confirmation */}
          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 6 }}>
              Type <code style={{
                background: '#fef2f2', color: '#991b1b', padding: '1px 6px',
                borderRadius: 3, fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontWeight: 600,
              }}>DELETE</code> to confirm:
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              style={{
                width: '100%', padding: '8px 10px', fontSize: 13,
                border: `1px solid ${typed === 'DELETE' ? '#16a34a' : 'var(--color-border)'}`,
                borderRadius: 6,
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 24px', borderTop: '1px solid var(--color-border)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: '8px 16px', fontSize: 13, background: '#fff',
              border: '1px solid var(--color-border)', borderRadius: 6,
              color: '#374151', cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={async () => { if (canConfirm) await onConfirm(buildPayload()); }}
            disabled={!canConfirm}
            style={{
              padding: '8px 16px', fontSize: 13,
              background: canConfirm ? '#dc2626' : '#e5e7eb',
              border: 'none', borderRadius: 6,
              color: canConfirm ? '#fff' : '#9ca3af', fontWeight: 500,
              cursor: canConfirm ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Deleting…' : 'Delete and Clean Up'}
          </button>
        </div>
      </div>
    </div>
  );
}
