import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import Spinner from '../components/Spinner';
import TruncatedText from '../components/TruncatedText';
import SectionHeading from '../components/SectionHeading';
import Meter from '../components/Meter';
import { renderNavIcon } from '../components/navIcons';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';

// ──────────────────────────────────────────────────────────────────────────
// Council — the single governance-council page. Merges the old Council
// Dashboard (the meeting briefing: who's on the council, when it next meets,
// maturity trend, escalations) with the Council Scorecard (the point-in-time,
// division-by-division measures, ROI value drivers and snapshots). One page,
// read top to bottom: brief → health → detail → trend → narrative.
// ──────────────────────────────────────────────────────────────────────────

// ── Types (mirror routes/council-scorecard.ts) ──
interface Row {
  orgId: string;
  name: string;
  domainsTotal: number;
  domainsGoverned: number;
  tier1Total: number;
  coverage: number | null;
  classification: number | null;
  openIssues: number;
  exceptions: number;
  status: string;
}
interface Narrative { whatMoved?: string; forCouncil?: string; whatMovedAuto?: boolean; forCouncilAuto?: boolean }
interface ScopeInfo { lens: 'all' | 'governed'; applied: boolean; version: number | null; changedAt: string | null }
interface ValueDriverRatio { covered: number; total: number; pct: number }
interface ValueDrivers { ownership: ValueDriverRatio; openRisk: number; resolvedLast30: number; avgResolutionDays: number | null }
interface RoiModel { currency: string; riskCostPerItem: number; resolutionValuePerIssue: number; ownershipValuePerEntity: number }
interface ValueStreamRoi { valueStreamId: string; name: string; assets: number; ownershipValue: number; resolutionValueAnnualized: number; annualValue: number; valueAtRisk: number }
interface RoiEstimate {
  configured: boolean; currency: string; model: RoiModel;
  valueAtRisk: number; resolutionValueMonthly: number; resolutionValueAnnualized: number;
  ownershipValue: number; annualValue: number;
  byValueStream?: ValueStreamRoi[];
}
interface Derived {
  orgId: string; orgName: string; period: string;
  targets: { coverage: number; classification: number; openIssues: number; exceptions: number; openIssuesDays: number };
  divisions: Row[]; enterprise: Row; narrative: Narrative; canEdit?: boolean;
  scope?: ScopeInfo;
  valueDrivers?: ValueDrivers;
  roi?: RoiEstimate;
}
interface VersionMeta { id: string; period: string; status: string; createdBy?: string; createdAt: string }
interface SavedVersion { id: string; orgId: string; period: string; status: string; createdBy?: string; createdAt: string; derived: Derived; overrides: Record<string, unknown>; narrative: Narrative }

// ── Briefing sources (composed from Groups / Calendar / Maturity trends) ──
interface CouncilMember { personName: string | null; agentName: string | null; groupRole: string; since: string }
interface CouncilGroup { id: string; name: string; charter: string; status: string; members: CouncilMember[] }
interface Occurrence { eventId: string; name: string; occursAt: string; daysAway: number; cadence: string; attendeeNames: string[] }
interface MaturitySnapshot { timestamp: string; overall: number; dimensions: { name: string; score: number }[] }

const ROLE_LABEL: Record<string, string> = {
  CHAIR: 'Chair', VICE_CHAIR: 'Vice-chair', SECRETARY: 'Secretary', MEMBER: 'Member', ADVISOR: 'Advisor',
};
const ROLE_ORDER: Record<string, number> = { CHAIR: 0, VICE_CHAIR: 1, SECRETARY: 2, MEMBER: 3, ADVISOR: 4 };

// A tiny inline sparkline for the maturity trend (no chart lib). Draws the
// series as a line with an emphasised end point over a faint area fill.
function Sparkline({ points, color, width = 260, height = 48 }: { points: number[]; color: string; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 4;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (points.length - 1);
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - min) / span);
  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${height - pad} L ${x(0).toFixed(1)} ${height - pad} Z`;
  const lastX = x(points.length - 1);
  const lastY = y(points[points.length - 1]);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', maxWidth: '100%' }} aria-hidden>
      <path d={area} fill={color} opacity={0.1} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={3.2} fill={color} />
    </svg>
  );
}

type Overrides = Record<string, number | string>;

// ── Shared stat-tile spec ─────────────────────────────────────────────────
// One tile shape reused across every KPI / value-driver / ROI strip so they
// all read at the same density as the main Dashboard's stat tiles (compact
// card, ~22px number, uniform min-height so a tile with a meter doesn't stand
// taller than a number-only one).
const TILE_MIN = 180;               // grid column min width
const TILE_GAP = 12;
const tileGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${TILE_MIN}px, 1fr))`, gap: TILE_GAP };
const statTile: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
  padding: '12px 14px', background: 'var(--color-bg)', minHeight: 84,
};
const tileLabel: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 };
const tileNumber: React.CSSProperties = { fontSize: 22, fontWeight: 700, marginTop: 6, fontVariantNumeric: 'tabular-nums' };
const tileSub: React.CSSProperties = { fontSize: 10.5, color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.4 };
// Right-aligned badge used in the ROI section headings.
const roiBadge: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '2px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '.04em' };
const roiBadgeMuted: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', padding: '2px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '.04em' };

