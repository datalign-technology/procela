import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';

interface DashboardStats {
  valueStreams: number;
  processes: number;
  subProcesses: number;
  steps: number;
  systems: number;
  dataAssets: number;
  mappings: number;
  organizations: number;
  people: number;
  coverage: { mapped: number; unmapped: number; percentage: number };
  governance: { bronze: number; silver: number; gold: number };
  averageHealth: number;
  gaps: { unmappedSteps: number; ungovernedAssets: number; ownerlessItems: number };
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

  if (error) {
    return (
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Dashboard</h1>
        <div style={{ color: 'var(--color-danger, #ef4444)' }}>Error: {error}</div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Dashboard</h1>
        <div style={{ color: 'var(--color-text-muted)' }}>Loading...</div>
      </div>
    );
  }

  const hasGaps = stats.gaps.unmappedSteps > 0 || stats.gaps.ungovernedAssets > 0;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Dashboard</h1>
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
    </div>
  );
}
