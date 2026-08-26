import { SkeletonRows } from '../components/Skeleton';
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import { Check } from 'lucide-react';
import { renderNavIcon } from '../components/navIcons';
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

interface UngovernedColumnGroup {
  assetId: string;
  assetName: string;
  columns: string[];
  count: number;
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
  ungovernedColumns: UngovernedColumnGroup[];
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
  ungovernedColumns: number;
  totalGaps: number;
}

// ── Gap section config ──

type Severity = 'critical' | 'warning' | 'info';

interface GapSection {
  key: keyof GapData;
  title: string;
  description: string;
  severity: Severity;
  // Icon is the sidebar SVG for the route this gap targets — so
  // an Ownership Gaps row shows the People rail icon, a Low-Health
  // Assets row shows the Data Assets rail icon, and so on. Rendered
  // via renderNavIcon(route, {size}) at each call site.
  icon: React.ReactNode;
}

// Each gap section's icon points at the sidebar SVG of the page
// the gap describes, so the visual mapping between "Unmapped
// Activities" and the /processes rail entry, "Ownership Gaps"
// and /people, etc., stays consistent with the rest of the app.
const SECTION_ICON_SIZE = 18;
const gapIcon = (route: string) => renderNavIcon(route, { size: SECTION_ICON_SIZE, strokeWidth: 1.8 });
const GAP_SECTIONS: GapSection[] = [
  {
    key: 'unmappedSteps',
    title: 'Unmapped Activities',
    description: 'Process activities with no data asset linked. These represent potential data gaps where business processes lack data coverage.',
    severity: 'critical',
    icon: gapIcon('/processes'),
  },
  {
    key: 'ownerlessProcesses',
    title: 'Ownership Gaps',
    description: 'Value streams and processes with no assigned owner. Every process should have clear accountability.',
    severity: 'critical',
    icon: gapIcon('/people'),
  },
  {
    key: 'ungovernedAssets',
    title: 'Ungoverned Assets',
    description: 'Uncertified data assets linked to process activities. Critical processes depend on minimally governed data.',
    severity: 'warning',
    icon: gapIcon('/data-assets'),
  },
  {
    key: 'lowHealthAssets',
    title: 'Low-Health Assets',
    description: 'Data assets linked to processes with health score below 50%. Quality issues may affect dependent processes.',
    severity: 'warning',
    icon: gapIcon('/data-quality'),
  },
  {
    key: 'ungovernedColumns',
    title: 'Ungoverned Columns',
    description: 'Columns an asset is bound to (they carry a physical source) but with no data-quality rule. Binding a column declares it matters — one with no rule is coverage you claimed but never measure.',
    severity: 'warning',
    icon: gapIcon('/data-quality'),
  },
  {
    key: 'unownedDomains',
    title: 'Unowned Domains',
    description: 'Data domains with no assigned owner. Domain ownership drives stewardship accountability.',
    severity: 'warning',
    icon: gapIcon('/data-domains'),
  },
  {
    key: 'orphanedAssets',
    title: 'Orphaned Assets',
    description: 'Data assets not assigned to any data domain. These lack governance oversight.',
    severity: 'info',
    icon: gapIcon('/data-assets'),
  },
  {
    key: 'unlinkedAssets',
    title: 'Unlinked Assets',
    description: 'Data assets with no mapping to any process activity. It is unclear which processes these support.',
    severity: 'info',
    icon: gapIcon('/data-assets/orphans'),
  },
  {
    key: 'unassignedPeople',
    title: 'Unassigned People',
    description: 'People in the organization with no ownership or stewardship assignments.',
    severity: 'info',
    icon: gapIcon('/people'),
  },
  {
    key: 'duplicateAssetNames',
    title: 'Duplicate Asset Names',
    description: 'Multiple data assets share the same name (case-insensitive). Sometimes legitimate \u2014 e.g., two divisions both have "Customer Accounts" \u2014 but worth a look to decide whether to merge or rename for clarity.',
    severity: 'info',
    icon: gapIcon('/data-assets'),
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
  const [selectedKey, setSelectedKey] = useState<keyof GapData | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Severity | null>(null);

  const load = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: GapData; summary: GapSummary }>(`/gap-detection${query}`);
      setData(res.data || null);
      setSummary(res.summary || null);
      // Nothing is expanded by default — the user picks a gap tile to drill
      // into. (The severity summary cards up top still call out where the
      // gaps are, and clicking one selects the first matching section.)
      setSelectedKey(null);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { load(); }, [load]);

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

  // Derive the total and per-severity counts from the same gap sections the
  // page actually renders as tiles, so the summary bar always reconciles with
  // them (total === critical + warning + info, each band === its tiles). The
  // backend's summary.totalGaps counts a different membership — it folds in
  // system/connection gaps the page doesn't tile and omits people/low-health —
  // so relying on it made the "All gaps" figure smaller than a subtotal.
  const sectionCount = (sec: GapSection) => (data[sec.key] as any[]).length;
  const countBySeverity = (sev: Severity) =>
    GAP_SECTIONS.filter((s) => s.severity === sev).reduce((n, s) => n + sectionCount(s), 0);
  const criticalCount = countBySeverity('critical');
  const warningCount = countBySeverity('warning');
  const infoCount = countBySeverity('info');
  const totalCount = criticalCount + warningCount + infoCount;

  const selectedSection = GAP_SECTIONS.find((sec) => sec.key === selectedKey);

  // The severity legend doubles as a filter over the tile grid. When a
  // severity is active, only its tiles show, and a selected tile's detail
  // panel is hidden if it falls outside the filter (kept in state so
  // clearing the filter restores it).
  const visibleSections = severityFilter
    ? GAP_SECTIONS.filter((sec) => sec.severity === severityFilter)
    : GAP_SECTIONS;
  const showDetail = !!selectedSection && (!severityFilter || selectedSection.severity === severityFilter);

  return (
    <div>
      <PageHeader
        title="Gap Detection"
        subtitle="Identifies gaps in process coverage, data governance, ownership, and data quality across the organization."
      />

      {/* Severity summary — a slim proportion bar + legend that doubles as a
          severity filter over the gap tiles below. Replaces the old KPI card
          row, whose counts just restated the tiles. */}
      {totalCount > 0 && (
        <SeverityBar
          total={totalCount}
          critical={criticalCount}
          warning={warningCount}
          info={infoCount}
          active={severityFilter}
          onSelect={setSeverityFilter}
        />
      )}

      {totalCount === 0 ? (
        <div style={{
          background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 'var(--radius-md)',
          padding: '2rem', textAlign: 'center',
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, color: '#166534' }}><Check size={28} strokeWidth={2.4} /></div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#166534' }}>No gaps detected</div>
          <div style={{ fontSize: 13, color: '#15803d', marginTop: 4 }}>
            All processes are mapped, assets are governed, and ownership is assigned.
          </div>
        </div>
      ) : (
        <>
          {/* Every gap type as a tile — the whole picture at a glance. Click a
              non-empty tile to see its affected items in the panel below. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, marginBottom: 16 }}>
            {visibleSections.map((section) => {
              const items = data[section.key] as any[];
              const count = items.length;
              const sev = SEVERITY_CONFIG[section.severity];
              const isSelected = selectedKey === section.key;
              const canOpen = count > 0;
              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={canOpen ? () => setSelectedKey(section.key) : undefined}
                  disabled={!canOpen}
                  aria-pressed={isSelected}
                  title={canOpen ? `Show ${count} ${section.title.toLowerCase()}` : `${section.title}: clear`}
                  style={{
                    font: 'inherit', textAlign: 'left', cursor: canOpen ? 'pointer' : 'default',
                    background: 'var(--color-surface)',
                    // Fully per-side longhand borders. The outline colour changes
                    // on selection, so it must never be set via a shorthand
                    // (`border`/`borderColor`) alongside the `borderLeft*`
                    // longhands — React warns about that conflict on re-render.
                    borderStyle: 'solid',
                    borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderLeftWidth: 4,
                    borderTopColor: isSelected ? 'var(--color-primary)' : (count > 0 ? sev.border : 'var(--color-border)'),
                    borderRightColor: isSelected ? 'var(--color-primary)' : (count > 0 ? sev.border : 'var(--color-border)'),
                    borderBottomColor: isSelected ? 'var(--color-primary)' : (count > 0 ? sev.border : 'var(--color-border)'),
                    borderLeftColor: count > 0 ? sev.badge : 'var(--color-border)',
                    borderRadius: 'var(--radius-md)', padding: '11px 14px',
                    boxShadow: isSelected ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                    display: 'flex', alignItems: 'center', gap: 10,
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                >
                  <span style={{ display: 'inline-flex', color: count > 0 ? sev.color : 'var(--color-text-muted)', flexShrink: 0 }}>{section.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{section.title}</span>
                    <span style={{ display: 'block', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: count > 0 ? sev.color : 'var(--color-text-muted)', marginTop: 1 }}>{count > 0 ? sev.label : 'Clear'}</span>
                  </span>
                  {count > 0 ? (
                    <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700, background: sev.badge, color: '#fff', flexShrink: 0 }}>{count}</span>
                  ) : (
                    <span style={{ display: 'inline-flex', color: 'var(--color-success)', flexShrink: 0 }}><Check size={16} strokeWidth={2.6} /></span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Prompt to drill in — shown until the user picks a gap tile. */}
          {!showDetail && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '2px' }}>
              Select a gap above to see the affected items.
            </div>
          )}

          {/* Detail — the affected items for the selected gap. */}
          {showDetail && selectedSection && (() => {
            const sev = SEVERITY_CONFIG[selectedSection.severity];
            const items = data[selectedSection.key] as any[];
            return (
              <Card padding={0} style={{ overflow: 'hidden', borderLeft: `4px solid ${sev.badge}` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ display: 'inline-flex', color: sev.color, marginTop: 1 }}>{selectedSection.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{selectedSection.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.4 }}>{selectedSection.description}</div>
                  </div>
                  <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700, background: sev.badge, color: '#fff', flexShrink: 0 }}>{items.length}</span>
                </div>
                <div style={{ padding: '8px 16px 12px' }}>
                  {renderItems(selectedSection.key, items)}
                </div>
              </Card>
            );
          })()}
        </>
      )}
    </div>
  );
}

