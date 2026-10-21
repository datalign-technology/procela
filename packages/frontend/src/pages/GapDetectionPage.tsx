import { SkeletonRows } from '../components/Skeleton';
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import SegmentedControl from '../components/SegmentedControl';
import ExportMenu from '../components/ExportMenu';
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

// Echoes what the backend applied for the ?scope filter. `applied` is false
// when program scope was requested but the org has no program / an empty
// scope, so the toggle can explain why the view didn't narrow.
interface GapScopeInfo {
  mode: 'all' | 'program';
  applied: boolean;
  entities: { processNodes: number; dataDomains: number; dataAssets: number; systems: number } | null;
}

// ── Gap section config ──

type Severity = 'critical' | 'warning' | 'info';

// The three buckets the checks list groups under (matches the redesign board).
type GroupName = 'Process coverage' | 'Data governance' | 'Ownership';
const GROUP_ORDER: GroupName[] = ['Process coverage', 'Data governance', 'Ownership'];

interface GapSection {
  key: keyof GapData;
  title: string;
  // Which group the check sits under in the left pane.
  group: GroupName;
  // A terse one-liner shown under the title in the check row.
  short: string;
  description: string;
  // One plain-language line on the business consequence of leaving this gap
  // open — shown under the description in the detail panel so a reader sees
  // *why* to act, not just *what* is missing.
  why: string;
  // The action verb for the per-row Fix affordance (e.g. "Map data").
  fix: string;
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
    group: 'Process coverage',
    short: 'Activities with no data linked',
    description: 'Process activities with no data asset linked. These represent potential data gaps where business processes lack data coverage.',
    why: 'You cannot tell which data this activity depends on, so a data problem here would surface in the business process with no warning.',
    fix: 'Map data',
    severity: 'critical',
    icon: gapIcon('/processes'),
  },
  {
    key: 'ownerlessProcesses',
    title: 'Ownership Gaps',
    group: 'Ownership',
    short: 'Value streams & processes with no owner',
    description: 'Value streams and processes with no assigned owner. Every process should have clear accountability.',
    why: 'With no owner, nobody is accountable when this process needs a decision, a review, or a fix.',
    fix: 'Assign owner',
    severity: 'critical',
    icon: gapIcon('/people'),
  },
  {
    key: 'ungovernedAssets',
    title: 'Ungoverned Assets',
    group: 'Data governance',
    short: 'Uncertified data used by processes',
    description: 'Uncertified data assets linked to process activities. Critical processes depend on minimally governed data.',
    why: 'Live processes are running on data nobody has certified for trust.',
    fix: 'Start certification',
    severity: 'warning',
    icon: gapIcon('/data-assets'),
  },
  {
    key: 'lowHealthAssets',
    title: 'Low-Health Assets',
    group: 'Data governance',
    short: 'Linked assets under 50% health',
    description: 'Data assets linked to processes with health score below 50%. Quality issues may affect dependent processes.',
    why: 'Processes depend on this data while its measured quality is poor — errors flow straight downstream.',
    fix: 'Review quality',
    severity: 'warning',
    icon: gapIcon('/data-quality'),
  },
  {
    key: 'ungovernedColumns',
    title: 'Ungoverned Columns',
    group: 'Data governance',
    short: 'Bound columns with no quality rule',
    description: 'Columns an asset is bound to (they carry a physical source) but with no data-quality rule. Binding a column declares it matters — one with no rule is coverage you claimed but never measure.',
    why: 'Binding a column declares it matters; with no quality rule its values are never checked, so drift goes unmeasured.',
    fix: 'Add quality rule',
    severity: 'warning',
    icon: gapIcon('/data-quality'),
  },
  {
    key: 'unownedDomains',
    title: 'Unowned Domains',
    group: 'Data governance',
    short: 'Data domains with no owner',
    description: 'Data domains with no assigned owner. Domain ownership drives stewardship accountability.',
    why: 'A domain with no owner has no one to steward the assets filed under it.',
    fix: 'Assign owner',
    severity: 'warning',
    icon: gapIcon('/data-domains'),
  },
  {
    key: 'orphanedAssets',
    title: 'Orphaned Assets',
    group: 'Data governance',
    short: 'Not placed in a data domain',
    description: 'Data assets not assigned to any data domain. These lack governance oversight.',
    why: 'Assets outside every domain fall through stewardship — domain owners only oversee what is filed under them.',
    fix: 'Set domain',
    severity: 'info',
    icon: gapIcon('/data-assets'),
  },
  {
    key: 'unlinkedAssets',
    title: 'Unlinked Assets',
    group: 'Process coverage',
    short: 'Data not used by any process',
    description: 'Data assets with no mapping to any process activity. It is unclear which processes these support.',
    why: 'Nobody can say which work relies on these — candidates to map to a process, merge, or retire.',
    fix: 'Map to activity',
    severity: 'info',
    icon: gapIcon('/data-assets/orphans'),
  },
  {
    key: 'unassignedPeople',
    title: 'Unassigned People',
    group: 'Ownership',
    short: 'No ownership or stewardship role',
    description: 'People in the organization with no ownership or stewardship assignments.',
    why: 'Spare stewardship capacity: these people could take on the open owner gaps above.',
    fix: 'Assign role',
    severity: 'info',
    icon: gapIcon('/people'),
  },
  {
    key: 'duplicateAssetNames',
    title: 'Duplicate Asset Names',
    group: 'Data governance',
    short: 'Multiple assets share a name',
    description: 'Multiple data assets share the same name (case-insensitive). Sometimes legitimate \u2014 e.g., two divisions both have "Customer Accounts" \u2014 but worth a look to decide whether to merge or rename for clarity.',
    why: 'Shared names make it easy to map or report against the wrong asset \u2014 worth confirming they are genuinely distinct.',
    fix: 'Compare & merge',
    severity: 'info',
    icon: gapIcon('/data-assets'),
  },
];

