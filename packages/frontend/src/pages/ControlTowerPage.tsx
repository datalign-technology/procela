import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import PageTabNav, { ANALYZE_TABS } from '../components/PageTabNav';

// ── Types ────────────────────────────────────────────────────────────────

interface ControlTowerSummary {
  issues: {
    total: number;
    open: number;
    investigating: number;
    inProgress: number;
    resolved: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
  };
  tasks: {
    total: number;
    open: number;
    inProgress: number;
    pendingReview: number;
    pendingApproval: number;
    completed: number;
    overdue: number;
    byPriority: Record<string, number>;
    byAutomationMode: Record<string, number>;
  };
  policies: {
    total: number;
    active: number;
    draft: number;
    underReview: number;
    overdueReviews: number;
    byCategory: Record<string, number>;
  };
  controls: {
    total: number;
    active: number;
    byType: Record<string, number>;
    byAutomationMode: Record<string, number>;
    automationRate: number;
  };
  coverage: {
    domainsWithOwners: number;
    domainsTotal: number;
    assetsWithOwners: number;
    assetsTotal: number;
    processesWithOwners: number;
    processesTotal: number;
  };
}

// ── Styles ───────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 20,
  boxShadow: 'var(--shadow-sm)',
};

const kpiValueStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
};

const kpiLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-muted)',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  marginBottom: 12,
};

const skeletonStyle: React.CSSProperties = {
  background: 'linear-gradient(90deg, var(--color-border) 25%, var(--color-bg) 50%, var(--color-border) 75%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.5s infinite',
  borderRadius: 4,
};

// ── Severity / priority color maps ───────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  LOW: '#94a3b8',
  MEDIUM: '#3b82f6',
  HIGH: '#f59e0b',
  CRITICAL: '#ef4444',
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW: '#94a3b8',
  MEDIUM: '#3b82f6',
  HIGH: '#f59e0b',
  CRITICAL: '#ef4444',
  URGENT: '#ef4444',
};

// ── Skeleton loader ──────────────────────────────────────────────────────

