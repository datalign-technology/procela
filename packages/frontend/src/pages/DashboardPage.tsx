import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
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
  coverage: { mapped: number; unmapped: number; percentage: number };
  governance: { bronze: number; silver: number; gold: number };
  averageHealth: number;
  gaps: {
    unmappedSteps: number;
    unmappedActivities: number;
    ungovernedAssets: number;
    ownerlessItems: number;
    ungovernedDomains: number;
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
  const steps = [
    {
      icon: '⛁',
      title: 'Define your business processes',
      description: 'Map how your organization works — value streams, processes, sub-processes, and steps. Plain business language, no technical knowledge required.',
      done: stats.processes > 0,
      ctaLabel: 'Add processes',
      ctaTo: '/processes',
      doneLabel: `${stats.processes} ${stats.processes === 1 ? 'process' : 'processes'}`,
    },
    {
      icon: '⌸',
      title: 'Register your systems',
      description: 'Tell Procela about the applications and platforms your data lives in — ERP, CRM, data warehouses, file stores.',
      done: stats.systems > 0,
      ctaLabel: 'Add systems',
      ctaTo: '/systems',
      doneLabel: `${stats.systems} ${stats.systems === 1 ? 'system' : 'systems'}`,
    },
    {
      icon: '⬢',
      title: 'Add your data assets',
      description: 'Describe the data you care about in business terms — customer records, transactions, reports — so it can be tied back to processes.',
      done: stats.dataAssets > 0,
      ctaLabel: 'Add data assets',
      ctaTo: '/data-assets',
      doneLabel: `${stats.dataAssets} ${stats.dataAssets === 1 ? 'asset' : 'assets'}`,
    },
    {
      icon: '☺',
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
      <div style={{ height: 4, background: 'var(--color-bg)', borderRadius: 2, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{
          width: `${percent}%`, height: '100%',
          background: 'var(--color-primary)', transition: 'width 0.3s',
        }} />
      </div>
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
              {s.done ? '✓' : i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>{s.icon}</span>
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

function MyDashboard() {
  const { user } = useAuthStore();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.email) { setLoading(false); return; }
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: any }>('/dashboard/my-dashboard');
        setData(res.data);
      } catch { /* */ }
      finally { setLoading(false); }
    })();
  }, [user?.email]);

  if (loading) return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>My Dashboard</h2>
      <div style={{ ...cardStyle, color: 'var(--color-text-muted)', fontSize: 13 }}>Loading...</div>
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
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>My Dashboard</h2>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Welcome back, {data.person.name}. Here’s what needs your attention.
      </p>

      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div style={{ ...cardStyle, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: s.overdueTasks > 0 ? '#dc2626' : 'var(--color-text)' }}>{s.openTasks || 0}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Open Tasks</div>
          {s.overdueTasks > 0 && <div style={{ fontSize: 10, color: '#dc2626', marginTop: 2 }}>{s.overdueTasks} overdue</div>}
        </div>
        <div style={{ ...cardStyle, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: s.criticalIssues > 0 ? '#dc2626' : 'var(--color-text)' }}>{s.openIssues || 0}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Open Issues</div>
          {s.criticalIssues > 0 && <div style={{ fontSize: 10, color: '#dc2626', marginTop: 2 }}>{s.criticalIssues} critical</div>}
        </div>
        <div style={{ ...cardStyle, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{(s.domainsOwned || 0) + (s.domainsSteward || 0)}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>My Domains</div>
        </div>
        <div style={{ ...cardStyle, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{s.upcomingEventsCount || 0}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Upcoming Events</div>
        </div>
      </div>

      {/* Two-column: Attention + Schedule */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Needs Attention */}
        <div style={{ ...cardStyle, borderLeft: '4px solid #f59e0b', padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Needs My Attention
          </div>
          {(data.myTasks || []).filter((t: any) => t.isOverdue).length === 0 &&
           (data.myIssues || []).filter((i: any) => i.severity === 'CRITICAL').length === 0 &&
           (data.pendingReviews || []).length === 0 ? (
            <div style={{ color: '#16a34a', fontSize: 13 }}>All clear — no urgent items.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(data.myTasks || []).filter((t: any) => t.isOverdue).slice(0, 3).map((t: any) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#dc2626' }}>Overdue: {t.title}</span>
                  <Link to="/governance-work?tab=tasks" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>View</Link>
                </div>
              ))}
              {(data.myIssues || []).filter((i: any) => i.severity === 'CRITICAL').slice(0, 3).map((i: any) => (
                <div key={i.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#dc2626' }}>Critical: {i.title}</span>
                  <Link to="/governance-work?tab=issues" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>View</Link>
                </div>
              ))}
              {(data.pendingReviews || []).slice(0, 3).map((r: any) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, color: r.isOverdue ? '#dc2626' : '#92400e' }}>{r.isOverdue ? 'Overdue review' : 'Review due'}: {r.name}</span>
                  <Link to="/governance-policies" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>View</Link>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* My Schedule */}
        <div style={{ ...cardStyle, borderLeft: '4px solid #3b82f6', padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#1e40af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            My Schedule
          </div>
          {(data.upcomingEvents || []).length === 0 ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No upcoming events in the next 14 days.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(data.upcomingEvents || []).slice(0, 5).map((e: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12 }}>{e.name}</span>
                  <span style={{ fontSize: 10, color: e.daysAway === 0 ? '#dc2626' : 'var(--color-text-muted)', fontWeight: e.daysAway === 0 ? 600 : 400 }}>
                    {e.daysAway === 0 ? 'Today' : e.daysAway === 1 ? 'Tomorrow' : `In ${e.daysAway} days`}
                  </span>
                </div>
              ))}
              <Link to="/governance-calendar" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none', marginTop: 4 }}>View calendar</Link>
            </div>
          )}
        </div>
      </div>

      {/* My Domains */}
      {(data.myDomains || []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>My Domains</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {(data.myDomains || []).map((d: any) => {
              const healthPct = d.totalAssets > 0 ? Math.round((d.healthyAssets / d.totalAssets) * 100) : 0;
              return (
                <Link key={d.id} to="/data-domains" style={{ ...cardStyle, padding: '10px 14px', textDecoration: 'none', color: 'var(--color-text)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', color: d.relation === 'owner' ? '#1e40af' : '#065f46', background: d.relation === 'owner' ? '#dbeafe' : '#d1f0eb', padding: '1px 5px', borderRadius: 3 }}>{d.relation}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>{d.assetCount} assets &middot; {healthPct}% healthy</div>
                  <div style={{ height: 4, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${healthPct}%`, background: healthPct >= 80 ? '#22c55e' : healthPct >= 50 ? '#f59e0b' : '#dc2626', borderRadius: 2 }} />
                  </div>
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
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>My Tasks</span>
            <Link to="/governance-work?tab=tasks" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>View all {data.myTasks.length}</Link>
          </div>
          <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
            {(data.myTasks || []).slice(0, 5).map((t: any, i: number) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderTop: i > 0 ? '1px solid var(--color-border)' : 'none', fontSize: 12 }}>
                <span style={priorityBadge(t.priority)}>{t.priority}</span>
                <span style={{ flex: 1 }}>{t.title}</span>
                {t.dueDate && <span style={{ fontSize: 10, color: t.isOverdue ? '#dc2626' : 'var(--color-text-muted)' }}>{t.isOverdue ? 'Overdue' : new Date(t.dueDate).toLocaleDateString()}</span>}
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{t.status.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My Issues (top 5) */}
      {(data.myIssues || []).length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>My Issues</span>
            <Link to="/governance-work?tab=issues" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>View all {data.myIssues.length}</Link>
          </div>
          <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
            {(data.myIssues || []).slice(0, 5).map((issue: any, i: number) => (
              <div key={issue.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderTop: i > 0 ? '1px solid var(--color-border)' : 'none', fontSize: 12 }}>
                <span style={priorityBadge(issue.severity)}>{issue.severity}</span>
                <span style={{ flex: 1 }}>{issue.title}</span>
                {issue.domainName && <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{issue.domainName}</span>}
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{issue.status.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Stats Overview — compact KPI strip ──

function StatsOverview({ stats }: { stats: DashboardStats }) {
  const kpis = [
    { label: 'Value Streams', value: stats.valueStreams, color: '#0f4f46' },
    { label: 'Processes', value: stats.processes, color: '#92400e' },
    { label: 'Data Assets', value: stats.dataAssets, color: '#1e40af' },
    { label: 'Systems', value: stats.systems, color: '#5b21b6' },
    { label: 'Coverage', value: `${stats.coverage.percentage}%`, color: stats.coverage.percentage >= 80 ? '#16a34a' : stats.coverage.percentage >= 50 ? '#ca8a04' : '#dc2626' },
    { label: 'Avg Health', value: `${stats.averageHealth}%`, color: stats.averageHealth >= 80 ? '#16a34a' : stats.averageHealth >= 50 ? '#ca8a04' : '#dc2626' },
  ];
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Overview</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ ...cardStyle, padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{k.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dashboard section ordering (persisted to localStorage) ──

type SectionKey = 'myDashboard' | 'overview' | 'programMaturity' | 'gaps' | 'whatsNext' | 'stewardOnboarding' | 'quickActions' | 'recentActivity';

const DEFAULT_SECTIONS: SectionKey[] = ['myDashboard', 'overview', 'programMaturity', 'gaps', 'whatsNext', 'stewardOnboarding', 'quickActions', 'recentActivity'];

const SECTION_LABELS: Record<SectionKey, string> = {
  myDashboard: 'My Dashboard',
  overview: 'Overview',
  programMaturity: 'Program Maturity',
  gaps: 'Governance Gaps',
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

const quickActions = [
  { icon: '☰', label: 'Run Wizard', description: 'Generate a process hierarchy with AI', link: '/processes/wizard' },
  { icon: '⛁', label: 'Data Assets', description: 'Define and manage data assets', link: '/data-assets' },
  { icon: '✓', label: 'Data Quality', description: 'Define quality rules and health scores', link: '/data-quality' },
  { icon: '↔', label: 'Mappings', description: 'Link processes to data', link: '/mappings' },
  { icon: '▨', label: 'Enterprise View', description: 'Full cross-entity visibility', link: '/enterprise-view' },
];

function QuickActions() {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Quick Actions</h2>
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
            <span style={{ fontSize: 24 }}>{action.icon}</span>
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
  const suggestions: Array<{ icon: string; title: string; description: string; link: string }> = [];

  // Phase 1: No processes yet
  if (stats.valueStreams === 0) {
    suggestions.push({
      icon: '☰',
      title: 'Define your first value stream',
      description: 'Start by mapping out how your organization delivers value. Use the AI wizard to generate a process hierarchy from your industry.',
      link: '/processes/wizard',
    });
  }

  // Phase 2: Processes exist but no data assets
  if (stats.valueStreams > 0 && stats.dataAssets === 0) {
    suggestions.push({
      icon: '⛁',
      title: 'Register your data assets',
      description: `You have ${stats.valueStreams} value stream${stats.valueStreams > 1 ? 's' : ''} defined. Now describe the data your processes depend on.`,
      link: '/data-assets',
    });
  }

  // Phase 3: Assets exist but no mappings
  if (stats.dataAssets > 0 && stats.mappings === 0) {
    suggestions.push({
      icon: '↔',
      title: 'Map data to processes',
      description: `You have ${stats.dataAssets} data asset${stats.dataAssets > 1 ? 's' : ''} but none are linked to process steps. Mappings reveal dependencies and gaps.`,
      link: '/mappings',
    });
  }

  // Phase 4: Low coverage
  if (stats.mappings > 0 && stats.coverage.percentage < 50) {
    suggestions.push({
      icon: '⚠',
      title: 'Improve coverage',
      description: `Only ${stats.coverage.percentage}% of process steps have data mapped. Review gaps to find unmapped steps.`,
      link: '/mappings',
    });
  }

  // Phase 5: Low health
  if (stats.dataAssets > 0 && stats.averageHealth < 80) {
    suggestions.push({
      icon: '✓',
      title: 'Improve data quality',
      description: `Average health is ${stats.averageHealth}%. Add quality rules to your data assets to identify and fix issues.`,
      link: '/data-quality',
    });
  }

  // Phase 6: No people assigned
  if (stats.people === 0 && stats.valueStreams > 0) {
    suggestions.push({
      icon: '☻',
      title: 'Add your team',
      description: 'Assign owners and stewards to your processes and data assets so everyone knows who is responsible.',
      link: '/people',
    });
  }

  // Phase 7: catalogue is dominated by uncertified (BRONZE-tier) assets
  if (stats.governance.bronze > 0 && stats.governance.gold === 0) {
    suggestions.push({
      icon: '▲',
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
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{"What's Next"}</h2>
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

function RecentActivity() {
  const { activeOrgId } = useOrgContext();
  const [entries, setEntries] = useState<Array<{
    id: string; entityType: string; entityId: string; action: string;
    timestamp: string; userId: string | null;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const DEFAULT_ROWS = 5;

  useEffect(() => {
    if (!activeOrgId) { setEntries([]); setLoading(false); return; }
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: any[] }>(`/audit?orgId=${activeOrgId}&limit=30`);
        setEntries(res.data || []);
      } catch { /* */ }
      finally { setLoading(false); }
    })();
  }, [activeOrgId]);

  if (loading || entries.length === 0) return null;

  const actionIcon = (action: string) => {
    if (action === 'CREATE') return '+';
    if (action === 'UPDATE') return '~';
    if (action === 'DELETE') return '×';
    return '•';
  };

  const actionColor = (action: string) => {
    if (action === 'CREATE') return '#16a34a';
    if (action === 'UPDATE') return '#2563eb';
    if (action === 'DELETE') return '#dc2626';
    return '#64748b';
  };

  const timeAgo = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const visible = showAll ? entries : entries.slice(0, DEFAULT_ROWS);
  const hasMore = entries.length > DEFAULT_ROWS;

  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Recent Activity</h2>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {visible.map((e) => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--color-border)', fontSize: 12 }}>
            <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: actionColor(e.action) + '18', color: actionColor(e.action), flexShrink: 0 }}>
              {actionIcon(e.action)}
            </span>
            <span style={{ flex: 1, color: 'var(--color-text)' }}>
              <strong>{e.action.toLowerCase()}</strong> {e.entityType.replace(/([A-Z])/g, ' $1').trim()}
            </span>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 11, flexShrink: 0 }}>{timeAgo(e.timestamp)}</span>
          </div>
        ))}
        {hasMore && (
          <button
            onClick={() => setShowAll((v) => !v)}
            style={{
              width: '100%', padding: '8px', fontSize: 12, fontWeight: 500,
              background: 'var(--color-bg)', color: 'var(--color-primary)',
              border: 'none', cursor: 'pointer',
            }}
          >
            {showAll ? 'Show less' : `Show all ${entries.length} entries`}
          </button>
        )}
      </div>
    </div>
  );
}

function ProgramMaturity() {
  const { activeOrgId } = useOrgContext();
  const [status, setStatus] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);

  useEffect(() => {
    if (!activeOrgId) { setStatus(null); setRecommendations([]); return; }
    (async () => {
      try {
        const progRes = await apiClient.get<any>(`/governance-program?orgId=${activeOrgId}`);
        const prog = progRes.data;
        if (!prog?.id) return;
        const [statusRes, recRes] = await Promise.all([
          apiClient.get<any>(`/governance-program/${prog.id}/status`),
          apiClient.get<any>(`/governance-program/${prog.id}/recommendations`),
        ]);
        setStatus(statusRes.data);
        setRecommendations(recRes.data || []);
      } catch { /* */ }
    })();
  }, [activeOrgId]);

  if (!status) return null;

  const phaseNames = ['', 'Foundation Definition', 'Structural Design', 'People & Processes', 'Operationalization'];
  const phaseColors = ['', '#3b82f6', '#8b5cf6', '#22c55e', '#f97316'];

  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Program Maturity</h2>
      <div style={{ ...cardStyle, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: phaseColors[status.currentPhase],
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 700,
          }}>
            {status.currentPhase}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Phase {status.currentPhase}: {phaseNames[status.currentPhase]}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{status.overallProgress}% overall progress</div>
          </div>
        </div>
        <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ height: '100%', width: `${status.overallProgress}%`, background: phaseColors[status.currentPhase], borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
        {recommendations.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Next steps to advance</div>
            {recommendations.slice(0, 3).map((r: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12 }}>
                <span style={{ color: r.priority === 'HIGH' ? '#dc2626' : '#d97706', fontSize: 8 }}>●</span>
                <span style={{ flex: 1 }}>{r.action}</span>
                <Link to={r.link} style={{ color: 'var(--color-primary)', textDecoration: 'none', fontSize: 11, flexShrink: 0 }}>Go</Link>
              </div>
            ))}
          </div>
        )}
        <Link to="/governance-program" style={{ fontSize: 12, color: 'var(--color-primary)', textDecoration: 'none', marginTop: 8, display: 'inline-block' }}>
          View full program →
        </Link>
      </div>
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
        const tasksRes = await apiClient.get<{ success: boolean; data: any[] }>(`/governance-tasks?orgId=${activeOrgId}&taskType=STEWARDSHIP`);
        const tasks = tasksRes.data || [];
        const onboarding = tasks.filter((t: any) => t.linkedObjectType === 'DamaRole');
        const completed = onboarding.filter((t: any) => t.status === 'COMPLETED').length;
        const overdue = onboarding.filter((t: any) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && t.dueDate && new Date(t.dueDate) < new Date()).length;
        setData({ total: onboarding.length, completed, overdue });
      } catch { /* */ }
    })();
  }, [activeOrgId]);

  if (!data || data.total === 0) return null;

  const rate = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;

  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Steward Onboarding</h2>
      <div style={{ ...cardStyle, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{rate}% complete</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{data.completed} of {data.total} tasks</span>
        </div>
        <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${rate}%`, background: rate === 100 ? '#22c55e' : 'var(--color-primary)', borderRadius: 4, transition: 'width 0.3s' }} />
        </div>
        {data.overdue > 0 && (
          <div style={{ fontSize: 12, color: '#dc2626', marginTop: 6 }}>
            {data.overdue} overdue task{data.overdue !== 1 ? 's' : ''}
          </div>
        )}
        <Link to="/governance-work?tab=tasks" style={{ fontSize: 12, color: 'var(--color-primary)', textDecoration: 'none', marginTop: 6, display: 'inline-block' }}>
          View all stewardship tasks
        </Link>
      </div>
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
  ];
  const total = items.reduce((s, i) => s + i.count, 0);
  const sevColors = { critical: '#dc2626', warning: '#d97706', info: '#2563eb' };

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Governance Gaps</h2>
      {total === 0 ? (
        <div style={{ padding: '16px 0', textAlign: 'center', color: '#16a34a', fontSize: 13, fontWeight: 500 }}>
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

  const fetchData = useCallback(async () => {
    if (!activeOrgId) { setStats(null); return; }
    try {
      const res = await apiClient.get<{ success: boolean; data: DashboardStats }>(`/dashboard/stats?orgId=${activeOrgId}`);
      setStats(res.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard');
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>Dashboard</h1>
          <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
        </div>
        <div style={{ color: 'var(--color-danger, #ef4444)' }}>Error: {error}</div>
      </div>
    );
  }

  if (!stats && !activeOrgId) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Dashboard</h1>
        </div>
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', padding: '3rem 2rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>&#9881;</div>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No organization selected</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
            Create an organization to get started with your data governance program.
          </p>
          <Link to="/organizations" style={{
            display: 'inline-block', padding: '8px 20px', background: 'var(--color-primary)',
            color: '#fff', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500,
            textDecoration: 'none',
          }}>
            Go to Organizations
          </Link>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Dashboard</h1>
        </div>
        <div style={{ color: 'var(--color-text-muted)' }}>Loading...</div>
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
    whatsNext: <WhatsNext stats={stats} />,
    stewardOnboarding: <StewardOnboarding />,
    quickActions: <QuickActions />,
    recentActivity: <RecentActivity />,
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>Dashboard</h1>
          <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
        </div>
        {!isEmptyOrg && (
          <button
            onClick={() => setShowCustomize((v) => !v)}
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
        )}
      </div>

      {showCustomize && (
        <div style={{
          ...cardStyle, marginBottom: 24, padding: 16,
          background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)',
          border: '1px solid #93c5fd',
        }}>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <button
                    onClick={() => layout.moveUp(key)}
                    disabled={idx === 0}
                    style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', fontSize: 10, color: idx === 0 ? 'var(--color-border)' : 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}
                  >{'▲'}</button>
                  <button
                    onClick={() => layout.moveDown(key)}
                    disabled={idx === layout.order.length - 1}
                    style={{ background: 'none', border: 'none', cursor: idx === layout.order.length - 1 ? 'default' : 'pointer', fontSize: 10, color: idx === layout.order.length - 1 ? 'var(--color-border)' : 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}
                  >{'▼'}</button>
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
        </div>
      )}

      {isEmptyOrg ? (
        <GettingStartedCard stats={stats} />
      ) : (
        layout.order.filter((key) => !layout.hidden.has(key)).map((key) => (
          <React.Fragment key={key}>
            {sectionMap[key]}
          </React.Fragment>
        ))
      )}
    </div>
  );
}
