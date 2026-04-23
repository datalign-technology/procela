import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useAuthStore } from '../stores/authStore';
import GovernanceSetupWizard from '../components/GovernanceSetupWizard';
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








interface ChecklistStep {
  number: number;
  title: string;
  description: string;
  link: string;
  complete: boolean;
}

// ──────────────────────────────────────────────────────────────────────────
// My Items — personalized dashboard section showing what the logged-in
// user owns, stewards, and may need to act on.
// ──────────────────────────────────────────────────────────────────────────

interface MyItemsData {
  person: { id: string; name: string; email: string; role: string; title: string } | null;
  ownedProcesses: Array<{ id: string; name: string; level: string; status: string }>;
  myAssets: Array<{ id: string; name: string; relation: string }>;
  myRoles: Array<{ id: string; roleType: string; scopeType: string; scopeName: string }>;
  myGroups: Array<{ id: string; name: string; type: string; groupRole: string }>;
  myDomains: Array<{ id: string; name: string; relation: string }>;
  actionItems: Array<{ type: string; message: string; link: string }>;
}

const DAMA_SHORT: Record<string, string> = {
  CDO: 'CDO', DATA_GOVERNANCE_LEAD: 'Gov Lead', DATA_OWNER: 'Owner',
  BUSINESS_DATA_STEWARD: 'Biz Steward', DATA_QUALITY_ANALYST: 'DQ Analyst',
  TECHNICAL_DATA_STEWARD: 'Tech Steward', DATA_CUSTODIAN: 'Custodian',
  DATA_ARCHITECT: 'Architect', DATA_ENGINEER: 'Engineer', DATABASE_ADMINISTRATOR: 'DBA',
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '3px 10px', borderRadius: 4,
  fontSize: 12, fontWeight: 500,
  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
  color: 'var(--color-text)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280,
};

