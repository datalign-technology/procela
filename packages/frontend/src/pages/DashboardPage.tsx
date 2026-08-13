import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { X, ArrowLeftRight, ListTree, Database, CheckCircle2, Users, TrendingUp, Check, ChevronUp, ChevronDown } from 'lucide-react';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';
import ActivityFeed from '../components/ActivityFeed';
import { SkeletonRows } from '../components/Skeleton';
import PageHeader from '../components/PageHeader';
import SectionLabel from '../components/SectionLabel';
import Card from '../components/Card';
import { healthColorVar } from '../components/HealthBar';
import SectionHeading from '../components/SectionHeading';
import StatTile from '../components/StatTile';
import Meter from '../components/Meter';
import ProgressRing from '../components/ProgressRing';
import DomainLensToggle from '../components/DomainLensToggle';
import DomainLensActiveBanner from '../components/DomainLensActiveBanner';
import { renderNavIcon } from '../components/navIcons';
import SkillGapsWidget from '../components/SkillGapsWidget';
import { useDomainLens } from '../stores/domainLensStore';
import { useAuthStore } from '../stores/authStore';
import { usePolling } from '../hooks/usePolling';

interface DashboardStats {
  valueStreams: number;
  processes: number;
  subProcesses: number;
  steps: number;
  activities: number;
  systems: number;
  dataAssets: number;
  mappings: number;
  organizations: number;
  people: number;
  /** True when the current scope org has at least one descendant org
   *  at ownership level (company sees its divisions). Used by the
   *  setup-complete banner to decide whether to require descendant
   *  processes before declaring "done". */
  hasChildOwnershipOrgs?: boolean;
  /** Count of process nodes owned by descendants of the current scope
   *  org — parent-scope only cares whether the divisions have processes
   *  yet, not by how many. Zero when the current scope has no
   *  ownership-level descendants. */
  descendantProcesses?: number;
  coverage: { mapped: number; unmapped: number; percentage: number };
  governance: { bronze: number; silver: number; gold: number };
  averageHealth: number;
  gaps: {
    unmappedSteps: number;
    unmappedActivities: number;
    ungovernedAssets: number;
    ownerlessItems: number;
    ungovernedDomains: number;
    /** Data assets in scope that no mapping row references — the
     *  reverse-view signal landed with the orphan-assets page. */
    orphanAssets?: number;
    /** Total Phase 3 suggestion dismissals recorded for this scope.
     *  Informational, not severity-bearing — a high number is
     *  expected once the learning loop has been in use for a while. */
  };
}

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 20,
  boxShadow: 'var(--shadow-sm)',
};

// ──────────────────────────────────────────────────────────────────────────
// GettingStartedCard — shown on the Dashboard when an org exists but
// hasn't been populated yet. Dropping the full stat-heavy dashboard onto
// a brand-new tenant produces a wall of zeros and no signal about what
// to do first; this card gives a guided four-step path through the
// three layers (Business / Data / Systems / People).
// ──────────────────────────────────────────────────────────────────────────

