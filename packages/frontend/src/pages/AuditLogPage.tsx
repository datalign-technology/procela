import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { useOrgContext } from '../stores/orgContext';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import Avatar from '../components/Avatar';
import { SkeletonRows } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { renderNavIcon } from '../components/navIcons';
import { usePagination } from '../hooks/usePagination';
import Pager from '../components/Pager';

// ──────────────────────────────────────────────────────────────────────────
// AuditLogPage — full audit trail in one place.
//
// The Dashboard's Recent Activity widget shows the most recent ~5 entries;
// per-entity detail pages show what happened to that record; this page is
// the catch-all "who did what" view across the whole org with filters, a
// one-click integrity check, and CSV export — so questions like "who deleted
// my value stream last week" have an answer without digging through records.
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
  // Optional payload — some emitters include a `before` / `after` blob, used
  // to summarize what actually changed on an update.
  before?: unknown;
  after?: unknown;
}

interface Person { id: string; name: string }

const PAGE_LIMIT = 500;

const WHEN_OPTIONS: Array<{ value: string; label: string; ms: number | null }> = [
  { value: 'all', label: 'Any time', ms: null },
  { value: '24h', label: 'Last 24 hours', ms: 86400000 },
  { value: '7d', label: 'Last 7 days', ms: 7 * 86400000 },
  { value: '30d', label: 'Last 30 days', ms: 30 * 86400000 },
];

