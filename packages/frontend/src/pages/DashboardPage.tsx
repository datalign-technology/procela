import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { X, Check, ChevronUp, ChevronDown } from 'lucide-react';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';
import { SkeletonRows } from '../components/Skeleton';
import PageHeader from '../components/PageHeader';
import SectionLabel from '../components/SectionLabel';
import Card from '../components/Card';
import { healthColorVar } from '../components/HealthBar';
import SectionHeading from '../components/SectionHeading';
import StatTile from '../components/StatTile';
import Meter from '../components/Meter';
import Gauge from '../components/Gauge';
import Donut from '../components/Donut';
import Sparkline from '../components/Sparkline';
import { useTierLabel } from '../lib/governanceTier';
import { useNavigate } from 'react-router-dom';
import { renderNavIcon } from '../components/navIcons';
import { useAuthStore } from '../stores/authStore';
import { useAiEnabled } from '../stores/aiConfigStore';
import { usePolling } from '../hooks/usePolling';

interface DashboardStats {
  /** Total process-hierarchy nodes across every level (value stream →
   *  activity). The authoritative catalog-size count — individual
   *  per-level fields below are a subset and some levels (sub-process)
   *  are only exposed via byLevel, so prefer this for a node total. */
  totalNodes?: number;
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
// My Items — personalized dashboard section showing what the logged-in
// user owns, stewards, and may need to act on.
// ──────────────────────────────────────────────────────────────────────────

interface MyTask { id: string; title: string; isOverdue?: boolean; priority: string; dueDate?: string; status: string; }
interface MyIssue { id: string; title: string; severity: string; status: string; domainName?: string; }
interface MyReview { id: string; name: string; isOverdue?: boolean; nextReviewDate?: string | null; }
interface MyEvent { name: string; daysAway: number; }
// Unified time-ordered entry for My Schedule — a calendar event, a task due
// date, or a policy review due date, all reduced to "what & when".
interface ScheduleItem { id: string; kind: 'event' | 'task' | 'review'; name: string; daysAway: number; to: string; }
interface MyDomain { id: string; name: string; relation: string; assetCount: number; totalAssets: number; healthyAssets: number; }
// Aggregate over the assets in the domains I own or steward — powers the
// personal "My Portfolio Health" widget (the tier mix + health of what I'm
// accountable for), a you-scoped stand-in for the org-wide Governance Posture.
interface MyPortfolio {
  domains: number; domainsOwned: number; domainsSteward: number;
  assets: number; healthyAssets: number; avgHealth: number; atRiskDomains: number;
  mappedAssets: number; ownedAssets: number;
  tiers: { gold: number; silver: number; bronze: number };
}
interface MyDashboardData {
  person?: { name: string };
  portfolio?: MyPortfolio;
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

// Small uppercase card header with a leading semantic icon — used by the
// Attention (amber alert) and Schedule (blue calendar) panels so the pair is
// told apart by glyph, not by a 4px border colour alone. The icon inherits
// `color` via currentColor.
function CardHeaderRow({ color, icon, label }: { color: string; icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      <span style={{ display: 'inline-flex', color, flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
    </div>
  );
}

// Warning-triangle glyph for the "Needs My Attention" header (stroke follows
// the wrapper's currentColor so it renders in the warning amber).
function AttentionGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// Whole-days from today to a YYYY-MM-DD date string (negative = past).
// Used to place task/review due dates on the same daysAway axis as the
// server-computed calendar-event offsets.
function daysUntilDate(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return Infinity;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

// Bucket any daysAway-bearing items into a calendar-style grouping so My
// Schedule reads as "when", not a flat list. Empty buckets are dropped.
function bucketByDaysAway<T extends { daysAway: number }>(items: T[]): Array<{ label: string; items: T[] }> {
  return [
    { label: 'Today', items: items.filter((e) => e.daysAway <= 0) },
    { label: 'This week', items: items.filter((e) => e.daysAway >= 1 && e.daysAway <= 6) },
    { label: 'Later', items: items.filter((e) => e.daysAway >= 7) },
  ].filter((g) => g.items.length > 0);
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
    <div style={{ marginBottom: 16 }}>
      <SectionHeading title="My Dashboard" />
      <Card padding={20}><SkeletonRows rows={4} columnWidths={[180, null, 90]} /></Card>
    </div>
  );

  if (!data?.person) {
    // Empty state instead of hiding — e.g. when the signed-in account isn't
    // linked to a person record in this org (admins, SSO users not yet
    // imported). The section still shows so an enabled widget doesn't vanish.
    return (
      <div style={{ marginBottom: 16 }}>
        <SectionHeading title="My Dashboard" />
        <Card padding="16px 20px">
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            This is your personal view — the tasks, issues, and domains assigned to you will show up
            here once your account is linked to a person in this organization.
            <div style={{ marginTop: 8 }}>
              <Link to="/people" style={{ fontSize: 12, color: 'var(--color-primary)' }}>Link your profile in People &rarr;</Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const s = data.summary || {};

  // Needs-My-Attention queue (the "now" side): things that are late or at
  // risk right now — overdue tasks, critical issues, overdue policy reviews,
  // and domains I own/steward that have slipped below the 80%-healthy bar.
  // Reviews that are merely *upcoming* (not yet overdue) belong to Schedule,
  // not here, so the two panels never show the same review twice.
  // urgentShown mirrors the per-source slice caps below so the "+N more"
  // footer only appears when the queue genuinely runs past what's rendered.
  const overdueTasks = (data.myTasks || []).filter((t) => t.isOverdue);
  const criticalIssues = (data.myIssues || []).filter((i) => i.severity === 'CRITICAL');
  const overdueReviews = (data.pendingReviews || []).filter((r) => r.isOverdue);
  const atRiskDomains = (data.myDomains || []).filter((d) => d.totalAssets > 0 && d.healthyAssets / d.totalAssets < 0.8);
  const urgentTotal = overdueTasks.length + criticalIssues.length + overdueReviews.length + atRiskDomains.length;
  const urgentShown = Math.min(overdueTasks.length, 3) + Math.min(criticalIssues.length, 3)
    + Math.min(overdueReviews.length, 3) + Math.min(atRiskDomains.length, 3);

  // My Schedule (the "next" side): every future-dated thing within 14 days,
  // on one axis — calendar events (server-dated), plus task and review due
  // dates that aren't overdue (those are Attention's). Sorted soonest-first.
  const scheduleItems: ScheduleItem[] = [
    ...(data.upcomingEvents || []).map((e, i): ScheduleItem => ({ id: `event-${i}`, kind: 'event', name: e.name, daysAway: e.daysAway, to: '/governance-calendar' })),
    ...(data.myTasks || [])
      .filter((t) => t.dueDate && !t.isOverdue)
      .map((t): ScheduleItem => ({ id: t.id, kind: 'task', name: t.title, daysAway: daysUntilDate(t.dueDate!), to: '/governance-work?tab=tasks' }))
      .filter((t) => t.daysAway >= 0 && t.daysAway <= 14),
    ...(data.pendingReviews || [])
      .filter((r) => r.nextReviewDate && !r.isOverdue)
      .map((r): ScheduleItem => ({ id: r.id, kind: 'review', name: r.name, daysAway: daysUntilDate(r.nextReviewDate!), to: '/governance-policies' }))
      .filter((r) => r.daysAway >= 0 && r.daysAway <= 14),
  ].sort((a, b) => a.daysAway - b.daysAway);

  const priorityColor = (p: string) => p === 'CRITICAL' ? '#dc2626' : p === 'HIGH' ? '#f59e0b' : p === 'MEDIUM' ? '#3b82f6' : '#64748b';
  const priorityBadge = (p: string): React.CSSProperties => ({
    display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600,
    background: priorityColor(p) + '18', color: priorityColor(p),
  });

  return (
    <div style={{ marginBottom: 16 }}>
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

      {/* Two-column: Attention (the act-now triage queue — given primacy)
          + Schedule (the look-ahead). Asymmetric 3:2 so the pair reads as
          "urgent now vs. what's next" rather than two equal twins. */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 12, marginBottom: 16 }}>
        {/* Needs Attention — the act-now triage queue. A leading alert
            glyph (not just the amber rule) so it's told apart from Schedule
            at a glance. Sources: overdue tasks, critical issues, overdue
            reviews, at-risk domains; each capped, with a "+N more" footer
            when the queue runs longer. */}
        <Card padding="14px 16px" style={{ borderLeft: '4px solid var(--color-warning)' }}>
          <CardHeaderRow color="var(--color-warning)" icon={<AttentionGlyph />} label="Needs My Attention" />
          {urgentTotal === 0 ? (
            <div style={{ color: 'var(--color-success)', fontSize: 13 }}>All clear — no urgent items.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {overdueTasks.slice(0, 3).map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-error)' }}>Overdue: {t.title}</span>
                  <Link to="/governance-work?tab=tasks" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>View</Link>
                </div>
              ))}
              {criticalIssues.slice(0, 3).map((i) => (
                <div key={i.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-error)' }}>Critical: {i.title}</span>
                  <Link to="/governance-work?tab=issues" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>View</Link>
                </div>
              ))}
              {overdueReviews.slice(0, 3).map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-error)' }}>Overdue review: {r.name}</span>
                  <Link to="/governance-policies" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>View</Link>
                </div>
              ))}
              {atRiskDomains.slice(0, 3).map((d) => {
                const pct = d.totalAssets > 0 ? Math.round((d.healthyAssets / d.totalAssets) * 100) : 0;
                return (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--color-warning)' }}>Low health: {d.name} ({pct}% healthy)</span>
                    <Link to="/data-domains" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>View</Link>
                  </div>
                );
              })}
              {urgentTotal > urgentShown && (
                <Link to="/governance-work?tab=tasks" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none', marginTop: 2 }}>
                  +{urgentTotal - urgentShown} more &rarr;
                </Link>
              )}
            </div>
          )}
        </Card>

        {/* My Schedule — the look-ahead. Calendar events, upcoming task due
            dates and upcoming review dates on one time axis, grouped into
            buckets (Today / This week / Later) so it reads as a calendar
            preview rather than a flat list, and never mirrors the Attention
            queue beside it. A muted kind tag distinguishes a task/review due
            date from a meeting. */}
        <Card padding="14px 16px" style={{ borderLeft: '4px solid var(--color-info)' }}>
          <CardHeaderRow color="var(--color-info)" icon={renderNavIcon('/governance-calendar', { size: 13 })} label="My Schedule" />
          {scheduleItems.length === 0 ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Nothing scheduled in the next 14 days.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {bucketByDaysAway(scheduleItems).map((g) => (
                <div key={g.label}>
                  <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 3 }}>{g.label}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {g.items.slice(0, 5).map((item) => (
                      <Link key={item.id} to={item.to} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textDecoration: 'none', color: 'var(--color-text)' }}>
                        <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.kind !== 'event' && (
                            <span style={{ color: 'var(--color-text-muted)' }}>{item.kind === 'task' ? 'Task' : 'Review'}: </span>
                          )}
                          {item.name}
                        </span>
                        <span style={{ fontSize: 10, color: item.daysAway <= 0 ? 'var(--color-error)' : 'var(--color-text-muted)', fontWeight: item.daysAway <= 0 ? 600 : 400, flexShrink: 0 }}>
                          {item.daysAway <= 0 ? 'Today' : item.daysAway === 1 ? 'Tomorrow' : `In ${item.daysAway} days`}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
              <Link to="/governance-calendar" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none', marginTop: 2 }}>View calendar</Link>
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



// Tier donut fills — a bronze / silver / gold medal ramp. Validated for
// CVD + normal-vision separation (the grey "silver" is intentional and always
// carries a labelled legend). Fixed hex like the tier badge palette so the
// medal metaphor stays stable across themes.
const TIER_CHART_COLOR: Record<'GOLD' | 'SILVER' | 'BRONZE', string> = {
  GOLD: '#b8860b', SILVER: '#64748b', BRONZE: '#b45309',
};

// A gauge wrapped as a drill-down link, with a subtle hover highlight so it
// reads as actionable.
function GaugeLink({ to, children, title }: { to: string; title: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      title={title}
      style={{ textDecoration: 'none', borderRadius: 'var(--radius-md)', padding: '4px 8px', transition: 'background 0.15s' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
    >
      {children}
    </Link>
  );
}

// ── My Portfolio Health — the tier mix + health of the assets in the domains
//    I own or steward. A you-scoped replacement for the org-wide Governance
//    Posture: one gauge (not two) keeps it compact enough to sit in a single
//    horizontal row. Self-fetches /dashboard/my-dashboard like MyDashboard. ──
function MyPortfolioHealth() {
  const { user } = useAuthStore();
  const [data, setData] = useState<MyDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const tierLabel = useTierLabel();

  useEffect(() => {
    if (!user?.email) { setLoading(false); return; }
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: MyDashboardData }>('/dashboard/my-dashboard');
        setData(res.data);
      } catch { /* */ } finally { setLoading(false); }
    })();
  }, [user?.email]);

  if (loading) return (
    <div style={{ marginBottom: 16 }}>
      <SectionHeading title="My Portfolio Health" />
      <Card padding={20}><SkeletonRows rows={2} columnWidths={[140, null, 60]} /></Card>
    </div>
  );

  const p = data?.portfolio;
  if (!data?.person || !p || p.domains === 0) {
    return (
      <div style={{ marginBottom: 16 }}>
        <SectionHeading title="My Portfolio Health" />
        <Card padding="16px 20px">
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            {!data?.person
              ? 'Link your profile to see the tier mix and health of the domains and assets you own.'
              : 'You don’t own or steward any domains yet — the tier mix and health of your assets will show up here once you do.'}
            <div style={{ marginTop: 8 }}>
              <Link to={!data?.person ? '/people' : '/data-domains'} style={{ fontSize: 12, color: 'var(--color-primary)' }}>
                {!data?.person ? 'Link your profile in People →' : 'View data domains →'}
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const tierTotal = p.tiers.gold + p.tiers.silver + p.tiers.bronze;
  const tiers = [
    { key: 'GOLD', label: tierLabel('GOLD'), value: p.tiers.gold, color: TIER_CHART_COLOR.GOLD },
    { key: 'SILVER', label: tierLabel('SILVER'), value: p.tiers.silver, color: TIER_CHART_COLOR.SILVER },
    { key: 'BRONZE', label: tierLabel('BRONZE'), value: p.tiers.bronze, color: TIER_CHART_COLOR.BRONZE },
  ];
  return (
    <div style={{ marginBottom: 16 }}>
      <SectionHeading title="My Portfolio Health" />
      <Card padding="18px 22px">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 20, alignItems: 'center' }}>
          <div>
            <SectionLabel>My asset tiers</SectionLabel>
            {tierTotal > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Link to="/data-domains" title="View my data domains" style={{ display: 'inline-flex', flexShrink: 0 }}>
                  <Donut segments={tiers} centerLabel="Assets" size={96} thickness={14} legend={false} />
                </Link>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  {tiers.map((t) => (
                    <Link
                      key={t.key}
                      to={`/data-assets?tier=${t.key}`}
                      title={`View ${t.label} data assets`}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, textDecoration: 'none', color: 'inherit', padding: '1px 4px', borderRadius: 4, transition: 'background 0.15s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                    >
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: t.color, flexShrink: 0 }} />
                      <span style={{ color: 'var(--color-text-secondary)', flex: 1, whiteSpace: 'nowrap' }}>{t.label}</span>
                      <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{t.value}</span>
                      <span style={{ color: 'var(--color-text-muted)', minWidth: 34, textAlign: 'right' }}>{Math.round((t.value / tierTotal) * 100)}%</span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No governed assets in your domains yet.</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: 12, flexWrap: 'wrap' }}>
            <GaugeLink to="/data-assets?sort=healthScore&dir=asc" title="Health of the assets in your domains — opens Data Assets, lowest health first">
              <Gauge value={p.avgHealth} label="Asset health" />
            </GaugeLink>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6, minWidth: 0 }}>
              <div><strong style={{ color: 'var(--color-text)' }}>{p.domains}</strong> domain{p.domains === 1 ? '' : 's'} <span style={{ color: 'var(--color-text-muted)' }}>({p.domainsOwned} owned · {p.domainsSteward} steward)</span></div>
              <div><strong style={{ color: 'var(--color-text)' }}>{p.assets}</strong> asset{p.assets === 1 ? '' : 's'} <span style={{ color: 'var(--color-text-muted)' }}>· {p.healthyAssets} healthy</span></div>
              {p.atRiskDomains > 0 && (
                <div style={{ color: 'var(--color-warning)', fontWeight: 600 }}>{p.atRiskDomains} domain{p.atRiskDomains === 1 ? '' : 's'} at risk</div>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Catalog Coverage — how complete the catalog is, not how big it is ──
//
// Raw level counts (value streams / processes / …) duplicated the Overview
// KPI strip and only ever climbed, so they carried little signal. This view
// keeps the catalog framing but answers "how governed is what we've built?":
// each dimension is covered-of-total, with a per-row proportional bar (its
// own denominator) so a short bar always means real work remaining — unlike
// a magnitude chart where the longest bar is just the biggest number. Rows
// whose total is zero (nothing to cover yet) are dropped rather than shown
// at a misleading 0%.
// ── My Coverage — how governed the assets *I* own or steward are: data
//    mapping, governance tier, and ownership, each covered-of-total for my
//    portfolio (a you-scoped replacement for the org Catalog Coverage).
//    Self-fetches /dashboard/my-dashboard for the `portfolio` aggregate. ──
function MyCoverage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [data, setData] = useState<MyDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.email) { setLoading(false); return; }
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: MyDashboardData }>('/dashboard/my-dashboard');
        setData(res.data);
      } catch { /* */ } finally { setLoading(false); }
    })();
  }, [user?.email]);

  if (loading) return (
    <div style={{ marginBottom: 16 }}>
      <SectionHeading title="My Coverage" />
      <Card padding={20}><SkeletonRows rows={3} columnWidths={[120, null, 60]} /></Card>
    </div>
  );

  const p = data?.portfolio;
  if (!data?.person || !p || p.assets === 0) {
    return (
      <div style={{ marginBottom: 16 }}>
        <SectionHeading title="My Coverage" />
        <Card padding="16px 20px">
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            {!data?.person
              ? 'Link your profile to track mapping, governance and ownership coverage of the assets you own.'
              : 'No assets in your domains yet — their mapping, governance and ownership coverage will show up here.'}
          </div>
        </Card>
      </div>
    );
  }

  const governed = p.tiers.silver + p.tiers.gold;
  const rows = [
    { label: 'Data mapping', covered: p.mappedAssets, total: p.assets, hint: 'My assets linked to a process activity', to: '/mappings' },
    { label: 'Asset governance', covered: governed, total: p.assets, hint: 'My assets at Managed or Certified tier', to: '/data-assets' },
    { label: 'Ownership', covered: p.ownedAssets, total: p.assets, hint: 'My assets with an accountable owner', to: '/data-assets' },
  ];

  return (
    <div style={{ marginBottom: 16 }}>
      <SectionHeading title="My Coverage" />
      <Card padding="16px 20px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((r) => {
            const pct = r.total > 0 ? Math.round((r.covered / r.total) * 100) : 0;
            return (
              <button
                key={r.label}
                type="button"
                onClick={() => navigate(r.to)}
                title={r.hint}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{r.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {r.covered} / {r.total}
                    <span style={{ color: healthColorVar(pct), fontWeight: 600, marginLeft: 8 }}>{pct}%</span>
                  </span>
                </div>
                <Meter value={pct} height={5} color={healthColorVar(pct)} />
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ── My Trends — a real weekly series of MY open governance tasks, open
//    issues, and overdue tasks, reconstructed server-side from record
//    timestamps (see /dashboard/my-trends). A you-scoped replacement for the
//    org Trends strip; no "Sample" badge because the history is real, not
//    synthesized. Full-width, so the three cards sit compact in one row. ──
interface MyTrendPoint { date: string; openTasks: number; openIssues: number; overdue: number; }
function MyTrends() {
  const { user } = useAuthStore();
  const [points, setPoints] = useState<MyTrendPoint[] | null>(null);
  useEffect(() => {
    if (!user?.email) { setPoints([]); return; }
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: { points: MyTrendPoint[] } }>('/dashboard/my-trends');
        setPoints(res.data?.points || []);
      } catch { setPoints([]); }
    })();
  }, [user?.email]);

  if (!points) return null;           // loading — stay quiet to avoid a flash
  if (points.length < 1) return null; // no history to draw

  const metrics = [
    { key: 'openTasks' as const, label: 'My Open Tasks', to: '/governance-work?tab=tasks', goodUp: false },
    { key: 'openIssues' as const, label: 'My Open Issues', to: '/governance-work?tab=issues', goodUp: false },
    { key: 'overdue' as const, label: 'My Overdue', to: '/governance-work?tab=tasks', goodUp: false },
  ];
  const spanWeeks = points.length - 1; // weekly boundaries → intervals

  return (
    <div style={{ marginBottom: 16 }}>
      <SectionHeading title="My Trends" right={
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>last {points.length} weeks</span>
      } />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {metrics.map((m) => {
          const series = points.map((pt) => pt[m.key]);
          const first = series[0];
          const last = series[series.length - 1];
          const delta = last - first;
          const improved = m.goodUp ? delta >= 0 : delta <= 0;
          const deltaColor = delta === 0 ? 'var(--color-text-muted)' : improved ? 'var(--color-success)' : 'var(--color-error)';
          const arrow = delta === 0 ? '' : delta > 0 ? '▲' : '▼';
          return (
            <Link key={m.key} to={m.to} style={{ ...cardStyle, padding: '12px 14px', textDecoration: 'none', color: 'var(--color-text)', display: 'block' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.label}</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                <div style={{ lineHeight: 1.1 }}>
                  <span style={{ fontSize: 22, fontWeight: 700 }}>{last}</span>
                  <div style={{ fontSize: 11, fontWeight: 600, color: deltaColor, marginTop: 2 }}>
                    {arrow} {Math.abs(delta)} <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>vs {spanWeeks}w ago</span>
                  </div>
                </div>
                <Sparkline points={series} color="var(--color-primary)" title={`${m.label}, last ${points.length} weeks`} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── Dashboard section ordering (persisted to localStorage) ──

type SectionKey = 'myDashboard' | 'myPortfolio' | 'myTrends' | 'myCoverage';

// Default order follows an inverted-pyramid reading of importance, top → bottom:
//   1. myDashboard    — personal, act-now (your overdue tasks / critical issues)
//   2. myTrends       — my open tasks/issues/overdue over time, full-width strip
//   3. myPortfolio    — the tier mix + health of the domains/assets I own ┐ pair
//   4. myCoverage     — mapping/governance/ownership of my assets          ┘
// Quick actions are NOT a section — they render as a compact menu bar pinned
// under the page header (see DashboardActionBar), not in this flow. The two
// narrow analytical widgets (myPortfolio, myCoverage) stay contiguous so they
// pair two-up cleanly; My Trends is full-width so its cards sit compact in a
// single row. The dashboard is fully you-scoped: the org-wide Governance
// Posture / Trends / Catalog Coverage / Program Maturity / Governance Gaps
// widgets are all replaced or dropped in favour of My Portfolio Health /
// My Trends / My Coverage.
const DEFAULT_SECTIONS: SectionKey[] = ['myDashboard', 'myTrends', 'myPortfolio', 'myCoverage'];

type SectionWidth = 'full' | 'half';

// Default width per section. `full` takes its own row; consecutive `half`
// sections pack two-up so the page stays tight (less vertical scrolling).
// The user can override any of these in Customize — this is only the starting
// layout. The personal two-column body (My Dashboard) and the My Trends strip
// go full-bleed; the analytical widgets pair up as compact equal-height cards.
const DEFAULT_WIDTHS: Record<SectionKey, SectionWidth> = {
  myDashboard: 'full',
  myTrends: 'full',
  myPortfolio: 'half',
  myCoverage: 'half',
};

const SECTION_LABELS: Record<SectionKey, string> = {
  myDashboard: 'My Dashboard',
  myPortfolio: 'My Portfolio Health',
  myTrends: 'My Trends',
  myCoverage: 'My Coverage',
};

interface StoredLayout { order: string[]; hidden: string[]; width?: Record<string, SectionWidth> }

function useDashboardLayout() {
  // Scope the saved layout to the signed-in user, so two people sharing a
  // browser (or the same device across accounts) don't clobber each other's
  // dashboard. `read` falls back to the legacy shared key so anyone who
  // customized before this change keeps their layout until they next adjust
  // it — the first write lands under the per-user key.
  const userId = useAuthStore((s) => s.user?.id) ?? 'anon';
  const STORAGE_KEY = `procela_dashboard_layout:${userId}`;
  const LEGACY_KEY = 'procela_dashboard_layout';
  const KNOWN_KEYS = new Set<SectionKey>(DEFAULT_SECTIONS);
  const isKnown = (k: string): k is SectionKey => KNOWN_KEYS.has(k as SectionKey);
  const read = (): StoredLayout | null => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
      return raw ? JSON.parse(raw) as StoredLayout : null;
    } catch { return null; }
  };

  // Captured once at mount: does this user already have a saved layout? Used
  // by the density default so a user who has customized the dashboard keeps
  // the Detailed view while a first-time visitor starts in Simple.
  const [hasSaved] = useState<boolean>(() => read() !== null);

  const [order, setOrder] = useState<SectionKey[]>(() => {
    const parsed = read();
    if (parsed) {
      const cleaned = (parsed.order || []).filter(isKnown);
      // Insert any DEFAULT keys missing from the stored layout (sections added
      // in a later release) at their default-relative position — NOT appended
      // to the end. Appending stranded a new lead section like My Dashboard at
      // the BOTTOM for every existing user, because their saved order predates
      // it. For each missing key we splice it in just before the first
      // later-in-default section that's already present, so it surfaces where
      // the default layout intends while still preserving the user's own
      // ordering of the sections they have customized.
      for (let di = 0; di < DEFAULT_SECTIONS.length; di++) {
        const key = DEFAULT_SECTIONS[di];
        if (cleaned.includes(key)) continue;
        let insertAt = cleaned.length;
        for (let dj = di + 1; dj < DEFAULT_SECTIONS.length; dj++) {
          const laterIdx = cleaned.indexOf(DEFAULT_SECTIONS[dj]);
          if (laterIdx !== -1) { insertAt = laterIdx; break; }
        }
        cleaned.splice(insertAt, 0, key);
      }
      return cleaned.length > 0 ? cleaned : DEFAULT_SECTIONS;
    }
    return DEFAULT_SECTIONS;
  });
  const [hidden, setHidden] = useState<Set<SectionKey>>(() => {
    const parsed = read();
    return parsed ? new Set((parsed.hidden || []).filter(isKnown)) : new Set();
  });
  const [width, setWidthState] = useState<Record<SectionKey, SectionWidth>>(() => {
    const parsed = read();
    // Start from the defaults, then apply any stored per-section overrides, so
    // a section added in a later release inherits its default width.
    const w = { ...DEFAULT_WIDTHS };
    if (parsed?.width) for (const [k, v] of Object.entries(parsed.width)) {
      if (isKnown(k) && (v === 'full' || v === 'half')) w[k] = v;
    }
    return w;
  });

  const persist = (o: SectionKey[], h: Set<SectionKey>, w: Record<SectionKey, SectionWidth>) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ order: o, hidden: Array.from(h), width: w }));
  };

  const moveUp = (key: SectionKey) => {
    setOrder((prev) => {
      const idx = prev.indexOf(key);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      persist(next, hidden, width);
      return next;
    });
  };

  const moveDown = (key: SectionKey) => {
    setOrder((prev) => {
      const idx = prev.indexOf(key);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      persist(next, hidden, width);
      return next;
    });
  };

  const toggle = (key: SectionKey) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      persist(order, next, width);
      return next;
    });
  };

  const setWidth = (key: SectionKey, w: SectionWidth) => {
    setWidthState((prev) => {
      const next = { ...prev, [key]: w };
      persist(order, hidden, next);
      return next;
    });
  };

  const reset = () => {
    setOrder(DEFAULT_SECTIONS);
    setHidden(new Set());
    setWidthState({ ...DEFAULT_WIDTHS });
    persist(DEFAULT_SECTIONS, new Set(), { ...DEFAULT_WIDTHS });
  };

  return { order, hidden, width, hasSaved, moveUp, moveDown, toggle, setWidth, reset };
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