function GettingStartedCard({ stats }: { stats: DashboardStats }) {
  // Steps use the same icon set as the sidebar so the numbered
  // rows here read as "open the Processes / Systems / Data Assets /
  // People page". Sized down to 16px to sit inline with the title.
  const steps = [
    {
      icon: renderNavIcon('/processes', { size: 16 }),
      title: 'Define your business processes',
      description: 'Map how your organization works — value streams, processes, sub-processes, and activities. Plain business language, no technical knowledge required.',
      done: stats.processes > 0,
      ctaLabel: 'Generate processes',
      // Send first-timers to the AI wizard, not the empty catalog
      // table — the wizard is the fast path to a real hierarchy.
      ctaTo: '/processes/wizard',
      doneLabel: `${stats.processes} ${stats.processes === 1 ? 'process' : 'processes'}`,
    },
    {
      icon: renderNavIcon('/systems', { size: 16 }),
      title: 'Register your systems',
      description: 'Tell Procela about the applications and platforms your data lives in — ERP, CRM, data warehouses, file stores.',
      done: stats.systems > 0,
      ctaLabel: 'Add systems',
      ctaTo: '/systems',
      doneLabel: `${stats.systems} ${stats.systems === 1 ? 'system' : 'systems'}`,
    },
    {
      icon: renderNavIcon('/data-assets', { size: 16 }),
      title: 'Add your data assets',
      description: 'Describe the data you care about in business terms — customer records, transactions, reports — so it can be tied back to processes.',
      done: stats.dataAssets > 0,
      ctaLabel: 'Add data assets',
      ctaTo: '/data-assets',
      doneLabel: `${stats.dataAssets} ${stats.dataAssets === 1 ? 'asset' : 'assets'}`,
    },
    {
      icon: renderNavIcon('/people', { size: 16 }),
      title: 'Invite your people',
      description: 'Set up owners and stewards so accountability is clear. Procela tracks who is responsible for each process, system, and asset.',
      done: stats.people > 0,
      ctaLabel: 'Add people',
      ctaTo: '/people',
      doneLabel: `${stats.people} ${stats.people === 1 ? 'person' : 'people'}`,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const percent = Math.round((doneCount / steps.length) * 100);

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: 24,
      marginBottom: 24,
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Welcome to Procela</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
          A few short steps to get your governance program off the ground.{' '}
          {doneCount > 0 && (
            <span style={{ color: 'var(--color-text)' }}>
              {doneCount} of {steps.length} done.
            </span>
          )}
        </p>
      </div>
      <Meter value={percent} height={4} style={{ marginBottom: 20 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {steps.map((s, i) => (
          <div key={s.title} style={{
            display: 'flex', alignItems: 'flex-start', gap: 14,
            padding: 14,
            background: s.done ? 'var(--color-bg)' : 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 14, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: s.done ? '#dcfce7' : 'var(--color-bg)',
              color: s.done ? '#166534' : 'var(--color-text)',
              fontSize: 13, fontWeight: 600,
              border: s.done ? '1px solid #86efac' : '1px solid var(--color-border)',
            }}>
              {s.done ? <Check size={15} strokeWidth={3} /> : i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--color-text-secondary)', flexShrink: 0 }}>{s.icon}</span>
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{s.title}</h3>
                {s.done && (
                  <span style={{ fontSize: 11, color: '#166534', marginLeft: 'auto', fontWeight: 500 }}>
                    {s.doneLabel}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '4px 0 0', lineHeight: 1.5 }}>
                {s.description}
              </p>
              {!s.done && (
                <Link
                  to={s.ctaTo}
                  style={{
                    display: 'inline-block', marginTop: 10,
                    padding: '6px 14px', fontSize: 12, fontWeight: 500,
                    background: 'var(--color-primary)', color: '#fff',
                    borderRadius: 'var(--radius-md)', textDecoration: 'none',
                  }}
                >
                  {s.ctaLabel}
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}









// ──────────────────────────────────────────────────────────────────────────
// My Items — personalized dashboard section showing what the logged-in
// user owns, stewards, and may need to act on.
// ──────────────────────────────────────────────────────────────────────────

interface MyTask { id: string; title: string; isOverdue?: boolean; priority: string; dueDate?: string; status: string; }
interface MyIssue { id: string; title: string; severity: string; status: string; domainName?: string; }
interface MyReview { id: string; name: string; isOverdue?: boolean; }
interface MyEvent { name: string; daysAway: number; }
interface MyDomain { id: string; name: string; relation: string; assetCount: number; totalAssets: number; healthyAssets: number; }
interface MyDashboardData {
  person?: { name: string };
  summary?: {
    openTasks?: number; overdueTasks?: number; openIssues?: number; criticalIssues?: number;
    domainsOwned?: number; domainsSteward?: number; upcomingEventsCount?: number;
  };
  myTasks?: MyTask[];
  myIssues?: MyIssue[];
  pendingReviews?: MyReview[];
  upcomingEvents?: MyEvent[];
  myDomains?: MyDomain[];
}

function MyDashboard() {
  const { user } = useAuthStore();
  const [data, setData] = useState<MyDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.email) { setLoading(false); return; }
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: MyDashboardData }>('/dashboard/my-dashboard');
        setData(res.data);
      } catch { /* */ }
      finally { setLoading(false); }
    })();
  }, [user?.email]);

  if (loading) return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeading title="My Dashboard" />
      <Card padding={20}><SkeletonRows rows={4} columnWidths={[180, null, 90]} /></Card>
    </div>
  );

  if (!data?.person) return null;

  const s = data.summary || {};
  const priorityColor = (p: string) => p === 'CRITICAL' ? '#dc2626' : p === 'HIGH' ? '#f59e0b' : p === 'MEDIUM' ? '#3b82f6' : '#64748b';
  const priorityBadge = (p: string): React.CSSProperties => ({
    display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600,
    background: priorityColor(p) + '18', color: priorityColor(p),
  });

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeading title="My Dashboard" marginBottom={4} />
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Welcome back, {data.person.name}. Here’s what needs your attention.
      </p>

      {/* Summary KPIs — each tile is a hyperlink to the surface where
          that count lives. Same affordance as the org Overview strip
          below (hover lift, muted-but-still-linked at zero, tooltip
          announces the destination for keyboard / screen-reader). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <StatTile dense
          to="/governance-work?tab=tasks"
          label="Open Tasks"
          value={s.openTasks || 0}
          valueColor={(s.overdueTasks || 0) > 0 ? 'var(--color-error)' : 'var(--color-text)'}
          sub={(s.overdueTasks || 0) > 0 ? { text: `${s.overdueTasks} overdue`, color: 'var(--color-error)' } : null}
        />
        <StatTile dense
          to="/governance-work?tab=issues"
          label="Open Issues"
          value={s.openIssues || 0}
          valueColor={(s.criticalIssues || 0) > 0 ? 'var(--color-error)' : 'var(--color-text)'}
          sub={(s.criticalIssues || 0) > 0 ? { text: `${s.criticalIssues} critical`, color: 'var(--color-error)' } : null}
        />
        <StatTile dense
          to="/data-domains"
          label="My Domains"
          value={(s.domainsOwned || 0) + (s.domainsSteward || 0)}
        />
        <StatTile dense
          to="/governance-calendar"
          label="Upcoming Events"
          value={s.upcomingEventsCount || 0}
        />
      </div>

      {/* Two-column: Attention + Schedule */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Needs Attention */}
        <Card padding="14px 16px" style={{ borderLeft: '4px solid var(--color-warning)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-warning)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Needs My Attention
          </div>
          {(data.myTasks || []).filter((t) => t.isOverdue).length === 0 &&
           (data.myIssues || []).filter((i) => i.severity === 'CRITICAL').length === 0 &&
           (data.pendingReviews || []).length === 0 ? (
            <div style={{ color: 'var(--color-success)', fontSize: 13 }}>All clear — no urgent items.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(data.myTasks || []).filter((t) => t.isOverdue).slice(0, 3).map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-error)' }}>Overdue: {t.title}</span>
                  <Link to="/governance-work?tab=tasks" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>View</Link>
                </div>
              ))}
              {(data.myIssues || []).filter((i) => i.severity === 'CRITICAL').slice(0, 3).map((i) => (
                <div key={i.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-error)' }}>Critical: {i.title}</span>
                  <Link to="/governance-work?tab=issues" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>View</Link>
                </div>
              ))}
              {(data.pendingReviews || []).slice(0, 3).map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, color: r.isOverdue ? 'var(--color-error)' : 'var(--color-warning)' }}>{r.isOverdue ? 'Overdue review' : 'Review due'}: {r.name}</span>
                  <Link to="/governance-policies" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>View</Link>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* My Schedule */}
        <Card padding="14px 16px" style={{ borderLeft: '4px solid var(--color-info)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-info)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            My Schedule
          </div>
          {(data.upcomingEvents || []).length === 0 ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No upcoming events in the next 14 days.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(data.upcomingEvents || []).slice(0, 5).map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12 }}>{e.name}</span>
                  <span style={{ fontSize: 10, color: e.daysAway === 0 ? 'var(--color-error)' : 'var(--color-text-muted)', fontWeight: e.daysAway === 0 ? 600 : 400 }}>
                    {e.daysAway === 0 ? 'Today' : e.daysAway === 1 ? 'Tomorrow' : `In ${e.daysAway} days`}
                  </span>
                </div>
              ))}
              <Link to="/governance-calendar" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none', marginTop: 4 }}>View calendar</Link>
            </div>
          )}
        </Card>
      </div>

      {/* My Domains */}
      {(data.myDomains || []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <SectionLabel>My Domains</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {(data.myDomains || []).map((d) => {
              const healthPct = d.totalAssets > 0 ? Math.round((d.healthyAssets / d.totalAssets) * 100) : 0;
              return (
                <Link key={d.id} to="/data-domains" style={{ ...cardStyle, padding: '10px 14px', textDecoration: 'none', color: 'var(--color-text)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', color: d.relation === 'owner' ? '#1e40af' : '#065f46', background: d.relation === 'owner' ? '#dbeafe' : '#d1f0eb', padding: '1px 5px', borderRadius: 3 }}>{d.relation}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>{d.assetCount} assets &middot; {healthPct}% healthy</div>
                  <Meter value={healthPct} height={4} color={healthColorVar(healthPct)} />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* My Tasks (top 5) */}
      {(data.myTasks || []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <SectionLabel marginBottom={0}>My Tasks</SectionLabel>
            <Link to="/governance-work?tab=tasks" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>View all {data.myTasks?.length ?? 0}</Link>
          </div>
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {(data.myTasks || []).slice(0, 5).map((t, i) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderTop: i > 0 ? '1px solid var(--color-border)' : 'none', fontSize: 12 }}>
                <span style={priorityBadge(t.priority)}>{t.priority}</span>
                <span style={{ flex: 1 }}>{t.title}</span>
                {t.dueDate && <span style={{ fontSize: 10, color: t.isOverdue ? 'var(--color-error)' : 'var(--color-text-muted)' }}>{t.isOverdue ? 'Overdue' : new Date(t.dueDate).toLocaleDateString()}</span>}
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{t.status.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* My Issues (top 5) */}
      {(data.myIssues || []).length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <SectionLabel marginBottom={0}>My Issues</SectionLabel>
            <Link to="/governance-work?tab=issues" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>View all {data.myIssues?.length ?? 0}</Link>
          </div>
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {(data.myIssues || []).slice(0, 5).map((issue, i) => (
              <div key={issue.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderTop: i > 0 ? '1px solid var(--color-border)' : 'none', fontSize: 12 }}>
                <span style={priorityBadge(issue.severity)}>{issue.severity}</span>
                <span style={{ flex: 1 }}>{issue.title}</span>
                {issue.domainName && <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{issue.domainName}</span>}
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{issue.status.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}


// ── Stats Overview — compact KPI strip ──

function StatsOverview({ stats }: { stats: DashboardStats }) {
  // Each KPI tile is a hyperlink to the surface where that count lives.
  // Two derived metrics get more specific deep-links:
  //   - Coverage → Data Mapping (the page that surfaces unmapped-activity
  //     and unlinked-asset banners natively).
  //   - Avg Health → Data Assets sorted by health ascending, so the
  //     cohort dragging the average down is at the top of the table.
  // Zero counts still link through, but render with a muted cursor so
  // users land on the empty-state CTA on the destination page rather
  // than dead-clicking from a 0 tile.
  // Counts wear plain ink — the label carries identity; colour is spent only
  // where the number is a *state* (coverage / health), via healthColorVar.
  const kpis: Array<{ label: string; value: string | number; color?: string; to: string; zero: boolean }> = [
    { label: 'Value Streams', value: stats.valueStreams, to: '/processes', zero: stats.valueStreams === 0 },
    { label: 'Processes',     value: stats.processes,    to: '/processes', zero: stats.processes === 0 },
    { label: 'Data Assets',   value: stats.dataAssets,   to: '/data-assets', zero: stats.dataAssets === 0 },
    { label: 'Systems',       value: stats.systems,      to: '/systems', zero: stats.systems === 0 },
    { label: 'Coverage',      value: `${stats.coverage.percentage}%`,
      color: healthColorVar(stats.coverage.percentage),
      to: '/mappings', zero: stats.coverage.percentage === 0 },
    { label: 'Avg Health',    value: `${stats.averageHealth}%`,
      color: healthColorVar(stats.averageHealth),
      to: '/data-assets?sort=healthScore&dir=asc', zero: stats.averageHealth === 0 },
  ];
  return (
    <div style={{ marginBottom: 24 }}>
      {/* Heading row carries the lens toggle so the user can sweep the
          KPI strip between operational and governance work without
          leaving the dashboard. Value Streams / Processes / Coverage
          numbers refetch with `?domain=…`; Data Assets / Systems / Avg
          Health stay constant — they are not domain-tagged. */}
      <SectionHeading title="Overview" right={<DomainLensToggle pageKey="dashboard" />} />
      <DomainLensActiveBanner pageKey="dashboard" entityLabel="process counts" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
        {kpis.map((k) => (
          <StatTile dense key={k.label} label={k.label} value={k.value} to={k.to} valueColor={k.color} zero={k.zero} />
        ))}
      </div>
    </div>
  );
}

// ── Dashboard section ordering (persisted to localStorage) ──

type SectionKey = 'myDashboard' | 'overview' | 'programMaturity' | 'gaps' | 'whatsNext' | 'stewardOnboarding' | 'quickActions' | 'recentActivity' | 'skillGaps';

const DEFAULT_SECTIONS: SectionKey[] = ['myDashboard', 'overview', 'programMaturity', 'gaps', 'skillGaps', 'whatsNext', 'stewardOnboarding', 'quickActions', 'recentActivity'];

const SECTION_LABELS: Record<SectionKey, string> = {
  myDashboard: 'My Dashboard',
  overview: 'Overview',
  programMaturity: 'Program Maturity',
  gaps: 'Governance Gaps',
  skillGaps: 'Skill Gaps',
  whatsNext: "What's Next",
  stewardOnboarding: 'Steward Onboarding',
  quickActions: 'Quick Actions',
  recentActivity: 'Recent Activity',
};

function useDashboardLayout() {
  const STORAGE_KEY = 'procela_dashboard_layout';
  const KNOWN_KEYS = new Set<SectionKey>(DEFAULT_SECTIONS);
  const isKnown = (k: string): k is SectionKey => KNOWN_KEYS.has(k as SectionKey);
  const [order, setOrder] = useState<SectionKey[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { order: string[]; hidden: string[] };
        const cleaned = (parsed.order || []).filter(isKnown);
        // Append any DEFAULT keys missing from the stored layout (e.g. new sections added in a release)
        for (const k of DEFAULT_SECTIONS) if (!cleaned.includes(k)) cleaned.push(k);
        return cleaned.length > 0 ? cleaned : DEFAULT_SECTIONS;
      }
    } catch { /* */ }
    return DEFAULT_SECTIONS;
  });
  const [hidden, setHidden] = useState<Set<SectionKey>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { order: string[]; hidden: string[] };
        return new Set((parsed.hidden || []).filter(isKnown));
      }
    } catch { /* */ }
    return new Set();
  });

  const persist = (o: SectionKey[], h: Set<SectionKey>) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ order: o, hidden: Array.from(h) }));
  };

  const moveUp = (key: SectionKey) => {
    setOrder((prev) => {
      const idx = prev.indexOf(key);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      persist(next, hidden);
      return next;
    });
  };

  const moveDown = (key: SectionKey) => {
    setOrder((prev) => {
      const idx = prev.indexOf(key);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      persist(next, hidden);
      return next;
    });
  };

  const toggle = (key: SectionKey) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      persist(order, next);
      return next;
    });
  };

  const reset = () => {
    setOrder(DEFAULT_SECTIONS);
    setHidden(new Set());
    persist(DEFAULT_SECTIONS, new Set());
  };

  return { order, hidden, moveUp, moveDown, toggle, reset };
}