// Each measure links to the page where you act on it — like the dashboard
// tiles and Gap Detection rows, the number is a hyperlink to its source.
const MEASURES: Array<{ key: 'coverage' | 'classification' | 'openIssues' | 'exceptions'; label: string; kind: 'pct' | 'count'; href: string; }> = [
  { key: 'coverage',       label: 'Tier-1 coverage', kind: 'pct',   href: '/data-domains' },
  { key: 'classification', label: 'Classification',  kind: 'pct',   href: '/data-assets' },
  { key: 'openIssues',     label: 'Open issues',     kind: 'count', href: '/governance-work?tab=issues' },
  { key: 'exceptions',     label: 'Exceptions',      kind: 'count', href: '/governance-exceptions' },
];

// The column-header subtitle for each measure, derived from the server's
// targets so the printed thresholds always match the logic that colours the
// bars and derives the status (no hardcoded "target 80%" to drift).
type Targets = Derived['targets'];
function measureSub(key: typeof MEASURES[number]['key'], t: Targets): string {
  switch (key) {
    case 'coverage':       return `target ${t.coverage}%`;
    case 'classification': return `target ${t.classification}%`;
    case 'openIssues':     return `>${t.openIssuesDays}d · target ${t.openIssues}`;
    case 'exceptions':     return `past expiry · target ${t.exceptions}`;
  }
}

