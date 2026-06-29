import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import ConfirmDialog from './ConfirmDialog';

// Settings → Connectors panel. Lists every paired on-prem connector
// for the active org with its live freshness status, and lets an
// admin create a new pairing or revoke a stale one.
//
// Pairing UX: the admin clicks "Add connector", types a name, and
// gets back an 8-digit code. The modal shows the code + the docker
// command they paste into their on-prem host. The connector claims
// the code on first boot and starts heartbeating within a minute.

interface ConnectorRow {
  id: string;
  orgId: string;
  name: string;
  status: 'PAIRED' | 'ONLINE' | 'STALE' | 'OFFLINE' | 'REVOKED';
  lastHeartbeatAt: string | null;
  agentVersion: string | null;
  pairingCodeActive: boolean;
  createdAt: string;
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

export default function ConnectorsSection({ sectionStyle, sectionTitleStyle }: {
  sectionStyle: React.CSSProperties;
  sectionTitleStyle: React.CSSProperties;
}) {
  const [rows, setRows] = useState<ConnectorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [issuedCode, setIssuedCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ConnectorRow | null>(null);

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
  // OFFLINE without the admin reloading the page. Cheap — the list
  // endpoint is just an in-memory scan.
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function handleAdd() {
    if (!newName.trim() || adding) return;
    setAdding(true);
    try {
      const res = await apiClient.post<PairStartResponse>('/connectors/pair/start', { name: newName.trim() });
      if (res.success && res.data) {
        setIssuedCode({ code: res.data.pairingCode, expiresAt: res.data.expiresAt });
        setNewName('');
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
              <th style={{ padding: '6px 4px', fontWeight: 500 }}>Last heartbeat</th>
              <th style={{ padding: '6px 4px', fontWeight: 500 }}>Version</th>
              <th style={{ padding: '6px 4px', fontWeight: 500 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-subtle, #f1f5f9)' }}>
                <td style={{ padding: '8px 4px', fontWeight: 500 }}>
                  {r.name}
                  {r.pairingCodeActive && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#92400e' }}>code pending</span>
                  )}
                </td>
                <td style={{ padding: '8px 4px' }}><StatusChip status={r.status} /></td>
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
            ))}
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
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-surface)', padding: 24, borderRadius: 8, width: 420, maxWidth: '90vw' }}>
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
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
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