// Icons match the sidebar rail via renderNavIcon(route). Was
// hand-picked Unicode glyphs (✶ ⛁ ✓ ▨ ⊞) — one Mappings tile
// already used a Lucide icon which made the whole row look
// half-migrated. `iconRoute` decouples the icon from the link
// target so /processes/wizard (no sidebar entry) can inherit
// the /processes rail icon instead of falling back to text.
const quickActions = [
  { iconRoute: '/processes',       label: 'Run Wizard',      description: 'Generate a process hierarchy with AI',                          link: '/processes/wizard' },
  { iconRoute: '/data-assets',     label: 'Data Assets',     description: 'Define and manage data assets',                                 link: '/data-assets' },
  { iconRoute: '/data-quality',    label: 'Data Quality',    description: 'Define quality rules and health scores',                        link: '/data-quality' },
  { iconRoute: '/mappings',        label: 'Data Mapping',    description: 'Link data to process activities',                               link: '/mappings' },
  { iconRoute: '/enterprise-view', label: 'Enterprise View', description: 'Full cross-entity visibility',                                   link: '/enterprise-view' },
  { iconRoute: '/analysis',        label: 'Analysis',        description: 'Pivot the catalog (systems × domains, roles × people…)',       link: '/analysis' },
];

function QuickActions() {
  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeading title="Quick Actions" />
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 12,
      }}>
        {quickActions.map((action) => (
          <Link
            key={action.label}
            to={action.link}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: 6,
              padding: '16px 12px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-sm)',
              textDecoration: 'none',
              color: 'var(--color-text)',
              cursor: 'pointer',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-primary)';
              e.currentTarget.style.boxShadow = 'var(--shadow-md, 0 2px 8px rgba(0,0,0,0.1))';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
            }}
          >
            <span style={{ display: 'inline-flex', color: 'var(--color-primary)' }}>{renderNavIcon(action.iconRoute, { size: 24, strokeWidth: 1.8 })}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{action.label}</span>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.3 }}>{action.description}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}


