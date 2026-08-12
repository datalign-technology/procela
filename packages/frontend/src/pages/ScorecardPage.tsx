import { useEffect, useState, useCallback, useRef } from 'react';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
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

interface SnapshotDimension {
  name: string;
  score: number;
}

interface ScorecardSnapshot {
  id: string;
  orgId: string;
  timestamp: string;
  overall: number;
  dimensions: SnapshotDimension[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const RECOMMENDATIONS: Record<string, string> = {
  'Process Documentation': 'Set more value streams to ACTIVE status and ensure they have complete paths (Value Stream > Process > Activity).',
  'Data Governance': 'Promote Uncertified data assets to Managed or Certified by adding quality rules, owners, and documentation.',
  'Domain Coverage': 'Assign owners to your data domains to establish accountability and stewardship.',
  'Governance Structure': 'Establish the missing governance bodies (Council, Office, Committee, or Stewardship Teams) to build a complete governance framework.',
  'People Coverage': 'Add members to governance groups that currently have no participants.',
};

const DIMENSION_COLORS: Record<string, string> = {
  'Process Documentation': '#3b82f6',
  'Data Governance': '#ef4444',
  'Domain Coverage': '#8b5cf6',
  'Governance Structure': '#f59e0b',
  'People Coverage': '#10b981',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}/${day}`;
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// SVG Chart Components
// ---------------------------------------------------------------------------
interface ChartProps {
  snapshots: ScorecardSnapshot[];
}

function MaturityChart({ snapshots }: ChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (snapshots.length < 2) {
    return (
      <div style={{
        padding: 24,
        textAlign: 'center',
        color: 'var(--color-text-muted)',
        fontSize: 13,
      }}>
        Need at least 2 data points to display a trend chart. The scorecard is snapshotted automatically each day you visit this page, or use the "Take Snapshot" button.
      </div>
    );
  }

  const width = 700;
  const height = 220;
  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 35;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const timestamps = snapshots.map((s) => new Date(s.timestamp).getTime());
  const minT = Math.min(...timestamps);
  const maxT = Math.max(...timestamps);
  const timeRange = maxT - minT || 1;

  const scaleX = (t: number) => paddingLeft + ((t - minT) / timeRange) * chartWidth;
  const scaleY = (score: number) => paddingTop + chartHeight - (score / 100) * chartHeight;

  const points = snapshots.map((s, i) => ({
    x: scaleX(timestamps[i]),
    y: scaleY(s.overall),
    score: s.overall,
    date: formatDate(s.timestamp),
  }));

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');

  // Y-axis grid lines
  const yTicks = [0, 25, 50, 75, 100];

  // X-axis labels — show up to 8 evenly spaced dates
  const maxLabels = 8;
  const labelStep = Math.max(1, Math.floor(snapshots.length / maxLabels));
  const xLabels = snapshots
    .map((s, i) => ({ index: i, label: formatDate(s.timestamp), x: points[i].x }))
    .filter((_, i) => i % labelStep === 0 || i === snapshots.length - 1);

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: 'visible' }}
    >
      {/* Grid lines */}
      {yTicks.map((tick) => (
        <g key={tick}>
          <line
            x1={paddingLeft}
            y1={scaleY(tick)}
            x2={width - paddingRight}
            y2={scaleY(tick)}
            stroke="var(--color-border, #e5e7eb)"
            strokeWidth={1}
            strokeDasharray={tick === 0 || tick === 100 ? undefined : '4,4'}
          />
          <text
            x={paddingLeft - 8}
            y={scaleY(tick) + 4}
            textAnchor="end"
            fontSize={11}
            fill="var(--color-text-muted, #9ca3af)"
          >
            {tick}
          </text>
        </g>
      ))}

      {/* X-axis labels */}
      {xLabels.map((l) => (
        <text
          key={l.index}
          x={l.x}
          y={height - 5}
          textAnchor="middle"
          fontSize={11}
          fill="var(--color-text-muted, #9ca3af)"
        >
          {l.label}
        </text>
      ))}

      {/* Trend line */}
      <polyline
        points={polylinePoints}
        fill="none"
        stroke="var(--color-primary, #3b82f6)"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Area fill under the line */}
      <polygon
        points={`${points[0].x},${scaleY(0)} ${polylinePoints} ${points[points.length - 1].x},${scaleY(0)}`}
        fill="var(--color-primary, #3b82f6)"
        opacity={0.08}
      />

      {/* Data points */}
      {points.map((p, i) => (
        <g key={i}>
          <circle
            cx={p.x}
            cy={p.y}
            r={hoveredIndex === i ? 6 : 4}
            fill={overallColor(p.score)}
            stroke="#fff"
            strokeWidth={2}
            style={{ cursor: 'pointer', transition: 'r 0.15s ease' }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          />
          {hoveredIndex === i && (
            <>
              <rect
                x={p.x - 28}
                y={p.y - 30}
                width={56}
                height={22}
                rx={4}
                fill="var(--color-text, #1f2937)"
              />
              <text
                x={p.x}
                y={p.y - 16}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill="#fff"
              >
                {p.score} - {p.date}
              </text>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Dimension Sparkline
// ---------------------------------------------------------------------------
interface SparklineProps {
  snapshots: ScorecardSnapshot[];
  dimensionName: string;
  color: string;
}

function DimensionSparkline({ snapshots, dimensionName, color }: SparklineProps) {
  const scores = snapshots.map((s) => {
    const dim = s.dimensions.find((d) => d.name === dimensionName);
    return dim ? dim.score : 0;
  });

  if (scores.length < 2) {
    return (
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', paddingTop: 16 }}>
        Waiting for data...
      </div>
    );
  }

  const width = 200;
  const height = 80;
  const pad = 10;

  const chartW = width - pad * 2;
  const chartH = height - pad * 2;

  const points = scores.map((score, i) => {
    const x = pad + (i / (scores.length - 1)) * chartW;
    const y = pad + chartH - (score / 100) * chartH;
    return { x, y, score };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');

  const latest = scores[scores.length - 1];
  const first = scores[0];
  const delta = latest - first;
  const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color }}>{dimensionName}</span>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: delta > 0 ? '#22c55e' : delta < 0 ? '#ef4444' : 'var(--color-text-muted)',
        }}>
          {latest}% ({deltaStr})
        </span>
      </div>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ overflow: 'visible' }}
      >
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polygon
          points={`${points[0].x},${pad + chartH} ${polyline} ${points[points.length - 1].x},${pad + chartH}`}
          fill={color}
          opacity={0.1}
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={3}
            fill={color}
            stroke="#fff"
            strokeWidth={1.5}
          >
            <title>{`${dimensionName}: ${p.score}% (${formatDate(snapshots[i].timestamp)})`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------
export default function ScorecardPage() {
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const [data, setData] = useState<ScorecardData | null>(null);
  const [snapshots, setSnapshots] = useState<ScorecardSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const autoSnapshotDone = useRef(false);

  // Fetch snapshots
  const fetchSnapshots = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: ScorecardSnapshot[] }>(
        `/maturity-trends${query}`
      );
      setSnapshots(res.data);
    } catch {
      // Non-critical — just means no trend data yet
    }
  }, [activeOrgId]);

  // Take a snapshot
  const takeSnapshot = useCallback(async (scorecardData: ScorecardData, silent = false) => {
    if (!activeOrgId) return;
    try {
      setSnapshotLoading(true);
      await apiClient.post('/maturity-trends/snapshot', {
        orgId: activeOrgId,
        overall: scorecardData.overall,
        dimensions: scorecardData.dimensions.map((d) => ({
          name: d.name,
          score: d.score,
        })),
      });
      await fetchSnapshots();
      if (!silent) {
        addToast('success', 'Maturity snapshot saved');
      }
    } catch {
      if (!silent) {
        addToast('error', 'Failed to save snapshot');
      }
    } finally {
      setSnapshotLoading(false);
    }
  }, [activeOrgId, fetchSnapshots, addToast]);

  // Fetch scorecard data
  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: ScorecardData }>(`/dashboard/scorecard${query}`);
      setData(res.data);
      return res.data;
    } catch (err) {
      setError(errorMessage(err, 'Failed to load scorecard'));
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  // Auto-snapshot: on page load, check if we have a snapshot for today
  const maybeAutoSnapshot = useCallback(async (scorecardData: ScorecardData, currentSnapshots: ScorecardSnapshot[]) => {
    if (!activeOrgId || autoSnapshotDone.current) return;
    autoSnapshotDone.current = true;

    const today = todayDateString();
    const hasTodaySnapshot = currentSnapshots.some(
      (s) => s.orgId === activeOrgId && s.timestamp.startsWith(today)
    );

    if (!hasTodaySnapshot) {
      await takeSnapshot(scorecardData, true);
    }
  }, [activeOrgId, takeSnapshot]);

  useEffect(() => {
    autoSnapshotDone.current = false;
    let cancelled = false;

    (async () => {
      const [scorecardResult] = await Promise.all([fetchData(), fetchSnapshots()]);
      if (cancelled) return;

      // After both fetches complete, check for auto-snapshot
      if (scorecardResult) {
        // Re-fetch snapshots to get the latest state for the auto-snapshot check
        const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
        try {
          const res = await apiClient.get<{ success: boolean; data: ScorecardSnapshot[] }>(
            `/maturity-trends${query}`
          );
          if (!cancelled) {
            setSnapshots(res.data);
            await maybeAutoSnapshot(scorecardResult, res.data);
          }
        } catch {
          // Continue without auto-snapshot
        }
      }
    })();

    return () => { cancelled = true; };
  }, [fetchData, fetchSnapshots, activeOrgId, maybeAutoSnapshot]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div>
        <PageHeader title="Governance Maturity Scorecard" />
        <div style={{ color: 'var(--color-text-muted)' }}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Governance Maturity Scorecard" />
        <div style={{ color: 'var(--color-error)' }}>Error: {error}</div>
      </div>
    );
  }

  if (!data) return null;

  const lowDimensions = data.dimensions.filter((d) => d.score < 50);

  // Dimension names for sparklines
  const dimensionNames = data.dimensions.map((d) => d.name);

  return (
    <div>
      <PageHeader title="Governance Maturity Scorecard" />

      {/* Overall Score */}
      <Card padding={32} marginBottom={24} style={{ textAlign: 'center' }}>
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
      </Card>

      {/* Dimension Bars */}
      <Card padding={24} marginBottom={24}>
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
      </Card>

      {/* Maturity Over Time */}
      <Card padding={24} marginBottom={24}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Maturity Over Time</h2>
          <button
            onClick={() => takeSnapshot(data)}
            disabled={snapshotLoading}
            style={{
              padding: '6px 16px',
              fontSize: 13,
              fontWeight: 600,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              cursor: snapshotLoading ? 'not-allowed' : 'pointer',
              opacity: snapshotLoading ? 0.6 : 1,
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!snapshotLoading) (e.target as HTMLButtonElement).style.background = 'var(--color-border)';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.background = 'var(--color-surface)';
            }}
          >
            {snapshotLoading ? 'Saving...' : 'Take Snapshot'}
          </button>
        </div>
        <MaturityChart snapshots={snapshots} />
      </Card>

      {/* Dimension Sparklines */}
      {snapshots.length >= 2 && (
        <Card padding={24} marginBottom={24}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Dimension Trends</h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 20,
          }}>
            {dimensionNames.map((name) => (
              <div
                key={name}
                style={{
                  padding: 12,
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <DimensionSparkline
                  snapshots={snapshots}
                  dimensionName={name}
                  color={DIMENSION_COLORS[name] || '#6b7280'}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recommendations */}
      {lowDimensions.length > 0 && (
        <Card padding={24}>
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
        </Card>
      )}
    </div>
  );
}
