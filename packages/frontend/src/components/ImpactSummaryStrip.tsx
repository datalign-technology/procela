import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import Card from './Card';

// ──────────────────────────────────────────────────────────────────────────
// ImpactSummaryStrip — the at-a-glance "blast radius" row on a data asset's
// 360 Overview tab: Activities / Processes / Downstream data / Value streams /
// People to notify, with a "See full impact" link to the Impact tab (where
// ImpactAnalysisPanel shows the full lists). Reads the same
// GET /data-assets/:id/impact endpoint, using only its summary counts.
// Renders nothing while loading or if the endpoint is unavailable, so the
// Overview stays clean.
// ──────────────────────────────────────────────────────────────────────────

interface ImpactSummary {
  activityCount: number;
  processCount: number;
  valueStreamCount: number;
  peopleCount: number;
  downstreamAssetCount: number;
}

export default function ImpactSummaryStrip({ assetId, onSeeFull }: { assetId: string; onSeeFull: () => void }) {
  const [summary, setSummary] = useState<ImpactSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ success: boolean; data: { summary: ImpactSummary } }>(`/data-assets/${assetId}/impact`)
      .then((r) => { if (!cancelled) setSummary(r.data?.summary || null); })
      .catch(() => { if (!cancelled) setSummary(null); });
    return () => { cancelled = true; };
  }, [assetId]);

  if (!summary) return null;

  const cells: { label: string; value: number }[] = [
    { label: 'Activities', value: summary.activityCount },
    { label: 'Processes', value: summary.processCount },
    { label: 'Downstream data', value: summary.downstreamAssetCount ?? 0 },
    { label: 'Value streams', value: summary.valueStreamCount },
    { label: 'People to notify', value: summary.peopleCount },
  ];

  return (
    <Card padding={18}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>If this asset changes or breaks</h2>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>What depends on it and who to tell.</div>
        </div>
        <button
          type="button"
          onClick={onSeeFull}
          style={{ border: 'none', background: 'transparent', color: 'var(--color-primary)', fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: '4px 0' }}
        >
          See full impact {'→'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', marginTop: 14, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {cells.map((c, i) => (
          <div key={c.label} style={{ padding: '12px 16px', borderRight: i < cells.length - 1 ? '1px solid var(--color-border)' : undefined }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{c.label}</div>
            <div style={{ fontSize: 24, fontWeight: 600, fontVariantNumeric: 'tabular-nums', marginTop: 2, color: c.value === 0 ? 'var(--color-text-muted)' : 'var(--color-text)' }}>{c.value}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
