import { useEffect, useState, useCallback, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import Button from '../components/Button';
import SecondaryButton from '../components/SecondaryButton';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import EditableField from '../components/EditableField';
import DetailEditActions from '../components/DetailEditActions';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { successToast, errorToast } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import { renderNavIcon } from '../components/navIcons';
import { dotPill, daysUntil, fmtDate } from './GovernanceTasksPage';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceExceptionsPage — the roster of time-boxed waivers of a policy or
// control. Leads with status count cards (Active / Expiring / Past expiry /
// Closed) that filter the list, a labelled "Grant exception" form behind one
// button, a soft link from each exception to the policy it waives, and a side
// panel explaining the lifecycle. Only admins can grant or close.
// ──────────────────────────────────────────────────────────────────────────

interface GovException {
  id: string; orgId: string; title: string; reason?: string;
  policyId?: string;
  status: 'ACTIVE' | 'CLOSED'; grantedAt: string; expiresAt: string; pastExpiry?: boolean;
}
interface PolicyRef { id: string; code: string; name: string; }

const inputStyle: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 10px', fontSize: 13, background: 'var(--color-surface)', color: 'var(--color-text)', width: '100%' };
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 };
const reqMark = <span style={{ color: 'var(--color-error)' }}> *</span>;

const rowMenuBtnStyle: React.CSSProperties = {
  width: 32, height: 32, border: 0, background: 'transparent', borderRadius: 8,
  color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 18, lineHeight: 1,
};
const rowMenuStyle: React.CSSProperties = {
  position: 'absolute', top: 34, right: 0, zIndex: 30, minWidth: 150,
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))',
  padding: 6, textAlign: 'left',
};
const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', fontSize: 13, color: 'var(--color-text)',
  background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
};

// Dotted status pill. An ACTIVE waiver that's run past its expiry is the thing
// the council watches, so it reads "Past expiry" in red.
function statusPill(e: GovException): React.ReactNode {
  if (e.status === 'ACTIVE' && e.pastExpiry) return dotPill({ bg: '#fbe4e4', color: '#9a1c1c' }, 'Past expiry');
  if (e.status === 'ACTIVE') return dotPill({ bg: '#dcefe5', color: '#17604b' }, 'Active');
  return dotPill({ bg: '#eef0f2', color: '#6b7280' }, 'Closed');
}

// The expanded row detail: the exception's own fields with a view→Edit→Save
// toggle. One Save writes PUT /governance-exceptions/:id. The ACTIVE/CLOSED
// lifecycle stays on the row's Close / Reopen action, not a record edit.
function ExceptionDetail({ exc, policies, canEdit, onSaved }: {
  exc: GovException;
  policies: PolicyRef[];
  canEdit: boolean;
  onSaved: () => void;
}) {
  const m = useDetailEditMode<{ title: string; reason: string; expiresAt: string; policyId: string }>(
    { title: exc.title, reason: exc.reason ?? '', expiresAt: (exc.expiresAt || '').slice(0, 10), policyId: exc.policyId ?? '' },
    async (draft) => {
      if (!draft.title.trim()) { errorToast(null, 'Title is required'); throw new Error('no-title'); }
      if (!draft.expiresAt) { errorToast(null, 'Expiry date is required'); throw new Error('no-expiry'); }
      try {
        await apiClient.put(`/governance-exceptions/${exc.id}`, {
          title: draft.title.trim(),
          reason: draft.reason.trim() || undefined,
          expiresAt: draft.expiresAt,
          policyId: draft.policyId || null,
        });
        successToast('Exception updated');
        onSaved();
      } catch (err) { errorToast(err, 'Failed to update exception'); throw err; }
    },
  );
  const policy = policies.find((p) => p.id === exc.policyId);
  return (
    <div style={{ padding: '12px 16px' }}>
      {canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: m.isEditing ? 12 : 8 }}>
          <DetailEditActions editing={m.isEditing} canEdit dirty={m.dirty} saving={m.saving} onEdit={m.enter} onCancel={m.cancel} onSave={m.save} />
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        {m.isEditing && (
          <EditableField label="Title" editing value={m.draft.title} onChange={(v) => m.set('title', v)} placeholder="What is being waived?" />
        )}
        <EditableField
          label="Expires"
          editing={m.isEditing}
          value={m.draft.expiresAt}
          renderEdit={() => (
            <input aria-label="Expires" type="date" value={m.draft.expiresAt} onChange={(e) => m.set('expiresAt', e.target.value)} style={inputStyle} />
          )}
        >
          {exc.expiresAt ? fmtDate(exc.expiresAt) : '—'}
        </EditableField>
        <EditableField
          label="Waives policy"
          editing={m.isEditing}
          value={m.draft.policyId}
          renderEdit={() => (
            <select aria-label="Waives policy" value={m.draft.policyId} onChange={(e) => m.set('policyId', e.target.value)} style={{ ...inputStyle, appearance: 'auto' as const }}>
              <option value="">— No policy —</option>
              {policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        >
          {policy ? <Link to={`/governance-policies/${policy.id}`} style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'none' }}>{policy.name}</Link> : <span style={{ color: 'var(--color-text-muted)' }}>Not linked to a policy</span>}
        </EditableField>
      </div>
      <div style={{ marginTop: 14 }}>
        <EditableField label="Reason" editing={m.isEditing} type="textarea" value={m.draft.reason} onChange={(v) => m.set('reason', v)} placeholder="Why this waiver was granted" emptyText="No reason recorded">
          {exc.reason ? <span style={{ color: 'var(--color-text-secondary)' }}>{exc.reason}</span> : undefined}
        </EditableField>
      </div>
    </div>
  );
}