// Compact action menu pinned under the page header — a horizontal row of
// icon+label chips (the description rides the tooltip). Replaces the old
// full-width "Quick Actions" grid of six large cards, which ate a whole
// section of vertical space for what is really navigation chrome. Renders
// once at the top in both Simple and Detailed views; not a customizable
// section, so it's always available as the dashboard's "menu".
function DashboardActionBar() {
  const aiEnabled = useAiEnabled();
  // Drop the AI-only "Run Wizard" action when AI features are turned off.
  const actions = aiEnabled ? quickActions : quickActions.filter((a) => a.link !== '/processes/wizard');
  return (
    <div
      role="navigation"
      aria-label="Dashboard quick actions"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}
    >
      {actions.map((action) => (
        <Link
          key={action.label}
          to={action.link}
          title={action.description}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 999,
            boxShadow: 'var(--shadow-sm)',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--color-text)',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.color = 'var(--color-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text)'; }}
        >
          <span style={{ display: 'inline-flex', color: 'var(--color-primary)' }}>{renderNavIcon(action.iconRoute, { size: 15, strokeWidth: 1.8 })}</span>
          {action.label}
        </Link>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// EmptyDashboardWelcome — the Dashboard's own empty-org state. Deliberately
// NOT the setup checklist (that lives only on the Get Started guide, /setup);
// a second copy of it here made the Dashboard and Setup pages mirror each
// other. This is a minimal welcome that hands off to the guide, plus the
// personal "My Dashboard" section so the page still carries real content.
// ──────────────────────────────────────────────────────────────────────────
function EmptyDashboardWelcome() {
  return (
    <div>
      <Card padding={24} marginBottom={24}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Welcome to Procela</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '6px 0 16px', lineHeight: 1.5, maxWidth: 560 }}>
          Your organization is ready, but there’s nothing to report on yet. The dashboard fills in as you add processes, systems, data assets, and owners — the Get Started guide walks you through it step by step.
        </p>
        <Link
          to="/setup"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', fontSize: 13, fontWeight: 600,
            background: 'var(--color-primary)', color: '#fff',
            borderRadius: 'var(--radius-md)', textDecoration: 'none',
          }}
        >
          Finish setup in Get Started &rarr;
        </Link>
      </Card>
      <MyDashboard />
    </div>
  );
}

