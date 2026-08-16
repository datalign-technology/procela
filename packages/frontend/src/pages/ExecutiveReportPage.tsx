import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import PageHeader from '../components/PageHeader';
import Spinner from '../components/Spinner';
import { useOrgContext } from '../stores/orgContext';
import { healthColorVar } from '../components/HealthBar';
import SectionHeading from '../components/SectionHeading';
import StatTile from '../components/StatTile';
import Meter from '../components/Meter';
import TierBar from '../components/TierBar';
import EmptyState from '../components/EmptyState';

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
  marginBottom: 22,
  pageBreakInside: 'avoid',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid var(--color-border)',
  fontWeight: 600,
  color: 'var(--color-text-secondary, #64748b)',
  fontSize: 12,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--color-border)',
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
    } catch (err) {
      setError(errorMessage(err, 'Failed to load report data'));
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
        <Spinner center label="Loading…" />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Executive Report" />
        <div style={{ color: 'var(--color-error)' }}>Error: {error}</div>
      </div>
    );
  }

  if (!stats || !scorecard) {
    return (
      <div>
        <PageHeader title="Executive Report" />
        <EmptyState
          title="No report data yet"
          description="Once your organization has processes, data assets and governance defined, the executive report will summarize coverage, health and gaps here."
        />
      </div>
    );
  }

  const unmappedActivities = stats.gaps.unmappedActivities ?? stats.gaps.unmappedSteps ?? 0;
  const domainsWithOwners = dataDomains.filter((d) => d.ownerId).length;
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="executive-report">
      <style>{`
        @media print {
          nav, header, aside, button, .no-print, .skip-to-content { display: none !important; }
          body { background: white !important; }
          main { padding: 0 !important; margin: 0 !important; }
          .executive-report { padding: 0; }
          .report-content {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
          }
          /* Fit the whole report on a single page. Scale the content down,
             tighten the vertical rhythm, and keep sections from splitting
             across pages. */
          .report-content { font-size: 11px; }
          .report-content h1 { font-size: 20px !important; }
          /* Report header (centred block) — trim its generous screen spacing. */
          .report-content > div:first-child { margin-bottom: 14px !important; padding-bottom: 12px !important; }
          /* Each numbered section — avoid page splits and tighten the gap. */
          .report-content > div { page-break-inside: avoid; margin-bottom: 12px !important; }
          .page-break { page-break-before: auto !important; }
          @page { size: portrait; margin: 10mm; }
        }
      `}</style>

      {/* Print Button */}
      <div className="no-print">
        <PageHeader
          title="Executive Report"
          actions={
            <button onClick={() => window.print()} className="no-print" style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 500,
              background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}>
              Print (browser)
            </button>
          }
        />
      </div>

      <div className="report-content" style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 40,
        boxShadow: 'var(--shadow-sm)',
      }}>
        {/* Report Header */}
        <div style={{ textAlign: 'center', marginBottom: 40, borderBottom: '3px solid var(--color-primary)', paddingBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--color-primary)', margin: 0 }}>
            Procela Executive Report
          </h1>
          <div style={{ fontSize: 16, color: 'var(--color-text-secondary, #64748b)', marginTop: 8 }}>
            {activeOrgName || 'All Organizations'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Generated {today}
          </div>
        </div>

        {/* Section 1: Organization Overview */}
        <div style={sectionStyle}>
          <SectionHeading title="1. Organization Overview" underline />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <StatTile dense label="Organizations" value={stats.organizations} />
            <StatTile dense label="People" value={stats.people} />
            <StatTile dense label="Systems" value={stats.systems} />
            <StatTile dense label="Maturity Score" value={`${scorecard.overall}%`} valueColor={scorecard.dimensions[0]?.color || 'var(--color-text)'} />
          </div>
        </div>

        {/* Section 2: Process Coverage */}
        <div style={sectionStyle}>
          <SectionHeading title="2. Process Coverage" underline />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
            <StatTile dense label="Value Streams" value={stats.valueStreams} />
            <StatTile dense label="Processes" value={stats.processes} />
            <StatTile dense label="Activities" value={stats.activities} />
            <StatTile dense label="Coverage" value={`${stats.coverage.percentage}%`} valueColor={healthColorVar(stats.coverage.percentage)} />
          </div>
          <Meter value={stats.coverage.percentage} height={8} />
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
            {stats.coverage.mapped} of {stats.coverage.mapped + stats.coverage.unmapped} activities mapped to data assets
          </div>
        </div>

        {/* Section 3: Data Governance */}
        <div className="page-break" style={sectionStyle}>
          <SectionHeading title="3. Data Governance" underline />
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 16, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Certification tiers
              </div>
              <TierBar gold={stats.governance.gold} silver={stats.governance.silver} bronze={stats.governance.bronze} />
            </div>
            <StatTile dense label="Avg Health" value={`${stats.averageHealth}%`} valueColor={healthColorVar(stats.averageHealth)} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {domainsWithOwners} of {dataDomains.length} data domains have assigned owners.
          </div>
        </div>

        {/* Section 4: Gap Analysis */}
        <div style={sectionStyle}>
          <SectionHeading title="4. Gap Analysis" underline />
          <div style={{ overflowX: 'auto' }}>
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
                    background: unmappedActivities > 0 ? 'var(--color-error)' : 'var(--color-success)',
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
                    background: stats.gaps.ungovernedAssets > 0 ? 'var(--color-warning)' : 'var(--color-success)',
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
                    background: stats.gaps.ownerlessItems > 0 ? 'var(--color-warning)' : 'var(--color-success)',
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
                    background: (stats.gaps.ungovernedDomains ?? 0) > 0 ? 'var(--color-info)' : 'var(--color-success)',
                  }}>
                    {(stats.gaps.ungovernedDomains ?? 0) > 0 ? 'Info' : 'Clear'}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>

        {/* Section 5: Governance Structure */}
        <div className="page-break" style={sectionStyle}>
          <SectionHeading title="5. Governance Structure" underline />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
            <StatTile dense label="Governance Groups" value={govGroups.length} />
            <StatTile dense label="Data Domains" value={dataDomains.length} />
            <StatTile dense label="Domains with Owners" value={domainsWithOwners} />
          </div>
          {govGroups.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
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
                        background: g.status === 'ACTIVE' ? 'var(--color-success)' : 'var(--color-text-muted)',
                      }}>
                        {g.status}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{g.members.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '2px solid var(--color-border)',
          paddingTop: 16,
          textAlign: 'center',
          fontSize: 11,
          color: 'var(--color-text-muted)',
        }}>
          Generated by Procela -- {today}
        </div>
      </div>
    </div>
  );
}