export default function GovernanceExceptionsPage() {
  const { activeOrgId } = useOrgContext();
  // Exceptions are governance:write = admin-only. Non-admins see the
  // read-only roster with no grant form and no row actions.
  const { isAdmin } = usePermissions();
  const { addToast } = useToastStore();
  const [rows, setRows] = useState<GovException[]>([]);
  const [policies, setPolicies] = useState<PolicyRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [policyId, setPolicyId] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Status lens: 'active' | 'expiring' | 'past' | 'closed' | null (all).
  const [lens, setLens] = useState<string | null>(null);
  const toggleExpand = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  useEffect(() => {
    if (!rowMenuId) return;
    const close = () => setRowMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [rowMenuId]);

  const load = useCallback(async () => {
    if (!activeOrgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [excRes, polRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GovException[] }>(`/governance-exceptions?orgId=${activeOrgId}`),
        apiClient.get<{ success: boolean; data: PolicyRef[] }>(`/governance-policies?orgId=${activeOrgId}`).catch(() => ({ success: true, data: [] as PolicyRef[] })),
      ]);
      setRows(excRes.data || []);
      setPolicies(polRes.data || []);
    } catch { addToast('error', 'Failed to load exceptions.'); }
    finally { setLoading(false); }
  }, [activeOrgId, addToast]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!activeOrgId || !title.trim() || !expiresAt) return;
    setSaving(true);
    try {
      await apiClient.post('/governance-exceptions', { orgId: activeOrgId, title: title.trim(), expiresAt, reason: reason.trim() || undefined, policyId: policyId || undefined });
      setTitle(''); setExpiresAt(''); setReason(''); setPolicyId(''); setShowForm(false);
      addToast('success', 'Exception granted.');
      load();
    } catch { addToast('error', 'Failed to grant exception. You may not have permission.'); }
    finally { setSaving(false); }
  };

  const setStatus = async (e: GovException, status: 'ACTIVE' | 'CLOSED') => {
    try { await apiClient.put(`/governance-exceptions/${e.id}`, { status }); load(); }
    catch { addToast('error', 'Failed to update.'); }
  };
  const remove = async (id: string) => {
    try { await apiClient.delete(`/governance-exceptions/${id}`); addToast('success', 'Exception deleted.'); load(); }
    catch { addToast('error', 'Failed to delete.'); }
  };

  // ── Status counts ──
  const isExpiringSoon = (e: GovException) => e.status === 'ACTIVE' && !e.pastExpiry && (daysUntil(e.expiresAt) ?? 99) <= 30 && (daysUntil(e.expiresAt) ?? -1) >= 0;
  const activeCount = rows.filter((r) => r.status === 'ACTIVE').length;
  const expiringCount = rows.filter(isExpiringSoon).length;
  const pastCount = rows.filter((r) => r.pastExpiry).length;
  const closedCount = rows.filter((r) => r.status === 'CLOSED').length;

  const matchesLens = (e: GovException) => {
    if (!lens) return true;
    if (lens === 'active') return e.status === 'ACTIVE';
    if (lens === 'expiring') return isExpiringSoon(e);
    if (lens === 'past') return !!e.pastExpiry;
    if (lens === 'closed') return e.status === 'CLOSED';
    return true;
  };
  const visible = rows.filter(matchesLens);

  const policyName = (id?: string) => policies.find((p) => p.id === id)?.name;

  const cards: { key: string; label: string; count: number; fg: string; tint: string }[] = [
    { key: 'active',   label: 'Active',             count: activeCount,   fg: '#17604b', tint: '#dcefe5' },
    { key: 'expiring', label: 'Expiring in 30 days', count: expiringCount, fg: '#9a4a0e', tint: 'var(--color-warning-light)' },
    { key: 'past',     label: 'Past expiry',        count: pastCount,     fg: '#9a1c1c', tint: '#fbe4e4' },
    { key: 'closed',   label: 'Closed',             count: closedCount,   fg: 'var(--color-text-secondary)', tint: 'var(--color-bg)' },
  ];

  return (
    <div>
      <PageHeader
        title="Governance Exceptions"
        subtitle="Time-boxed waivers of a policy or control. Those still active past their expiry are what the council watches."
        actions={isAdmin ? <Button variant="primary" size="sm" onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancel' : '+ Grant exception'}</Button> : undefined}
      />

      {/* Plain-words lead — the page never explained what an exception is. */}
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-text-secondary)', maxWidth: 680 }}>
        An exception is a documented, time-limited permission to skip a policy or control — granted for a named reason, with an expiry date the council tracks.
      </p>

      {/* Grant form — labelled fields, required marks, behind one button. */}
      {isAdmin && showForm && (
        <Card padding={20} marginBottom={16}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Grant an exception</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Title{reqMark}</label>
              <input aria-label="Title" placeholder="What is being waived?" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Expiry date{reqMark}</label>
              <input aria-label="Expiry date" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Waives policy</label>
              <select aria-label="Waives policy" value={policyId} onChange={(e) => setPolicyId(e.target.value)} style={{ ...inputStyle, appearance: 'auto' as const }}>
                <option value="">— No policy —</option>
                {policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Reason</label>
              <textarea aria-label="Reason" placeholder="Why this waiver is being granted" value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <SecondaryButton onClick={() => setShowForm(false)}>Cancel</SecondaryButton>
            <Button variant="primary" disabled={!title.trim() || !expiresAt} loading={saving} onClick={add}>Grant exception</Button>
          </div>
        </Card>
      )}

      {/* Status count cards — one tap filters the list. */}
      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {cards.map((c) => {
            const active = lens === c.key;
            return (
              <button
                key={c.key} type="button" aria-pressed={active}
                onClick={() => setLens(active ? null : c.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', font: 'inherit',
                  padding: '10px 16px', borderRadius: 'var(--radius-md)', textAlign: 'left', flex: '1 1 150px',
                  background: active ? c.tint : 'var(--color-surface)',
                  border: `1px solid ${active ? c.fg : 'var(--color-border)'}`,
                }}
              >
                <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: c.fg, fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{c.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? <Spinner center label="Loading…" /> : rows.length === 0 ? (
        <EmptyState
          icon={renderNavIcon('/governance-exceptions')}
          title="No exceptions recorded"
          description="When a policy or control genuinely can't be met yet, grant a time-boxed exception here so the gap is documented and tracked to an expiry — rather than going unrecorded."
          action={isAdmin ? { label: '+ Grant the first exception', onClick: () => setShowForm(true) } : undefined}
        />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          <main style={{ flex: '999 1 540px', minWidth: 0 }}>
            <Card padding={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                  <thead>
                    <tr>
                      {['Exception', 'Granted', 'Expires', 'Status', ''].map((h, i) => (
                        <th key={h || i} style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', padding: '10px 14px', borderBottom: '1.5px solid var(--color-border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>No exceptions match this filter.</td></tr>
                    ) : visible.map((e) => {
                      const expanded = expandedId === e.id;
                      const pol = policyName(e.policyId);
                      return (
                        <Fragment key={e.id}>
                          <tr
                            onClick={(ev) => {
                              if ((ev.target as HTMLElement).closest('button, a, input, select, textarea, label, [role="button"]')) return;
                              toggleExpand(e.id);
                            }}
                            style={{ cursor: 'pointer', background: expanded ? 'var(--color-primary-light)' : undefined }}
                          >
                            <td style={td}>
                              <button
                                type="button"
                                onClick={() => toggleExpand(e.id)}
                                aria-expanded={expanded}
                                style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}
                              >
                                {e.title}
                              </button>
                              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                {pol ? <>Waives {pol}</> : 'No policy linked'}{e.reason ? ` · ${e.reason}` : ''}
                              </div>
                            </td>
                            <td style={td}><span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{e.grantedAt ? fmtDate(e.grantedAt) : '—'}</span></td>
                            <td style={td}>
                              <span style={{ fontSize: 13, color: e.pastExpiry ? 'var(--color-error)' : 'var(--color-text-secondary)', fontWeight: e.pastExpiry ? 600 : 400 }}>
                                {e.expiresAt ? fmtDate(e.expiresAt) : '—'}
                              </span>
                            </td>
                            <td style={td}>{statusPill(e)}</td>
                            <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {isAdmin ? (
                                <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center', position: 'relative' }}>
                                  {e.status === 'ACTIVE'
                                    ? <SecondaryButton onClick={() => setStatus(e, 'CLOSED')}>Close</SecondaryButton>
                                    : <SecondaryButton onClick={() => setStatus(e, 'ACTIVE')}>Reopen</SecondaryButton>}
                                  <button type="button" aria-label="More actions" aria-haspopup="menu"
                                    onClick={(ev) => { ev.stopPropagation(); setRowMenuId(rowMenuId === e.id ? null : e.id); }}
                                    style={rowMenuBtnStyle}>⋯</button>
                                  {rowMenuId === e.id && (
                                    <div role="menu" onClick={(ev) => ev.stopPropagation()} style={rowMenuStyle}>
                                      <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); toggleExpand(e.id); }}>Open &amp; edit</button>
                                      <button type="button" role="menuitem" style={{ ...menuItemStyle, color: 'var(--color-error)' }} onClick={() => { setRowMenuId(null); setConfirmDelete(e.id); }}>Delete</button>
                                    </div>
                                  )}
                                </div>
                              ) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                            </td>
                          </tr>
                          {expanded && (
                            <tr>
                              <td colSpan={5} style={{ padding: 0, background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
                                <ExceptionDetail exc={e} policies={policies} canEdit={isAdmin} onSaved={load} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </main>

          {/* Side panel — what an exception is and how it flows. */}
          <aside style={{ flex: '1 1 260px', minWidth: 0 }}>
            <Card>
              <SectionLabel marginBottom={10}>How exceptions work</SectionLabel>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
                <li><strong style={{ color: 'var(--color-text)' }}>Grant</strong> a waiver with a reason and an expiry when a policy can't be met yet.</li>
                <li>It stays <strong style={{ color: 'var(--color-text)' }}>Active</strong> until its expiry; the council reviews what's <strong style={{ color: 'var(--color-text)' }}>expiring</strong>.</li>
                <li>Past expiry, it's flagged <strong style={{ color: 'var(--color-error)' }}>Past expiry</strong> — renew (extend the date) or <strong style={{ color: 'var(--color-text)' }}>Close</strong> it.</li>
              </ol>
              <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                Only admins can grant or close exceptions. Everyone can see the roster.
              </p>
            </Card>
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete exception?"
        message="This permanently removes the exception record. To keep the history, Close it instead."
        confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); if (id) await remove(id); }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

const td: React.CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--color-border)', fontSize: 14, verticalAlign: 'top' };
