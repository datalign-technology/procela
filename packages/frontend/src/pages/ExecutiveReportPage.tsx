import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import { useOrgContext } from '../stores/orgContext';
import IconButton from '../components/IconButton';

interface DashboardStats {
  valueStreams: number;
  processes: number;
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

interface ScorecardData {
  overall: number;
  dimensions: { name: string; score: number; description: string; color: string }[];
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

interface GovernanceGroupSummary {
  id: string;
  name: string;
  type: string;
  status: string;
  members: { personId: string }[];
}

interface DataDomainSummary {
  id: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
}

const sectionStyle: React.CSSProperties = {
  marginBottom: 32,
  pageBreakInside: 'avoid',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  borderBottom: '2px solid var(--color-primary, #0f4f46)',
  paddingBottom: 6,
  marginBottom: 16,
  color: 'var(--color-primary, #0f4f46)',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid var(--color-border, #e5e7eb)',
  fontWeight: 600,
  color: 'var(--color-text-secondary, #64748b)',
  fontSize: 12,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--color-border, #e5e7eb)',
};

const metricBoxStyle: React.CSSProperties = {
  background: 'var(--color-surface, #fff)',
  border: '1px solid var(--color-border, #e5e7eb)',
  borderRadius: 8,
  padding: 16,
  textAlign: 'center',
};

export default function ExecutiveReportPage() {
  const { activeOrgId, activeOrgName } = useOrgContext();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [scorecard, setScorecard] = useState<ScorecardData | null>(null);
  const [, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [govGroups, setGovGroups] = useState<GovernanceGroupSummary[]>([]);
  const [dataDomains, setDataDomains] = useState<DataDomainSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [statsRes, scorecardRes, auditRes, govRes, domainRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DashboardStats }>(`/dashboard/stats${query}`),
        apiClient.get<{ success: boolean; data: ScorecardData }>(`/dashboard/scorecard${query}`),
        apiClient.get<{ success: boolean; data: AuditLogEntry[] }>('/audit?limit=10'),
        apiClient.get<{ success: boolean; data: GovernanceGroupSummary[] }>(`/governance-groups${query}`),
        apiClient.get<{ success: boolean; data: DataDomainSummary[] }>(`/data-domains${query}`),
      ]);
      setStats(statsRes.data);
      setScorecard(scorecardRes.data);
      setAuditEntries(auditRes.data || []);
      setGovGroups(govRes.data || []);
      setDataDomains(domainRes.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Executive Report" />
        <div style={{ color: 'var(--color-text-muted)' }}>Loading report data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Executive Report" />
        <div style={{ color: 'var(--color-danger, #ef4444)' }}>Error: {error}</div>
      </div>
    );
  }

  if (!stats || !scorecard) return null;

  const unmappedActivities = stats.gaps.unmappedActivities ?? stats.gaps.unmappedSteps ?? 0;
  const domainsWithOwners = dataDomains.filter((d) => d.ownerId).length;
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="executive-report">
      <style>{`
        @media print {
          nav, header, aside, button, .no-print { display: none !important; }
          body { background: white !important; }
          main { padding: 0 !important; margin: 0 !important; }
          .executive-report { padding: 0; }
          .report-content { box-shadow: none !important; border: none !important; }
        }
        @media print {
          .page-break { page-break-before: always; }
        }
      `}</style>