function WhatsNext({ stats }: { stats: DashboardStats }) {
  // Build suggestions based on current state
  const suggestions: Array<{ icon: React.ReactNode; title: string; description: string; link: string }> = [];

  const sIcon = { size: 20, strokeWidth: 1.8 } as const;

  // Phase 1: No processes yet
  if (stats.valueStreams === 0) {
    suggestions.push({
      icon: <ListTree {...sIcon} />,
      title: 'Define your first value stream',
      description: 'Start by mapping out how your organization delivers value. Use the AI wizard to generate a process hierarchy from your industry.',
      link: '/processes/wizard',
    });
  }

  // Phase 2: Processes exist but no data assets
  if (stats.valueStreams > 0 && stats.dataAssets === 0) {
    suggestions.push({
      icon: <Database {...sIcon} />,
      title: 'Register your data assets',
      description: `You have ${stats.valueStreams} value stream${stats.valueStreams > 1 ? 's' : ''} defined. Now describe the data your processes depend on.`,
      link: '/data-assets',
    });
  }

  // Phase 3: Assets exist but no mappings
  if (stats.dataAssets > 0 && stats.mappings === 0) {
    suggestions.push({
      icon: <ArrowLeftRight size={20} strokeWidth={1.8} />,
      title: 'Map data to processes',
      description: `You have ${stats.dataAssets} data asset${stats.dataAssets > 1 ? 's' : ''} but none are linked to process activities. Data Mapping reveals dependencies and gaps.`,
      link: '/mappings',
    });
  }

  // (Low-coverage guidance intentionally lives only in the "Governance
  // Gaps" section — its "Unmapped activities" row is the canonical
  // place for that. A duplicate "Improve coverage" card here said the
  // same thing twice in adjacent sections.)

  // Phase 5: Low health
  if (stats.dataAssets > 0 && stats.averageHealth < 80) {
    suggestions.push({
      icon: <CheckCircle2 {...sIcon} />,
      title: 'Improve data quality',
      description: `Average health is ${stats.averageHealth}%. Add quality rules to your data assets to identify and fix issues.`,
      link: '/data-quality',
    });
  }

  // Phase 6: No people assigned
  if (stats.people === 0 && stats.valueStreams > 0) {
    suggestions.push({
      icon: <Users {...sIcon} />,
      title: 'Add your team',
      description: 'Assign owners and stewards to your processes and data assets so everyone knows who is responsible.',
      link: '/people',
    });
  }

  // Phase 7: catalogue is dominated by uncertified (BRONZE-tier) assets
  if (stats.governance.bronze > 0 && stats.governance.gold === 0) {
    suggestions.push({
      icon: <TrendingUp {...sIcon} />,
      title: 'Elevate governance tiers',
      description: `All ${stats.governance.bronze} data assets are Uncertified. Promote them to Managed or Certified as you define ownership and quality rules.`,
      link: '/data-assets',
    });
  }

  // Limit to 3 suggestions
  const shown = suggestions.slice(0, 3);

  if (shown.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeading title="What's Next" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.map((s) => (
          <Link key={s.link} to={s.link} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            textDecoration: 'none', color: 'var(--color-text)',
            transition: 'border-color 0.15s',
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
          >
            <span style={{ fontSize: 20, flexShrink: 0 }}>{s.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{s.description}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Legacy Dashboard widget; now a thin wrapper around the shared
 *  ActivityFeed so org-wide recent activity, per-entity timelines, and
 *  the "what I did" feed all share rendering, enrichment, and timestamp
 *  behaviour. */
function RecentActivity() {
  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeading title="Recent Activity" right={<Link to="/audit-log" style={{ fontSize: 12, color: 'var(--color-primary)' }}>View full audit log →</Link>} />
      <ActivityFeed inline />
    </div>
  );
}

interface ProgramStatus { currentPhase: number; overallProgress: number; }
interface ProgramRecommendation { action: string; link: string; priority: string; }

function ProgramMaturity() {
  const { activeOrgId } = useOrgContext();
  const [status, setStatus] = useState<ProgramStatus | null>(null);
  const [recommendations, setRecommendations] = useState<ProgramRecommendation[]>([]);

  useEffect(() => {
    if (!activeOrgId) { setStatus(null); setRecommendations([]); return; }
    (async () => {
      try {
        const progRes = await apiClient.get<{ data: { id?: string } | null }>(`/governance-program?orgId=${activeOrgId}`);
        const prog = progRes.data;
        if (!prog?.id) return;
        const [statusRes, recRes] = await Promise.all([
          apiClient.get<{ data: ProgramStatus }>(`/governance-program/${prog.id}/status`),
          apiClient.get<{ data: ProgramRecommendation[] }>(`/governance-program/${prog.id}/recommendations`),
        ]);
        setStatus(statusRes.data);
        setRecommendations(recRes.data || []);
      } catch { /* */ }
    })();
  }, [activeOrgId]);

  if (!status) return null;

  const phaseNames = ['', 'Foundation Definition', 'Structural Design', 'People & Processes', 'Operationalization'];

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeading title="Program Maturity" />
      <Card padding="16px 20px">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <ProgressRing percent={status.overallProgress} size={54} stroke={5} showLabel />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Phase {status.currentPhase}: {phaseNames[status.currentPhase]}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Overall program progress</div>
          </div>
        </div>
        {recommendations.length > 0 && (
          <div>
            <SectionLabel marginBottom={6}>Next steps to advance</SectionLabel>
            {recommendations.slice(0, 3).map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.priority === 'HIGH' ? 'var(--color-error)' : 'var(--color-warning)', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{r.action}</span>
                <Link to={r.link} style={{ color: 'var(--color-primary)', textDecoration: 'none', fontSize: 11, flexShrink: 0 }}>Go</Link>
              </div>
            ))}
          </div>
        )}
        <Link to="/governance-program" style={{ fontSize: 12, color: 'var(--color-primary)', textDecoration: 'none', marginTop: 8, display: 'inline-block' }}>
          View full program →
        </Link>
      </Card>
    </div>
  );
}

function StewardOnboarding() {
  const { activeOrgId } = useOrgContext();
  const [data, setData] = useState<{ total: number; completed: number; overdue: number } | null>(null);

  useEffect(() => {
    if (!activeOrgId) { setData(null); return; }
    (async () => {
      try {
        interface StewardTask { linkedObjectType?: string; status?: string; dueDate?: string }
        const tasksRes = await apiClient.get<{ success: boolean; data: StewardTask[] }>(`/governance-tasks?orgId=${activeOrgId}&taskType=STEWARDSHIP`);
        const tasks = tasksRes.data || [];
        const onboarding = tasks.filter((t) => t.linkedObjectType === 'DamaRole');
        const completed = onboarding.filter((t) => t.status === 'COMPLETED').length;
        const overdue = onboarding.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && t.dueDate && new Date(t.dueDate) < new Date()).length;
        setData({ total: onboarding.length, completed, overdue });
      } catch { /* */ }
    })();
  }, [activeOrgId]);

  if (!data || data.total === 0) return null;

  const rate = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeading title="Steward Onboarding" />
      <Card padding="16px 20px">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{rate}% complete</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{data.completed} of {data.total} tasks</span>
        </div>
        <Meter value={rate} height={8} color={rate === 100 ? 'var(--color-success)' : 'var(--color-primary)'} />
        {data.overdue > 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 6 }}>
            {data.overdue} overdue task{data.overdue !== 1 ? 's' : ''}
          </div>
        )}
        <Link to="/governance-work?tab=tasks" style={{ fontSize: 12, color: 'var(--color-primary)', textDecoration: 'none', marginTop: 6, display: 'inline-block' }}>
          View all stewardship tasks
        </Link>
      </Card>
    </div>
  );
}

