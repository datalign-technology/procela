import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import ConfirmDialog from './ConfirmDialog';

// Settings → Connectors panel. Lists every paired on-prem connector
// for the active org with its live freshness status, and lets an
// admin create a new pairing, edit (name + systems), inspect recent
// activity, or revoke.
//
// Pairing UX: the admin clicks "Add connector", picks a name and the
// systems this connector reports for, and gets back an 8-digit code.
// The modal shows the code + the docker command. The connector
// claims the code on first boot and starts heartbeating within a
// minute.

interface ConnectorRow {
  id: string;
  orgId: string;
  name: string;
  status: 'PAIRED' | 'ONLINE' | 'STALE' | 'OFFLINE' | 'REVOKED';
  lastHeartbeatAt: string | null;
  agentVersion: string | null;
  systemIds: string[];
  pairingCodeActive: boolean;
  createdAt: string;
}

interface SystemRef {
  id: string;
  name: string;
}

interface ConnectorEvent {
  id: string;
  type: 'PAIRED' | 'HEARTBEAT' | 'SCAN_STARTED' | 'SCAN_COMPLETED' | 'SCAN_FAILED' | 'ASSETS_REPORTED';
  ts: string;
  data: Record<string, any>;
}

interface PairStartResponse {
  success: boolean;
  data?: { id: string; name: string; pairingCode: string; expiresAt: string };
  error?: string;
}

const STATUS_STYLES: Record<ConnectorRow['status'], { bg: string; color: string; label: string; title: string }> = {
  ONLINE:  { bg: '#dcfce7', color: '#166534', label: 'Online',  title: 'Heartbeat received in the last 30 minutes' },
  STALE:   { bg: '#fef3c7', color: '#92400e', label: 'Stale',   title: 'No heartbeat in 30 min – 4 hours' },
  OFFLINE: { bg: '#fee2e2', color: '#991b1b', label: 'Offline', title: 'No heartbeat in over 4 hours' },
  PAIRED:  { bg: '#e0e7ff', color: '#3730a3', label: 'Awaiting first heartbeat', title: 'Pairing code issued — waiting for the connector to claim it' },
  REVOKED: { bg: '#f3f4f6', color: '#4b5563', label: 'Revoked', title: 'Connector token revoked' },
};

function StatusChip({ status }: { status: ConnectorRow['status'] }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      title={s.title}
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        background: s.bg,
        color: s.color,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.2,
        textTransform: 'uppercase',
      }}
    >
      {s.label}
    </span>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} d ago`;
}

const EVENT_LABEL: Record<ConnectorEvent['type'], string> = {
  PAIRED:           'Paired',
  HEARTBEAT:        'Heartbeat',
  SCAN_STARTED:     'Scan started',
  SCAN_COMPLETED:   'Scan completed',
  SCAN_FAILED:      'Scan failed',
  ASSETS_REPORTED:  'Assets reported',
};

// Systems multi-picker — small enough that inline checkboxes beat a
// full dropdown component. Used in both the Add modal and the
// detail drawer.
function SystemsPicker({ all, selected, onToggle }: {
  all: SystemRef[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (all.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
        No systems defined yet. Add one from the Systems page first, then assign it here.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 140, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 4, padding: 8 }}>
      {all.map((s) => {
        const checked = selected.includes(s.id);
        return (
          <label
            key={s.id}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 8px', fontSize: 12,
              border: `1px solid ${checked ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: checked ? 'var(--color-primary-light)' : 'transparent',
              borderRadius: 4, cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(s.id)}
              style={{ margin: 0 }}
            />
            {s.name}
          </label>
        );
      })}
    </div>
  );
}