function SkeletonLoader() {
  return (
    <div>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      {/* KPI row skeleton */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={cardStyle}>
            <div style={{ ...skeletonStyle, width: 80, height: 28, marginBottom: 8 }} />
            <div style={{ ...skeletonStyle, width: 120, height: 14 }} />
          </div>
        ))}
      </div>
      {/* Two-column skeleton */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
        {[1, 2].map((i) => (
          <div key={i} style={cardStyle}>
            <div style={{ ...skeletonStyle, width: 140, height: 16, marginBottom: 16 }} />
            {[1, 2, 3, 4].map((j) => (
              <div key={j} style={{ ...skeletonStyle, width: '100%', height: 20, marginBottom: 8 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Horizontal bar chart helper ──────────────────────────────────────────

function HorizontalBarChart({
  data,
  colorMap,
}: {
  data: Record<string, number>;
  colorMap: Record<string, string>;
}) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No data</div>;
  }
  const max = Math.max(...entries.map(([, v]) => v), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 500, width: 70, textAlign: 'right', color: 'var(--color-text)', textTransform: 'capitalize' }}>
            {label.toLowerCase()}
          </span>
          <div style={{ flex: 1, height: 20, background: 'var(--color-bg)', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${(value / max) * 100}%`,
                minWidth: value > 0 ? 4 : 0,
                background: colorMap[label] || '#94a3b8',
                borderRadius: 4,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, width: 30, color: 'var(--color-text)' }}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Progress bar helper ──────────────────────────────────────────────────

function CoverageItem({ label, current, total }: { label: string; current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const barColor = pct >= 80 ? '#16a34a' : pct >= 50 ? '#ca8a04' : '#dc2626';

  return (
    <div style={{ flex: 1, minWidth: 180 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: barColor }}>{pct}%</span>
      </div>
      <div style={{ height: 8, background: 'var(--color-bg)', borderRadius: 4, overflow: 'hidden', marginBottom: 4 }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: barColor,
            borderRadius: 4,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
        {current} of {total} have owners
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────

export default function ControlTowerPage() {
  const { activeOrgId } = useOrgContext();
  const [data, setData] = useState<ControlTowerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
        const res = await apiClient.get<{ success: boolean; data: ControlTowerSummary }>(
          `/control-tower/summary${query}`,
        );
        if (!cancelled) setData(res.data);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load Control Tower data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeOrgId]);

  // ── Header ────────────────────────────────────────────────────────────

  const header = (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Control Tower</h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
        Governance operations at a glance.
      </p>
    </div>
  );

  if (error) {
    return (
      <div>
        {header}
        <div style={{ color: 'var(--color-danger, #ef4444)' }}>Error: {error}</div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div>
        {header}
        <SkeletonLoader />
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────

  const criticalCount = data.issues.bySeverity?.CRITICAL ?? 0;
  const activeTasks = (data.tasks.open ?? 0) + (data.tasks.inProgress ?? 0);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div>
      <PageTabNav tabs={ANALYZE_TABS} />
      {header}

      {/* ── KPI Row ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        {/* Open Issues */}
        <div style={cardStyle}>
          <div style={kpiValueStyle}>{data.issues.open}</div>
          <div style={kpiLabelStyle}>Open Issues</div>
          {criticalCount > 0 && (
            <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, marginTop: 4 }}>
              {criticalCount} critical
            </div>
          )}
        </div>

        {/* Active Tasks */}
        <div style={cardStyle}>
          <div style={kpiValueStyle}>{activeTasks}</div>
          <div style={kpiLabelStyle}>Active Tasks</div>
          {data.tasks.overdue > 0 && (
            <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, marginTop: 4 }}>
              {data.tasks.overdue} overdue
            </div>
          )}
        </div>

        {/* Active Policies */}
        <div style={cardStyle}>
          <div style={kpiValueStyle}>{data.policies.active}</div>
          <div style={kpiLabelStyle}>Active Policies</div>
          {data.policies.overdueReviews > 0 && (
            <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600, marginTop: 4 }}>
              {data.policies.overdueReviews} overdue review{data.policies.overdueReviews !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* Automation Rate */}
        <div style={cardStyle}>
          <div style={kpiValueStyle}>{Math.round(data.controls.automationRate)}%</div>
          <div style={kpiLabelStyle}>Automation Rate</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
            AGENT + HYBRID controls
          </div>
        </div>
      </div>

      {/* ── Issues by Severity / Tasks by Priority ───────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 32 }}>
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Issues by Severity</div>
          <HorizontalBarChart data={data.issues.bySeverity || {}} colorMap={SEVERITY_COLORS} />
        </div>
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Tasks by Priority</div>
          <HorizontalBarChart data={data.tasks.byPriority || {}} colorMap={PRIORITY_COLORS} />
        </div>
      </div>

      {/* ── Automation Breakdown ──────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionTitleStyle}>Automation Breakdown</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {/* Tasks by automation mode */}
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Tasks
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              {['HUMAN', 'AGENT', 'HYBRID'].map((mode) => (
                <div key={mode} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)' }}>
                    {data.tasks.byAutomationMode?.[mode] ?? 0}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
                    {mode.toLowerCase()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Controls by automation mode */}
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Controls
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              {['HUMAN', 'AGENT', 'HYBRID'].map((mode) => (
                <div key={mode} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)' }}>
                    {data.controls.byAutomationMode?.[mode] ?? 0}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
                    {mode.toLowerCase()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Coverage Gaps ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionTitleStyle}>Coverage Gaps</div>
        <div style={{ ...cardStyle, display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <CoverageItem
            label="Domains"
            current={data.coverage.domainsWithOwners}
            total={data.coverage.domainsTotal}
          />
          <CoverageItem
            label="Assets"
            current={data.coverage.assetsWithOwners}
            total={data.coverage.assetsTotal}
          />
          <CoverageItem
            label="Processes"
            current={data.coverage.processesWithOwners}
            total={data.coverage.processesTotal}
          />
        </div>
      </div>
    </div>
  );
}
