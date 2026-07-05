import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { apiClient } from '../api/client';

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

// Impact payload can be either the bare counts (legacy callers) or
// counts + a samples map keyed by the same category names. Samples
// are optional — when absent the dialog falls back to the old
// count-only rendering.
interface ImpactCounts { [k: string]: number | string[] | undefined }
interface OrgOption { id: string; name: string; type: string }

// Severity thresholds applied to (totalEntities, childOrgCount).
// Catastrophic requires both — a 500-entity single division is
// big but recoverable; an enterprise tree with 200+ entities is
// the deleting-the-customer scenario.
type Severity = 'small' | 'medium' | 'large' | 'catastrophic';
function computeSeverity(total: number, childOrgs: number): Severity {
  if (childOrgs >= 2 && total > 200) return 'catastrophic';
  if (total > 200) return 'large';
  if (total > 50) return 'medium';
  return 'small';
}
const SEVERITY_STYLE: Record<Severity, { label: string; bg: string; color: string; border: string }> = {
  small:        { label: 'Small',        bg: '#dcfce7', color: '#166534', border: '#86efac' },
  medium:       { label: 'Medium',       bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
  large:        { label: 'Large',        bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
  catastrophic: { label: 'Catastrophic', bg: '#7f1d1d', color: '#fff',    border: '#7f1d1d' },
};

interface Props {
  open: boolean;
  orgId: string;
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
  open, orgId, orgName, impact, accessibleOrgs, excludedTargetIds, busy, onCancel, onConfirm,
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

  // Counts and sample names are on the same impact object — counts
  // are numbers on the category key, samples are an optional sibling
  // map under impact.samples. Tolerates the legacy shape (no
  // samples) by treating samples as an empty array per category.
  const countOf = (key: CategoryKey): number => {
    const v = impact?.[key];
    return typeof v === 'number' ? v : 0;
  };
  const samplesOf = (key: CategoryKey): string[] => {
    const s = (impact as any)?.samples?.[key];
    return Array.isArray(s) ? s : [];
  };

  // Only show categories that actually have data (count > 0). If impact
  // hasn't loaded yet we show nothing (the parent gates open=true on impact).
  const visibleCategories = useMemo(() => {
    if (!impact) return [];
    return CATEGORIES.filter((c) => countOf(c.key) > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impact]);

  // Total entity count drives the severity badge. Sum every visible
  // category — childOrgs participates so a "delete a whole division
  // subtree" trips Catastrophic even without 200+ leaf entities.
  const severity = useMemo<Severity>(() => {
    if (!impact) return 'small';
    const total = CATEGORIES.reduce((sum, c) => sum + countOf(c.key), 0);
    return computeSeverity(total, countOf('childOrgs'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impact]);

  // "Export snapshot" — pull a full archive of every entity the
  // delete would touch and trigger a browser download. Cheap
  // recovery option for "I clicked Delete and regretted it."
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const handleExportSnapshot = async () => {
    if (snapshotBusy) return;
    setSnapshotBusy(true);
    try {
      const res = await apiClient.get<{ success: boolean; snapshot: any }>(`/organizations/${orgId}/snapshot`);
      const blob = new Blob([JSON.stringify(res.snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const safeName = orgName.replace(/[^A-Za-z0-9._-]+/g, '_');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const a = document.createElement('a');
      a.href = url;
      a.download = `procela-snapshot-${safeName}-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Swallow — the parent's apiClient error toast will surface
      // the failure if any. Snapshot is non-blocking insurance.
    } finally {
      setSnapshotBusy(false);
    }
  };

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
      const count = countOf(c.key);
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
        {/* Destructive banner — the most prominent thing in the
            modal. Red bar across the top so users read "cannot be
            undone" before they read anything else. */}
        <div style={{
          padding: '12px 24px',
          background: '#7f1d1d', color: '#fff',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span aria-hidden style={{ display: 'inline-flex' }}><AlertTriangle size={18} strokeWidth={2.2} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>This action cannot be undone.</div>
            <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
              Deleting an organization cascades to every entity owned by it. Review the impact below before confirming.
            </div>
          </div>
        </div>
        {/* Header */}
        <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 id="org-cleanup-title" style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#111827' }}>
              Delete &ldquo;{orgName}&rdquo;
            </h3>
            <span
              title={`Severity: ${SEVERITY_STYLE[severity].label} — based on entity count and child-org count`}
              style={{
                padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                background: SEVERITY_STYLE[severity].bg,
                color: SEVERITY_STYLE[severity].color,
                border: `1px solid ${SEVERITY_STYLE[severity].border}`,
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}
            >
              {SEVERITY_STYLE[severity].label}
            </span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
            Choose what should happen to data linked to this organization. Anything you don&rsquo;t move will be deleted permanently.
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
                      const count = countOf(c.key);
                      const samples = samplesOf(c.key);
                      const moveMissing = a.type === 'move' && !a.targetOrgId;
                      const more = Math.max(0, count - samples.length);
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
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</span>
                              <span style={{ fontSize: 11, color: '#6b7280' }}>{count}</span>
                            </div>
                            {samples.length > 0 && (
                              <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {samples.join(', ')}{more > 0 ? `, +${more} more` : ''}
                              </div>
                            )}
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
              <strong style={{ color: 'var(--color-error)' }}>{tally.deleted}</strong> deleted
              {tally.moved > 0 && <>, <strong style={{ color: 'var(--color-success)' }}>{tally.moved}</strong> moved</>}
              {tally.orphaned > 0 && <>, <strong style={{ color: 'var(--color-warning)' }}>{tally.orphaned}</strong> orphaned</>}
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
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          {/* Recovery insurance — pulls every entity the delete
              would touch into a JSON file. Doesn't change behaviour
              or block the dialog, so left-aligned and styled as a
              secondary action. */}
          <button
            onClick={handleExportSnapshot}
            disabled={busy || snapshotBusy}
            title="Download a JSON archive of every entity this delete would touch. Recommended before any Large or Catastrophic delete."
            style={{
              padding: '8px 14px', fontSize: 12,
              background: '#fff', color: '#374151',
              border: '1px solid var(--color-border)', borderRadius: 6,
              cursor: (busy || snapshotBusy) ? 'not-allowed' : 'pointer',
              opacity: (busy || snapshotBusy) ? 0.6 : 1,
            }}
          >
            {snapshotBusy ? 'Exporting…' : '↓ Export org snapshot first'}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
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
    </div>
  );
}