export default function ConnectorsSection({ sectionStyle, sectionTitleStyle }: {
  sectionStyle: React.CSSProperties;
  sectionTitleStyle: React.CSSProperties;
}) {
  const [rows, setRows] = useState<ConnectorRow[]>([]);
  const [systems, setSystems] = useState<SystemRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSystemIds, setNewSystemIds] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [issuedCode, setIssuedCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ConnectorRow | null>(null);
  const [detailTarget, setDetailTarget] = useState<ConnectorRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ success: boolean; data: ConnectorRow[] }>('/connectors');
      setRows(res.data || []);
    } catch (e: any) {
      setError(e?.message || 'failed to load connectors');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh every 30s so the freshness chips drift toward STALE /
  // OFFLINE without the admin reloading the page.
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  // Systems list — fetched once. Used by Add and Edit. Filtering
  // happens server-side via orgId scope; the connector endpoint
  // expects raw ids, not enriched objects.
  useEffect(() => {
    apiClient
      .get<{ success: boolean; data: SystemRef[] }>('/systems')
      .then((res) => setSystems((res.data || []).map((s) => ({ id: s.id, name: s.name }))))
      .catch(() => { /* leave empty — picker shows a friendly hint */ });
  }, []);

  const toggleNewSystem = (id: string) => {
    setNewSystemIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  async function handleAdd() {
    if (!newName.trim() || adding) return;
    setAdding(true);
    try {
      const res = await apiClient.post<PairStartResponse>('/connectors/pair/start', {
        name: newName.trim(),
        systemIds: newSystemIds,
      });
      if (res.success && res.data) {
        setIssuedCode({ code: res.data.pairingCode, expiresAt: res.data.expiresAt });
        setNewName('');
        setNewSystemIds([]);
        setAddOpen(false);
        await load();
      } else {
        setError(res.error || 'could not start pairing');
      }
    } catch (e: any) {
      setError(e?.message || 'could not start pairing');
    } finally {
      setAdding(false);
    }
  }

  async function handleRevoke(row: ConnectorRow) {
    try {
      await apiClient.delete(`/connectors/${row.id}`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'revoke failed');
    } finally {
      setRevokeTarget(null);
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 12 }}>
        <div>
          <h2 style={sectionTitleStyle}>On-prem connectors</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
            Small agents that run inside your network and ship catalog metadata back to Procela. Connection strings stay on-prem; only schema names, row counts, and freshness timestamps cross the wire.
          </p>
        </div>
        <button
          onClick={() => { setAddOpen(true); setError(null); }}
          style={{ padding: '8px 14px', fontSize: 13, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 500, flexShrink: 0 }}
        >
          Add connector
        </button>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 4, padding: '6px 10px', fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 0' }}>
          No connectors paired. Add one to start pulling live freshness signals from your on-prem data sources.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', textAlign: 'left' }}>
              <th style={{ padding: '6px 4px', fontWeight: 500 }}>Name</th>
              <th style={{ padding: '6px 4px', fontWeight: 500 }}>Status</th>
              <th style={{ padding: '6px 4px', fontWeight: 500 }}>Systems</th>
              <th style={{ padding: '6px 4px', fontWeight: 500 }}>Last heartbeat</th>
              <th style={{ padding: '6px 4px', fontWeight: 500 }}>Version</th>
              <th style={{ padding: '6px 4px', fontWeight: 500 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sysNames = r.systemIds
                .map((id) => systems.find((s) => s.id === id)?.name)
                .filter((n): n is string => !!n);
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-subtle, #f1f5f9)' }}>
                  <td style={{ padding: '8px 4px', fontWeight: 500 }}>
                    <button
                      onClick={() => setDetailTarget(r)}
                      style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: 'pointer', font: 'inherit', fontWeight: 500, textAlign: 'left', textDecoration: 'underline' }}
                      title="View recent activity"
                    >
                      {r.name}
                    </button>
                    {r.pairingCodeActive && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: '#92400e' }}>code pending</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 4px' }}><StatusChip status={r.status} /></td>
                  <td style={{ padding: '8px 4px', color: 'var(--color-text-muted)', fontSize: 12 }}>
                    {sysNames.length === 0 ? <span style={{ color: '#92400e' }}>none assigned</span> : sysNames.join(', ')}
                  </td>
                  <td style={{ padding: '8px 4px', color: 'var(--color-text-muted)' }}>{relativeTime(r.lastHeartbeatAt)}</td>
                  <td style={{ padding: '8px 4px', color: 'var(--color-text-muted)' }}>{r.agentVersion || '—'}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                    {r.status !== 'REVOKED' && (
                      <button
                        onClick={() => setRevokeTarget(r)}
                        style={{ padding: '4px 10px', fontSize: 12, background: 'transparent', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer' }}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {addOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setAddOpen(false)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-surface)', padding: 24, borderRadius: 8, width: 460, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 16 }}>Add connector</h3>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
              Connector name
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. prod-warehouse"
              autoFocus
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }}
            />
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
              Systems this connector reports for
            </label>
            <SystemsPicker all={systems} selected={newSystemIds} onToggle={toggleNewSystem} />
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 12, marginBottom: 16 }}>
              You'll receive a one-time pairing code valid for 10 minutes. Paste it into your connector's config and start the container.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setAddOpen(false)} style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || adding}
                style={{ padding: '8px 14px', fontSize: 13, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, cursor: !newName.trim() || adding ? 'not-allowed' : 'pointer', opacity: !newName.trim() || adding ? 0.6 : 1, fontWeight: 500 }}
              >
                {adding ? 'Generating…' : 'Generate pairing code'}
              </button>
            </div>
          </div>
        </div>
      )}

      {issuedCode && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setIssuedCode(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-surface)', padding: 24, borderRadius: 8, width: 480, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 16 }}>Pairing code</h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              Enter this code into your on-prem connector within 10 minutes. The code can only be claimed once.
            </p>
            <div style={{ fontFamily: 'monospace', fontSize: 32, fontWeight: 700, letterSpacing: 6, textAlign: 'center', padding: '16px 0', background: 'var(--color-bg)', border: '1px dashed var(--color-border)', borderRadius: 6, marginBottom: 16 }}>
              {issuedCode.code}
            </div>
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 16 }}>
              Pass via env on first boot:
              <br />
              <code style={{ fontFamily: 'monospace', fontSize: 11, background: 'var(--color-bg)', padding: '2px 6px', borderRadius: 3 }}>
                docker run -e PROCELA_PAIRING_CODE={issuedCode.code} -v ./connector.yaml:/etc/procela/connector.yaml procela-connector
              </code>
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setIssuedCode(null)} style={{ padding: '8px 14px', fontSize: 13, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 500 }}>Done</button>
            </div>
          </div>
        </div>
      )}

      {detailTarget && (
        <ConnectorDetailDrawer
          row={detailTarget}
          systems={systems}
          onClose={() => setDetailTarget(null)}
          onSaved={async () => { await load(); }}
        />
      )}

      <ConfirmDialog
        open={!!revokeTarget}
        title={`Revoke ${revokeTarget?.name || ''}?`}
        message="The connector's token will stop working immediately. The row stays in the audit log. You can pair a new connector with the same name afterwards."
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={async () => { if (revokeTarget) await handleRevoke(revokeTarget); }}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────
//
// Slides in from the right when an admin clicks a connector name.
// Two halves:
//   - editable: name + system assignments
//   - read-only: recent activity (pairing, heartbeats, scans, reports)
// Saves are explicit (a Save button); cancelling closes without
// posting. Closing while saving is fine — the PATCH runs to
// completion in the background.

