import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Spinner from '../components/Spinner';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';

interface GovException {
  id: string; orgId: string; title: string; reason?: string;
  status: 'ACTIVE' | 'CLOSED'; grantedAt: string; expiresAt: string; pastExpiry?: boolean;
}

const inputStyle: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 10px', fontSize: 13, background: 'var(--color-surface)', color: 'var(--color-text)' };

export default function GovernanceExceptionsPage() {
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const [rows, setRows] = useState<GovException[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

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

      <Card padding={16} marginBottom={16}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 10 }}>Grant an exception</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input aria-label="Title" placeholder="What is being waived?" value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inputStyle, flex: '2 1 240px' }} />
          <input aria-label="Expiry date" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} style={{ ...inputStyle, flex: '1 1 150px' }} />
          <input aria-label="Reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, flex: '2 1 200px' }} />
          <Button variant="primary" disabled={!title.trim() || !expiresAt} loading={saving} onClick={add}>Grant</Button>
        </div>
      </Card>

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
                    <th key={h || i} style={{ textAlign: i > 0 && i < 4 ? 'left' : 'left', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', padding: '10px 14px', borderBottom: '1.5px solid var(--color-border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>No exceptions recorded.</td></tr>
                ) : rows.map((e) => (
                  <tr key={e.id}>
                    <td style={td}><div style={{ fontWeight: 600 }}>{e.title}</div>{e.reason && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{e.reason}</div>}</td>
                    <td style={td}><span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{e.grantedAt ? new Date(e.grantedAt).toLocaleDateString() : '—'}</span></td>
                    <td style={td}>
                      <span style={{ fontSize: 13, color: e.pastExpiry ? 'var(--color-error)' : 'var(--color-text-secondary)', fontWeight: e.pastExpiry ? 600 : 400 }}>
                        {e.expiresAt ? new Date(e.expiresAt).toLocaleDateString() : '—'}{e.pastExpiry && ' · past'}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: e.status === 'ACTIVE' ? 'var(--color-primary-light)' : 'var(--color-bg)', color: e.status === 'ACTIVE' ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>{e.status}</span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {e.status === 'ACTIVE'
                        ? <Button size="sm" variant="secondary" onClick={() => setStatus(e, 'CLOSED')}>Close</Button>
                        : <Button size="sm" variant="secondary" onClick={() => setStatus(e, 'ACTIVE')}>Reopen</Button>}
                      <Button size="sm" variant="ghost" onClick={() => remove(e)}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

const td: React.CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--color-border)', fontSize: 14, verticalAlign: 'top' };
