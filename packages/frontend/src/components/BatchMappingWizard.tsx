import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { useToastStore } from '../stores/toastStore';

// ── Types ──

interface BatchMappingWizardProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  onCreated: () => void;
}

interface ProcessNode {
  id: string;
  name: string;
  level: string;
}

interface DataAsset {
  id: string;
  name: string;
}

interface MappingRecord {
  id: string;
  processStepId: string;
  dataAssetId: string;
}

// ── Styles ──

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'var(--color-primary)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

// ── Component ──

export default function BatchMappingWizard({ open, onClose, orgId, onCreated }: BatchMappingWizardProps) {
  const addToast = useToastStore((s) => s.addToast);

  const [steps, setSteps] = useState<Array<{ id: string; name: string; level: string }>>([]);
  const [assets, setAssets] = useState<Array<{ id: string; name: string }>>([]);
  const [existingMappings, setExistingMappings] = useState<Set<string>>(new Set());
  const [newMappings, setNewMappings] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const query = orgId ? `?orgId=${orgId}` : '';
      const [nodesRes, assetsRes, mappingsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: ProcessNode[] }>(`/process-catalog${query}`),
        apiClient.get<{ success: boolean; data: DataAsset[] }>(`/data-assets${query}`),
        apiClient.get<{ success: boolean; data: MappingRecord[] }>(`/mappings${query}`),
      ]);

      const allNodes = nodesRes.data || [];
      // Filter to ACTIVITY (or TASK) level only
      const activities = allNodes.filter(
        (n) => n.level === 'ACTIVITY' || n.level === 'TASK',
      );
      setSteps(activities);
      setAssets(assetsRes.data || []);

      const existing = new Set<string>();
      for (const m of mappingsRes.data || []) {
        existing.add(`${m.processStepId}:${m.dataAssetId}`);
      }
      setExistingMappings(existing);
      setNewMappings(new Set());
    } catch {
      addToast('error', 'Failed to load data for batch mapping');
    } finally {
      setLoading(false);
    }
  }, [orgId, addToast]);

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open, fetchData]);

  const toggleMapping = (stepId: string, assetId: string) => {
    const key = `${stepId}:${assetId}`;
    setNewMappings((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleApply = async () => {
    setApplying(true);
    const pairs = Array.from(newMappings).map((key) => {
      const [processStepId, dataAssetId] = key.split(':');
      return { processStepId, dataAssetId, linkType: 'INPUT', notes: '' };
    });
    try {
      await Promise.all(pairs.map((p) => apiClient.post('/mappings', p)));
      addToast('success', `Created ${pairs.length} mapping${pairs.length !== 1 ? 's' : ''}`);
      onCreated();
      onClose();
    } catch {
      addToast('error', 'Failed to create some mappings');
    } finally {
      setApplying(false);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          width: '95%',
          maxWidth: 900,
          maxHeight: '85vh',
          overflow: 'auto',
          padding: 24,
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Batch Mapping</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              padding: '4px 8px',
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '3rem' }}>
            Loading...
          </p>
        ) : steps.length === 0 || assets.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '3rem' }}>
            {steps.length === 0 && assets.length === 0
              ? 'No process activities or data assets found. Create some first.'
              : steps.length === 0
                ? 'No process activities found. Create process activities first.'
                : 'No data assets found. Create data assets first.'}
          </p>
        ) : (
          <>
            <div style={{ overflow: 'auto', maxHeight: '60vh' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    <th
                      style={{
                        position: 'sticky',
                        left: 0,
                        background: 'var(--color-surface)',
                        zIndex: 2,
                        padding: '6px 10px',
                        minWidth: 200,
                        textAlign: 'left',
                      }}
                    >
                      Process Step
                    </th>
                    {assets.map((a) => (
                      <th
                        key={a.id}
                        style={{
                          padding: '6px 8px',
                          textAlign: 'center',
                          whiteSpace: 'nowrap',
                          transform: 'rotate(-45deg)',
                          transformOrigin: 'left bottom',
                          minWidth: 40,
                        }}
                      >
                        {a.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {steps.map((step) => (
                    <tr key={step.id}>
                      <td
                        style={{
                          position: 'sticky',
                          left: 0,
                          background: 'var(--color-surface)',
                          zIndex: 1,
                          padding: '4px 10px',
                          borderTop: '1px solid var(--color-border)',
                        }}
                      >
                        {step.name}
                      </td>
                      {assets.map((asset) => {
                        const exists = existingMappings.has(`${step.id}:${asset.id}`);
                        const checked = newMappings.has(`${step.id}:${asset.id}`) || exists;
                        return (
                          <td
                            key={asset.id}
                            style={{
                              textAlign: 'center',
                              padding: 4,
                              borderTop: '1px solid var(--color-border)',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={exists}
                              onChange={() => toggleMapping(step.id, asset.id)}
                              title={
                                exists
                                  ? 'Already mapped'
                                  : checked
                                    ? 'Will be created'
                                    : 'Click to map'
                              }
                              style={{
                                cursor: exists ? 'default' : 'pointer',
                                opacity: exists ? 0.5 : 1,
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 16,
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {newMappings.size} new mapping{newMappings.size !== 1 ? 's' : ''} to create
                {existingMappings.size > 0 && ` · ${existingMappings.size} existing`}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnSecondary} onClick={onClose}>
                  Cancel
                </button>
                <button
                  style={{ ...btnPrimary, opacity: newMappings.size === 0 || applying ? 0.6 : 1 }}
                  disabled={newMappings.size === 0 || applying}
                  onClick={handleApply}
                >
                  {applying
                    ? 'Creating...'
                    : `Create ${newMappings.size} Mapping${newMappings.size !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