      {/* Print Button */}
      <div className="no-print">
        <PageHeader
          title="Executive Report"
          actions={
            <>
              <button onClick={() => window.print()} className="no-print" style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 500,
                background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
              }}>
                Print / Export PDF
              </button>
              <IconButton icon="download" label="Export PDF" variant="primary" onClick={() => window.print()} />
            </>
          }
        />
      </div>

      <div className="report-content" style={{
        background: 'var(--color-surface, #fff)',
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: 'var(--radius-md, 8px)',
        padding: 40,
        boxShadow: 'var(--shadow-sm)',
      }}>
        {/* Report Header */}
        <div style={{ textAlign: 'center', marginBottom: 40, borderBottom: '3px solid var(--color-primary, #0f4f46)', paddingBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--color-primary, #0f4f46)', margin: 0 }}>
            Procela Executive Report
          </h1>
          <div style={{ fontSize: 16, color: 'var(--color-text-secondary, #64748b)', marginTop: 8 }}>
            {activeOrgName || 'All Organizations'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted, #94a3b8)', marginTop: 4 }}>
            Generated {today}
          </div>
        </div>

        {/* Section 1: Organization Overview */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>1. Organization Overview</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <div style={metricBoxStyle}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.organizations}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Organizations</div>
            </div>
            <div style={metricBoxStyle}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.people}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>People</div>
            </div>
            <div style={metricBoxStyle}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.systems}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Systems</div>
            </div>
            <div style={metricBoxStyle}>
              <div style={{ fontSize: 28, fontWeight: 700, color: scorecard.dimensions[0]?.color || '#333' }}>{scorecard.overall}%</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Maturity Score</div>
            </div>
          </div>
        </div>

        {/* Section 2: Process Coverage */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>2. Process Coverage</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
            <div style={metricBoxStyle}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.valueStreams}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Value Streams</div>
            </div>
            <div style={metricBoxStyle}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.processes}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Processes</div>
            </div>
            <div style={metricBoxStyle}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.activities}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Activities</div>
            </div>
            <div style={metricBoxStyle}>
              <div style={{ fontSize: 28, fontWeight: 700, color: stats.coverage.percentage >= 70 ? '#22c55e' : stats.coverage.percentage >= 40 ? '#eab308' : '#ef4444' }}>
                {stats.coverage.percentage}%
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Coverage</div>
            </div>
          </div>
          <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${stats.coverage.percentage}%`, background: '#0f4f46', borderRadius: 4 }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
            {stats.coverage.mapped} of {stats.coverage.mapped + stats.coverage.unmapped} activities mapped to data assets
          </div>
        </div>

        {/* Section 3: Data Governance */}
        <div className="page-break" style={sectionStyle}>
          <h2 style={sectionTitleStyle}>3. Data Governance</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
            <div style={{ ...metricBoxStyle, borderLeft: '4px solid #d4a017' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#d4a017' }}>{stats.governance.gold}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Certified</div>
            </div>
            <div style={{ ...metricBoxStyle, borderLeft: '4px solid #9ca3af' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#9ca3af' }}>{stats.governance.silver}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Managed</div>
            </div>
            <div style={{ ...metricBoxStyle, borderLeft: '4px solid #b45309' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#b45309' }}>{stats.governance.bronze}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Uncertified</div>
            </div>
            <div style={metricBoxStyle}>
              <div style={{ fontSize: 28, fontWeight: 700, color: stats.averageHealth >= 80 ? '#22c55e' : stats.averageHealth >= 50 ? '#eab308' : '#ef4444' }}>
                {stats.averageHealth}%
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Avg Health</div>
            </div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {domainsWithOwners} of {dataDomains.length} data domains have assigned owners.
          </div>
        </div>

        {/* Section 4: Gap Analysis */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>4. Gap Analysis</h2>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th scope="col" style={thStyle}>Gap Type</th>
                <th scope="col" style={{ ...thStyle, textAlign: 'right' }}>Count</th>
                <th scope="col" style={thStyle}>Severity</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={tdStyle}>Unmapped Activities</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{unmappedActivities}</td>
                <td style={tdStyle}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: '#fff',
                    background: unmappedActivities > 0 ? '#ef4444' : '#22c55e',
                  }}>
                    {unmappedActivities > 0 ? 'High' : 'Clear'}
                  </span>
                </td>
              </tr>
              <tr>
                <td style={tdStyle}>Ungoverned Assets (Uncertified, linked to processes)</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{stats.gaps.ungovernedAssets}</td>
                <td style={tdStyle}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: '#fff',
                    background: stats.gaps.ungovernedAssets > 0 ? '#eab308' : '#22c55e',
                  }}>
                    {stats.gaps.ungovernedAssets > 0 ? 'Medium' : 'Clear'}
                  </span>
                </td>
              </tr>
              <tr>
                <td style={tdStyle}>Ownership Gaps (Processes/Value Streams without owners)</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{stats.gaps.ownerlessItems}</td>
                <td style={tdStyle}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: '#fff',
                    background: stats.gaps.ownerlessItems > 0 ? '#eab308' : '#22c55e',
                  }}>
                    {stats.gaps.ownerlessItems > 0 ? 'Medium' : 'Clear'}
                  </span>
                </td>
              </tr>
              <tr>
                <td style={tdStyle}>Ungoverned Data Domains (no owner)</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{stats.gaps.ungovernedDomains ?? 0}</td>
                <td style={tdStyle}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: '#fff',
                    background: (stats.gaps.ungovernedDomains ?? 0) > 0 ? '#3b82f6' : '#22c55e',
                  }}>
                    {(stats.gaps.ungovernedDomains ?? 0) > 0 ? 'Info' : 'Clear'}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Section 5: Governance Structure */}
        <div className="page-break" style={sectionStyle}>
          <h2 style={sectionTitleStyle}>5. Governance Structure</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
            <div style={metricBoxStyle}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{govGroups.length}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Governance Groups</div>
            </div>
            <div style={metricBoxStyle}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{dataDomains.length}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Data Domains</div>
            </div>
            <div style={metricBoxStyle}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{domainsWithOwners}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Domains with Owners</div>
            </div>
          </div>
          {govGroups.length > 0 && (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th scope="col" style={thStyle}>Group</th>
                  <th scope="col" style={thStyle}>Type</th>
                  <th scope="col" style={thStyle}>Status</th>
                  <th scope="col" style={{ ...thStyle, textAlign: 'right' }}>Members</th>
                </tr>
              </thead>
              <tbody>
                {govGroups.slice(0, 10).map((g) => (
                  <tr key={g.id}>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{g.name}</td>
                    <td style={tdStyle}>{g.type.replace(/_/g, ' ')}</td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        color: '#fff',
                        background: g.status === 'ACTIVE' ? '#22c55e' : '#9ca3af',
                      }}>
                        {g.status}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{g.members.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '2px solid var(--color-border, #e5e7eb)',
          paddingTop: 16,
          textAlign: 'center',
          fontSize: 11,
          color: 'var(--color-text-muted, #94a3b8)',
        }}>
          Generated by Procela -- {today}
        </div>
      </div>
    </div>
  );
}
