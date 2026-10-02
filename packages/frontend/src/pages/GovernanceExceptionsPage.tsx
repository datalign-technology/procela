import { useEffect, useState, useCallback, Fragment } from 'react';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Spinner from '../components/Spinner';
import EditableField from '../components/EditableField';
import DetailEditActions from '../components/DetailEditActions';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { successToast, errorToast } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';

interface GovException {
  id: string; orgId: string; title: string; reason?: string;
  status: 'ACTIVE' | 'CLOSED'; grantedAt: string; expiresAt: string; pastExpiry?: boolean;
}

const inputStyle: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 10px', fontSize: 13, background: 'var(--color-surface)', color: 'var(--color-text)' };

// The expanded row detail: the exception's own fields (title / expiry /
// reason) with a view→Edit→Save toggle. One Save writes PUT
// /governance-exceptions/:id. The ACTIVE/CLOSED lifecycle stays on the row's
// Close / Reopen buttons (a state action, not a record edit).
function ExceptionDetail({ exc, canEdit, onSaved }: {
  exc: GovException;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const m = useDetailEditMode<{ title: string; reason: string; expiresAt: string }>(
    { title: exc.title, reason: exc.reason ?? '', expiresAt: (exc.expiresAt || '').slice(0, 10) },
    async (draft) => {
      if (!draft.title.trim()) { errorToast(null, 'Title is required'); throw new Error('no-title'); }
      if (!draft.expiresAt) { errorToast(null, 'Expiry date is required'); throw new Error('no-expiry'); }
      try {
        await apiClient.put(`/governance-exceptions/${exc.id}`, {
          title: draft.title.trim(),
          reason: draft.reason.trim() || undefined,
          expiresAt: draft.expiresAt,
        });
        successToast('Exception updated');
        onSaved();
      } catch (err) { errorToast(err, 'Failed to update exception'); throw err; }
    },
  );
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
          {exc.expiresAt ? new Date(exc.expiresAt).toLocaleDateString() : '—'}
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
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  // Row-click expansion: open an exception's full detail (reason + a
  // view→Edit→Save editor for its own fields) inline, matching the other
  // governance lists.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleExpand = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  const load = useCallback(async () => {
    if (!activeOrgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await apiClient.get<{ success: boolean; data: GovException[] }>(`/governance-exceptions?orgId=${activeOrgId}`);
      setRows(res.data || []);
    } catch { addToast('error', 'Failed to load exceptions.'); }
    finally { setLoading(false); }
  }, [activeOrgId, addToast]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!activeOrgId || !title.trim() || !expiresAt) return;
    setSaving(true);
    try {
      await apiClient.post('/governance-exceptions', { orgId: activeOrgId, title: title.trim(), expiresAt, reason: reason.trim() || undefined });
      setTitle(''); setExpiresAt(''); setReason('');
      addToast('success', 'Exception granted.');
      load();
    } catch { addToast('error', 'Failed to grant exception. You may not have permission.'); }
    finally { setSaving(false); }
  };

  const setStatus = async (e: GovException, status: 'ACTIVE' | 'CLOSED') => {
    try { await apiClient.put(`/governance-exceptions/${e.id}`, { status }); load(); }
    catch { addToast('error', 'Failed to update.'); }
  };
  const remove = async (e: GovException) => {
    try { await apiClient.delete(`/governance-exceptions/${e.id}`); load(); }
    catch { addToast('error', 'Failed to delete.'); }
  };

  const pastExpiryCount = rows.filter((r) => r.pastExpiry).length;

  return (
    <div>
      <PageHeader
        title="Governance Exceptions"
        subtitle="Time-boxed waivers of a policy or control. Those still active past their expiry are what the council watches."
      />

      {isAdmin && (
      <Card padding={16} marginBottom={16}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 10 }}>Grant an exception</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input aria-label="Title" placeholder="What is being waived?" value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inputStyle, flex: '2 1 240px' }} />
          <input aria-label="Expiry date" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} style={{ ...inputStyle, flex: '1 1 150px' }} />
          <input aria-label="Reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, flex: '2 1 200px' }} />
          <Button variant="primary" disabled={!title.trim() || !expiresAt} loading={saving} onClick={add}>Grant</Button>
        </div>
      </Card>
      )}

      {loading ? <Spinner center label="Loading…" /> : (
        <Card padding={0}>
          {pastExpiryCount > 0 && (
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border)', fontSize: 13, color: 'var(--color-error)', fontWeight: 600 }}>
              {pastExpiryCount} exception{pastExpiryCount === 1 ? '' : 's'} past expiry — renew or close.
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  {['Exception', 'Granted', 'Expires', 'Status', ''].map((h, i) => (
                    <th key={h || i} style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', padding: '10px 14px', borderBottom: '1.5px solid var(--color-border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>No exceptions recorded.</td></tr>
                ) : rows.map((e) => {
                  const expanded = expandedId === e.id;
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
                      {e.reason && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{e.reason}</div>}
                    </td>
                    <td style={td}><span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{e.grantedAt ? new Date(e.grantedAt).toLocaleDateString() : '—'}</span></td>
                    <td style={td}>
                      <span style={{ fontSize: 13, color: e.pastExpiry ? 'var(--color-error)' : 'var(--color-text-secondary)', fontWeight: e.pastExpiry ? 600 : 400 }}>
                        {e.expiresAt ? new Date(e.expiresAt).toLocaleDateString() : '—'}{e.pastExpiry && ' · past'}
                      </span>
                    </td>
                    <td style={td}>
                      {(() => {
                        // A waiver that's still ACTIVE past its expiry is the
                        // thing the council watches, so flag it red in the
                        // status column too — not just via the expires date.
                        const overdue = e.status === 'ACTIVE' && e.pastExpiry;
                        const pal = overdue
                          ? { bg: '#fee2e2', color: '#dc2626' }
                          : e.status === 'ACTIVE'
                            ? { bg: 'var(--color-primary-light)', color: 'var(--color-primary)' }
                            : { bg: 'var(--color-bg)', color: 'var(--color-text-muted)' };
                        return (
                          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap', background: pal.bg, color: pal.color }}>
                            {e.status}{overdue ? ' · overdue' : ''}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isAdmin ? (<>
                      {e.status === 'ACTIVE'
                        ? <Button size="sm" variant="secondary" onClick={() => setStatus(e, 'CLOSED')}>Close</Button>
                        : <Button size="sm" variant="secondary" onClick={() => setStatus(e, 'ACTIVE')}>Reopen</Button>}
                      <Button size="sm" variant="ghost" onClick={() => remove(e)}>Delete</Button>
                      </>) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={5} style={{ padding: 0, background: '#fafbfc', borderBottom: '1px solid var(--color-border)' }}>
                        <ExceptionDetail exc={e} canEdit={isAdmin} onSaved={load} />
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
      )}
    </div>
  );
}

const td: React.CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--color-border)', fontSize: 14, verticalAlign: 'top' };