function GapsOverview({ stats }: { stats: DashboardStats }) {
  const gaps = stats.gaps;
  if (!gaps) return null;
  const items = [
    { label: 'Unmapped activities', count: gaps.unmappedActivities || gaps.unmappedSteps || 0, severity: 'critical' as const, link: '/mappings' },
    { label: 'Ownerless processes', count: gaps.ownerlessItems || 0, severity: 'critical' as const, link: '/processes' },
    { label: 'Ungoverned assets (Uncertified)', count: gaps.ungovernedAssets || 0, severity: 'warning' as const, link: '/data-assets' },
    { label: 'Unowned domains', count: gaps.ungovernedDomains || 0, severity: 'warning' as const, link: '/data-domains' },
    { label: 'Orphan data assets (no process uses them)', count: gaps.orphanAssets || 0, severity: 'warning' as const, link: '/data-assets/orphans' },
  ];
  const total = items.reduce((s, i) => s + i.count, 0);
  const sevColors = { critical: 'var(--color-error)', warning: 'var(--color-warning)', info: 'var(--color-info)' };

  return (
    <div>
      <SectionHeading title="Governance Gaps" />
      {total === 0 ? (
        <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--color-success)', fontSize: 13, fontWeight: 500 }}>
          No gaps detected — all processes are mapped and ownership is assigned.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.filter((i) => i.count > 0).map((item) => (
            <Link key={item.label} to={item.link} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', textDecoration: 'none', color: 'inherit', transition: 'background 0.1s' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: sevColors[item.severity], minWidth: 28 }}>{item.count}</span>
              <span style={{ fontSize: 13, flex: 1 }}>{item.label}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Fix →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { activeOrgId } = useOrgContext();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Dashboard-scoped lens — defaults to ALL and refetches when the
  // user changes it so KPIs (process-side) reflect the chosen domain.
  // Assets / Systems / People are cross-cutting and stay unfiltered.
  const dashboardLens = useDomainLens('dashboard', 'ALL');

  const fetchData = useCallback(async () => {
    if (!activeOrgId) { setStats(null); return; }
    try {
      const domainQS = dashboardLens === 'ALL' ? '' : `&domain=${dashboardLens}`;
      const res = await apiClient.get<{ success: boolean; data: DashboardStats }>(`/dashboard/stats?orgId=${activeOrgId}${domainQS}`);
      setStats(res.data);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load dashboard'));
    }
  }, [activeOrgId, dashboardLens]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  usePolling(fetchData, 30000);

  const layout = useDashboardLayout();
  const [showCustomize, setShowCustomize] = useState(false);

  if (error) {
    return (
      <div>
        <PageHeader title="Dashboard">
        </PageHeader>
        <div style={{ color: 'var(--color-error)' }}>Error: {error}</div>
      </div>
    );
  }

  // No-org state is handled centrally by Layout's "Organization
  // Required" card — the Dashboard no longer renders its own variant.
  if (!stats) {
    return (
      <div>
        <PageHeader title="Dashboard">
        </PageHeader>
        <SkeletonRows rows={6} columnWidths={[200, null, null, 90]} />
      </div>
    );
  }


  // Brand-new orgs see a guided four-step setup card instead of a wall
  // of zeros. Once anything's been added, the regular dashboard takes
  // over (and the user can find any unfinished step in its bucket).
  const isEmptyOrg = stats.processes === 0
    && stats.dataAssets === 0
    && stats.systems === 0
    && stats.people === 0;

  const sectionMap: Record<SectionKey, React.ReactNode> = {
    myDashboard: <MyDashboard />,
    overview: <StatsOverview stats={stats} />,
    programMaturity: <ProgramMaturity />,
    gaps: <GapsOverview stats={stats} />,
    skillGaps: <SkillGapsWidget />,
    whatsNext: <WhatsNext stats={stats} />,
    stewardOnboarding: <StewardOnboarding />,
    quickActions: <QuickActions />,
    recentActivity: <RecentActivity />,
  };

  return (
    <div>
      <PageHeader
        title="Dashboard"
        actions={!isEmptyOrg ? (
          <button
            onClick={() => setShowCustomize((v) => !v)}
            aria-expanded={showCustomize}
            title="Reorder or hide dashboard sections"
            style={{
              padding: '5px 12px', fontSize: 11, fontWeight: 500,
              background: showCustomize ? 'var(--color-primary)' : 'var(--color-surface)',
              color: showCustomize ? '#fff' : 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {showCustomize ? 'Done' : 'Customize'}
          </button>
        ) : undefined}
      >
      </PageHeader>

      {showCustomize && (
        <Card
          padding={16}
          marginBottom={24}
          // Theme tokens, not hardcoded blues — the panel was rendering
          // a fixed light-blue gradient that clashed on re-branded /
          // dark-themed tenants.
          borderColor="var(--color-primary)"
          style={{ background: 'var(--color-bg)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Customize Dashboard</div>
            <button onClick={layout.reset} style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Reset to Default</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {layout.order.map((key, idx) => (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                background: layout.hidden.has(key) ? 'var(--color-bg)' : 'var(--color-surface)',
                border: '1px solid var(--color-border)', borderRadius: 4,
                opacity: layout.hidden.has(key) ? 0.5 : 1,
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button
                    onClick={() => layout.moveUp(key)}
                    disabled={idx === 0}
                    aria-label={`Move ${SECTION_LABELS[key]} up`}
                    title={`Move ${SECTION_LABELS[key]} up`}
                    style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', fontSize: 11, color: idx === 0 ? 'var(--color-border)' : 'var(--color-text-muted)', width: 24, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}
                  ><ChevronUp size={12} strokeWidth={2.5} /></button>
                  <button
                    onClick={() => layout.moveDown(key)}
                    disabled={idx === layout.order.length - 1}
                    aria-label={`Move ${SECTION_LABELS[key]} down`}
                    title={`Move ${SECTION_LABELS[key]} down`}
                    style={{ background: 'none', border: 'none', cursor: idx === layout.order.length - 1 ? 'default' : 'pointer', fontSize: 11, color: idx === layout.order.length - 1 ? 'var(--color-border)' : 'var(--color-text-muted)', width: 24, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}
                  ><ChevronDown size={12} strokeWidth={2.5} /></button>
                </div>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{SECTION_LABELS[key]}</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!layout.hidden.has(key)}
                    onChange={() => layout.toggle(key)}
                    style={{ cursor: 'pointer' }}
                  />
                  Show
                </label>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 8 }}>
            Reorder sections with arrows. Uncheck to hide. Your layout is saved automatically.
          </div>
        </Card>
      )}

      {isEmptyOrg ? (
        <GettingStartedCard stats={stats} />
      ) : (
        <>
          <SetupCompleteBanner stats={stats} orgId={activeOrgId} />
          {layout.order.filter((key) => !layout.hidden.has(key)).map((key) => (
            <React.Fragment key={key}>
              {sectionMap[key]}
            </React.Fragment>
          ))}
        </>
      )}
    </div>
  );
}

// One-time congratulations once all four setup steps (processes,
// systems, data assets, people) have data. The GettingStartedCard
// disappears the moment the org stops being empty, so without this
// the user never gets an "you're set up" signal — they just silently
// graduate to the full dashboard. Dismissal is keyed by orgId so each
// org celebrates once.
//
// Company-scope caveat: if this org has descendant divisions, don't
// declare setup complete until those divisions also have processes.
// Otherwise a parent-scope user sees "all in place" when the divisions
// where day-to-day work happens are still empty catalogs.
function SetupCompleteBanner({ stats, orgId }: { stats: DashboardStats; orgId: string | null }) {
  const selfComplete = stats.processes > 0 && stats.systems > 0 && stats.dataAssets > 0 && stats.people > 0;
  const descendantsIncomplete =
    stats.hasChildOwnershipOrgs === true && (stats.descendantProcesses ?? 0) === 0;
  const complete = selfComplete && !descendantsIncomplete;
  const flag = orgId ? `procela:setup-celebrated:${orgId}` : '';
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return !flag || localStorage.getItem(flag) === 'true'; } catch { return true; }
  });
  if (!complete || dismissed) return null;
  const dismiss = () => {
    try { if (flag) localStorage.setItem(flag, 'true'); } catch { /* */ }
    setDismissed(true);
  };
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', marginBottom: 20,
        background: '#dcfce7', border: '1px solid #86efac',
        borderRadius: 'var(--radius-md)', fontSize: 13, color: '#166534',
      }}
    >
      <Check size={16} strokeWidth={2.6} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span>
        <strong>Setup complete.</strong> Processes, systems, data assets and people are all in place — use <strong>Customize</strong> above to arrange this dashboard around what you watch most.
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss setup-complete message"
        style={{
          marginLeft: 'auto', background: 'transparent', border: 'none',
          color: '#166534', cursor: 'pointer', lineHeight: 1, padding: 4, display: 'inline-flex',
        }}
      ><X size={16} strokeWidth={2.4} /></button>
    </div>
  );
}
