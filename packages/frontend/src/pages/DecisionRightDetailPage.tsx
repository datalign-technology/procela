import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { HeaderEditActions } from '../components/DetailEditActions';
import { usePermissions } from '../hooks/usePermissions';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import ConfirmDialog from '../components/ConfirmDialog';
import { errorMessage, successToast, errorToast } from '../lib/errorToast';
import {
  DecisionRightFields,
  CATEGORY_LABELS,
  ROLE_LABELS,
  labelFor,
  type DecisionForm,
  type DecisionRight,
  type DecisionPerson,
  type DecisionGroup,
} from './DecisionRightsPage';

// ──────────────────────────────────────────────────────────────────────────
// DecisionRightDetailPage — the full record for one decision right at
// /decision-rights/:id. The F11 redesign makes the decider the hero (the old
// page omitted it), lays the four roles out as a numbered left-to-right flow
// (click a step to read what that role does), draws the escalation path, and
// adds a Facts rail, Related links, and simple gap checks. One back route:
// the global breadcrumb (no duplicate Back button).
// ──────────────────────────────────────────────────────────────────────────

interface PolicyRef { id: string; code: string; name: string; category: string }
interface GroupMemberRef { role?: string; personName?: string | null }
interface GroupRef extends DecisionGroup { members?: GroupMemberRef[] }

const panel: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', padding: 20,
};
const rowMenuBtnStyle: React.CSSProperties = {
  width: 40, height: 40, border: '1px solid var(--color-border)', background: 'var(--color-surface)',
  borderRadius: 8, color: 'var(--color-text)', cursor: 'pointer', fontSize: 18, lineHeight: 1,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const rowMenuStyle: React.CSSProperties = {
  position: 'absolute', top: 44, right: 0, zIndex: 30, minWidth: 160,
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))',
  padding: 6, textAlign: 'left',
};
const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', fontSize: 13, color: 'var(--color-text)',
  background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
};

// Plain-words explainer for each role in the flow.
const ROLE_BLURB: Record<string, string> = {
  Recommends: 'Prepares the proposal and gives a view before the decision is made.',
  Decides: 'Makes the call. There is one decider per decision.',
  Approves: 'Signs off the decision before it takes effect.',
  Informed: 'Told about the outcome afterwards — no say in it.',
};

// Spell out a known role abbreviation found in free-text escalation (e.g. CDO).
function expandRoleToken(token: string): string | null {
  const key = token.trim().toUpperCase().replace(/\s+/g, '_');
  return ROLE_LABELS[key] || null;
}

export default function DecisionRightDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();
  const { activeOrgId } = useOrgContext();
  const [row, setRow] = useState<DecisionRight | null>(null);
  const [people, setPeople] = useState<DecisionPerson[]>([]);
  const [groups, setGroups] = useState<GroupRef[]>([]);
  const [policies, setPolicies] = useState<PolicyRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRow = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [res, pplRes, grpRes, polRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DecisionRight }>(`/decision-rights/${id}`),
        apiClient.get<{ success: boolean; data: DecisionPerson[] }>('/people'),
        apiClient.get<{ success: boolean; data: GroupRef[] }>(`/governance-groups${query}`).catch(() => ({ success: true, data: [] as GroupRef[] })),
        apiClient.get<{ success: boolean; data: PolicyRef[] }>(`/governance-policies${query}`).catch(() => ({ success: true, data: [] as PolicyRef[] })),
      ]);
      setRow(res.data);
      setPeople(pplRes.data || []);
      setGroups(grpRes.data || []);
      setPolicies(polRes.data || []);
    } catch (err) {
      setError(errorMessage(err, 'Could not load decision right'));
    } finally {
      setLoading(false);
    }
  }, [id, activeOrgId]);

  useEffect(() => { fetchRow(); }, [fetchRow]);
  useBreadcrumbLeaf(row?.decision);

  if (loading) {
    return (
      <div>
        <PageHeader kicker="Decision right" title="Loading…" />
        <Card><SkeletonRows rows={4} columns={2} /></Card>
      </div>
    );
  }
  if (error || !row) {
    return (
      <EmptyState
        title="Couldn't load this decision right"
        description={error || 'It may have been deleted.'}
        action={{ label: 'Back to Decision Rights', onClick: () => navigate('/decision-rights') }}
      />
    );
  }

  // Mounted only once the record is loaded, so the edit-mode hook seeds from
  // real values (the People/Agent detail-body pattern).
  return (
    <DecisionRightDetailBody
      row={row}
      people={people}
      groups={groups}
      policies={policies}
      orgId={activeOrgId}
      isAdmin={isAdmin}
      onSaved={fetchRow}
      onDeleted={() => navigate('/decision-rights')}
      navigate={navigate}
    />
  );
}