// Format a whole-dollar figure in the tenant's chosen currency. Falls back to
// a plain grouped number if the currency code isn't one Intl recognises.
function fmtMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)}`;
  }
}

// Friendly destination names for link tooltips.
const MEASURE_DEST: Record<'coverage' | 'classification' | 'openIssues' | 'exceptions', string> = {
  coverage: 'Data Domains',
  classification: 'Data Assets',
  openIssues: 'Tasks & Issues',
  exceptions: 'Governance Exceptions',
};

// Each narrative section links to where its facts come from: "what moved" is
// drawn from the audit log; "for the council" summarises current gaps.
const NARRATIVE_LINK: Record<'whatMoved' | 'forCouncil', { to: string; label: string }> = {
  whatMoved: { to: '/audit-log', label: 'View recent activity' },
  forCouncil: { to: '/gap-detection', label: 'Review the gaps' },
};

// A hyperlink that inherits the surrounding text/number colour and only
// underlines on hover, so a linked measure reads as a normal value until you
// reach for it (matches the Gap Detection row-link affordance).
function ActionLink({ to, title, style, children }: { to: string; title?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      title={title}
      style={{ color: 'inherit', textDecoration: 'none', cursor: 'pointer', ...style }}
      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.textDecorationColor = 'var(--color-primary)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
    >
      {children}
    </Link>
  );
}

function statusPill(status: string) {
  const s = status.toLowerCase();
  const map: Record<string, { bg: string; color: string }> = {
    'on track':  { bg: 'var(--color-success)', color: '#fff' },
    'behind':    { bg: 'var(--color-warning)', color: '#fff' },
    'at risk':   { bg: 'var(--color-error)',   color: '#fff' },
    'no data':   { bg: 'var(--color-text-muted)', color: '#fff' },
  };
  const c = map[s] || { bg: 'var(--color-border)', color: 'var(--color-text)' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: `color-mix(in srgb, ${c.bg} 16%, transparent)`, color: c.bg }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: c.bg }} />{status}
    </span>
  );
}

function pctBarColor(v: number | null, target: number): string {
  if (v == null) return 'var(--color-border)';
  if (v >= target) return 'var(--color-success)';
  if (v >= target - 20) return 'var(--color-warning)';
  return 'var(--color-error)';
}

export default function CouncilPage() {
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const [derived, setDerived] = useState<Derived | null>(null);
  const [loading, setLoading] = useState(true);
  // Briefing sources — independent of the scorecard lens, so they load once
  // per org. A failure in one leaves the rest of the page populated.
  const [council, setCouncil] = useState<CouncilGroup | null>(null);
  const [meeting, setMeeting] = useState<Occurrence | null>(null);
  const [maturity, setMaturity] = useState<MaturitySnapshot[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [narrative, setNarrative] = useState<Narrative>({});
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);
  // Measure lens: "all" counts every entity in the org tree (default);
  // "governed" narrows to the entities the governance program governs. Live
  // control only — a saved version shows its own stored basis (derived.scope).
  const [lens, setLens] = useState<'all' | 'governed'>('all');
  // Saved-versions dropdown in the header (next to Save snapshot).
  const [versionsOpen, setVersionsOpen] = useState(false);
  const versionsRef = useRef<HTMLDivElement>(null);
  // Set when a save collides with an existing snapshot for the same period —
  // holds the replace target so the prompt can offer Replace vs. Save-as-new.
  const [pendingSave, setPendingSave] = useState<{ replaceId: string; period: string; savedAt: string } | null>(null);

  const canEdit = !!derived?.canEdit && !viewingVersionId;

  const loadDerived = useCallback(async () => {
    if (!activeOrgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await apiClient.get<{ success: boolean; data: Derived }>(`/council-scorecard/derive?orgId=${activeOrgId}&lens=${lens}`);
      setDerived(res.data);
      setNarrative(res.data.narrative || {});
      setOverrides({});
      setViewingVersionId(null);
      setEditing(false);
    } catch { addToast('error', 'Failed to load the scorecard.'); }
    finally { setLoading(false); }
  }, [activeOrgId, addToast, lens]);

  // Exit edit mode and discard unsaved edits — revert overrides + narrative to
  // the live derived baseline (live mode has no stored overrides).
  const cancelEdit = () => {
    setOverrides({});
    setNarrative(derived?.narrative || {});
    setEditing(false);
  };

  const loadVersions = useCallback(async () => {
    if (!activeOrgId) return;
    try {
      const res = await apiClient.get<{ success: boolean; data: VersionMeta[] }>(`/council-scorecard?orgId=${activeOrgId}`);
      setVersions(res.data || []);
    } catch { /* */ }
  }, [activeOrgId]);

  useEffect(() => { loadDerived(); loadVersions(); }, [loadDerived, loadVersions]);

  // Briefing: the council (Groups), its next meeting (Calendar), and the
  // maturity trend. Independent of the scorecard lens, so keyed on org only.
  const loadBriefing = useCallback(async () => {
    if (!activeOrgId) return;
    setCouncil(null); setMeeting(null); setMaturity([]);
    const oid = encodeURIComponent(activeOrgId);
    const [grpRes, calRes, matRes] = await Promise.allSettled([
      apiClient.get<{ data: CouncilGroup[] }>(`/governance-groups?orgId=${oid}`),
      apiClient.get<{ data: Occurrence[] }>(`/governance-calendar/upcoming?orgId=${oid}&days=120`),
      apiClient.get<{ data: MaturitySnapshot[] }>(`/maturity-trends?orgId=${oid}`),
    ]);
    if (grpRes.status === 'fulfilled') {
      const councilGroup = (grpRes.value.data || []).find((g) => (g as unknown as { type: string }).type === 'COUNCIL');
      if (councilGroup) {
        try { setCouncil((await apiClient.get<{ data: CouncilGroup }>(`/governance-groups/${councilGroup.id}`)).data); }
        catch { setCouncil(councilGroup); }
      }
    }
    if (calRes.status === 'fulfilled') {
      const occ = calRes.value.data || [];
      setMeeting(occ.find((o) => /council|committee|governance/i.test(o.name)) || occ[0] || null);
    }
    if (matRes.status === 'fulfilled') setMaturity(matRes.value.data || []);
  }, [activeOrgId]);

  useEffect(() => { loadBriefing(); }, [loadBriefing]);

  // Close the saved-versions dropdown on an outside click or Escape.
  useEffect(() => {
    if (!versionsOpen) return;
    const onDown = (e: MouseEvent) => { if (versionsRef.current && !versionsRef.current.contains(e.target as Node)) setVersionsOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setVersionsOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [versionsOpen]);

  const openVersion = async (id: string) => {
    try {
      const res = await apiClient.get<{ success: boolean; data: SavedVersion }>(`/council-scorecard/${id}`);
      setDerived({ ...res.data.derived, canEdit: false });
      setOverrides((res.data.overrides || {}) as Overrides);
      setNarrative(res.data.narrative || res.data.derived.narrative || {});
      setViewingVersionId(id);
      setEditing(false);
    } catch { addToast('error', 'Failed to open that version.'); }
  };

  // Save the current view as a snapshot. `replaceId` overwrites an existing
  // same-period version in place; otherwise a fresh version (new id +
  // timestamp) is created.
  const doPublish = async (replaceId?: string) => {
    if (!activeOrgId || !derived) return;
    setSaving(true);
    try {
      await apiClient.post('/council-scorecard', {
        orgId: activeOrgId,
        period: derived.period,
        overrides,
        narrative,
        lens: derived.scope?.lens ?? lens,
        ...(replaceId ? { replaceId } : {}),
      });
      addToast('success', replaceId
        ? `Replaced the ${derived.period} scorecard snapshot.`
        : `Saved the ${derived.period} scorecard snapshot.`);
      setPendingSave(null);
      setEditing(false);
      loadVersions();
    } catch { addToast('error', 'Failed to save. You may not have permission.'); }
    finally { setSaving(false); }
  };

  // Entry point for both the one-click "Save snapshot" and the edit-mode
  // "Publish snapshot". If a snapshot for this period already exists, prompt to
  // replace it or keep both; otherwise save straight away.
  const attemptSave = () => {
    if (!derived) return;
    const existing = versions.find((v) => v.period === derived.period);
    if (existing) setPendingSave({ replaceId: existing.id, period: derived.period, savedAt: existing.createdAt });
    else doPublish();
  };

  const oKey = (orgId: string, key: string) => `${orgId}.${key}`;
  const resolved = (row: Row, key: typeof MEASURES[number]['key']): number | null => {
    const k = oKey(row.orgId, key);
    if (k in overrides) return overrides[k] as number;
    return row[key];
  };
  const resolvedStatus = (row: Row): string => (overrides[oKey(row.orgId, 'status')] as string) ?? row.status;
  const isOverridden = (orgId: string, key: string) => oKey(orgId, key) in overrides;
  const setOverride = (orgId: string, key: string, value: number | string) =>
    setOverrides((p) => ({ ...p, [oKey(orgId, key)]: value }));
  const clearOverride = (orgId: string, key: string) =>
    setOverrides((p) => { const n = { ...p }; delete n[oKey(orgId, key)]; return n; });

  if (loading) return (<div><PageHeader title="Council" /><Spinner center label="Loading…" /></div>);
  if (!activeOrgId) return (<div><PageHeader title="Council" subtitle="Select an organization to view its council." /></div>);
  if (!derived) return (<div><PageHeader title="Council" /><Card>No data available.</Card></div>);

  const rows = [...derived.divisions, { ...derived.enterprise, isEnterprise: true } as Row & { isEnterprise?: boolean }];

  // ── Briefing derivations ──
  const sortedMembers = council
    ? [...council.members].sort((a, b) => (ROLE_ORDER[a.groupRole] ?? 9) - (ROLE_ORDER[b.groupRole] ?? 9))
    : [];
  const overallNow = maturity.length ? maturity[maturity.length - 1].overall : null;
  const overallFirst = maturity.length ? maturity[0].overall : null;
  const overallDelta = overallNow != null && overallFirst != null ? Math.round((overallNow - overallFirst) * 10) / 10 : null;
  const dims = maturity.length ? maturity[maturity.length - 1].dimensions : [];
  // Escalations — off-target measures framed as decisions to take, each
  // drilling into where it's fixed. Uses the resolved (override-aware) values.
  const escalations = MEASURES
    .map((m) => {
      const val = resolved(derived.enterprise, m.key);
      const tgt = derived.targets[m.key];
      const ok = val == null || (m.kind === 'pct' ? val >= tgt : val <= tgt);
      return { key: m.key, label: m.label, kind: m.kind, val, sub: measureSub(m.key, derived.targets), href: m.href, ok };
    })
    .filter((m) => !m.ok && m.val != null && (m.kind === 'pct' ? true : (m.val as number) > 0));

  const renderMeasureCell = (row: Row, m: typeof MEASURES[number], isEnt: boolean) => {
    const val = resolved(row, m.key);
    const overridden = isOverridden(row.orgId, m.key);
    if (editing && canEdit) {
      return (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
          <input
            type="number" aria-label={`${row.name} ${m.label}`}
            value={val == null ? '' : val}
            onChange={(e) => setOverride(row.orgId, m.key, e.target.value === '' ? 0 : Number(e.target.value))}
            style={{ width: 58, textAlign: 'right', border: `1px solid ${overridden ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 4, padding: '3px 6px', fontSize: 13, background: 'var(--color-surface)', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}
          />
          {overridden && <button type="button" title="Reset to derived" onClick={() => clearOverride(row.orgId, m.key)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 13 }}>↺</button>}
        </div>
      );
    }
    const display = val == null ? '—' : `${val}${m.kind === 'pct' ? '%' : ''}`;
    return (
      <ActionLink
        to={m.href}
        title={`Open ${m.label} — ${MEASURE_DEST[m.key]}`}
        style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, fontVariantNumeric: 'tabular-nums', fontWeight: isEnt ? 600 : 500 }}
      >
        <span style={{ color: overridden ? 'var(--color-primary)' : 'var(--color-text)' }}>
          {display}{overridden && <span title="Overridden" style={{ marginLeft: 4, fontSize: 9, color: 'var(--color-primary)' }}>●</span>}
        </span>
        {m.kind === 'pct' && val != null && (
          <span style={{ width: 60, height: 4, borderRadius: 2, background: 'var(--color-bg)', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.min(100, val)}%`, background: pctBarColor(val, m.key === 'coverage' ? derived.targets.coverage : derived.targets.classification), borderRadius: 2 }} />
          </span>
        )}
      </ActionLink>
    );
  };

  return (
    <div>
      <PageHeader
        title="Council"
        subtitle={`${derived.orgName} — ${derived.period}${viewingVersionId ? ' · saved version' : ''}. The council's meeting brief and its governance scorecard.`}
        actions={(
          // no-print: none of these controls belong on a printed briefing (the
          // global print stylesheet strips the app chrome; this strips the
          // page's own action bar).
          <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <IconButton icon="printer" label="Print briefing" onClick={() => window.print()} />
            {!viewingVersionId && !editing && (
              <div role="group" aria-label="Measure lens" style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 999, overflow: 'hidden' }}>
                {([['all', 'All'], ['governed', 'Governed']] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setLens(mode)}
                    aria-pressed={lens === mode}
                    title={mode === 'governed'
                      ? 'Only the entities your governance program governs (its resolved scope)'
                      : 'Every catalogued entity in the org tree, governed or not'}
                    style={{
                      padding: '5px 12px', fontSize: 12, fontWeight: lens === mode ? 600 : 500,
                      border: 'none', cursor: 'pointer',
                      background: lens === mode ? 'var(--color-primary)' : 'transparent',
                      color: lens === mode ? '#fff' : 'var(--color-text-secondary)',
                    }}
                  >{label}</button>
                ))}
              </div>
            )}
            {!editing && (
              <div ref={versionsRef} style={{ position: 'relative', display: 'inline-block' }}>
                <Button variant="secondary" onClick={() => setVersionsOpen((v) => !v)} aria-haspopup="menu" aria-expanded={versionsOpen}>
                  Versions{versions.length > 0 ? ` (${versions.length})` : ''} ▾
                </Button>
                {versionsOpen && (
                  <div role="menu" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 20, minWidth: 260, maxHeight: 320, overflowY: 'auto', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', padding: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', padding: '4px 8px 6px' }}>Saved versions</div>
                    {viewingVersionId && (
                      <button type="button" role="menuitem" onClick={() => { setVersionsOpen(false); loadDerived(); }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 8px', marginBottom: 4, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-bg)', cursor: 'pointer', font: 'inherit', color: 'var(--color-primary)', fontWeight: 600, fontSize: 12 }}>
                        ← Back to live
                      </button>
                    )}
                    {versions.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '4px 8px 8px', lineHeight: 1.4 }}>
                        No versions saved yet.{canEdit ? ' Click Save snapshot to keep a monthly record.' : ''}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {versions.map((v) => (
                          <button key={v.id} type="button" role="menuitem" onClick={() => { setVersionsOpen(false); openVersion(v.id); }}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '7px 8px', border: `1px solid ${viewingVersionId === v.id ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 6, background: viewingVersionId === v.id ? 'var(--color-primary-light)' : 'var(--color-surface)', cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--color-text)' }}>
                            <span style={{ fontWeight: 600, fontSize: 12.5 }}>{v.period}</span>
                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{v.status} · {new Date(v.createdAt).toLocaleDateString()}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {canEdit && !editing && <Button variant="secondary" onClick={() => setEditing(true)}>Edit &amp; override</Button>}
            {canEdit && !editing && <Button variant="primary" onClick={attemptSave} loading={saving}>Save snapshot</Button>}
            {canEdit && editing && <Button variant="secondary" onClick={cancelEdit} disabled={saving}>Cancel</Button>}
            {canEdit && editing && <Button variant="primary" onClick={attemptSave} loading={saving}>Publish snapshot</Button>}
          </div>
        )}
      />

      {/* Scope note — driven by what was actually measured (derived.scope), so a
          saved version shows its own basis. Under the governed lens: the scope
          version stamp when it narrowed, or why it didn't (no scope defined). */}
      {derived.scope && derived.scope.lens === 'governed' && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -6, marginBottom: 12, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {derived.scope.applied ? (
            <>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '2px 7px', borderRadius: 999 }}>Governed scope</span>
              <span>Measured within your governance program's scope.</span>
              {derived.scope.version != null && (
                <span
                  title={derived.scope.changedAt ? `Scope last changed ${new Date(derived.scope.changedAt).toLocaleString()}` : 'Scope has not changed since the program was created'}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >v{derived.scope.version}{derived.scope.changedAt ? ` · changed ${new Date(derived.scope.changedAt).toLocaleDateString()}` : ''}</span>
              )}
              <Link to="/governance/foundation" style={{ color: 'var(--color-primary)' }}>Manage scope →</Link>
            </>
          ) : (
            <>Your governance program has no scope defined yet, so this shows every catalogued entity. <Link to="/governance/foundation" style={{ color: 'var(--color-primary)' }}>Define scope →</Link></>
          )}
        </div>
      )}

      {/* ── Briefing: who's on the council + when it next meets ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div>
          <SectionHeading title="The council" as="h3" />
          <Card padding={16}>
            {council ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                    <span style={{ color: 'var(--color-primary)', display: 'inline-flex' }}>{renderNavIcon('/governance-groups', { size: 18 })}</span>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{council.name}</span>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: council.status === 'ACTIVE' ? 'var(--color-success)' : 'var(--color-text-muted)' }}>{council.status}</span>
                </div>
                {council.charter && (
                  <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.5, margin: '0 0 14px', borderLeft: '2px solid var(--color-border)', paddingLeft: 10 }}>{council.charter}</p>
                )}
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 8 }}>Membership ({sortedMembers.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sortedMembers.map((m, i) => {
                    const name = m.personName || m.agentName || 'Unknown';
                    const isAgent = !!m.agentName;
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {name}{isAgent && <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '0 5px', borderRadius: 3, marginLeft: 6 }}>Agent</span>}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: m.groupRole === 'CHAIR' ? 600 : 500, color: m.groupRole === 'CHAIR' ? 'var(--color-primary)' : 'var(--color-text-muted)', flexShrink: 0 }}>{ROLE_LABEL[m.groupRole] || m.groupRole}</span>
                      </div>
                    );
                  })}
                  {sortedMembers.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>No members assigned yet.</span>}
                </div>
                <div style={{ marginTop: 14 }}><Link to="/governance-groups" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}>Manage the council →</Link></div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                No governance council is defined for this organization yet. Create one — with a charter and members — to anchor this briefing.
                <div style={{ marginTop: 8 }}><Link to="/governance-groups" style={{ fontSize: 12.5, color: 'var(--color-primary)' }}>Set up governance groups →</Link></div>
              </div>
            )}
          </Card>
        </div>

        <div>
          <SectionHeading title="Next meeting" as="h3" />
          <Card padding={16}>
            {meeting ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
                  <span style={{ color: 'var(--color-primary)', display: 'inline-flex' }}>{renderNavIcon('/governance-calendar', { size: 18 })}</span>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{meeting.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums' }}>
                    {meeting.daysAway <= 0 ? 'Today' : meeting.daysAway === 1 ? 'Tomorrow' : `${meeting.daysAway} days`}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{new Date(meeting.occursAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', textTransform: 'capitalize', marginBottom: 12 }}>{meeting.cadence.toLowerCase()} cadence</div>
                {meeting.attendeeNames.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 6 }}>Attendees ({meeting.attendeeNames.length})</div>
                    <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{meeting.attendeeNames.join(', ')}</div>
                  </>
                )}
                <div style={{ marginTop: 14 }}><Link to="/governance-calendar" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}>Open the calendar →</Link></div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                No upcoming governance meeting is scheduled in the next 120 days.
                <div style={{ marginTop: 8 }}><Link to="/governance-calendar" style={{ fontSize: 12.5, color: 'var(--color-primary)' }}>Schedule one →</Link></div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Scorecard — the enterprise verdict + division-by-division grid ── */}
      <SectionHeading title="Scorecard" as="h3" right={statusPill(resolvedStatus(derived.enterprise))} />
      <Card padding={0} marginBottom={16}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={thL}>Division</th>
                <th style={thR}>Domains<div style={thSub}>governed · context</div></th>
                {MEASURES.map((m) => <th key={m.key} style={thR}>{m.label}<div style={thSub}>{measureSub(m.key, derived.targets)}</div></th>)}
                <th style={thR}>Status<div style={thSub}>derived</div></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isEnt = (row as any).isEnterprise;
                return (
                  <tr key={row.orgId} style={isEnt ? { background: 'var(--color-primary-light)', borderTop: '2px solid var(--color-primary)' } : undefined}>
                    <td style={{ ...tdL, fontWeight: isEnt ? 700 : 600, color: isEnt ? 'var(--color-primary)' : 'var(--color-text)' }}>
                      {isEnt && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', background: 'var(--color-surface)', color: 'var(--color-primary)', border: '1px solid var(--color-primary)', padding: '1px 6px', borderRadius: 999, marginRight: 8 }}>▲ Rollup</span>}
                      {row.name}
                    </td>
                    <td style={tdR}><ActionLink to="/data-domains" title="Open Data Domains" style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{row.domainsGoverned} of {row.domainsTotal}</ActionLink></td>
                    {MEASURES.map((m) => <td key={m.key} style={tdR}>{renderMeasureCell(row, m, isEnt)}</td>)}
                    <td style={tdR}>
                      {editing && canEdit ? (
                        <select value={resolvedStatus(row)} onChange={(e) => setOverride(row.orgId, 'status', e.target.value)} style={{ border: `1px solid ${isOverridden(row.orgId, 'status') ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 4, padding: '3px 6px', fontSize: 12, background: 'var(--color-surface)', color: 'var(--color-text)' }}>
                          {['On track', 'Behind', 'At risk', 'No data'].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : statusPill(resolvedStatus(row))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Governance value drivers — ROI Phase 1: leading indicators, not
          dollars. Respects the active lens; a CFO's $ model multiplies these. */}
      {derived.valueDrivers && (() => {
        const v = derived.valueDrivers;
        const tiles: Array<{ label: string; value: string; sub: string; tone?: 'good' | 'risk' }> = [
          { label: 'Ownership coverage', value: `${v.ownership.pct}%`, sub: `${v.ownership.covered}/${v.ownership.total} domains & assets have a named owner`, tone: 'good' },
          { label: 'Value at risk', value: `${v.openRisk}`, sub: 'Past-expiry exceptions + unowned tier-1 domains + unclassified assets — drive down', tone: 'risk' },
          { label: 'Resolved (30 days)', value: `${v.resolvedLast30}`, sub: 'Governance issues moved to a terminal status', tone: 'good' },
          { label: 'Avg days to resolve', value: v.avgResolutionDays == null ? '—' : `${v.avgResolutionDays}`, sub: v.avgResolutionDays == null ? 'No resolved issues yet' : 'Mean cycle time across resolved issues' },
        ];
        return (
          <>
          <SectionHeading title="Governance value drivers" as="h3" right={<span style={roiBadge}>Leading indicators</span>} />
          <Card padding={18} marginBottom={16}>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              The un-fakeable signals that governance is paying off — measured from your catalog, no assumed dollar figures. {derived.scope?.applied ? 'Scoped to the governed set.' : 'Across the whole org tree.'}
            </div>
            <div style={tileGrid}>
              {tiles.map((t) => (
                <div key={t.label} style={statTile}>
                  <div style={tileLabel}>{t.label}</div>
                  <div style={{ ...tileNumber, color: t.tone === 'risk' && v.openRisk > 0 ? 'var(--color-warning)' : t.tone === 'good' ? 'var(--color-success)' : 'var(--color-text)' }}>{t.value}</div>
                  <div style={tileSub}>{t.sub}</div>
                </div>
              ))}
            </div>
          </Card>
          </>
        );
      })()}

      {/* Estimated governance value — ROI Phase 2: the drivers above monetized
          with the tenant's OWN dollar model. When no model is set we show a
          configure prompt, never a fabricated figure. */}
      {derived.roi && (() => {
        const roi = derived.roi;
        if (!roi.configured) {
          return (
            <>
            <SectionHeading title="Estimated governance value" as="h3" right={<span style={roiBadgeMuted}>Not configured</span>} />
            <Card padding={18} marginBottom={16}>
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                Turn the drivers above into a dollar figure by setting your organization&rsquo;s value model — what an owned entity, a resolved issue, and an open-risk item are worth to you. Procela invents no figures.{' '}
                <Link to="/governance/foundation?tab=value" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Set your value model →</Link>
              </div>
            </Card>
            </>
          );
        }
        const cur = roi.currency;
        const tiles: Array<{ label: string; value: string; sub: string; tone?: 'good' | 'risk' }> = [
          { label: 'Estimated annual value', value: fmtMoney(roi.annualValue, cur), sub: 'Ownership value + annualized resolution value', tone: 'good' },
          { label: 'Ownership value', value: fmtMoney(roi.ownershipValue, cur), sub: 'Owned domains & assets × your value per owned entity' },
          { label: 'Resolution value (annualized)', value: fmtMoney(roi.resolutionValueAnnualized, cur), sub: `${fmtMoney(roi.resolutionValueMonthly, cur)}/mo run-rate × 12` },
          { label: 'Value at risk', value: fmtMoney(roi.valueAtRisk, cur), sub: 'Open-risk items × your exposure per item — drive down', tone: 'risk' },
        ];
        return (
          <>
          <SectionHeading title="Estimated governance value" as="h3" right={<span style={roiBadge}>Your assumptions</span>} />
          <Card padding={18} marginBottom={16}>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              The value drivers monetized with your model — {fmtMoney(roi.model.ownershipValuePerEntity, cur)}/owned entity, {fmtMoney(roi.model.resolutionValuePerIssue, cur)}/issue resolved, {fmtMoney(roi.model.riskCostPerItem, cur)}/open-risk item. An estimate, only as good as those assumptions. {derived.scope?.applied ? 'Scoped to the governed set.' : 'Across the whole org tree.'}{' '}
              <Link to="/governance/foundation?tab=value" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Edit model →</Link>
            </div>
            <div style={tileGrid}>
              {tiles.map((t) => (
                <div key={t.label} style={statTile}>
                  <div style={tileLabel}>{t.label}</div>
                  <div style={{ ...tileNumber, color: t.tone === 'risk' && roi.valueAtRisk > 0 ? 'var(--color-warning)' : t.tone === 'good' ? 'var(--color-success)' : 'var(--color-text)' }}>{t.value}</div>
                  <div style={tileSub}>{t.sub}</div>
                </div>
              ))}
            </div>
            {/* ROI Phase 3 — per-value-stream attribution. Which streams' data
                is banking value vs. carrying risk. */}
            {roi.byValueStream && roi.byValueStream.length > 0 && (() => {
              const rows = roi.byValueStream!;
              const shown = rows.slice(0, 8);
              return (
                <div style={{ marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 }}>By value stream</div>
                  <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)', marginBottom: 10, lineHeight: 1.4 }}>
                    Value attributed through each stream&rsquo;s process&#8594;data mappings. An asset supporting several streams counts in each, and org-level exceptions and unmapped data aren&rsquo;t attributed — so rows don&rsquo;t sum to the totals above.
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                      <thead>
                        <tr style={{ textAlign: 'right', color: 'var(--color-text-muted)', fontSize: 11 }}>
                          <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Value stream</th>
                          <th style={{ padding: '4px 8px', fontWeight: 600 }}>Assets</th>
                          <th style={{ padding: '4px 8px', fontWeight: 600 }}>Annual value</th>
                          <th style={{ padding: '4px 8px', fontWeight: 600 }}>Value at risk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r) => (
                          <tr key={r.valueStreamId} style={{ borderTop: '1px solid var(--color-border)' }}>
                            <td style={{ textAlign: 'left', padding: '7px 8px', fontWeight: 500 }}><TruncatedText text={r.name} /></td>
                            <td style={{ textAlign: 'right', padding: '7px 8px', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-muted)' }}>{r.assets}</td>
                            <td style={{ textAlign: 'right', padding: '7px 8px', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: r.annualValue > 0 ? 'var(--color-success)' : 'var(--color-text)' }}>{fmtMoney(r.annualValue, cur)}</td>
                            <td style={{ textAlign: 'right', padding: '7px 8px', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: r.valueAtRisk > 0 ? 'var(--color-warning)' : 'var(--color-text)' }}>{fmtMoney(r.valueAtRisk, cur)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > shown.length && (
                    <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)', marginTop: 8 }}>+{rows.length - shown.length} more stream{rows.length - shown.length === 1 ? '' : 's'} with attributed value.</div>
                  )}
                </div>
              );
            })()}
          </Card>
          </>
        );
      })()}

      {/* ── Maturity trend + escalations — are we improving, and what needs a call ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div>
          <SectionHeading title="Maturity trend" as="h3" />
          <Card padding={16}>
            {overallNow != null ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{overallNow.toFixed(1)}</span>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>/ 5 overall</span>
                  {overallDelta != null && overallDelta !== 0 && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: overallDelta > 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                      {overallDelta > 0 ? '▲' : '▼'} {Math.abs(overallDelta).toFixed(1)} since first snapshot
                    </span>
                  )}
                </div>
                {maturity.length >= 2 && <Sparkline points={maturity.map((s) => s.overall)} color="var(--color-primary)" />}
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dims.map((d) => (
                    <div key={d.name} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 34px', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                      <Meter value={(d.score / 5) * 100} height={5} />
                      <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.score.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                No maturity snapshots recorded yet. Maturity trend builds as assessments are captured over time.
              </div>
            )}
          </Card>
        </div>

        <div>
          <SectionHeading title="Needs a decision" as="h3" />
          <Card padding={16}>
            {escalations.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {escalations.map((m) => (
                  <Link key={m.key} to={m.href} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', textDecoration: 'none', color: 'inherit' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                    <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-warning)', minWidth: 30, fontVariantNumeric: 'tabular-nums' }}>{m.val}{m.kind === 'pct' ? '%' : ''}</span>
                    <span style={{ fontSize: 13, flex: 1 }}>{m.label} <span style={{ color: 'var(--color-text-muted)' }}>· {m.sub}</span></span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Review →</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div style={{ padding: '6px 0 10px', color: 'var(--color-success)', fontSize: 13, fontWeight: 500 }}>
                ✓ Every measure is on target — nothing to escalate this period.
              </div>
            )}
            {/* Council note — the auto-derived / editable summary, folded in from
                the old "For the council" narrative card so the page has a single
                decision surface instead of two that said much the same thing. */}
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                Council note
                {narrative.forCouncilAuto && <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '1px 6px', borderRadius: 999 }}>Auto-derived</span>}
              </div>
              {editing && canEdit ? (
                <textarea
                  value={narrative.forCouncil || ''}
                  onChange={(e) => setNarrative((p) => ({ ...p, forCouncil: e.target.value, forCouncilAuto: false }))}
                  rows={3}
                  style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 6, padding: 10, fontSize: 13, background: 'var(--color-surface)', color: 'var(--color-text)', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                />
              ) : (
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{narrative.forCouncil || '—'}</div>
              )}
            </div>
            <div style={{ marginTop: 12 }}><Link to="/gap-detection" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}>Review all gaps →</Link></div>
          </Card>
        </div>
      </div>

      {/* Narrative — the retrospective. "For the council" moved up into the
          "Needs a decision" card, so this is just the month's changes. */}
      <div style={{ marginBottom: 16 }}>
        {([['whatMoved', 'What moved this month']] as const).map(([key, label]) => (
          <Card key={key} padding={18}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              {label}
              {narrative[`${key}Auto` as 'whatMovedAuto' | 'forCouncilAuto'] && <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '1px 6px', borderRadius: 999 }}>AUTO-DERIVED</span>}
            </div>
            {editing && canEdit ? (
              <textarea
                value={narrative[key] || ''}
                onChange={(e) => setNarrative((p) => ({ ...p, [key]: e.target.value, [`${key}Auto`]: false }))}
                rows={4}
                style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 6, padding: 10, fontSize: 13.5, background: 'var(--color-surface)', color: 'var(--color-text)', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
            ) : (
              <>
                <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{narrative[key] || '—'}</div>
                <div style={{ marginTop: 12 }}>
                  <ActionLink to={NARRATIVE_LINK[key].to} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-primary)' }}>{NARRATIVE_LINK[key].label} →</ActionLink>
                </div>
              </>
            )}
          </Card>
        ))}
      </div>


      {/* Same-period save collision — let the editor replace the existing
          snapshot or keep it and save an additional one (new id + timestamp). */}
      <ConfirmDialog
        open={!!pendingSave}
        title="A snapshot for this period already exists"
        message={pendingSave
          ? `A ${pendingSave.period} snapshot was already saved on ${new Date(pendingSave.savedAt).toLocaleDateString()}. Replace it with the current view, or keep it and save this as a new snapshot?`
          : ''}
        confirmLabel="Replace existing"
        variant="primary"
        onConfirm={() => { if (pendingSave) doPublish(pendingSave.replaceId); }}
        onCancel={() => setPendingSave(null)}
      >
        <button
          type="button"
          onClick={() => doPublish()}
          disabled={saving}
          style={{ width: '100%', marginBottom: 16, padding: '8px 16px', fontSize: '0.875rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)', cursor: saving ? 'wait' : 'pointer', fontWeight: 500 }}
        >
          Save as a new snapshot
        </button>
      </ConfirmDialog>
    </div>
  );
}

// ── table styles ──
const thBase: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '.04em', textTransform: 'uppercase', padding: '10px 12px', borderBottom: '1.5px solid var(--color-border)', verticalAlign: 'bottom' };
const thL: React.CSSProperties = { ...thBase, textAlign: 'left' };
const thR: React.CSSProperties = { ...thBase, textAlign: 'right' };
const thSub: React.CSSProperties = { fontWeight: 500, textTransform: 'none', letterSpacing: 0, fontSize: 10, marginTop: 3, color: 'var(--color-text-muted)' };
const tdBase: React.CSSProperties = { padding: '12px', borderBottom: '1px solid var(--color-border)', fontSize: 14 };
const tdL: React.CSSProperties = { ...tdBase, textAlign: 'left' };
const tdR: React.CSSProperties = { ...tdBase, textAlign: 'right' };
