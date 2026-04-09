import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';

interface ScorecardDimension {
  name: string;
  score: number;
  description: string;
  color: string;
}

interface ScorecardData {
  overall: number;
  dimensions: ScorecardDimension[];
}

const RECOMMENDATIONS: Record<string, string> = {
  'Process Documentation': 'Set more value streams to ACTIVE status and ensure they have complete paths (Value Stream > Process > Activity).',
  'Data Governance': 'Promote Bronze-tier data assets to Silver or Gold by adding quality rules, owners, and documentation.',
  'Domain Coverage': 'Assign owners to your data domains to establish accountability and stewardship.',
  'Governance Structure': 'Establish the missing governance bodies (Council, Office, Committee, or Stewardship Teams) to build a complete governance framework.',
  'People Coverage': 'Add members to governance groups that currently have no participants.',
};

function overallColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#eab308';
  return '#ef4444';
}

function overallLabel(score: number): string {
  if (score >= 70) return 'Mature';
  if (score >= 40) return 'Developing';
  return 'Initial';
}

export default function ScorecardPage() {
  const { activeOrgId } = useOrgContext();
  const [data, setData] = useState<ScorecardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: ScorecardData }>(`/dashboard/scorecard${query}`);
      setData(res.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load scorecard');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Governance Maturity Scorecard</h1>
        <div style={{ color: 'var(--color-text-muted)' }}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Governance Maturity Scorecard</h1>
        <div style={{ color: 'var(--color-danger, #ef4444)' }}>Error: {error}</div>
      </div>
    );
  }

  if (!data) return null;

  const lowDimensions = data.dimensions.filter((d) => d.score < 50);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Governance Maturity Scorecard</h1>

      {/* Overall Score */}
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 32,
        boxShadow: 'var(--shadow-sm)',
        marginBottom: 24,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
          Overall Maturity Score
        </div>
        <div style={{
          fontSize: 64,
          fontWeight: 800,
          color: overallColor(data.overall),
          lineHeight: 1,
          marginBottom: 8,
        }}>
          {data.overall}
        </div>
        <div style={{
          display: 'inline-block',
          padding: '4px 16px',
          borderRadius: 12,
          fontSize: 14,
          fontWeight: 600,
          background: overallColor(data.overall),
          color: '#fff',
        }}>
          {overallLabel(data.overall)}
        </div>
      </div>

      {/* Dimension Bars */}
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 24,
        boxShadow: 'var(--shadow-sm)',
        marginBottom: 24,
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Dimensions</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {data.dimensions.map((dim) => (
            <div key={dim.name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{dim.name}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: dim.color }}>{dim.score}%</span>
              </div>
              <div style={{
                height: 12,
                background: 'var(--color-border)',
                borderRadius: 6,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${dim.score}%`,
                  background: dim.color,
                  borderRadius: 6,
                  transition: 'width 0.5s ease',
                  minWidth: dim.score > 0 ? 4 : 0,
                }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                {dim.description}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recommendations */}
      {lowDimensions.length > 0 && (
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 24,
          boxShadow: 'var(--shadow-sm)',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Recommendations</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {lowDimensions.map((dim) => (
              <div
                key={dim.name}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '12px 16px',
                  background: '#fef3c7',
                  borderLeft: `4px solid ${dim.color}`,
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>{'\u26A0'}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                    {dim.name} ({dim.score}%)
                  </div>
                  <div style={{ fontSize: 13, color: '#78350f' }}>
                    {RECOMMENDATIONS[dim.name] || 'Improve this dimension to strengthen your governance maturity.'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