// Severity palette — reused verbatim from the shared criticality badge
// palette (badgeColors.ts: high = red, medium = amber, low = teal) so the
// page's severity chips match every entity list. Soft `bg` + dark `color`,
// no solid fills, no blue, and no coloured tile rails — severity reads
// through the count pill, the icon and the uppercase label, exactly the
// way a badge does elsewhere in the app.
const SEVERITY_CONFIG = {
  critical: { bg: '#fee2e2', color: '#991b1b', label: 'Critical' },
  warning:  { bg: '#fef3c7', color: '#92400e', label: 'Warning' },
  info:     { bg: '#d1f0eb', color: '#0f4f46', label: 'Info' },
};

// ── Component ──

export default function GapDetectionPage() {
  const { activeOrgId, activeOrgName } = useOrgContext();
  const [data, setData] = useState<GapData | null>(null);
  const [summary, setSummary] = useState<GapSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<keyof GapData | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Severity | null>(null);
  // Clear checks are collapsed by default so the grid leads with actual gaps;
  // the disclosure below lets you confirm what's passing without the greyed
  // tiles diluting the ones that need attention.
  const [showClear, setShowClear] = useState(false);
  // Program-scope filter: 'all' = the whole catalog (default), 'program' =
  // only the entities the governance program governs (its value streams /
  // domains / systems, cascaded). `scopeInfo` echoes what the backend actually
  // applied so we can tell "scoped to N entities" from "program has no scope".
  const [scopeMode, setScopeMode] = useState<'all' | 'program'>('all');
  const [scopeInfo, setScopeInfo] = useState<GapScopeInfo | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (activeOrgId) params.set('orgId', activeOrgId);
      if (scopeMode === 'program') params.set('scope', 'program');
      const qs = params.toString();
      const res = await apiClient.get<{ success: boolean; data: GapData; summary: GapSummary; scope?: GapScopeInfo }>(`/gap-detection${qs ? `?${qs}` : ''}`);
      setData(res.data || null);
      setSummary(res.summary || null);
      setScopeInfo(res.scope || null);
      // Nothing is expanded by default — the user picks a gap tile to drill
      // into. (The severity summary cards up top still call out where the
      // gaps are, and clicking one selects the first matching section.)
      setSelectedKey(null);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId, scopeMode]);

  useEffect(() => { load(); }, [load]);

  // Keep a gap selected so the detail pane is never empty: default to the first
  // visible gap, and re-point when the severity filter hides the current one.
  // (Deliberately not keyed on selectedKey — a manual pick then sticks.)
  useEffect(() => {
    if (!data) return;
    const visible = (severityFilter ? GAP_SECTIONS.filter((s) => s.severity === severityFilter) : GAP_SECTIONS)
      .filter((s) => (data[s.key] as any[]).length > 0);
    if (visible.length === 0) { setSelectedKey(null); return; }
    setSelectedKey((cur) => (cur && visible.some((s) => s.key === cur) ? cur : visible[0].key));
  }, [data, severityFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // The severity legend doubles as a filter over the checks list. When a
  // severity is active, only its checks show.
  const visibleSections = severityFilter
    ? GAP_SECTIONS.filter((sec) => sec.severity === severityFilter)
    : GAP_SECTIONS;
  // Checks with open gaps fill the grouped left pane; clear checks (count 0)
  // drop into a collapsed disclosure so they confirm what's passing.
  const gapChecks = visibleSections.filter((sec) => sectionCount(sec) > 0);
  const clearChecks = visibleSections.filter((sec) => sectionCount(sec) === 0);
  // Grouped for the left pane — only groups that have a visible gap show.
  const groups = GROUP_ORDER
    .map((name) => ({ name, items: gapChecks.filter((s) => s.group === name) }))
    .filter((g) => g.items.length > 0);
  const showDetail = !!selectedSection && (!severityFilter || selectedSection.severity === severityFilter);
  // Headline figures (over the whole org, independent of the severity filter).
  const totalSections = GAP_SECTIONS.length;
  const checksWithGaps = GAP_SECTIONS.filter((s) => sectionCount(s) > 0).length;

  return (
    <div>
      <PageHeader
        title="Gap Detection"
        subtitle="Identifies gaps in process coverage, data governance, ownership, and data quality across the organization."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SegmentedControl
              ariaLabel="Scope"
              value={scopeMode}
              onChange={setScopeMode}
              options={[
                { value: 'all', label: 'All', title: 'Every catalogued entity, governed or not' },
                { value: 'program', label: 'In scope', title: 'Only the systems, domains and value streams your governance program governs' },
              ]}
            />
            <ExportMenu
              build={() => {
                const rows = GAP_SECTIONS.filter((s) => sectionCount(s) > 0)
                  .map((s) => [s.group, s.title, SEVERITY_CONFIG[s.severity].label, sectionCount(s)]);
                if (rows.length === 0) return null;
                return { filenameBase: 'gap-detection', sheetName: 'Gaps', headers: ['Group', 'Check', 'Severity', 'Open gaps'], rows };
              }}
            />
          </div>
        }
      />

      {/* Scope note — confirms what "In scope" actually narrowed to, or explains
          why it didn't (no program / empty scope ⇒ still showing everything). */}
      {scopeMode === 'program' && scopeInfo && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -6, marginBottom: 12, lineHeight: 1.4 }}>
          {scopeInfo.applied && scopeInfo.entities ? (
            <>Showing gaps within your governance program's scope — {scopeInfo.entities.processNodes} process nodes · {scopeInfo.entities.dataDomains} domains · {scopeInfo.entities.dataAssets} assets · {scopeInfo.entities.systems} systems. <Link to="/governance/foundation" style={{ color: 'var(--color-primary)' }}>Manage scope →</Link></>
          ) : (
            <>Your governance program has no scope defined yet, so this shows all catalogued entities. <Link to="/governance/foundation" style={{ color: 'var(--color-primary)' }}>Define scope →</Link></>
          )}
        </div>
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
          {/* Summary — the "Open gaps" headline alongside the proportion bar +
              severity pills (the pills filter the checks list below). */}
          <Card marginBottom={16}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
              <div style={{ flex: '0 0 auto' }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                  Open gaps{activeOrgName ? ` · ${activeOrgName}` : ''}
                </div>
                <div style={{ fontSize: 32, fontWeight: 600, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{totalCount}</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  in {checksWithGaps} of {totalSections} checks · {totalSections - checksWithGaps} clear
                </div>
              </div>
              <div style={{ flex: '1 1 380px', minWidth: 0 }}>
                <SeverityBar
                  total={totalCount}
                  critical={criticalCount}
                  warning={warningCount}
                  info={infoCount}
                  active={severityFilter}
                  onSelect={setSeverityFilter}
                />
              </div>
            </div>
          </Card>

          {/* Two-pane: grouped checks list (left) + the selected check's
              affected items (right). */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
            <aside
              aria-label="Checks"
              style={{ flex: '1 1 320px', maxWidth: 400, minWidth: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}
            >
              {groups.length === 0 ? (
                <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#166534' }}>
                  <Check size={18} strokeWidth={2.4} />
                  No {severityFilter ? `${SEVERITY_CONFIG[severityFilter].label.toLowerCase()} ` : ''}gaps in this view.
                </div>
              ) : groups.map((group) => (
                <div key={group.name}>
                  <div style={{ padding: '12px 16px 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>{group.name}</div>
                  {group.items.map((section) => (
                    <CheckRow
                      key={section.key}
                      section={section}
                      count={sectionCount(section)}
                      active={selectedKey === section.key}
                      onSelect={() => setSelectedKey(section.key)}
                    />
                  ))}
                </div>
              ))}

              {/* Clear checks — collapsed disclosure at the foot of the pane. */}
              {clearChecks.length > 0 && (
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
                  <button
                    type="button"
                    onClick={() => setShowClear((v) => !v)}
                    aria-expanded={showClear}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    <Check size={14} strokeWidth={2.6} />
                    {showClear ? 'Hide clear checks' : `${clearChecks.length} ${clearChecks.length === 1 ? 'check is' : 'checks are'} clear`}
                  </button>
                  {showClear && (
                    <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {clearChecks.map((section) => (
                        <li key={section.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                          <span style={{ display: 'inline-flex', color: 'var(--color-success)', flexShrink: 0 }}><Check size={14} strokeWidth={2.6} /></span>
                          <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{section.title}</span>
                          <span style={{ color: 'var(--color-text-muted)' }}>— no gaps found</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </aside>

            <main
              aria-label="Affected items"
              style={{ flex: '999 1 440px', minWidth: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}
            >
              {showDetail && selectedSection ? (() => {
                const sev = SEVERITY_CONFIG[selectedSection.severity];
                const items = data[selectedSection.key] as any[];
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--color-border)' }}>
                      <span style={{ display: 'inline-flex', color: sev.color, marginTop: 1, flexShrink: 0 }}>{selectedSection.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{selectedSection.title}</h2>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 8px', borderRadius: 11, fontSize: 11, fontWeight: 600, background: sev.bg, color: sev.color }}>
                            <span style={{ width: 6, height: 6, borderRadius: 3, background: sev.color }} />{sev.label}
                          </span>
                          <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>Affected {items.length}</span>
                        </div>
                        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{selectedSection.description}</p>
                        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                          <strong style={{ fontWeight: 600, color: 'var(--color-text)' }}>Why it matters:</strong> {selectedSection.why}
                        </p>
                      </div>
                    </div>
                    <div style={{ padding: '6px 10px 10px' }}>
                      {renderItems(selectedSection.key, items, selectedSection.fix)}
                    </div>
                    <div style={{ padding: '10px 18px', fontSize: 13, color: 'var(--color-text-muted)', background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)' }}>
                      {items.length === 1 ? '1 item' : `${items.length} items`}
                    </div>
                  </>
                );
              })() : (
                <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                  Select a check on the left to see its affected items.
                </div>
              )}
            </main>
          </div>
        </>
      )}
    </div>
  );
}

// ── Checks-list row (left pane) ──

function CheckRow({ section, count, active, onSelect }: {
  section: GapSection; count: number; active: boolean; onSelect: () => void;
}) {
  const sev = SEVERITY_CONFIG[section.severity];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--color-bg)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'var(--color-surface)'; }}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        border: 0, borderLeft: `3px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
        background: active ? 'var(--color-primary-light)' : 'var(--color-surface)',
        cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{section.title}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{section.short}</span>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 8px', borderRadius: 11, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', background: sev.bg, color: sev.color, flexShrink: 0 }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: sev.color }} />{sev.label}
      </span>
      <span style={{ minWidth: 20, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text)', flexShrink: 0 }}>{count}</span>
    </button>
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
    // Teal (the brand's low-severity colour), not blue — keeps the ramp
    // red → amber → teal, matching the criticality badges used elsewhere.
    { key: 'info',     label: 'Info',          count: info,     color: 'var(--color-primary)' },
  ];
  const toggle = (s: Severity) => onSelect(active === s ? null : s);
  return (
    <div>
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

function renderItems(key: string, items: any[], fix: string) {
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 10px', borderBottom: '1px solid var(--color-border)', fontSize: 13, gap: 10,
    textDecoration: 'none', color: 'var(--color-text)',
    transition: 'background 0.12s',
    borderRadius: 4,
  };
  const mutedStyle: React.CSSProperties = { fontSize: 11, color: 'var(--color-text-muted)' };
  const badgeStyle = (bg: string, color: string): React.CSSProperties => ({
    fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 3, background: bg, color,
  });

  // Wraps an item row in a Link with a hover affordance so the row reads
  // as a navigable thing. A trailing "fix" chip names the action the link
  // takes you to (Map data, Assign owner, …) — the explicit per-row Fix.
  const Row = ({ to, title, children }: { to: string; title?: string; children: React.ReactNode }) => (
    <Link
      to={to}
      title={title || 'Open the affected item'}
      style={rowStyle}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
    >
      {children}
      <span style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 10px', border: '1px solid var(--color-primary)', color: 'var(--color-primary)', borderRadius: 6, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>{fix}</span>
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
