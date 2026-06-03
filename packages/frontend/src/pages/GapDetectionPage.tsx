import { SkeletonRows } from '../components/Skeleton';
import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import { useOrgContext } from '../stores/orgContext';
import { getStatusColor } from '../lib/statusBadge';
import { badgeColor } from '../lib/badgeColors';
import { tierLabel } from '../lib/governanceTier';

// ── Types ──

interface UnmappedStep {
  id: string;
  name: string;
  level: string;
  status: string;
  path: { valueStream?: string; process?: string; subProcess?: string };
}

interface UngovervedAsset {
  id: string;
  name: string;
  governanceTier: string;
  healthScore: number;
}

interface LowHealthAsset {
  id: string;
  name: string;
  healthScore: number;
  governanceTier: string;
}

interface OwnerlessProcess {
  id: string;
  name: string;
  level: string;
  status: string;
}

interface UnownedDomain {
  id: string;
  name: string;
  status: string;
  assetCount: number;
}

interface OrphanedAsset {
  id: string;
  name: string;
  governanceTier: string;
  healthScore: number;
}

interface UnlinkedAsset {
  id: string;
  name: string;
  governanceTier: string;
}

interface UnassignedPerson {
  id: string;
  name: string;
  role: string;
}

interface DuplicateAssetGroup {
  name: string;
  assets: Array<{ id: string; name: string }>;
}

interface GapData {
  unmappedSteps: UnmappedStep[];
  ungovernedAssets: UngovervedAsset[];
  lowHealthAssets: LowHealthAsset[];
  ownerlessProcesses: OwnerlessProcess[];
  unownedDomains: UnownedDomain[];
  orphanedAssets: OrphanedAsset[];
  unlinkedAssets: UnlinkedAsset[];
  unassignedPeople: UnassignedPerson[];
  duplicateAssetNames: DuplicateAssetGroup[];
}

interface GapSummary {
  unmappedSteps: number;
  ungovernedAssets: number;
  lowHealthAssets: number;
  ownerlessProcesses: number;
  unownedDomains: number;
  orphanedAssets: number;
  unlinkedAssets: number;
  unassignedPeople: number;
  duplicateAssetNames: number;
  totalGaps: number;
}

// ── Gap section config ──

interface GapSection {
  key: keyof GapData;
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  icon: string;
}

const GAP_SECTIONS: GapSection[] = [
  {
    key: 'unmappedSteps',
    title: 'Unmapped Activities',
    description: 'Process activities with no data asset linked. These represent potential data gaps where business processes lack data coverage.',
    severity: 'critical',
    icon: '\u26A0',
  },
  {
    key: 'ownerlessProcesses',
    title: 'Ownership Gaps',
    description: 'Value streams and processes with no assigned owner. Every process should have clear accountability.',
    severity: 'critical',
    icon: '\u263B',
  },
  {
    key: 'ungovernedAssets',
    title: 'Ungoverned Assets',
    description: 'Uncertified data assets linked to process activities. Critical processes depend on minimally governed data.',
    severity: 'warning',
    icon: '\u26C1',
  },
  {
    key: 'lowHealthAssets',
    title: 'Low-Health Assets',
    description: 'Data assets linked to processes with health score below 50%. Quality issues may affect dependent processes.',
    severity: 'warning',
    icon: '\u2713',
  },
  {
    key: 'unownedDomains',
    title: 'Unowned Domains',
    description: 'Data domains with no assigned owner. Domain ownership drives stewardship accountability.',
    severity: 'warning',
    icon: '\u2637',
  },
  {
    key: 'orphanedAssets',
    title: 'Orphaned Assets',
    description: 'Data assets not assigned to any data domain. These lack governance oversight.',
    severity: 'info',
    icon: '\u26C1',
  },
  {
    key: 'unlinkedAssets',
    title: 'Unlinked Assets',
    description: 'Data assets with no mapping to any process activity. It is unclear which processes these support.',
    severity: 'info',
    icon: '\u2194',
  },
  {
    key: 'unassignedPeople',
    title: 'Unassigned People',
    description: 'People in the organization with no ownership or stewardship assignments.',
    severity: 'info',
    icon: '\u263B',
  },
  {
    key: 'duplicateAssetNames',
    title: 'Duplicate Asset Names',
    description: 'Multiple data assets share the same name (case-insensitive). Sometimes legitimate \u2014 e.g., two divisions both have "Customer Accounts" \u2014 but worth a look to decide whether to merge or rename for clarity.',
    severity: 'info',
    icon: '\u29C4',
  },
];

