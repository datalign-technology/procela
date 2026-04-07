import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

// ── Types ──

interface Step {
  id: string;
  name: string;
}

interface SubProcess {
  id: string;
  name: string;
  steps: Step[];
}

interface Process {
  id: string;
  name: string;
  ownerId?: string;
  subProcesses: SubProcess[];
}

interface ValueStream {
  id: string;
  name: string;
  ownerId?: string;
  processes: Process[];
}

interface DataAsset {
  id: string;
  name: string;
  governanceTier: string;
  healthScore: number;
  systemId: string;
}

interface Mapping {
  processStepId: string;
  dataAssetId: string;
  aiSuggested: boolean;
}

interface UnmappedStep {
  stepId: string;
  stepName: string;
  subProcessName: string;
  processName: string;
  valueStreamName: string;
}

interface UngovervedAsset {
  id: string;
  name: string;
  governanceTier: string;
  healthScore: number;
}

interface OwnerlessItem {
  id: string;
  name: string;
  type: string; // 'Value Stream' | 'Process'
}

// ── Styles ──

const sectionStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 20,
  marginBottom: 20,
  boxShadow: 'var(--shadow-sm)',
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 16,
};

const countBadge = (count: number, severity: 'critical' | 'warning' | 'ok'): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 28,
  padding: '2px 10px',
  borderRadius: 12,
  fontSize: 13,
  fontWeight: 700,
  color: '#fff',
  background:
    count === 0
      ? 'var(--color-success, #22c55e)'
      : severity === 'critical'
        ? 'var(--color-danger, #ef4444)'
        : 'var(--color-warning, #eab308)',
});

const listItemStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--color-border)',
  fontSize: 14,
};

const hierarchyStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-muted)',
  marginTop: 2,
};

const noOwnerBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  background: 'var(--color-danger, #ef4444)',
  color: '#fff',
  marginLeft: 8,
};

export default function GapDetectionPage() {
  const [unmappedSteps, setUnmappedSteps] = useState<UnmappedStep[]>([]);
  const [ungovernedAssets, setUngovernedAssets] = useState<UngovervedAsset[]>([]);
  const [ownerlessItems, setOwnerlessItems] = useState<OwnerlessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [vsRes, assetsRes, mappingsRes] = await Promise.all([
          apiClient.get<{ success: boolean; data: ValueStream[] }>('/process-catalog/value-streams'),
          apiClient.get<{ success: boolean; data: DataAsset[] }>('/data-assets'),
          apiClient.get<{ success: boolean; data: Mapping[] }>('/mappings'),
        ]);

        const valueStreams = vsRes.data;
        const dataAssets = assetsRes.data;
        const mappings = mappingsRes.data;

        // 1. Unmapped process steps
        const mappedStepIds = new Set(mappings.map((m) => m.processStepId));
        const unmapped: UnmappedStep[] = [];
        for (const vs of valueStreams) {
          for (const proc of vs.processes) {
            for (const sp of proc.subProcesses) {
              for (const step of sp.steps) {
                if (!mappedStepIds.has(step.id)) {
                  unmapped.push({
                    stepId: step.id,
                    stepName: step.name,
                    subProcessName: sp.name,
                    processName: proc.name,
                    valueStreamName: vs.name,
                  });
                }
              }
            }
          }
        }
        setUnmappedSteps(unmapped);

        // 2. Ungoverned assets linked to process steps (BRONZE tier + has mapping)
        const linkedAssetIds = new Set(mappings.map((m) => m.dataAssetId));
        const ungoverned = dataAssets.filter(
          (a) => a.governanceTier === 'BRONZE' && linkedAssetIds.has(a.id),
        );
        setUngovernedAssets(ungoverned);

        // 3. Ownership gaps
        const ownerless: OwnerlessItem[] = [];
        for (const vs of valueStreams) {
          if (!(vs as any).ownerId) {
            ownerless.push({ id: vs.id, name: vs.name, type: 'Value Stream' });
          }
          for (const proc of vs.processes) {
            if (!(proc as any).ownerId) {
              ownerless.push({ id: proc.id, name: proc.name, type: 'Process' });
            }
          }
        }
        setOwnerlessItems(ownerless);
      } catch (err: any) {
        setError(err.message || 'Failed to load gap data');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Gap Detection</h1>
        <div style={{ color: 'var(--color-text-muted)' }}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Gap Detection</h1>
        <div style={{ color: 'var(--color-danger, #ef4444)' }}>Error: {error}</div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Gap Detection</h1>

      {/* Section 1: Unmapped Process Steps */}
      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Unmapped Process Steps</h2>
          <span style={countBadge(unmappedSteps.length, 'critical')}>{unmappedSteps.length}</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
          Process steps that have no data asset linked to them. These represent potential data gaps.
        </p>
        {unmappedSteps.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            All process steps are mapped. No gaps found.
          </div>
        ) : (
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {unmappedSteps.map((step) => (
              <div key={step.stepId} style={listItemStyle}>
                <div style={{ fontWeight: 600 }}>{step.stepName}</div>
                <div style={hierarchyStyle}>
                  {step.valueStreamName} &gt; {step.processName} &gt; {step.subProcessName}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 2: Ungoverned Assets */}
      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Ungoverned Assets</h2>
          <span style={countBadge(ungovernedAssets.length, 'warning')}>{ungovernedAssets.length}</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
          Data assets at BRONZE governance tier that are linked to process steps. These are risky
          because critical processes depend on minimally governed data.
        </p>
        {ungovernedAssets.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            No ungoverned assets linked to process steps.
          </div>
        ) : (
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {ungovernedAssets.map((asset) => (
              <div key={asset.id} style={listItemStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600 }}>{asset.name}</span>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      background: '#b45309',
                      color: '#fff',
                    }}
                  >
                    BRONZE
                  </span>
                </div>
                <div style={hierarchyStyle}>
                  Health: {asset.healthScore}%
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 3: Ownership Gaps */}
      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Ownership Gaps</h2>
          <span style={countBadge(ownerlessItems.length, 'warning')}>{ownerlessItems.length}</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
          Value streams and processes with no assigned owner. Every process should have clear
          accountability.
        </p>
        {ownerlessItems.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            All items have assigned owners.
          </div>
        ) : (
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {ownerlessItems.map((item) => (
              <div key={item.id} style={listItemStyle}>
                <span style={{ fontWeight: 600 }}>{item.name}</span>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-muted)',
                    marginLeft: 8,
                  }}
                >
                  ({item.type})
                </span>
                <span style={noOwnerBadgeStyle}>No owner</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