function MyItems() {
  const { user } = useAuthStore();
  const [data, setData] = useState<MyItemsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.email) { setLoading(false); return; }
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: MyItemsData }>('/dashboard/my-items');
        setData(res.data);
      } catch { /* */ }
      finally { setLoading(false); }
    })();
  }, [user?.email]);

  if (loading) return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{'My Items'}</h2>
      <div style={{ ...cardStyle, color: 'var(--color-text-muted)', fontSize: 13 }}>{'Loading\u2026'}</div>
    </div>
  );

  if (!data?.person) return null;  // user has no people record — skip silently

  const hasAnything = (data.ownedProcesses.length + data.myAssets.length + data.myRoles.length + data.myGroups.length + data.myDomains.length) > 0;

  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        {'My Items'}
      </h2>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        {'What you own, steward, and belong to \u2014 based on your login '}({data.person.email}).
      </p>

      {/* Action items */}
      {data.actionItems.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 12, borderLeft: '4px solid #f59e0b', padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {'Needs attention'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.actionItems.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{a.message}</span>
                <Link to={a.link} style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 500, flexShrink: 0, textDecoration: 'none' }}>
                  View
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasAnything && (
        <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, padding: 24 }}>
          {'No processes, assets, roles, or groups are assigned to you yet.'}
        </div>
      )}

      {hasAnything && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {/* Owned processes */}
          {data.ownedProcesses.length > 0 && (
            <div style={cardStyle}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                {'My Processes'} ({data.ownedProcesses.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.ownedProcesses.slice(0, 6).map((p) => (
                  <Link key={p.id} to="/processes" style={{ ...chipStyle, textDecoration: 'none' }}>
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{p.level}</span>
                    {p.name}
                    <span style={{ fontSize: 10, color: p.status === 'ACTIVE' ? '#0f4f46' : '#64748b', marginLeft: 'auto' }}>{p.status}</span>
                  </Link>
                ))}
                {data.ownedProcesses.length > 6 && (
                  <Link to="/processes" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>
                    {`+${data.ownedProcesses.length - 6} more`}
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Data assets */}
          {data.myAssets.length > 0 && (
            <div style={cardStyle}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                {'My Data Assets'} ({data.myAssets.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.myAssets.slice(0, 6).map((a) => (
                  <Link key={a.id} to="/data-assets" style={{ ...chipStyle, textDecoration: 'none' }}>
                    {a.name}
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 'auto', textTransform: 'uppercase' }}>{a.relation}</span>
                  </Link>
                ))}
                {data.myAssets.length > 6 && (
                  <Link to="/data-assets" style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>
                    {`+${data.myAssets.length - 6} more`}
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Governance roles */}
          {data.myRoles.length > 0 && (
            <div style={cardStyle}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                {'My Governance Roles'} ({data.myRoles.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.myRoles.map((r) => (
                  <Link key={r.id} to="/governance?tab=roles" style={{ ...chipStyle, textDecoration: 'none' }}>
                    <strong>{DAMA_SHORT[r.roleType] || r.roleType}</strong>
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{r.scopeName}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Governance groups */}
          {data.myGroups.length > 0 && (
            <div style={cardStyle}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                {'My Groups'} ({data.myGroups.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.myGroups.map((g) => (
                  <Link key={g.id} to="/governance?tab=groups" style={{ ...chipStyle, textDecoration: 'none' }}>
                    {g.name}
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>{g.groupRole}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Domain responsibilities */}
          {data.myDomains.length > 0 && (
            <div style={cardStyle}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                {'My Domains'} ({data.myDomains.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.myDomains.map((d) => (
                  <Link key={d.id} to="/governance?tab=domains" style={{ ...chipStyle, textDecoration: 'none' }}>
                    {d.name}
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 'auto', textTransform: 'uppercase' }}>{d.relation}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GettingStartedChecklist({ stats }: { stats: DashboardStats }) {
  const steps: ChecklistStep[] = [
    {
      number: 1,
      title: 'Set up your organization',
      description: 'Create your company structure to organize processes and data by business unit.',
      link: '/organizations',
      complete: stats.organizations > 1,
    },
    {
      number: 2,
      title: 'Add people to your org',
      description: 'Add team members so you can assign ownership of processes and data assets.',
      link: '/organizations',
      complete: stats.people > 0,
    },
    {
      number: 3,
      title: 'Define your processes',
      description: 'Build your process catalog with value streams, processes, and activities.',
      link: '/processes',
      complete: stats.valueStreams > 0,
    },
    {
      number: 4,
      title: 'Register your systems',
      description: 'Add the applications and platforms where your organization\'s data lives.',
      link: '/systems',
      complete: stats.systems > 0,
    },
    {
      number: 5,
      title: 'Define data assets',
      description: 'Describe the data your organization relies on in business terms.',
      link: '/data-assets',
      complete: stats.dataAssets > 0,
    },
    {
      number: 6,
      title: 'Map data to processes',
      description: 'Link data assets to process steps to track dependencies and discover gaps.',
      link: '/mappings',
      complete: stats.mappings > 0,
    },
  ];

  const completedCount = steps.filter((s) => s.complete).length;

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: 28,
      marginBottom: 24,
      boxShadow: 'var(--shadow-sm)',
    }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: 'var(--color-primary)' }}>
        Getting Started with Procela
      </h2>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
        Follow these steps to set up your process-data landscape. {completedCount} of {steps.length} complete.
      </p>
      <div style={{
        height: 6,
        background: 'var(--color-border)',
        borderRadius: 3,
        marginBottom: 24,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${(completedCount / steps.length) * 100}%`,
          background: 'var(--color-primary)',
          borderRadius: 3,
          transition: 'width 0.3s',
        }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {steps.map((step) => (
          <div
            key={step.number}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '14px 16px',
              background: step.complete ? '#d1f0eb' : 'var(--color-bg)',
              border: `1px solid ${step.complete ? '#0f4f4633' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)',
              transition: 'background 0.15s',
            }}
          >
            <div style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 700,
              flexShrink: 0,
              background: step.complete ? 'var(--color-primary)' : 'var(--color-border)',
              color: step.complete ? '#fff' : 'var(--color-text-muted)',
            }}>
              {step.complete ? '\u2713' : step.number}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 14,
                fontWeight: 600,
                color: step.complete ? 'var(--color-primary)' : 'var(--color-text)',
                textDecoration: step.complete ? 'line-through' : 'none',
              }}>
                {step.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {step.description}
              </div>
            </div>
            <Link
              to={step.link}
              style={{
                padding: '6px 14px',
                background: step.complete ? 'transparent' : 'var(--color-primary)',
                color: step.complete ? 'var(--color-primary)' : '#fff',
                border: step.complete ? '1px solid var(--color-primary)' : 'none',
                borderRadius: 'var(--radius-md)',
                fontSize: 12,
                fontWeight: 500,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              {step.complete ? 'View' : 'Get Started'}
            </Link>
          </div>
        ))}
      </div>
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

type SectionKey = 'myItems' | 'overview' | 'wizard' | 'alerts' | 'whatsNext' | 'checklist' | 'quickActions' | 'recentActivity';

const DEFAULT_SECTIONS: SectionKey[] = ['myItems', 'overview', 'wizard', 'alerts', 'whatsNext', 'checklist', 'quickActions', 'recentActivity'];

const SECTION_LABELS: Record<SectionKey, string> = {
  myItems: 'My Items',
  overview: 'Overview',
  wizard: 'Governance Setup',
  alerts: 'Alerts',
  whatsNext: "What's Next",
  checklist: 'Getting Started',
  quickActions: 'Quick Actions',
  recentActivity: 'Recent Activity',
};

function useDashboardLayout() {
  const STORAGE_KEY = 'procela_dashboard_layout';
  const [order, setOrder] = useState<SectionKey[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { order: SectionKey[]; hidden: SectionKey[] };
        return parsed.order.length > 0 ? parsed.order : DEFAULT_SECTIONS;
      }
    } catch { /* */ }
    return DEFAULT_SECTIONS;
  });
  const [hidden, setHidden] = useState<Set<SectionKey>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { order: SectionKey[]; hidden: SectionKey[] };
        return new Set(parsed.hidden || []);
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
  { icon: '⚠', label: 'View Gaps', description: 'See unmapped steps and ungoverned assets', link: '/gap-detection' },
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


interface AlertItem {
  level: 'red' | 'amber' | 'info' | 'green';
  icon: string;
  message: string;
  count: number;
  link: string;
}

const ALERT_BORDER_COLORS: Record<string, string> = {
  red: '#ef4444',
  amber: '#eab308',
  info: '#3b82f6',
  green: '#22c55e',
};

const ALERT_BG_COLORS: Record<string, string> = {
  red: '#fef2f2',
  amber: '#fefce8',
  info: '#eff6ff',
  green: '#f0fdf4',
};

const ALERT_TEXT_COLORS: Record<string, string> = {
  red: '#991b1b',
  amber: '#854d0e',
  info: '#1e40af',
  green: '#166534',
};

function DashboardAlerts({ stats }: { stats: DashboardStats }) {
  const alerts: AlertItem[] = [];

  const unmappedActivities = stats.gaps.unmappedActivities ?? stats.gaps.unmappedSteps ?? 0;
  if (unmappedActivities > 0) {
    alerts.push({
      level: 'red',
      icon: '\u26A0',
      message: `${unmappedActivities} process ${unmappedActivities === 1 ? 'activity has' : 'activities have'} no data assets linked`,
      count: unmappedActivities,
      link: '/gap-detection',
    });
  }

  if (stats.gaps.ungovernedAssets > 0) {
    alerts.push({
      level: 'amber',
      icon: '\u25B3',
      message: `${stats.gaps.ungovernedAssets} Bronze-tier data ${stats.gaps.ungovernedAssets === 1 ? 'asset' : 'assets'} linked to processes`,
      count: stats.gaps.ungovernedAssets,
      link: '/data-assets',
    });
  }

  if (stats.gaps.ownerlessItems > 0) {
    alerts.push({
      level: 'amber',
      icon: '\u2639',
      message: `${stats.gaps.ownerlessItems} value ${stats.gaps.ownerlessItems === 1 ? 'stream/process has' : 'streams/processes have'} no owner`,
      count: stats.gaps.ownerlessItems,
      link: '/processes',
    });
  }

  const ungovernedDomains = stats.gaps.ungovernedDomains ?? 0;
  if (ungovernedDomains > 0) {
    alerts.push({
      level: 'info',
      icon: '\u25C8',
      message: `${ungovernedDomains} data ${ungovernedDomains === 1 ? 'domain has' : 'domains have'} no owner assigned`,
      count: ungovernedDomains,
      link: '/data-domains',
    });
  }

  if (alerts.length === 0) {
    return null; // No alerts = don't show the section at all
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Alerts</h2>
      {alerts.map((alert, idx) => (
        <div
          key={idx}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            background: ALERT_BG_COLORS[alert.level],
            borderLeft: `4px solid ${ALERT_BORDER_COLORS[alert.level]}`,
            borderRadius: 'var(--radius-md)',
          }}
        >
          <span style={{ fontSize: 18, flexShrink: 0 }}>{alert.icon}</span>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: ALERT_TEXT_COLORS[alert.level] }}>
            {alert.message}
          </span>
          <Link
            to={alert.link}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: 500,
              color: ALERT_TEXT_COLORS[alert.level],
              border: `1px solid ${ALERT_BORDER_COLORS[alert.level]}`,
              borderRadius: 'var(--radius-md)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            View
          </Link>
        </div>
      ))}
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
      link: '/gap-detection',
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

  // Phase 7: Bronze-heavy governance
  if (stats.governance.bronze > 0 && stats.governance.gold === 0) {
    suggestions.push({
      icon: '▲',
      title: 'Elevate governance tiers',
      description: `All ${stats.governance.bronze} data assets are at Bronze tier. Promote assets to Silver or Gold as you define ownership and quality rules.`,
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

  useEffect(() => {
    (async () => {
      try {
        const query = activeOrgId ? `?orgId=${activeOrgId}&limit=15` : '?limit=15';
        const res = await apiClient.get<{ success: boolean; data: any[] }>(`/audit${query}`);
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

  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Recent Activity</h2>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {entries.map((e) => (
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
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { activeOrgId } = useOrgContext();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: DashboardStats }>(`/dashboard/stats${query}`);
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

  if (!stats) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>Dashboard</h1>
          <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
        </div>
        <div style={{ color: 'var(--color-text-muted)' }}>Loading...</div>
      </div>
    );
  }

  const allZero =
    stats.valueStreams === 0 &&
    stats.processes === 0 &&
    stats.systems === 0 &&
    stats.dataAssets === 0 &&
    stats.mappings === 0 &&
    stats.organizations <= 1 &&
    stats.people === 0;

  const sectionMap: Record<SectionKey, React.ReactNode> = {
    myItems: <MyItems />,
    overview: <StatsOverview stats={stats} />,
    wizard: <GovernanceSetupWizard />,
    alerts: <DashboardAlerts stats={stats} />,
    whatsNext: <WhatsNext stats={stats} />,
    checklist: allZero ? <GettingStartedChecklist stats={stats} /> : <GettingStartedChecklist stats={stats} />,
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

      {layout.order.filter((key) => !layout.hidden.has(key)).map((key) => (
        <React.Fragment key={key}>
          {sectionMap[key]}
        </React.Fragment>
      ))}
    </div>
  );
}
