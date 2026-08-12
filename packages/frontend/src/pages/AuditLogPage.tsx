import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { useOrgContext } from '../stores/orgContext';
import PageHeader from '../components/PageHeader';
import { SkeletonRows } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

// ──────────────────────────────────────────────────────────────────────────
// AuditLogPage — full audit trail in one place.
//
// The Dashboard's Recent Activity widget shows the most recent ~5 entries;
// per-entity detail pages show what happened to that record; this page is
// the catch-all "who did what" view across the whole org with filters and
// CSV export, so questions like "who deleted my value stream last week"
// have an answer that doesn't require digging through individual records.
// ──────────────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  orgId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  timestamp: string;
  entityName: string | null;
  userName: string | null;
  // Optional payload — some emitters include a `before` / `after` blob, but
  // the route enrichment doesn't strip them, so make them visible if present.
  before?: unknown;
  after?: unknown;
}

interface Person { id: string; name: string }

const PAGE_LIMIT = 500;

export default function AuditLogPage() {
  const { activeOrgId } = useOrgContext();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [entityFilter, setEntityFilter] = useState<string>('');
  const [userFilter, setUserFilter] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  useEffect(() => {
    if (!activeOrgId) { setEntries([]); return; }
    setEntries(null);
    const params = new URLSearchParams({ orgId: activeOrgId, limit: String(PAGE_LIMIT) });
    if (userFilter) params.set('userId', userFilter);
    if (entityFilter) params.set('entityType', entityFilter);
    apiClient
      .get<{ success: boolean; data: AuditEntry[] }>(`/audit?${params.toString()}`)
      .then((res) => setEntries(res.data || []))
      .catch(() => setEntries([]));
  }, [activeOrgId, entityFilter, userFilter]);

  useEffect(() => {
    if (!activeOrgId) return;
    apiClient.get<{ success: boolean; data: Person[] }>(`/people?orgId=${activeOrgId}`)
      .then((res) => setPeople(res.data || []))
      .catch(() => setPeople([]));
  }, [activeOrgId]);

  // Distinct entity types + actions in the current result set, sorted —
  // so the dropdown options reflect what's actually present rather than
  // a hardcoded list that might drift from the backend.
  const entityTypes = useMemo(
    () => Array.from(new Set((entries || []).map((e) => e.entityType))).sort(),
    [entries],
  );
  const actions = useMemo(
    () => Array.from(new Set((entries || []).map((e) => e.action))).sort(),
    [entries],
  );

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (actionFilter && e.action !== actionFilter) return false;
      if (q) {
        const hay = `${e.entityName || ''} ${e.userName || ''} ${e.action} ${e.entityType}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, actionFilter, search]);

  const exportCsv = () => {
    const header = ['Timestamp', 'User', 'Action', 'Entity Type', 'Entity', 'Entity ID'];
    const rows = filtered.map((e) => [
      e.timestamp, e.userName || '', e.action, e.entityType,
      e.entityName || '', e.entityId,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Full server-side export. The in-page export above only covers what
  // was loaded (capped at PAGE_LIMIT and post-filter); this one hits
  // the backend endpoint that bypasses the page limit and includes
  // the entryHash column so a compliance reviewer can verify chain
  // integrity offline.
  const exportFullCsv = async () => {
    if (!activeOrgId) return;
    const params = new URLSearchParams({ orgId: activeOrgId });
    if (userFilter)   params.set('userId', userFilter);
    if (entityFilter) params.set('entityType', entityFilter);
    const token = useAuthStore.getState().accessToken;
    const res = await fetch(`/api/v1/audit/export.csv?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-full-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!activeOrgId) {
    return (
      <div>
        <PageHeader title="Audit Log" />
        <EmptyState
          icon="🗂"
          title="No organization selected"
          description="Audit entries are scoped to one organization. Pick or create one from the Organizations page to see its history."
          action={{ label: 'Go to Organizations', onClick: () => { window.location.href = '/organizations'; } }}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle="Every create, update and delete recorded across the org — the answer to 'who changed this and when'."
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            <IntegrityCheckButton />
            <button
              onClick={exportCsv}
              disabled={filtered.length === 0}
              title="Export the currently-loaded, filtered view (capped at the page limit)."
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 500,
                background: 'var(--color-surface)', color: 'var(--color-text)',
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                cursor: filtered.length === 0 ? 'not-allowed' : 'pointer',
                opacity: filtered.length === 0 ? 0.5 : 1,
              }}
            >
              Export view (CSV)
            </button>
            <button
              onClick={exportFullCsv}
              disabled={!activeOrgId}
              title="Download the full audit log for this org from the server — bypasses the page limit, includes the entryHash for chain-integrity verification. Use for compliance reviews."
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 500,
                background: 'var(--color-surface)', color: 'var(--color-text)',
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                cursor: !activeOrgId ? 'not-allowed' : 'pointer',
                opacity: !activeOrgId ? 0.5 : 1,
              }}
            >
              Full log (CSV)
            </button>
          </div>
        )}
      >
      </PageHeader>

      {/* Filter row */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
        marginBottom: 16, padding: 12,
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search audit log" placeholder="Search entity, user, action…"
          style={{
            flex: '1 1 240px', minWidth: 200,
            padding: '6px 12px', fontSize: 13,
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
          }}
        />
        <FilterSelect label="Entity" value={entityFilter} onChange={setEntityFilter}
          options={entityTypes} placeholder="All entity types" />
        <FilterSelect label="Action" value={actionFilter} onChange={setActionFilter}
          options={actions} placeholder="All actions" />
        <FilterSelect label="User" value={userFilter} onChange={setUserFilter}
          options={people.map((p) => ({ value: p.id, label: p.name }))} placeholder="All users" />
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-text-muted)' }}>
          {entries === null ? 'Loading…' : `${filtered.length} of ${entries.length} ${entries.length >= PAGE_LIMIT ? `(latest ${PAGE_LIMIT})` : ''}`}
        </div>
      </div>

      {entries === null ? (
        <SkeletonRows rows={8} columnWidths={[140, 140, 100, 200, null]} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="◌"
          title={entries.length === 0 ? 'No activity recorded yet' : 'No entries match these filters'}
          description={entries.length === 0
            ? 'As soon as someone creates, edits or deletes anything in this organization, it will show up here.'
            : 'Loosen the filters above to see more entries.'}
        />
      ) : (
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', overflow: 'hidden',
        }}>
          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)', textAlign: 'left' }}>
                <th style={th}>When</th>
                <th style={th}>Who</th>
                <th style={th}>Did</th>
                <th style={th}>To</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={td}>
                    <div>{relativeTime(e.timestamp)}</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{absoluteTime(e.timestamp)}</div>
                  </td>
                  <td style={td}>{e.userName || <span style={{ color: 'var(--color-text-muted)' }}>system</span>}</td>
                  <td style={td}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                      background: actionColor(e.action).bg, color: actionColor(e.action).fg,
                      fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3,
                    }}>{e.action}</span>
                  </td>
                  <td style={td}>
                    <div>
                      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.3, marginRight: 6 }}>{e.entityType}</span>
                      {e.entityName || <span style={{ color: 'var(--color-text-muted)' }}>(deleted)</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 12 }}>
        Need per-record history instead? Open the record (a process node, data asset, system) and use its inline timeline. <Link to="/help">Help guide</Link>
      </p>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<string | { value: string; label: string }>;
  placeholder: string;
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
      {label}:
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '4px 8px', fontSize: 12,
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
          background: 'var(--color-surface)', color: 'var(--color-text)',
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => {
          const v = typeof o === 'string' ? o : o.value;
          const l = typeof o === 'string' ? o : o.label;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    </label>
  );
}