function DecisionRightDetailBody({ row, people, groups, policies, orgId, isAdmin, onSaved, onDeleted, navigate }: {
  row: DecisionRight;
  people: DecisionPerson[];
  groups: GroupRef[];
  policies: PolicyRef[];
  orgId: string | null;
  isAdmin: boolean;
  onSaved: () => void;
  onDeleted: () => void;
  navigate: (to: string) => void;
}) {
  const { addToast } = useToastStore();
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [selStep, setSelStep] = useState(1); // default to Decides
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  const m = useDetailEditMode<DecisionForm>(
    {
      decision: row.decision,
      category: row.category,
      description: row.description,
      decider: row.decider || '',
      deciderType: row.deciderType,
      recommends: [...row.recommends],
      approves: [...row.approves],
      informed: [...row.informed],
      escalationPath: row.escalationPath,
    },
    async (draft) => {
      if (!draft.decision.trim()) { errorToast(null, 'Decision is required'); throw new Error('no-decision'); }
      try {
        await apiClient.put(`/decision-rights/${row.id}`, { ...draft, decider: draft.decider || null, ...(orgId ? { orgId } : {}) });
        successToast('Decision right updated');
        onSaved();
      } catch (err) { errorToast(err, 'Failed to update decision right'); throw err; }
    },
  );

  const deciderLabel = row.deciderName || (row.decider ? labelFor(row.decider, people, groups) : null);
  const deciderKind = row.deciderType === 'PERSON' ? 'person' : row.deciderType === 'GROUP' ? 'group' : 'role';

  // ── Flow steps ──
  const flowDefs = [
    { label: 'Recommends', values: row.recommends },
    { label: 'Decides', values: row.decider ? [row.decider] : [], isDecider: true },
    { label: 'Approves', values: row.approves },
    { label: 'Informed', values: row.informed },
  ];
  const whoFor = (values: string[]) => (values && values.length
    ? values.map((v) => labelFor(v, people, groups)).join(', ')
    : null);

  // ── Escalation chips ──
  const escSegments = (row.escalationPath || '')
    .split(/\s*(?:→|->|>)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  // ── Related: governing document (same category) + escalation group ──
  const govDoc = policies.find((p) => p.category === row.category) || null;
  const escLower = (row.escalationPath || '').toLowerCase();
  const escGroup = groups.find((g) => {
    if (!g.name) return false;
    const tokens = g.name.toLowerCase().split(/\W+/).filter((t) => t.length >= 4);
    return tokens.some((t) => escLower.includes(t));
  }) || null;
  const escChair = escGroup?.members?.find((mm) => mm.role === 'CHAIR')?.personName || null;

  // ── Checks ──
  const deciderAlsoApproves = !!row.decider && row.approves.includes(row.decider);
  const checks: Array<{ ok: boolean; text: string }> = [
    { ok: !!row.decider, text: row.decider ? 'Has a decider' : 'No decider named' },
    { ok: !!(row.escalationPath && row.escalationPath.trim()), text: row.escalationPath?.trim() ? 'Has an escalation path' : 'No escalation path set' },
    deciderAlsoApproves
      ? { ok: false, text: 'The decider is also an approver — that removes the separation between deciding and signing off.' }
      : (row.decider && row.approves.length ? { ok: true, text: 'Decider and approver are different people' } : { ok: true, text: 'No decider/approver overlap' }),
  ];

  const fmtDate = (s: string) => { try { return new Date(s).toLocaleDateString(); } catch { return s; } };
  const addDescLink = (label: string) => (
    <button type="button" onClick={() => m.enter()} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}>{label}</button>
  );

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); addToast('success', 'Link copied'); }
    catch { addToast('error', 'Could not copy link'); }
  };
  const handleDuplicate = async () => {
    try {
      const res = await apiClient.post<{ success: boolean; data: DecisionRight }>('/decision-rights', {
        decision: `${row.decision} (copy)`, category: row.category, description: row.description,
        decider: row.decider || null, deciderType: row.deciderType,
        recommends: row.recommends, approves: row.approves, informed: row.informed,
        escalationPath: row.escalationPath, ...(orgId ? { orgId } : {}),
      });
      addToast('success', 'Decision duplicated');
      if (res.data?.id) navigate(`/decision-rights/${res.data.id}`); else onSaved();
    } catch (err) { addToast('error', errorMessage(err, 'Failed to duplicate decision')); }
  };
  const handleDelete = async () => {
    try { await apiClient.delete(`/decision-rights/${row.id}`); addToast('success', 'Decision right deleted'); onDeleted(); }
    catch (err) { addToast('error', errorMessage(err, 'Failed to delete decision right')); }
  };

  const factRow = (label: string, node: React.ReactNode) => (
    <>
      <dt style={{ color: 'var(--color-text-muted)' }}>{label}</dt>
      <dd style={{ margin: 0 }}>{node}</dd>
    </>
  );

  return (
    <div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete decision right?"
        message={`This permanently deletes "${row.decision}".`}
        confirmLabel="Delete"
        onConfirm={async () => { setConfirmDelete(false); await handleDelete(); }}
        onCancel={() => setConfirmDelete(false)}
      />

      <PageHeader
        kicker={`Decision right · ${CATEGORY_LABELS[row.category] || row.category}`}
        title={row.decision}
        copyId={row.id}
        copyLabel="Copy decision-right ID"
        subtitle={row.description
          ? row.description
          : <span style={{ fontStyle: 'italic', color: 'var(--color-text-muted)' }}>No description yet. {addDescLink('Add one')} so people know when this applies.</span>}
        actions={<>
          <span ref={setActionsSlot} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} />
          {isAdmin && !m.isEditing && (
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen}
                onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }} style={rowMenuBtnStyle}>⋯</button>
              {menuOpen && (
                <div role="menu" onClick={(e) => e.stopPropagation()} style={rowMenuStyle}>
                  <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setMenuOpen(false); copyLink(); }}>Copy link</button>
                  <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setMenuOpen(false); handleDuplicate(); }}>Duplicate</button>
                  <button type="button" role="menuitem" style={{ ...menuItemStyle, color: 'var(--color-error)' }} onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}>Delete</button>
                </div>
              )}
            </span>
          )}
        </>}
      />

      {/* The header Edit button portals here. */}
      <HeaderEditActions slot={actionsSlot} editing={m.isEditing} canEdit={isAdmin} dirty={m.dirty} saving={m.saving} onEdit={m.enter} onCancel={m.cancel} onSave={m.save} editLabel="Edit decision" />

      {m.isEditing ? (
        <Card>
          <DecisionRightFields form={m.draft} setForm={(next) => m.patch(next)} people={people} groups={groups} />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          <main style={{ flex: '999 1 540px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* How this decision is made — the four roles as a numbered flow. */}
            <section style={panel}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>How this decision is made</h2>
              <p style={{ margin: '4px 0 16px', fontSize: 13, color: 'var(--color-text-muted)' }}>Read left to right. Click a step for what that person or role does.</p>
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                {flowDefs.map((s, i) => {
                  const active = selStep === i;
                  const who = s.isDecider ? deciderLabel : whoFor(s.values);
                  const sub = s.isDecider
                    ? (deciderLabel ? deciderKind.charAt(0).toUpperCase() + deciderKind.slice(1) : 'No one named')
                    : (s.values.length ? `${s.values.length} named` : 'No one named');
                  return (
                    <li key={s.label}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSelStep(i)}
                        style={{
                          width: '100%', textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: 14,
                          display: 'flex', flexDirection: 'column', gap: 6, minHeight: 112,
                          background: s.isDecider ? 'var(--color-primary-light)' : 'var(--color-surface)',
                          border: `1px solid ${active ? 'var(--color-primary)' : (s.isDecider ? 'var(--color-primary)' : 'var(--color-border)')}`,
                          boxShadow: active ? '0 0 0 1px var(--color-primary)' : 'none',
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{
                            width: 24, height: 24, borderRadius: 12, fontSize: 12, fontWeight: 700,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums',
                            background: s.isDecider ? 'var(--color-primary)' : 'var(--color-bg)',
                            color: s.isDecider ? '#fff' : 'var(--color-text-secondary)',
                          }}>{i + 1}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{s.label}</span>
                        </span>
                        <span style={{ fontSize: 15, fontWeight: 600, color: who ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{who || 'Not set'}</span>
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{sub}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                <strong style={{ color: 'var(--color-text)' }}>{flowDefs[selStep].label}:</strong> {ROLE_BLURB[flowDefs[selStep].label]}
              </div>
            </section>

            {/* If people disagree — the escalation path. */}
            <section style={panel}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>If people disagree</h2>
              <p style={{ margin: '4px 0 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>Where the decision goes when it cannot be settled at the step above.</p>
              {escSegments.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                  No escalation path set. {isAdmin && addDescLink('Add one')}
                </p>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {escSegments.map((seg, i) => {
                    const full = expandRoleToken(seg);
                    return (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        {i > 0 && <span aria-hidden="true" style={{ color: 'var(--color-text-muted)' }}>&rarr;</span>}
                        <span style={{ display: 'inline-flex', alignItems: 'center', height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--color-border)', fontWeight: 600 }}>
                          {seg}{full && <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 6 }}>({full})</span>}
                        </span>
                      </span>
                    );
                  })}
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Final say</span>
                </div>
              )}
            </section>

            {/* Related records, when we can resolve them. */}
            {(govDoc || escGroup) && (
              <section style={panel}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Related</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
                  {govDoc && (
                    <button type="button" onClick={() => navigate(`/governance-policies/${govDoc.id}`)} style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 14px' }}>
                      <SectionLabel marginBottom={4}>Governing document</SectionLabel>
                      <span style={{ display: 'block', fontWeight: 600, color: 'var(--color-text)' }}>{govDoc.name}</span>
                      <span style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)' }}>{govDoc.code} · suggested by area</span>
                    </button>
                  )}
                  {escGroup && (
                    <button type="button" onClick={() => navigate(`/governance-groups/${escGroup.id}`)} style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 14px' }}>
                      <SectionLabel marginBottom={4}>Escalation group</SectionLabel>
                      <span style={{ display: 'block', fontWeight: 600, color: 'var(--color-text)' }}>{escGroup.name}</span>
                      <span style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)' }}>{escChair ? `Chair: ${escChair}` : 'Governance group'}</span>
                    </button>
                  )}
                </div>
              </section>
            )}
          </main>

          <aside style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card>
              <SectionLabel>Facts</SectionLabel>
              <dl style={{ margin: '4px 0 0', display: 'grid', gridTemplateColumns: '92px 1fr', rowGap: 10, fontSize: 13.5 }}>
                {factRow('Area', CATEGORY_LABELS[row.category] || row.category)}
                {factRow('Decides', deciderLabel
                  ? <>{deciderLabel} <span style={{ color: 'var(--color-text-muted)' }}>({deciderKind})</span></>
                  : <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unassigned</span>)}
                {factRow('Description', row.description
                  ? <span style={{ color: 'var(--color-text-secondary)' }}>{row.description}</span>
                  : addDescLink('Add description'))}
                {factRow('Created', fmtDate(row.createdAt))}
                {factRow('Updated', fmtDate(row.updatedAt))}
              </dl>
            </Card>

            <Card>
              <SectionLabel>Check</SectionLabel>
              <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                {checks.map((c, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: c.ok ? 'var(--color-text)' : 'var(--color-warning)' }}>
                    <span aria-hidden="true" style={{ flex: 'none', fontWeight: 700, color: c.ok ? 'var(--color-success)' : 'var(--color-warning)' }}>{c.ok ? '✓' : '!'}</span>
                    {c.text}
                  </li>
                ))}
              </ul>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
