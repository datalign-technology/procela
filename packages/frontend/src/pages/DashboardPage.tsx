import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
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

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--color-text-secondary)',
  marginBottom: 4,
};

const valueStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  marginBottom: 4,
};

const descStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--color-text-muted)',
};

function healthColor(score: number): string {
  if (score >= 80) return 'var(--color-success, #22c55e)';
  if (score >= 50) return 'var(--color-warning, #eab308)';
  return 'var(--color-danger, #ef4444)';
}

interface AuditLogEntry {
  id: string;
  orgId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  timestamp: string;
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const ACTION_COLORS: Record<string, string> = {
  CREATE: '#22c55e',
  UPDATE: '#3b82f6',
  DELETE: '#ef4444',
};

function entityDisplayName(entry: AuditLogEntry): string {
  if (entry.after && typeof entry.after === 'object' && (entry.after as any).name) {
    return (entry.after as any).name;
  }
  if (entry.before && typeof entry.before === 'object' && (entry.before as any).name) {
    return (entry.before as any).name;
  }
  return entry.entityId.slice(0, 8);
}

interface ChecklistStep {
  number: number;
  title: string;
  description: string;
  link: string;
  complete: boolean;
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

function RecentActivity({ activeOrgId }: { activeOrgId: string | null }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: AuditLogEntry[] }>('/audit?limit=10');
        setEntries(res.data || []);
      } catch { /* */ }
      finally { setLoading(false); }
    })();
  }, [activeOrgId]);

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: 20,
      boxShadow: 'var(--shadow-sm)',
      marginTop: 24,
    }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>Recent Activity</h2>
      {loading ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13, padding: '12px 0' }}>Loading...</div>
      ) : entries.length === 0 ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13, padding: '12px 0', textAlign: 'center' }}>
          No recent activity
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {entries.map((entry) => {
            const actionColor = ACTION_COLORS[entry.action] || 'var(--color-text-muted)';
            return (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 0',
                  borderBottom: '1px solid var(--color-border)',
                  fontSize: 13,
                }}
              >
                <span style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#fff',
                  background: actionColor,
                  minWidth: 52,
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  flexShrink: 0,
                }}>
                  {entry.action}
                </span>
                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500, flexShrink: 0 }}>
                  {entry.entityType}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                  {entityDisplayName(entry)}
                </span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 11, flexShrink: 0 }}>
                  {relativeTime(entry.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface TrendDay {
  date: string;
  creates: number;
  updates: number;
  deletes: number;
  total: number;
}

function ActivityTrends() {
  const [days, setDays] = useState<TrendDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: TrendDay[] }>('/trends/activity');
        // Take last 7 days (data is sorted most recent first)
        setDays((res.data || []).slice(0, 7));
      } catch { /* */ }
      finally { setLoading(false); }
    })();
  }, []);

  const maxTotal = Math.max(1, ...days.map((d) => d.total));

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: 20,
      boxShadow: 'var(--shadow-sm)',
      marginTop: 24,
    }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>Activity Trends (Last 7 Days)</h2>
      {loading ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13, padding: '12px 0' }}>Loading...</div>
      ) : days.length === 0 || days.every((d) => d.total === 0) ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13, padding: '12px 0', textAlign: 'center' }}>
          No activity in the last 7 days
        </div>
      ) : (
        <div>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '100px 1fr 60px 60px 60px 60px',
            gap: 8,
            padding: '8px 0',
            borderBottom: '2px solid var(--color-border)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            <span>Date</span>
            <span>Activity</span>
            <span style={{ textAlign: 'right' }}>Creates</span>
            <span style={{ textAlign: 'right' }}>Updates</span>
            <span style={{ textAlign: 'right' }}>Deletes</span>
            <span style={{ textAlign: 'right' }}>Total</span>
          </div>
          {/* Table rows */}
          {days.map((day) => (
            <div
              key={day.date}
              style={{
                display: 'grid',
                gridTemplateColumns: '100px 1fr 60px 60px 60px 60px',
                gap: 8,
                padding: '8px 0',
                borderBottom: '1px solid var(--color-border)',
                fontSize: 13,
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 500, fontSize: 12 }}>{day.date}</span>
              <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 16 }}>
                {day.creates > 0 && (
                  <div style={{
                    height: '100%',
                    width: `${(day.creates / maxTotal) * 100}%`,
                    background: '#22c55e',
                    borderRadius: '3px 0 0 3px',
                    minWidth: 3,
                  }} />
                )}
                {day.updates > 0 && (
                  <div style={{
                    height: '100%',
                    width: `${(day.updates / maxTotal) * 100}%`,
                    background: '#3b82f6',
                    minWidth: 3,
                  }} />
                )}
                {day.deletes > 0 && (
                  <div style={{
                    height: '100%',
                    width: `${(day.deletes / maxTotal) * 100}%`,
                    background: '#ef4444',
                    borderRadius: '0 3px 3px 0',
                    minWidth: 3,
                  }} />
                )}
              </div>
              <span style={{ textAlign: 'right', color: '#22c55e', fontWeight: day.creates > 0 ? 600 : 400 }}>{day.creates}</span>
              <span style={{ textAlign: 'right', color: '#3b82f6', fontWeight: day.updates > 0 ? 600 : 400 }}>{day.updates}</span>
              <span style={{ textAlign: 'right', color: '#ef4444', fontWeight: day.deletes > 0 ? 600 : 400 }}>{day.deletes}</span>
              <span style={{ textAlign: 'right', fontWeight: 700 }}>{day.total}</span>
            </div>
          ))}
          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--color-text-muted)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: '#22c55e', display: 'inline-block' }} /> Creates
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: '#3b82f6', display: 'inline-block' }} /> Updates
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: '#ef4444', display: 'inline-block' }} /> Deletes
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 12,
        fontSize: 13,
        fontWeight: 600,
        background: color,
        color: '#fff',
        marginRight: 8,
        marginBottom: 4,
      }}
    >
      {label}: {count}
    </span>
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
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '14px 18px',
        marginBottom: 24,
        background: ALERT_BG_COLORS.green,
        borderLeft: `4px solid ${ALERT_BORDER_COLORS.green}`,
        borderRadius: 'var(--radius-md)',
        fontSize: 14,
        fontWeight: 500,
        color: ALERT_TEXT_COLORS.green,
      }}>
        <span style={{ fontSize: 18 }}>{'\u2713'}</span>
        All clear -- no issues detected across your processes and data.
      </div>
    );
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

  const hasGaps = stats.gaps.unmappedSteps > 0 || stats.gaps.ungovernedAssets > 0;

  const allZero =
    stats.valueStreams === 0 &&
    stats.processes === 0 &&
    stats.systems === 0 &&
    stats.dataAssets === 0 &&
    stats.mappings === 0 &&
    stats.organizations <= 1 &&
    stats.people === 0;

  if (allZero) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>Dashboard</h1>
          <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
        </div>
        <GettingStartedChecklist stats={stats} />
        <RecentActivity activeOrgId={activeOrgId} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Dashboard</h1>
        <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 16,
        }}
      >
        {/* Process Coverage */}
        <div style={cardStyle}>
          <div style={labelStyle}>Process Coverage</div>
          <div style={valueStyle}>{stats.coverage.percentage}%</div>
          <div style={descStyle}>
            {stats.coverage.mapped} / {stats.steps} steps mapped
          </div>
        </div>

        {/* Data Health */}
        <div style={cardStyle}>
          <div style={labelStyle}>Data Health</div>
          <div style={{ ...valueStyle, color: healthColor(stats.averageHealth) }}>
            {stats.averageHealth}%
          </div>
          <div style={descStyle}>Average health score across {stats.dataAssets} assets</div>
        </div>

        {/* Governance Overview */}
        <div style={cardStyle}>
          <div style={labelStyle}>Governance Overview</div>
          <div style={{ marginTop: 8, marginBottom: 4 }}>
            <Badge label="Gold" count={stats.governance.gold} color="#d4a017" />
            <Badge label="Silver" count={stats.governance.silver} color="#9ca3af" />
            <Badge label="Bronze" count={stats.governance.bronze} color="#b45309" />
          </div>
          <div style={descStyle}>{stats.dataAssets} total data assets</div>
        </div>

        {/* Total Assets */}
        <div style={cardStyle}>
          <div style={labelStyle}>Total Data Assets</div>
          <div style={valueStyle}>{stats.dataAssets}</div>
          <div style={descStyle}>Registered data assets</div>
        </div>

        {/* Systems */}
        <div style={cardStyle}>
          <div style={labelStyle}>Systems</div>
          <div style={valueStyle}>{stats.systems}</div>
          <div style={descStyle}>Connected systems</div>
        </div>

        {/* Organizations */}
        <div style={cardStyle}>
          <div style={labelStyle}>Organizations</div>
          <div style={valueStyle}>{stats.organizations}</div>
          <div style={descStyle}>Organizational units</div>
        </div>

        {/* People */}
        <div style={cardStyle}>
          <div style={labelStyle}>People</div>
          <div style={valueStyle}>{stats.people}</div>
          <div style={descStyle}>Registered users</div>
        </div>

        {/* Gaps */}
        <div
          style={{
            ...cardStyle,
            borderColor: hasGaps ? 'var(--color-warning, #eab308)' : 'var(--color-border)',
          }}
        >
          <div style={labelStyle}>Gaps</div>
          <div style={{ marginTop: 8 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 6,
                fontSize: 14,
              }}
            >
              <span>Unmapped Steps</span>
              <span
                style={{
                  fontWeight: 700,
                  color:
                    stats.gaps.unmappedSteps > 0
                      ? 'var(--color-danger, #ef4444)'
                      : 'var(--color-success, #22c55e)',
                }}
              >
                {stats.gaps.unmappedSteps}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 6,
                fontSize: 14,
              }}
            >
              <span>Ungoverned Assets</span>
              <span
                style={{
                  fontWeight: 700,
                  color:
                    stats.gaps.ungovernedAssets > 0
                      ? 'var(--color-warning, #eab308)'
                      : 'var(--color-success, #22c55e)',
                }}
              >
                {stats.gaps.ungovernedAssets}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <DashboardAlerts stats={stats} />
      </div>

      <RecentActivity activeOrgId={activeOrgId} />

      <ActivityTrends />
    </div>
  );
}