const th: React.CSSProperties = { padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.3 };
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };

function actionColor(action: string): { bg: string; fg: string } {
  const a = action.toLowerCase();
  if (a.includes('delete')) return { bg: '#fef2f2', fg: '#b91c1c' };
  if (a.includes('create')) return { bg: '#ecfdf5', fg: '#047857' };
  if (a.includes('update') || a.includes('edit')) return { bg: '#eff6ff', fg: '#1d4ed8' };
  return { bg: 'var(--color-bg)', fg: 'var(--color-text-secondary)' };
}

function relativeTime(iso: string): string {
  const diffSec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

// IntegrityCheckButton — runs the hash-chain verifier on demand and
// shows the result inline. Green = the log hasn't been touched since
// the entries were written. Red = something was inserted, deleted,
// reordered, or modified. Surface the broken index so an admin can
// open the row in the table and investigate.
function IntegrityCheckButton() {
  const [state, setState] = useState<'idle' | 'checking' | 'ok' | 'broken'>('idle');
  const [info, setInfo] = useState<{ brokenAt: number; total: number; reason?: string } | null>(null);

  const run = async () => {
    setState('checking');
    setInfo(null);
    try {
      const res = await apiClient.get<{ data: { valid: boolean; brokenAt: number; total: number; reason?: string } }>(
        '/audit/verify');
      setInfo({ brokenAt: res.data.brokenAt, total: res.data.total, reason: res.data.reason });
      setState(res.data.valid ? 'ok' : 'broken');
    } catch {
      setState('broken');
      setInfo({ brokenAt: -1, total: 0, reason: 'verifier endpoint failed' });
    }
  };

  let label = 'Verify integrity';
  let bg = 'var(--color-surface)';
  let color = 'var(--color-text)';
  let title = 'Walk the hash chain and confirm no entries have been altered.';
  if (state === 'checking') { label = 'Verifying…'; }
  else if (state === 'ok' && info) { label = `Verified · ${info.total} entries`; bg = '#d1fae5'; color = '#065f46'; title = 'Hash chain intact across the entire audit log.'; }
  else if (state === 'broken' && info) {
    label = info.brokenAt >= 0 ? `Broken at #${info.brokenAt + 1}` : 'Verify failed';
    bg = '#fee2e2'; color = '#991b1b';
    title = info.reason || 'The audit log appears to have been tampered with.';
  }

  return (
    <button
      onClick={run}
      disabled={state === 'checking'}
      title={title}
      style={{
        padding: '6px 14px', fontSize: 12, fontWeight: 500,
        background: bg, color, border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        cursor: state === 'checking' ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}