function ConnectorDetailDrawer({ row, systems, onClose, onSaved }: {
  row: ConnectorRow;
  systems: SystemRef[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(row.name);
  const [systemIds, setSystemIds] = useState<string[]>(row.systemIds);
  const [events, setEvents] = useState<ConnectorEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = name.trim() !== row.name || JSON.stringify(systemIds.slice().sort()) !== JSON.stringify(row.systemIds.slice().sort());

  useEffect(() => {
    setLoadingEvents(true);
    apiClient
      .get<{ success: boolean; data: ConnectorEvent[] }>(`/connectors/${row.id}/events`)
      .then((res) => setEvents(res.data || []))
      .catch(() => setEvents([]))
      .finally(() => setLoadingEvents(false));
  }, [row.id]);

  const toggleSystem = (id: string) => {
    setSystemIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiClient.patch(`/connectors/${row.id}`, { name: name.trim(), systemIds });
      await onSaved();
      onClose();
    } catch (e: any) {
      setSaveError(e?.message || 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'flex-end', zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 480, maxWidth: '95vw', background: 'var(--color-surface)', height: '100%', boxShadow: '-8px 0 20px rgba(0,0,0,0.1)', overflowY: 'auto', padding: 24, boxSizing: 'border-box' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Connector details</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)' }}>×</button>
        </div>

        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 6 }}>Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }}
        />

        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 6 }}>Systems this connector reports for</label>
        <SystemsPicker all={systems} selected={systemIds} onToggle={toggleSystem} />

        {saveError && (
          <div style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 4, padding: '6px 10px', fontSize: 12, marginTop: 12 }}>
            {saveError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, marginBottom: 20 }}>
          <button onClick={onClose} style={{ padding: '6px 12px', fontSize: 13, background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            style={{ padding: '6px 12px', fontSize: 13, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, cursor: !dirty || saving ? 'not-allowed' : 'pointer', opacity: !dirty || saving ? 0.6 : 1, fontWeight: 500 }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        <h4 style={{ fontSize: 13, fontWeight: 600, marginTop: 24, marginBottom: 8, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Recent activity</h4>
        {loadingEvents ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>
        ) : events.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No activity yet. The connector hasn't paired or sent a report.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12 }}>
            {events.map((e) => (
              <li key={e.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border-subtle, #f1f5f9)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontWeight: 500 }}>{EVENT_LABEL[e.type] || e.type}</span>
                  <span style={{ color: 'var(--color-text-muted)' }} title={new Date(e.ts).toLocaleString()}>{relativeTime(e.ts)}</span>
                </div>
                {Object.keys(e.data || {}).length > 0 && (
                  <div style={{ marginTop: 2, color: 'var(--color-text-muted)', fontFamily: 'monospace', fontSize: 11 }}>
                    {Object.entries(e.data).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
