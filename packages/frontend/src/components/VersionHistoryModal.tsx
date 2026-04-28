import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';
import { getStatusColor } from '@/lib/statusBadge';

interface ProcessNodeSnapshot {
  name: string;
  description: string;
  level: string;
  [key: string]: unknown;
}

interface ProcessVersion {
  id: string;
  nodeId: string;
  version: number;
  snapshot: ProcessNodeSnapshot;
  changedBy: string | null;
  changedAt: string;
  status: string;
  note: string;
}

interface VersionHistoryModalProps {
  nodeId: string;
  onClose: () => void;
}

export default function VersionHistoryModal({ nodeId, onClose }: VersionHistoryModalProps) {
  const [versions, setVersions] = useState<ProcessVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<ProcessVersion | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ success: boolean; data: ProcessVersion[] }>(`/process-catalog/nodes/${nodeId}/history`);
      setVersions(res.data || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [nodeId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const statusBadge = (status: string) => {
    const c = getStatusColor(status);
    return { display: 'inline-block' as const, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 as const, background: c.bg, color: c.color };
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }} onClick={() => { onClose(); }}>
      <div style={{
        background: 'var(--color-surface)', borderRadius: 'var(--radius-md)',
        padding: 24, maxWidth: 600, width: '90vw', maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }} onClick={(e) => e.stopPropagation()}>
        {viewing ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>Version {viewing.version} Snapshot</h2>
              <button onClick={() => setViewing(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--color-primary)', padding: '4px 8px' }}>Back</button>
            </div>
            <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: 16 }}>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{viewing.snapshot.name}</div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description</div>
                <div style={{ fontSize: 13 }}>{viewing.snapshot.description || '(none)'}</div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status at this version</div>
                <span style={statusBadge(viewing.status)}>{viewing.status}</span>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Level</div>
                <div style={{ fontSize: 13 }}>{viewing.snapshot.level}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Note</div>
                <div style={{ fontSize: 13 }}>{viewing.note}</div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>Version History</h2>
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)', padding: '0 4px' }}>x</button>
            </div>
            {loading ? (
              <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '2rem' }}>Loading...</p>
            ) : versions.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '2rem' }}>No version history yet. History is recorded when a node's status changes.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {versions.map((v) => {
                  const c = getStatusColor(v.status);
                  return (
                    <div key={v.id} style={{
                      background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '10px 14px',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>Version {v.version}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                          <span style={{
                            display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, marginRight: 6,
                            background: c.bg, color: c.color,
                          }}>{v.status}</span>
                          {new Date(v.changedAt).toLocaleString()}
                        </div>
                      </div>
                      <button onClick={() => setViewing(v)}
                        style={{ padding: '4px 10px', fontSize: 11, fontWeight: 500, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                        View
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
