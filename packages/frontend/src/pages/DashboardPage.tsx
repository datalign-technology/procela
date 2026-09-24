import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { X, Check } from 'lucide-react';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';
import { SkeletonRows } from '../components/Skeleton';
import PageHeader from '../components/PageHeader';
import SectionLabel from '../components/SectionLabel';
import Card from '../components/Card';
import { healthColorVar } from '../components/HealthBar';
import SectionHeading from '../components/SectionHeading';
import InfoTip from '../components/InfoTip';
import Meter from '../components/Meter';
import Gauge from '../components/Gauge';
import Donut from '../components/Donut';
import Sparkline from '../components/Sparkline';
import { useTierLabel } from '../lib/governanceTier';
import { useNavigate } from 'react-router-dom';
import { renderNavIcon } from '../components/navIcons';
import { useAuthStore } from '../stores/authStore';
import { useAiEnabled } from '../stores/aiConfigStore';
import { useToastStore } from '../stores/toastStore';
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
interface MyDomain { id: string; name: string; relation: string; assetCount: number; directAssetCount?: number; totalAssets: number; healthyAssets: number; }
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

type Lens = 'all' | 'governed';
// The you-scoped sections share one endpoint; the governed lens (+ the active
// org) rides the query string so the same call narrows "my" portfolio to the
// governance program's scope. Default 'all' + no orgId ⇒ today's URL exactly,
// so an un-lensed section is byte-for-byte unchanged.
interface LensProps { lens?: Lens; orgId?: string | null }
function myDashboardUrl(lens: Lens = 'all', orgId: string | null = null): string {
  const params = new URLSearchParams();
  if (orgId) params.set('orgId', orgId);
  if (lens === 'governed') params.set('lens', 'governed');
  const qs = params.toString();
  return `/dashboard/my-dashboard${qs ? `?${qs}` : ''}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Today queue — the merged, ranked "what needs me" list. Overdue tasks,
// critical issues, overdue policy reviews and at-risk domains are all things
// that need the signed-in user, so they share ONE de-duplicated queue ranked
// by urgency, rather than the old separate Needs-Attention / Tasks / Issues
// panels that listed the same items twice. Each row carries the action that
// resolves it (a deep link to where it's handled); a segmented
// All / Tasks / Issues filter narrows the same list.
// ──────────────────────────────────────────────────────────────────────────
type QueueFilter = 'all' | 'task' | 'issue';
// A row's action is either a navigation (open the thing elsewhere) or an
// in-place mutation (advance a task / issue's status without leaving the
// dashboard). `do` rows PUT `body` to `endpoint`, toast `done`, then refetch.
type QueueAction =
  | { mode: 'nav'; label: string; to: string; solid: boolean }
  | { mode: 'do'; label: string; endpoint: string; body: Record<string, unknown>; done: string; solid: boolean };
interface QueueItem {
  id: string;
  kind: 'issue' | 'task' | 'review' | 'domain';
  score: number;                 // lower = more urgent (sort key)
  dot: string;                   // leading severity dot colour
  pill: { label: string; color: string };
  title: string;
  meta: string;
  due?: { label: string; over: boolean };
  action: QueueAction;
}

// Fold the personal work items into one urgency-ranked queue. Scores are hand
// tuned so the most decision-worthy rows float up: a critical issue first, then
// at-risk domains and overdue work, then open work by priority. Task and issue
// rows carry an in-place action that advances their status one valid step (the
// completed/resolved item then drops off the queue on the next refetch);
// reviews and at-risk domains have no single fix, so those stay navigation.
function buildQueue(data: MyDashboardData): QueueItem[] {
  const tasksTo = '/governance-work?tab=tasks';
  const issuesTo = '/governance-work?tab=issues';
  const items: QueueItem[] = [];

  for (const i of data.myIssues || []) {
    const crit = i.severity === 'CRITICAL';
    const high = i.severity === 'HIGH';
    const ep = `/governance-issues/${i.id}`;
    const action: QueueAction = i.status === 'OPEN'
      ? { mode: 'do', label: 'Start', endpoint: ep, body: { status: 'IN_PROGRESS' }, done: 'Issue moved to In progress.', solid: crit }
      : i.status === 'IN_PROGRESS'
        ? { mode: 'do', label: 'Resolve', endpoint: ep, body: { status: 'RESOLVED' }, done: 'Issue resolved.', solid: crit }
        : { mode: 'nav', label: 'Open', to: issuesTo, solid: crit };
    items.push({
      id: `issue-${i.id}`, kind: 'issue',
      score: crit ? 0 : high ? 2 : 3,
      dot: crit ? '#dc2626' : high ? '#f59e0b' : '#3b82f6',
      pill: { label: i.severity, color: priorityColor(i.severity) },
      title: i.title,
      meta: ['Issue', i.domainName].filter(Boolean).join(' · '),
      action,
    });
  }
  for (const t of data.myTasks || []) {
    const over = !!t.isOverdue;
    const high = t.priority === 'HIGH' || t.priority === 'CRITICAL';
    const med = t.priority === 'MEDIUM';
    const ep = `/governance-tasks/${t.id}`;
    const canComplete = t.status === 'IN_PROGRESS' || t.status === 'PENDING_REVIEW' || t.status === 'PENDING_APPROVAL';
    const action: QueueAction = t.status === 'OPEN'
      ? { mode: 'do', label: 'Start', endpoint: ep, body: { status: 'IN_PROGRESS' }, done: 'Task started.', solid: over }
      : canComplete
        ? { mode: 'do', label: 'Complete', endpoint: ep, body: { status: 'COMPLETED' }, done: 'Task completed.', solid: over }
        : { mode: 'nav', label: 'Open', to: tasksTo, solid: over };
    items.push({
      id: `task-${t.id}`, kind: 'task',
      score: over ? 1.5 : high ? 2.5 : med ? 4 : 5,
      dot: over ? '#dc2626' : high ? '#f59e0b' : med ? '#3b82f6' : '#64748b',
      pill: { label: t.priority, color: priorityColor(t.priority) },
      title: t.title, meta: 'Task',
      due: t.dueDate
        ? { label: over ? 'Overdue' : new Date(t.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), over }
        : undefined,
      action,
    });
  }
  for (const r of (data.pendingReviews || []).filter((rv) => rv.isOverdue)) {
    items.push({
      id: `review-${r.id}`, kind: 'review', score: 1.8, dot: '#dc2626',
      pill: { label: 'REVIEW', color: '#dc2626' },
      title: r.name, meta: 'Policy review · overdue',
      action: { mode: 'nav', label: 'Review', to: '/governance-policies', solid: false },
    });
  }
  for (const d of (data.myDomains || []).filter((dm) => dm.totalAssets > 0 && dm.healthyAssets / dm.totalAssets < 0.8)) {
    const pct = Math.round((d.healthyAssets / d.totalAssets) * 100);
    items.push({
      id: `domain-${d.id}`, kind: 'domain', score: 1, dot: '#dc2626',
      pill: { label: 'AT RISK', color: '#dc2626' },
      title: d.name, meta: `Domain you ${d.relation === 'owner' ? 'own' : 'steward'} · ${pct}% healthy`,
      action: { mode: 'nav', label: 'Open', to: '/data-domains', solid: false },
    });
  }
  return items.sort((a, b) => a.score - b.score);
}

// Shared style for a queue row's trailing action affordance (a link or a
// button), so the nav and mutate variants look identical. A fixed min-width
// + centred content means "Open", "Start", "Complete" etc. all render at the
// same width and their left edges line up down the column, whether the row's
// action is a nav Link or a mutate button.
function actionStyle(solid: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    minWidth: 72, boxSizing: 'border-box',
    fontSize: 11, fontWeight: 600, borderRadius: 7, padding: '4px 10px', flexShrink: 0,
    textDecoration: 'none', whiteSpace: 'nowrap', lineHeight: 1.4,
    border: '1px solid var(--color-primary)',
    background: solid ? 'var(--color-primary)' : 'transparent',
    color: solid ? '#fff' : 'var(--color-primary)',
  };
}

const QUEUE_MAX = 8;

// The dashboard's left pane: the ranked action queue (Concept B / "Today").
function TodayQueue({ lens = 'all', orgId = null }: LensProps) {
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const [data, setData] = useState<MyDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const trend = useMyTrends();

  const load = useCallback(async () => {
    if (!user?.email) { setLoading(false); return; }
    try {
      const res = await apiClient.get<{ success: boolean; data: MyDashboardData }>(myDashboardUrl(lens, orgId));
      setData(res.data);
    } catch { /* */ } finally { setLoading(false); }
  }, [user?.email, lens, orgId]);

  useEffect(() => { load(); }, [load]);

  // Run a row's in-place action (advance a task / issue's status), then
  // refetch so the row updates or drops off. Errors surface as a toast; the
  // row stays put so the user can retry.
  const runAction = async (it: QueueItem) => {
    if (it.action.mode !== 'do' || busyId) return;
    setBusyId(it.id);
    try {
      await apiClient.put(it.action.endpoint, it.action.body);
      addToast('success', it.action.done);
      await load();
    } catch (e) {
      addToast('error', errorMessage(e, 'Could not update this item.'));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return (
    <div style={{ marginBottom: 16 }}>
      <SectionLabel>Today</SectionLabel>
      <Card padding={0}><div style={{ padding: 14 }}><SkeletonRows rows={4} columnWidths={[16, null, 60, 60]} /></div></Card>
    </div>
  );

  if (!data?.person) {
    // Not linked to a person in this org (admins, SSO users not yet imported):
    // show the prompt to link, not an empty queue.
    return (
      <div style={{ marginBottom: 16 }}>
        <SectionLabel>Today</SectionLabel>
        <Card padding="16px 20px">
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            This is your personal view — the tasks, issues and domains that need you show up here once
            your account is linked to a person in this organization.
            <div style={{ marginTop: 8 }}>
              <Link to="/people" style={{ fontSize: 12, color: 'var(--color-primary)' }}>Link your profile in People &rarr;</Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const queue = buildQueue(data);
  const taskCount = queue.filter((i) => i.kind === 'task').length;
  const issueCount = queue.filter((i) => i.kind === 'issue').length;
  const overdue = (data.myTasks || []).filter((t) => t.isOverdue).length;
  const filtered = queue.filter((i) => (filter === 'all' ? true : i.kind === filter));
  const top = filtered.slice(0, QUEUE_MAX);
  const segs: Array<[QueueFilter, string, number]> = [
    ['all', 'All', queue.length], ['task', 'Tasks', taskCount], ['issue', 'Issues', issueCount],
  ];

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SectionLabel marginBottom={0}>Today</SectionLabel>
          <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{queue.length}</span>
          {overdue > 0 && <span style={attentionChip}>{overdue} overdue</span>}
          <TrendMini points={trend} metricKey="openTasks" />
        </div>
        <div role="group" aria-label="Filter the queue" style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 999, overflow: 'hidden' }}>
          {segs.map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              style={{
                padding: '4px 11px', fontSize: 11, fontWeight: filter === key ? 600 : 500,
                border: 'none', cursor: 'pointer',
                background: filter === key ? 'var(--color-primary)' : 'transparent',
                color: filter === key ? '#fff' : 'var(--color-text-secondary)',
              }}
            >{label} {n}</button>
          ))}
        </div>
      </div>
      <Card padding={0} style={{ overflow: 'hidden' }}>
        {top.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--color-success)' }}>
            {queue.length === 0 ? 'All clear — nothing needs you right now.' : `No open ${filter === 'task' ? 'tasks' : 'issues'} in your queue.`}
          </div>
        ) : top.map((it, idx) => (
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: idx > 0 ? '1px solid var(--color-border)' : 'none' }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: it.dot, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.meta}</div>
            </div>
            {/* Fixed-width pill + a reserved, right-aligned date column so the
                pills, the dates, and the action buttons line up in clean
                columns across every row — including rows with no due date. */}
            <span style={{ display: 'inline-block', boxSizing: 'border-box', width: 66, textAlign: 'center', padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: it.pill.color + '18', color: it.pill.color, flexShrink: 0, whiteSpace: 'nowrap' }}>{it.pill.label}</span>
            <span style={{ width: 52, textAlign: 'left', flexShrink: 0, fontSize: 10, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: it.due?.over ? 'var(--color-error)' : 'var(--color-text-muted)', fontWeight: it.due?.over ? 600 : 400 }}>{it.due ? it.due.label : ''}</span>
            {it.action.mode === 'nav' ? (
              <Link to={it.action.to} style={actionStyle(it.action.solid)}>{it.action.label}</Link>
            ) : (
              <button
                type="button"
                disabled={busyId === it.id}
                onClick={() => runAction(it)}
                title={`${it.action.label} — ${it.title}`}
                style={{ ...actionStyle(it.action.solid), cursor: busyId === it.id ? 'default' : 'pointer', opacity: busyId && busyId !== it.id ? 0.5 : 1 }}
              >{busyId === it.id ? '…' : it.action.label}</button>
            )}
          </div>
        ))}
        {filtered.length > top.length && (
          <Link to="/governance-work" style={{ display: 'block', padding: '9px 14px', borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>
            +{filtered.length - top.length} more in Governance Work &rarr;
          </Link>
        )}
      </Card>
    </div>
  );
}

// The right-pane header: the next scheduled governance meeting, pulled from the
// same my-dashboard payload. Renders nothing when there's nothing on the
// calendar in the look-ahead window, so the portfolio rail stays tight.
function NextMeeting({ lens = 'all', orgId = null }: LensProps) {
  const { user } = useAuthStore();
  const [data, setData] = useState<MyDashboardData | null>(null);
  useEffect(() => {
    if (!user?.email) return;
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: MyDashboardData }>(myDashboardUrl(lens, orgId));
        setData(res.data);
      } catch { /* */ }
    })();
  }, [user?.email, lens, orgId]);

  const ev = (data?.upcomingEvents || [])[0];
  if (!ev) return null;
  const when = ev.daysAway <= 0 ? 'Today' : ev.daysAway === 1 ? 'Tomorrow' : `In ${ev.daysAway} days`;
  return (
    <div style={{ marginBottom: 16 }}>
      <Card padding="12px 14px" style={{ display: 'flex', alignItems: 'center', gap: 10, borderLeft: '3px solid var(--color-info)' }}>
        <span style={{ display: 'inline-flex', color: 'var(--color-info)', flexShrink: 0 }}>{renderNavIcon('/governance-calendar', { size: 16 })}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.name}</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Next meeting</div>
        </div>
        <Link to="/governance-calendar" style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-warning)', textDecoration: 'none', whiteSpace: 'nowrap' }}>{when} &rarr;</Link>
      </Card>
    </div>
  );
}

// Priority/severity colour — the four-step CRITICAL/HIGH/MEDIUM/LOW ramp used
// by the Today queue's severity pills. Fixed hex (not semantic vars) so the
// scale stays distinguishable rather than collapsing onto the theme's single
// error/warning colours.
function priorityColor(p: string): string {
  return p === 'CRITICAL' ? '#dc2626' : p === 'HIGH' ? '#f59e0b' : p === 'MEDIUM' ? '#3b82f6' : '#64748b';
}

// ── Shared weekly trend series (my open tasks / issues / overdue), read from
//    /dashboard/my-trends. Its numbers used to live in a standalone "Trends"
//    card row that duplicated the Tasks/Issues list counts; the trend now
//    rides inline in each list's header instead. ──
interface MyTrendPoint { date: string; openTasks: number; openIssues: number; overdue: number; }

function useMyTrends(): MyTrendPoint[] | null {
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
  return points;
}

// A compact sparkline + delta for one metric, shown in a list header. Fewer is
// better for all three metrics, so a downward delta is green.
function TrendMini({ points, metricKey }: { points: MyTrendPoint[] | null; metricKey: 'openTasks' | 'openIssues' | 'overdue' }) {
  if (!points || points.length < 2) return null;
  const series = points.map((p) => p[metricKey]);
  const spanWeeks = points.length - 1;
  const delta = series[series.length - 1] - series[0];
  const deltaColor = delta === 0 ? 'var(--color-text-muted)' : delta < 0 ? 'var(--color-success)' : 'var(--color-error)';
  const arrow = delta === 0 ? '' : delta > 0 ? '▲' : '▼';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={`Last ${spanWeeks} week${spanWeeks === 1 ? '' : 's'}`}>
      <Sparkline points={series} color="var(--color-primary)" />
      {delta !== 0 && (
        <span style={{ fontSize: 10, fontWeight: 600, color: deltaColor, whiteSpace: 'nowrap' }}>
          {arrow}{Math.abs(delta)} <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>vs {spanWeeks}w</span>
        </span>
      )}
    </span>
  );
}

// A small red pill for a count that needs attention (e.g. overdue tasks).
const attentionChip: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999,
  background: 'var(--color-error)', color: '#fff', whiteSpace: 'nowrap',
};


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
function MyPortfolioHealth({ lens = 'all', orgId = null }: LensProps) {
  const { user } = useAuthStore();
  const [data, setData] = useState<MyDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const tierLabel = useTierLabel();

  useEffect(() => {
    if (!user?.email) { setLoading(false); return; }
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: MyDashboardData }>(myDashboardUrl(lens, orgId));
        setData(res.data);
      } catch { /* */ } finally { setLoading(false); }
    })();
  }, [user?.email, lens, orgId]);

  if (loading) return (
    <div style={{ marginBottom: 16 }}>
      <SectionHeading title={<>Portfolio Health <InfoTip term="Portfolio Health" inline /></>} />
      <Card padding={20}><SkeletonRows rows={2} columnWidths={[140, null, 60]} /></Card>
    </div>
  );

  const p = data?.portfolio;
  if (!data?.person || !p || p.domains === 0) {
    return (
      <div style={{ marginBottom: 16 }}>
        <SectionHeading title={<>Portfolio Health <InfoTip term="Portfolio Health" inline /></>} />
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
      <SectionHeading title={<>Portfolio Health <InfoTip term="Portfolio Health" inline /></>} />
      <Card padding="18px 22px">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 20, alignItems: 'center' }}>
          <div>
            <SectionLabel>Asset tiers <InfoTip term="Governance Tier" inline /></SectionLabel>
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
              {/* No assets yet → render the gauge neutral ("—"), not a red 0%.
                  Health is *unmeasured*, not bad; a red zero on a brand-new
                  portfolio reads as failure when nothing's been added. */}
              <Gauge value={p.assets > 0 ? p.avgHealth : null} label="Asset health" />
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
function MyCoverage({ lens = 'all', orgId = null }: LensProps) {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [data, setData] = useState<MyDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.email) { setLoading(false); return; }
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: MyDashboardData }>(myDashboardUrl(lens, orgId));
        setData(res.data);
      } catch { /* */ } finally { setLoading(false); }
    })();
  }, [user?.email, lens, orgId]);

  if (loading) return (
    <div style={{ marginBottom: 16 }}>
      <SectionHeading title={<>Coverage <InfoTip term="Coverage" inline /></>} />
      <Card padding={20}><SkeletonRows rows={3} columnWidths={[120, null, 60]} /></Card>
    </div>
  );

  const p = data?.portfolio;
  if (!data?.person || !p || p.assets === 0) {
    return (
      <div style={{ marginBottom: 16 }}>
        <SectionHeading title={<>Coverage <InfoTip term="Coverage" inline /></>} />
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
      <SectionHeading title={<>Coverage <InfoTip term="Coverage" inline /></>} />
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


// ── My Domains — the data domains I own or steward, each with its asset
//    count and health, as a card grid. Promoted out of the personal
//    "My Dashboard" section into its own customizable section so it can be
//    reordered / hidden / resized from Customize like the analytical widgets.
//    Self-fetches /dashboard/my-dashboard like its siblings. ──
function MyDomains({ lens = 'all', orgId = null }: LensProps) {
  const { user } = useAuthStore();
  const [data, setData] = useState<MyDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.email) { setLoading(false); return; }
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: MyDashboardData }>(myDashboardUrl(lens, orgId));
        setData(res.data);
      } catch { /* */ } finally { setLoading(false); }
    })();
  }, [user?.email, lens, orgId]);

  if (loading) return (
    <div style={{ marginBottom: 16 }}>
      <SectionHeading title="Domains" />
      <Card padding={20}><SkeletonRows rows={2} columnWidths={[160, null, 60]} /></Card>
    </div>
  );

  const domains = data?.myDomains || [];
  if (!data?.person || domains.length === 0) {
    return (
      <div style={{ marginBottom: 16 }}>
        <SectionHeading title="Domains" />
        <Card padding="16px 20px">
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            {!data?.person
              ? 'Link your profile to see the data domains you own or steward.'
              : 'You don’t own or steward any data domains yet.'}
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

  return (
    <div style={{ marginBottom: 16 }}>
      <SectionHeading title="Domains" />
      {/* alignContent stretch (overriding the half-grid's default `start`) +
          full-height cards so the domain card(s) fill the cell and this widget
          lines up flush with its taller row-partner (Trends) instead of
          floating at the top with dead space below. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, alignContent: 'stretch', flex: 1 }}>
        {domains.map((d) => {
          const healthPct = d.totalAssets > 0 ? Math.round((d.healthyAssets / d.totalAssets) * 100) : 0;
          return (
            <Link key={d.id} to="/data-domains" style={{ ...cardStyle, padding: '10px 14px', textDecoration: 'none', color: 'var(--color-text)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>{d.name}</span>
                <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', color: d.relation === 'owner' ? '#1e40af' : '#065f46', background: d.relation === 'owner' ? '#dbeafe' : '#d1f0eb', padding: '1px 5px', borderRadius: 3 }}>{d.relation}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                {d.totalAssets} asset{d.totalAssets === 1 ? '' : 's'}
                {typeof d.directAssetCount === 'number' && d.directAssetCount !== d.totalAssets && (
                  <span title="Includes assets rolled up from sub-domains"> ({d.directAssetCount} direct)</span>
                )}
                {' '}&middot; {healthPct}% healthy
              </div>
              <Meter value={healthPct} height={4} color={healthColorVar(healthPct)} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// EmptyDashboardWelcome — the Dashboard's own empty-org state. Deliberately
// NOT the setup checklist (that lives only on the Get Started guide, /setup);
// a second copy of it here made the Dashboard and Setup pages mirror each
// other. This is a minimal welcome that hands off to the guide, plus the
// personal Today queue so the page still carries real content.
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
      <TodayQueue />
    </div>
  );
}

// The dashboard's governed-lens note. Reuses /governance-program/scope-coverage
// (the same source of truth the Foundation Scope tab reads) so the note's
// "applied" + version match the program exactly, with no extra plumbing.
function DashboardScopeNote({ orgId }: { orgId: string | null }) {
  const [info, setInfo] = useState<{ applied: boolean; version: { number: number; changedAt: string | null } | null } | null>(null);
  useEffect(() => {
    if (!orgId) { setInfo(null); return; }
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: { applied: boolean; version: { number: number; changedAt: string | null } | null } }>(`/governance-program/scope-coverage?orgId=${orgId}`);
        setInfo(res.data);
      } catch { setInfo(null); }
    })();
  }, [orgId]);
  const applied = !!info?.applied;
  return (
    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {applied ? (
        <>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '2px 7px', borderRadius: 999 }}>Governed scope</span>
          <span>Showing only the domains &amp; assets your governance program governs.</span>
          {info?.version && (
            <span
              title={info.version.changedAt ? `Scope last changed ${new Date(info.version.changedAt).toLocaleString()}` : 'Scope has not changed since the program was created'}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >v{info.version.number}{info.version.changedAt ? ` · changed ${new Date(info.version.changedAt).toLocaleDateString()}` : ''}</span>
          )}
          <Link to="/governance/foundation" style={{ color: 'var(--color-primary)' }}>Manage scope →</Link>
        </>
      ) : (
        <>Your governance program has no scope defined yet, so this shows everything you own. <Link to="/governance/foundation" style={{ color: 'var(--color-primary)' }}>Define scope →</Link></>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { activeOrgId } = useOrgContext();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Governed lens: narrows the you-scoped portfolio sections to the entities
  // the governance program governs. 'all' (default) is today's behaviour.
  const [lens, setLens] = useState<Lens>('all');

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

  // Focus mode collapses the portfolio rail so the dashboard is just the
  // action queue (the compact, single-column Concept A view). Per browser.
  const [focus, setFocus] = useState<boolean>(() => {
    try { return localStorage.getItem('procela:dashboard-focus') === '1'; } catch { return false; }
  });
  const toggleFocus = () => setFocus((f) => {
    const next = !f;
    try { localStorage.setItem('procela:dashboard-focus', next ? '1' : '0'); } catch { /* */ }
    return next;
  });
  // Run Wizard now rides in the header actions (the separate quick-action bar
  // was dropped to keep the dashboard on one screen). AI-gated — hidden when
  // AI features are off.
  const aiEnabled = useAiEnabled();

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

  return (
    <div>
      <PageHeader
        title="Dashboard"
        actions={!isEmptyOrg ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {/* Run Wizard — the one "do" action from the old quick-action bar,
                kept here as a primary pill (AI-gated). The bar's other entries
                were navigation duplicated by the sidebar, so they were dropped. */}
            {aiEnabled && (
              <Link
                to="/processes/wizard"
                title="Generate a process hierarchy with AI"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '5px 12px', background: 'var(--color-primary)',
                  border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)',
                  fontSize: 12, fontWeight: 600, color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap',
                }}
              >
                <span style={{ display: 'inline-flex', color: '#fff' }}>{renderNavIcon('/processes', { size: 15, strokeWidth: 1.8 })}</span>
                Run Wizard
              </Link>
            )}
            {/* Governed lens — narrows the you-scoped portfolio sections to the
                entities the governance program governs. 'All' is the default. */}
            <div role="group" aria-label="Portfolio lens" style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 999, overflow: 'hidden' }}>
              {([['all', 'All'], ['governed', 'Governed']] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setLens(mode)}
                  aria-pressed={lens === mode}
                  title={mode === 'governed'
                    ? 'Only the domains and assets your governance program governs'
                    : 'Everything you own or steward, governed or not'}
                  style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: lens === mode ? 600 : 500,
                    border: 'none', cursor: 'pointer',
                    background: lens === mode ? 'var(--color-primary)' : 'transparent',
                    color: lens === mode ? '#fff' : 'var(--color-text-secondary)',
                  }}
                >{label}</button>
              ))}
            </div>
            {/* Focus mode — collapse the portfolio rail to just the action
                queue (the compact single-column view). */}
            <button
              onClick={toggleFocus}
              aria-pressed={focus}
              title={focus ? 'Show the portfolio panel' : 'Focus mode — hide the portfolio panel and show just your action queue'}
              style={{
                padding: '5px 12px', fontSize: 11, fontWeight: 500,
                background: focus ? 'var(--color-primary)' : 'var(--color-surface)',
                color: focus ? '#fff' : 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {focus ? 'Show portfolio' : 'Focus'}
            </button>
          </div>
        ) : undefined}
      >
      </PageHeader>

      {/* Governed-lens note — only when the lens is on. Explains what narrowed
          (with the scope version) or why it didn't (no scope defined yet). */}
      {!isEmptyOrg && lens === 'governed' && <DashboardScopeNote orgId={activeOrgId} />}

      {isEmptyOrg ? (
        <EmptyDashboardWelcome />
      ) : (
        <>
          <SetupCompleteBanner stats={stats} orgId={activeOrgId} />
          {/* Concept B — Focus + Portfolio. Left: the ranked action queue
              (everything that needs you). Right: the portfolio glance (next
              meeting, portfolio health, coverage, the domains you own). Focus
              mode drops the right rail so the queue is the whole page; the
              two-column split only applies on a wide viewport and when the
              rail is shown (see .dashboard-two-pane in global.css). */}
          <div className={`dashboard-two-pane${focus ? '' : ' two-col'}`}>
            <div className="dtp-main"><TodayQueue lens={lens} orgId={activeOrgId} /></div>
            {!focus && (
              <div className="dtp-side">
                <NextMeeting lens={lens} orgId={activeOrgId} />
                <MyPortfolioHealth lens={lens} orgId={activeOrgId} />
                <MyCoverage lens={lens} orgId={activeOrgId} />
                <MyDomains lens={lens} orgId={activeOrgId} />
              </div>
            )}
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
        padding: '8px 14px', marginBottom: 12,
        background: '#dcfce7', border: '1px solid #86efac',
        borderRadius: 'var(--radius-md)', fontSize: 13, color: '#166534',
      }}
    >
      <Check size={16} strokeWidth={2.6} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span>
        <strong>Setup complete.</strong> Processes, systems, data assets and people are all in place — your dashboard now leads with everything that needs you.
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
