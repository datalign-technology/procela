import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';
import Modal from './Modal';
import SectionLabel from './SectionLabel';
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

  // The modal has two stacked views: a list of all versions, and the
  // snapshot of a single version. The Modal chrome wraps both; only the
  // title and inner content swap based on `viewing`. The "Back" button
  // appears in the actions slot when viewing a snapshot so the user can
  // return to the list without closing the dialog.
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={viewing ? `Version ${viewing.version} Snapshot` : 'Version History'}
      actions={viewing ? (
        <button
          onClick={() => setViewing(null)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--color-primary)', padding: '4px 8px' }}
        >
          Back
        </button>
      ) : undefined}
    >
        {viewing ? (
            <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: 16 }}>
              <div style={{ marginBottom: 8 }}>
                <SectionLabel marginBottom={0}>Name</SectionLabel>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{viewing.snapshot.name}</div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <SectionLabel marginBottom={0}>Description</SectionLabel>
                <div style={{ fontSize: 13 }}>{viewing.snapshot.description || '(none)'}</div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <SectionLabel marginBottom={0}>Status at this version</SectionLabel>
                <span style={statusBadge(viewing.status)}>{viewing.status}</span>
              </div>
              <div style={{ marginBottom: 8 }}>
                <SectionLabel marginBottom={0}>Level</SectionLabel>
                <div style={{ fontSize: 13 }}>{viewing.snapshot.level}</div>
              </div>
              <div>
                <SectionLabel marginBottom={0}>Note</SectionLabel>
                <div style={{ fontSize: 13 }}>{viewing.note}</div>
              </div>
            </div>
        ) : (
          <>
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
    </Modal>
  );
}