export default function AuditLogPage() {
  const { activeOrgId } = useOrgContext();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [entityFilter, setEntityFilter] = useState<string>('');
  const [userFilter, setUserFilter] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [whenFilter, setWhenFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  // Integrity check — lifted here so its outcome can render as a result strip
  // under the header, explaining what a pass/fail actually proves.
  const [integrity, setIntegrity] = useState<{ state: 'idle' | 'checking' | 'ok' | 'broken'; brokenAt?: number; total?: number; reason?: string }>({ state: 'idle' });
  const runIntegrity = async () => {
    setIntegrity({ state: 'checking' });
    try {
      const res = await apiClient.get<{ data: { valid: boolean; brokenAt: number; total: number; reason?: string } }>('/audit/verify');
      setIntegrity({ state: res.data.valid ? 'ok' : 'broken', brokenAt: res.data.brokenAt, total: res.data.total, reason: res.data.reason });
    } catch {
      setIntegrity({ state: 'broken', brokenAt: -1, total: 0, reason: 'The verifier endpoint could not be reached.' });
    }
  };

  // Export menu (one control, two scopes).
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!exportOpen) return;
    const close = (e: MouseEvent) => { if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [exportOpen]);

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

  // Distinct record types + actions present in the current result set.
  const entityTypes = useMemo(
    () => Array.from(new Set((entries || []).map((e) => e.entityType))).sort(),
    [entries],
  );
  const actions = useMemo(
    () => Array.from(new Set((entries || []).map((e) => e.action))).sort(),
    [entries],
  );

  const whenMs = WHEN_OPTIONS.find((o) => o.value === whenFilter)?.ms ?? null;
  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = search.trim().toLowerCase();
    const cutoff = whenMs == null ? null : Date.now() - whenMs;
    return entries.filter((e) => {
      if (actionFilter && e.action !== actionFilter) return false;
      if (cutoff != null && new Date(e.timestamp).getTime() < cutoff) return false;
      if (q) {
        const hay = `${e.entityName || ''} ${e.userName || ''} ${e.action} ${e.entityType}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, actionFilter, whenMs, search]);

  const auditPage = usePagination(filtered, 20);

  const exportCsv = () => {
    setExportOpen(false);
    const header = ['Timestamp', 'User', 'Action', 'Record type', 'Record', 'Record ID'];
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

  // Full server-side export — bypasses the page limit and includes the
  // entryHash column so a compliance reviewer can verify chain integrity
  // offline.
  const exportFullCsv = async () => {
    setExportOpen(false);
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
          icon={renderNavIcon('/organizations', { size: 36 })}
          title="No organization selected"
          description="Audit entries are scoped to one organization. Pick or create one from the Organizations page to see its history."
          action={{ label: 'Go to Organizations', onClick: () => { window.location.href = '/organizations'; } }}
        />
      </div>
    );
  }

  const integrityVerb = integrity.state === 'ok' ? 'Verified' : integrity.state === 'broken' ? 'Integrity check failed' : 'Verify integrity';

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle="Every create, update and delete recorded across the org — the answer to 'who changed this and when'."
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" onClick={runIntegrity} disabled={integrity.state === 'checking'}>
              {integrity.state === 'checking' ? 'Verifying…' : 'Verify integrity'}
            </Button>
            <div ref={exportRef} style={{ position: 'relative' }}>
              <Button variant="secondary" onClick={() => setExportOpen((v) => !v)} aria-haspopup="menu" aria-expanded={exportOpen} disabled={filtered.length === 0}>
                Export ▾
              </Button>
              {exportOpen && (
                <div role="menu" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30, minWidth: 260, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))', padding: 6 }}>
                  <button type="button" role="menuitem" onClick={exportCsv} style={exportItem}>
                    <div style={{ fontWeight: 600 }}>This view (CSV)</div>
                    <div style={exportItemSub}>The {filtered.length.toLocaleString()} filtered {filtered.length === 1 ? 'entry' : 'entries'} shown here.</div>
                  </button>
                  <button type="button" role="menuitem" onClick={exportFullCsv} style={exportItem}>
                    <div style={{ fontWeight: 600 }}>Full log · with checksums (CSV)</div>
                    <div style={exportItemSub}>The complete log from the server, including each entry's hash for offline integrity checks.</div>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      />

      {/* Integrity result strip — explains what the check proves. */}
      {integrity.state !== 'idle' && integrity.state !== 'checking' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 14px',
          borderRadius: 'var(--radius-md)', fontSize: 13,
          background: integrity.state === 'ok' ? '#d1fae5' : '#fee2e2',
          color: integrity.state === 'ok' ? '#065f46' : '#991b1b',
          border: `1px solid ${integrity.state === 'ok' ? '#6ee7b7' : '#fca5a5'}`,
        }}>
          <span style={{ fontSize: 16 }}>{integrity.state === 'ok' ? '🔒' : '⚠️'}</span>
          <span>
            <strong>{integrityVerb}.</strong>{' '}
            {integrity.state === 'ok'
              ? `All ${integrity.total?.toLocaleString() ?? ''} entries form an unbroken hash chain — nothing has been inserted, deleted, reordered or altered since they were written.`
              : integrity.brokenAt != null && integrity.brokenAt >= 0
                ? `The hash chain breaks at entry #${integrity.brokenAt + 1} — the log may have been tampered with. ${integrity.reason || ''}`
                : (integrity.reason || 'The audit log could not be verified.')}
          </span>
        </div>
      )}

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
          aria-label="Search audit log" placeholder="Search record, person, action…"
          style={{
            flex: '1 1 220px', minWidth: 180,
            padding: '6px 12px', fontSize: 13,
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
          }}
        />
        <FilterSelect label="When" value={whenFilter} onChange={setWhenFilter}
          options={WHEN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
        <FilterSelect label="Record type" value={entityFilter} onChange={setEntityFilter}
          options={entityTypes.map((t) => ({ value: t, label: prettyEntity(t) }))} placeholder="All record types" />
        <FilterSelect label="Action" value={actionFilter} onChange={setActionFilter}
          options={actions.map((a) => ({ value: a, label: prettyLabel(a) }))} placeholder="All actions" />
        <FilterSelect label="Person" value={userFilter} onChange={setUserFilter}
          options={people.map((p) => ({ value: p.id, label: p.name }))} placeholder="All people" />
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-text-muted)' }}>
          {entries === null ? 'Loading…' : `${filtered.length} of ${entries.length} ${entries.length >= PAGE_LIMIT ? `(latest ${PAGE_LIMIT})` : ''}`}
        </div>
      </div>

      {entries === null ? (
        <SkeletonRows rows={8} columnWidths={[140, 160, 110, null, null]} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={renderNavIcon('/audit-log', { size: 36 })}
          title={entries.length === 0 ? 'No activity recorded yet' : 'No entries match these filters'}
          description={entries.length === 0
            ? 'The audit log records who created, edited or deleted anything in this organization, as a tamper-evident hash chain. It’s empty because nothing has been changed here yet — try editing a data asset, then come back.'
            : 'Loosen the filters above to see more entries.'}
          action={entries.length === 0 ? { label: 'Go to Data Assets', onClick: () => { window.location.href = '/data-assets'; } } : undefined}
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
                <th style={th}>What changed</th>
              </tr>
            </thead>
            <tbody>
              {auditPage.pageItems.map((e) => {
                const ac = actionColor(e.action);
                return (
                  <tr key={e.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={td}>
                      <div>{relativeTime(e.timestamp)}</div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{absoluteTime(e.timestamp)}</div>
                    </td>
                    <td style={td}>
                      {e.userName
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar name={e.userName} size="sm" /><span>{e.userName}</span></span>
                        : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--color-text-muted)' }}><Avatar name="System" size="sm" /><span>System</span></span>}
                    </td>
                    <td style={td}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', borderRadius: 999,
                        background: ac.bg, color: ac.fg, fontSize: 12, fontWeight: 600,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: 3, background: ac.fg }} />{prettyLabel(e.action)}
                      </span>
                    </td>
                    <td style={td}>
                      <div>
                        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.3, marginRight: 6 }}>{prettyEntity(e.entityType)}</span>
                        {e.entityName || <span style={{ color: 'var(--color-text-muted)' }}>(deleted)</span>}
                      </div>
                    </td>
                    <td style={{ ...td, color: 'var(--color-text-secondary)' }}>{whatChanged(e)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <Pager pagination={auditPage} noun={['entry', 'entries']} />
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 12, lineHeight: 1.5 }}>
        Looking for the history of one record? Open it — a process node, data asset, system or person — and read its <strong style={{ color: 'var(--color-text)' }}>Activity</strong> tab, which shows just that record's timeline. This page is the org-wide view. <Link to="/help" style={{ color: 'var(--color-primary)' }}>Help guide</Link>
      </p>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<string | { value: string; label: string }>;
  placeholder?: string;
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
        {placeholder && <option value="">{placeholder}</option>}
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
const exportItem: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
  background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', font: 'inherit', fontSize: 13, color: 'var(--color-text)',
};
const exportItemSub: React.CSSProperties = { fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.4 };

function actionColor(action: string): { bg: string; fg: string } {
  const a = action.toLowerCase();
  if (a.includes('delete')) return { bg: '#fbe4e4', fg: '#9a1c1c' };
  if (a.includes('create')) return { bg: '#dcefe5', fg: '#17604b' };
  if (a.includes('update') || a.includes('edit')) return { bg: '#e6eef9', fg: '#24508f' };
  return { bg: 'var(--color-bg)', fg: 'var(--color-text-secondary)' };
}

// Sentence-case a SCREAMING_SNAKE action: "AUTO_CREATED" → "Auto created".
function prettyLabel(code: string): string {
  const s = (code || '').replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "GovernanceTask" / "data_asset" → "Governance task" / "Data asset".
function prettyEntity(code: string): string {
  const s = (code || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function prettyField(key: string): string {
  const s = (key || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// One-line "what changed": the created/deleted verb, or — for an update with a
// before/after blob — the fields that actually differ.
function whatChanged(e: AuditEntry): string {
  const a = e.action.toLowerCase();
  if (a.includes('create')) return 'Created the record';
  if (a.includes('delete')) return 'Removed the record';
  if ((a.includes('update') || a.includes('edit')) && e.before && e.after && typeof e.before === 'object' && typeof e.after === 'object') {
    const b = e.before as Record<string, unknown>;
    const af = e.after as Record<string, unknown>;
    const ignore = new Set(['updatedAt', 'updatedBy', 'createdAt', 'createdBy']);
    const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(af)]));
    const changed = keys.filter((k) => !ignore.has(k) && JSON.stringify(b[k]) !== JSON.stringify(af[k]));
    if (changed.length > 0) {
      return `Changed ${changed.slice(0, 3).map(prettyField).join(', ')}${changed.length > 3 ? `, +${changed.length - 3} more` : ''}`;
    }
    return 'Updated';
  }
  return prettyLabel(e.action);
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