// ── Severity summary bar ──

// A slim stacked proportion bar plus a legend that doubles as a severity
// filter. Replaces the old KPI card row (whose Total / Critical / Warning /
// Info counts simply restated the tiles below).
function SeverityBar({ total, critical, warning, info, active, onSelect }: {
  total: number;
  critical: number;
  warning: number;
  info: number;
  active: Severity | null;
  onSelect: (s: Severity | null) => void;
}) {
  const segs: { key: Severity; label: string; count: number; color: string }[] = [
    { key: 'critical', label: 'Critical',      count: critical, color: 'var(--color-error)' },
    { key: 'warning',  label: 'Warning',       count: warning,  color: 'var(--color-warning)' },
    { key: 'info',     label: 'Informational', count: info,     color: 'var(--color-info)' },
  ];
  const toggle = (s: Severity) => onSelect(active === s ? null : s);
  return (
    <div style={{ marginBottom: 16 }}>
      {/* Stacked proportion bar — each segment sized by its share of the
          total, dimmed when another severity is filtered. */}
      <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--color-border)', marginBottom: 8 }}>
        {segs.filter((s) => s.count > 0).map((s) => (
          <button
            key={s.key}
            type="button"
            aria-label={`${s.count} ${s.label.toLowerCase()}`}
            title={`${s.count} ${s.label.toLowerCase()} — click to filter`}
            onClick={() => toggle(s.key)}
            style={{
              flex: s.count, minWidth: 4, padding: 0, border: 'none', cursor: 'pointer',
              background: s.color, opacity: active && active !== s.key ? 0.3 : 1,
              transition: 'opacity 0.15s',
            }}
          />
        ))}
      </div>
      {/* Legend / filter chips. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <SeverityChip label="All gaps" count={total} active={active === null} onClick={() => onSelect(null)} />
        {segs.map((s) => (
          <SeverityChip key={s.key} label={s.label} count={s.count} dotColor={s.color} active={active === s.key} onClick={() => toggle(s.key)} />
        ))}
      </div>
    </div>
  );
}

function SeverityChip({ label, count, dotColor, active, onClick }: {
  label: string; count: number; dotColor?: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 999, font: 'inherit', fontSize: 12, fontWeight: 600,
        cursor: 'pointer', color: 'var(--color-text)',
        background: active ? 'var(--color-primary-light)' : 'var(--color-surface)',
        border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {dotColor && <span style={{ width: 8, height: 8, borderRadius: 999, background: dotColor, flexShrink: 0 }} />}
      <span>{label}</span>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 700 }}>{count}</span>
    </button>
  );
}



// ── Render items for each gap type ──

function renderItems(key: string, items: any[]) {
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 8px', borderBottom: '1px solid var(--color-border)', fontSize: 13, gap: 8,
    textDecoration: 'none', color: 'var(--color-text)',
    transition: 'background 0.12s',
    borderRadius: 4,
  };
  const mutedStyle: React.CSSProperties = { fontSize: 11, color: 'var(--color-text-muted)' };
  const badgeStyle = (bg: string, color: string): React.CSSProperties => ({
    fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 3, background: bg, color,
  });

  // Wraps an item row in a Link with a hover affordance so the row reads
  // as a navigable thing rather than a static list line.
  const Row = ({ to, title, children }: { to: string; title?: string; children: React.ReactNode }) => (
    <Link
      to={to}
      title={title || 'Open the affected item'}
      style={rowStyle}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
    >
      {children}
    </Link>
  );

  switch (key) {
    case 'unmappedSteps':
      return items.map((s: UnmappedStep) => {
        const sc = s.status ? getStatusColor(s.status) : null;
        return (
          <Row
            key={s.id}
            to={`/processes?highlight=${encodeURIComponent(s.id)}`}
            title={`Open ${s.name} in the Process Catalog to link a data asset`}
          >
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
          </Row>
        );
      });

    case 'ungovernedAssets':
      return items.map((a: UngovervedAsset) => (
        <Row
          key={a.id}
          to={`/data-assets?highlight=${encodeURIComponent(a.id)}`}
          title={`Open ${a.name} on Data Assets to raise its trust tier`}
        >
          <span style={{ fontWeight: 500, flex: 1 }}>{a.name}</span>
          <span style={badgeStyle('#fed7aa', '#9a3412')}>{tierLabel('BRONZE')}</span>
          <span style={mutedStyle}>{a.healthScore}% health</span>
        </Row>
      ));

    case 'lowHealthAssets':
      return items.map((a: LowHealthAsset) => (
        <Row
          key={a.id}
          to={`/data-assets?highlight=${encodeURIComponent(a.id)}`}
          title={`Open ${a.name} on Data Assets to address quality issues`}
        >
          <span style={{ fontWeight: 500, flex: 1 }}>{a.name}</span>
          <span style={badgeStyle(a.healthScore < 30 ? '#fee2e2' : '#fef3c7', a.healthScore < 30 ? '#991b1b' : '#92400e')}>
            {a.healthScore}%
          </span>
        </Row>
      ));

    case 'ownerlessProcesses':
      return items.map((p: OwnerlessProcess) => {
        const sc = p.status ? getStatusColor(p.status) : null;
        return (
          <Row
            key={p.id}
            to={`/processes?highlight=${encodeURIComponent(p.id)}`}
            title={`Open ${p.name} on the Process Catalog to assign an owner`}
          >
            <span style={{ fontWeight: 500, flex: 1 }}>{p.name}</span>
            <span style={badgeStyle('#f1f5f9', '#475569')}>{p.level.replace('_', ' ')}</span>
            {sc && <span style={badgeStyle(sc.bg, sc.color)}>{p.status.replace('_', ' ')}</span>}
          </Row>
        );
      });

    case 'unownedDomains':
      return items.map((d: UnownedDomain) => (
        <Row
          key={d.id}
          to={`/data-domains?highlight=${encodeURIComponent(d.id)}`}
          title={`Open ${d.name} on Data Domains to assign an owner`}
        >
          <span style={{ fontWeight: 500, flex: 1 }}>{d.name}</span>
          <span style={mutedStyle}>{d.assetCount} assets</span>
        </Row>
      ));

    case 'orphanedAssets':
      return items.map((a: OrphanedAsset) => (
        <Row
          key={a.id}
          to={`/data-assets?highlight=${encodeURIComponent(a.id)}`}
          title={`Open ${a.name} on Data Assets to put it in a domain`}
        >
          <span style={{ fontWeight: 500, flex: 1 }}>{a.name}</span>
          <span style={badgeStyle(badgeColor('tier', a.governanceTier).bg, badgeColor('tier', a.governanceTier).color)}>{a.governanceTier}</span>
        </Row>
      ));

    case 'unlinkedAssets':
      return items.map((a: UnlinkedAsset) => (
        <Row
          key={a.id}
          to={`/data-assets?highlight=${encodeURIComponent(a.id)}`}
          title={`Open ${a.name} on Data Assets to link it to a process activity`}
        >
          <span style={{ fontWeight: 500, flex: 1 }}>{a.name}</span>
          <span style={badgeStyle('#f1f5f9', '#475569')}>{a.governanceTier}</span>
        </Row>
      ));

    case 'unassignedPeople':
      return items.map((p: UnassignedPerson) => (
        <Row
          key={p.id}
          to={`/people/${encodeURIComponent(p.id)}`}
          title={`Open ${p.name}'s profile to give them ownership or stewardship`}
        >
          <span style={{ fontWeight: 500, flex: 1 }}>{p.name}</span>
          <span style={mutedStyle}>{p.role.replace('_', ' ')}</span>
        </Row>
      ));

    case 'duplicateAssetNames':
      return items.map((g: DuplicateAssetGroup) => (
        <Row
          key={g.name}
          to={`/data-assets?search=${encodeURIComponent(g.name)}`}
          title={`Filter Data Assets by "${g.name}" to compare or merge them`}
        >
          <span style={{ fontWeight: 500, flex: 1 }}>
            {g.name}
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400 }}>
              ({g.assets.length} assets share this name)
            </span>
          </span>
        </Row>
      ));

    case 'ungovernedColumns':
      return items.map((g: UngovernedColumnGroup) => (
        <Row
          key={g.assetId}
          to={`/data-assets?highlight=${encodeURIComponent(g.assetId)}`}
          title={`Open ${g.assetName} on Data Assets to add a quality rule to its bound columns`}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{g.assetName}</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
              {g.columns.map((c) => (
                <span key={c} style={badgeStyle('#fef3c7', '#92400e')}>{c}</span>
              ))}
            </div>
          </div>
          <span style={mutedStyle}>{g.count} unmeasured</span>
        </Row>
      ));

    default:
      return null;
  }
}