const SEVERITY_CONFIG = {
  critical: { bg: '#fef2f2', border: '#fca5a5', badge: '#dc2626', color: '#991b1b', label: 'Critical' },
  warning:  { bg: '#fffbeb', border: '#fcd34d', badge: '#d97706', color: '#92400e', label: 'Warning' },
  info:     { bg: '#f0f9ff', border: '#93c5fd', badge: '#2563eb', color: '#1e40af', label: 'Info' },
};

// ── Component ──

export default function GapDetectionPage() {
  const { activeOrgId } = useOrgContext();
  const [data, setData] = useState<GapData | null>(null);
  const [summary, setSummary] = useState<GapSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: GapData; summary: GapSummary }>(`/gap-detection${query}`);
      setData(res.data || null);
      setSummary(res.summary || null);
      // Auto-expand any critical-severity section that actually has
      // gaps, so the most urgent items (e.g. Unmapped Activities) are
      // visible without hunting through nine collapsed rows.
      if (res.summary) {
        const critical = GAP_SECTIONS
          .filter((s) => s.severity === 'critical' && (res.summary as any)[s.key] > 0)
          .map((s) => s.key as string);
        if (critical.length) setExpandedSections(new Set(critical));
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { load(); }, [load]);

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Gap Detection" />
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <SkeletonRows rows={5} columns={4} />
        </div>
      </div>
    );
  }

  if (!data || !summary) {
    return (
      <div>
        <PageHeader title="Gap Detection" />
        <div style={{ color: 'var(--color-text-muted)' }}>No data available.</div>
      </div>
    );
  }

  const criticalCount = summary.unmappedSteps + summary.ownerlessProcesses;
  const warningCount = summary.ungovernedAssets + summary.lowHealthAssets + summary.unownedDomains;
  const infoCount = summary.orphanedAssets + summary.unlinkedAssets + summary.unassignedPeople;

  return (
    <div>
      <PageHeader
        title="Gap Detection"
        subtitle="Identifies gaps in process coverage, data governance, ownership, and data quality across the organization."
      />

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <SummaryCard label="Total Gaps" count={summary.totalGaps} color="#64748b" />
        <SummaryCard label="Critical" count={criticalCount} color="#dc2626" />
        <SummaryCard label="Warning" count={warningCount} color="#d97706" />
        <SummaryCard label="Informational" count={infoCount} color="#2563eb" />
      </div>

      {summary.totalGaps === 0 && criticalCount === 0 && warningCount === 0 && infoCount === 0 ? (
        <div style={{
          background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 'var(--radius-md)',
          padding: '2rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>{'\u2713'}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#166534' }}>No gaps detected</div>
          <div style={{ fontSize: 13, color: '#15803d', marginTop: 4 }}>
            All processes are mapped, assets are governed, and ownership is assigned.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {GAP_SECTIONS.map((section) => {
            const items = data[section.key] as any[];
            const count = items.length;
            const sev = SEVERITY_CONFIG[section.severity];
            const isOpen = expandedSections.has(section.key);
            return (
              <div key={section.key} style={{
                background: 'var(--color-surface)', border: `1px solid ${count > 0 ? sev.border : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-md)', overflow: 'hidden',
                borderLeft: `4px solid ${count > 0 ? sev.badge : '#e2e8f0'}`,
              }}>
                {/* Section header */}
                <div
                  onClick={() => count > 0 && toggleSection(section.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
                    cursor: count > 0 ? 'pointer' : 'default',
                  }}
                >
                  {count > 0 && (
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{isOpen ? '\u25BC' : '\u25B6'}</span>
                  )}
                  <span style={{ fontSize: 16 }}>{section.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{section.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>{section.description}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {count > 0 ? (
                      <span style={{
                        padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700,
                        background: sev.badge, color: '#fff',
                      }}>
                        {count}
                      </span>
                    ) : (
                      <span style={{
                        padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                        background: '#d1fae5', color: '#065f46',
                      }}>
                        {'\u2713'} Clear
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded items */}
                {isOpen && count > 0 && (
                  <div style={{ borderTop: `1px solid ${sev.border}`, padding: '8px 16px 12px' }}>
                    {renderItems(section.key, items)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Summary card ──

function SummaryCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{
      flex: 1, minWidth: 120, padding: '12px 16px', borderRadius: 'var(--radius-md)',
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: count > 0 ? color : '#16a34a' }}>{count}</div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>{label}</div>
    </div>
  );
}

// ── Render items for each gap type ──

function renderItems(key: string, items: any[]) {
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 0', borderBottom: '1px solid var(--color-border)', fontSize: 13, gap: 8,
  };
  const mutedStyle: React.CSSProperties = { fontSize: 11, color: 'var(--color-text-muted)' };
  const badgeStyle = (bg: string, color: string): React.CSSProperties => ({
    fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 3, background: bg, color,
  });

  switch (key) {
    case 'unmappedSteps':
      return items.map((s: UnmappedStep) => {
        const sc = s.status ? getStatusColor(s.status) : null;
        return (
          <div key={s.id} style={rowStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{s.name}</div>
              <div style={mutedStyle}>
                {[s.path.valueStream, s.path.process, s.path.subProcess].filter(Boolean).join(' > ')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <span style={badgeStyle('#f1f5f9', '#475569')}>{s.level.replace('_', ' ')}</span>
              {sc && <span style={badgeStyle(sc.bg, sc.color)}>{s.status.replace('_', ' ')}</span>}
            </div>
          </div>
        );
      });

    case 'ungovernedAssets':
      return items.map((a: UngovervedAsset) => (
        <div key={a.id} style={rowStyle}>
          <span style={{ fontWeight: 500, flex: 1 }}>{a.name}</span>
          <span style={badgeStyle('#fed7aa', '#9a3412')}>{tierLabel('BRONZE')}</span>
          <span style={mutedStyle}>{a.healthScore}% health</span>
        </div>
      ));

    case 'lowHealthAssets':
      return items.map((a: LowHealthAsset) => (
        <div key={a.id} style={rowStyle}>
          <span style={{ fontWeight: 500, flex: 1 }}>{a.name}</span>
          <span style={badgeStyle(a.healthScore < 30 ? '#fee2e2' : '#fef3c7', a.healthScore < 30 ? '#991b1b' : '#92400e')}>
            {a.healthScore}%
          </span>
        </div>
      ));

    case 'ownerlessProcesses':
      return items.map((p: OwnerlessProcess) => {
        const sc = p.status ? getStatusColor(p.status) : null;
        return (
          <div key={p.id} style={rowStyle}>
            <span style={{ fontWeight: 500, flex: 1 }}>{p.name}</span>
            <span style={badgeStyle('#f1f5f9', '#475569')}>{p.level.replace('_', ' ')}</span>
            {sc && <span style={badgeStyle(sc.bg, sc.color)}>{p.status.replace('_', ' ')}</span>}
          </div>
        );
      });

    case 'unownedDomains':
      return items.map((d: UnownedDomain) => (
        <div key={d.id} style={rowStyle}>
          <span style={{ fontWeight: 500, flex: 1 }}>{d.name}</span>
          <span style={mutedStyle}>{d.assetCount} assets</span>
        </div>
      ));

    case 'orphanedAssets':
      return items.map((a: OrphanedAsset) => (
        <div key={a.id} style={rowStyle}>
          <span style={{ fontWeight: 500, flex: 1 }}>{a.name}</span>
          <span style={badgeStyle(badgeColor('tier', a.governanceTier).bg, badgeColor('tier', a.governanceTier).color)}>{a.governanceTier}</span>
        </div>
      ));

    case 'unlinkedAssets':
      return items.map((a: UnlinkedAsset) => (
        <div key={a.id} style={rowStyle}>
          <span style={{ fontWeight: 500, flex: 1 }}>{a.name}</span>
          <span style={badgeStyle('#f1f5f9', '#475569')}>{a.governanceTier}</span>
        </div>
      ));

    case 'unassignedPeople':
      return items.map((p: UnassignedPerson) => (
        <div key={p.id} style={rowStyle}>
          <span style={{ fontWeight: 500, flex: 1 }}>{p.name}</span>
          <span style={mutedStyle}>{p.role.replace('_', ' ')}</span>
        </div>
      ));

    case 'duplicateAssetNames':
      return items.map((g: DuplicateAssetGroup) => (
        <div key={g.name} style={{ ...rowStyle, alignItems: 'flex-start' }}>
          <span style={{ fontWeight: 500, flex: 1 }}>
            {g.name}
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400 }}>
              ({g.assets.length} assets share this name)
            </span>
          </span>
        </div>
      ));

    default:
      return null;
  }
}