export default function DashboardPage() {
  const { activeOrgId } = useOrgContext();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!activeOrgId) { setStats(null); return; }
    try {
      const res = await apiClient.get<{ success: boolean; data: DashboardStats }>(`/dashboard/stats?orgId=${activeOrgId}`);
      setStats(res.data);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load dashboard'));
    }
  }, [activeOrgId]);

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


  // Brand-new orgs see a minimal welcome that hands off to the Get Started
  // guide (/setup) — deliberately NOT the setup checklist, which lives only on
  // that guide. A second copy of the checklist here made the two pages mirror
  // each other. Once anything's been added, the regular dashboard takes over.
  const isEmptyOrg = stats.processes === 0
    && stats.dataAssets === 0
    && stats.systems === 0
    && stats.people === 0;

  const sectionMap: Record<SectionKey, React.ReactNode> = {
    myDashboard: <MyDashboard />,
    myPortfolio: <MyPortfolioHealth />,
    myTrends: <MyTrends />,
    myCoverage: <MyCoverage />,
  };

  return (
    <div>
      <PageHeader
        title="Dashboard"
        actions={!isEmptyOrg ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {/* Customize lets the user reorder / hide / resize the dashboard
                sections. There's a single dashboard view now (the former
                Simple/Detailed toggle is gone), so it's always available. */}
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
          </div>
        ) : undefined}
      >
      </PageHeader>

      {/* Quick-action menu bar — pinned under the header as the dashboard's
          "menu". Hidden on an empty org, which shows the welcome/setup screen
          instead. */}
      {!isEmptyOrg && <DashboardActionBar />}

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
                {/* Width — Half packs two-up (tighter, less scrolling); Full
                    takes its own row. Disabled while the section is hidden. */}
                <div role="group" aria-label={`${SECTION_LABELS[key]} width`} style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 999, overflow: 'hidden', opacity: layout.hidden.has(key) ? 0.5 : 1 }}>
                  {(['half', 'full'] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => layout.setWidth(key, w)}
                      disabled={layout.hidden.has(key)}
                      aria-pressed={layout.width[key] === w}
                      title={w === 'half' ? 'Half width (pairs two-up)' : 'Full width (own row)'}
                      style={{
                        padding: '2px 9px', fontSize: 10, fontWeight: layout.width[key] === w ? 600 : 400,
                        border: 'none', cursor: layout.hidden.has(key) ? 'default' : 'pointer',
                        textTransform: 'capitalize',
                        background: layout.width[key] === w ? 'var(--color-primary)' : 'transparent',
                        color: layout.width[key] === w ? '#fff' : 'var(--color-text-secondary)',
                      }}
                    >
                      {w}
                    </button>
                  ))}
                </div>
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
            Reorder with the arrows, set each section Half (pairs two-up) or Full width, and uncheck to hide. Your layout is saved automatically.
          </div>
        </Card>
      )}

      {isEmptyOrg ? (
        <EmptyDashboardWelcome />
      ) : (
        <>
          <SetupCompleteBanner stats={stats} orgId={activeOrgId} />
          {/* Layout packs by each section's user-controlled width: a `full`
              section takes its own row; runs of consecutive `half` sections
              chunk two-up so the page stays tight. Deterministic pairing —
              instead of a masonry column flow — keeps a card from stranding
              itself, and re-chunking on hide/width-change means a hidden or
              widened section never leaves an empty half-row (a lone leftover
              half spans the full width). Pairs drop to one column below ~620px.
              Vertical rhythm comes from each widget's own marginBottom. */}
          <div>
            {(() => {
              const visible = layout.order.filter((key) => !layout.hidden.has(key));
              // Split the visible sections into rows: each `full` section is its
              // own full-width row; a run of consecutive `half` widgets renders
              // as ONE two-column grid (not fixed pairs) so grid auto-flow can
              // backfill — a widget that renders nothing collapses and the
              // following halves move up to fill, keeping every half at half
              // width with no stranded empty column.
              const rows: Array<{ band?: SectionKey; run?: SectionKey[] }> = [];
              let run: SectionKey[] = [];
              const flushRun = () => {
                if (run.length > 0) { rows.push({ run: run.slice() }); run = []; }
              };
              for (const key of visible) {
                if (layout.width[key] === 'full') { flushRun(); rows.push({ band: key }); }
                else run.push(key);
              }
              flushRun();

              return rows.map((row, ri) => {
                if (row.band) return <div key={`band-${row.band}`} className="dashboard-section-cell">{sectionMap[row.band]}</div>;
                const keys = row.run!;
                // .dashboard-half-grid is a responsive 2-column grid; each cell
                // collapses (display:none) when its widget renders nothing, so
                // auto-flow reflows the remaining halves to fill both columns.
                return (
                  <div key={`run-${ri}-${keys.join('-')}`} className="dashboard-half-grid">
                    {keys.map((k) => <div key={k} className="dashboard-section-cell">{sectionMap[k]}</div>)}
                  </div>
                );
              });
            })()}
          </div>
        </>
      )}
    </div>
  );
}

// One-time congratulations once all four setup steps (processes,
// systems, data assets, people) have data. An empty org sees the minimal
// EmptyDashboardWelcome instead of the full dashboard; the moment it stops
// being empty it lands on the full dashboard, so without this the user never
// gets an "you're set up" signal — they just silently graduate. Dismissal is
// keyed by orgId so each org celebrates once.
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
