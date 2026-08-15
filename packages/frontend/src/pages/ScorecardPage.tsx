import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionHeading from '../components/SectionHeading';
import Meter from '../components/Meter';
import Spinner from '../components/Spinner';
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

// Each dimension tile deep-links to the catalog page where you'd act on it,
// so the scorecard doubles as a jumping-off point. Keyed by dimension name;
// a dimension with no entry renders as a plain (non-linked) tile.
const DIMENSION_ROUTES: Record<string, string> = {
  'Process Documentation': '/processes',
  'Data Governance': '/data-assets',
  'Domain Coverage': '/data-domains',
  'Governance Structure': '/governance-groups',
  'People Coverage': '/people',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function overallColor(score: number): string {
  if (score >= 70) return 'var(--color-success)';
  if (score >= 40) return 'var(--color-warning)';
  return 'var(--color-error)';
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

  const height = 108;

  if (snapshots.length < 2) {
    return (
      // Match the rendered chart's height so the hero row (and the sibling
      // Overall Maturity card, which stretches to the grid row height) stays
      // the same height whether or not a trend is available — otherwise the
      // card visibly resizes as the org scope changes the snapshot count.
      <div style={{
        minHeight: height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px 24px',
        textAlign: 'center',
        color: 'var(--color-text-muted)',
        fontSize: 13,
      }}>
        Need at least 2 data points to display a trend chart. The scorecard is snapshotted automatically each day you visit this page, or use the "Take Snapshot" button.
      </div>
    );
  }

  const width = 700;
  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 12;
  const paddingBottom = 24;

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
        stroke="var(--color-primary)"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Area fill under the line */}
      <polygon
        points={`${points[0].x},${scaleY(0)} ${polylinePoints} ${points[points.length - 1].x},${scaleY(0)}`}
        fill="var(--color-primary)"
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
          color: delta > 0 ? 'var(--color-success)' : delta < 0 ? 'var(--color-error)' : 'var(--color-text-muted)',
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

// A drill-down wrapper: turns any card into a hyperlink to the page where the
// underlying data lives, with a subtle hover-lift so the whole surface reads
// as actionable. Shared by the Dimension tiles, the Recommendations, and the
// Dimension Trends so all three "drill down to the source" the same way.
function LiftLink({ to, ariaLabel, children }: { to: string; ariaLabel: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      aria-label={ariaLabel}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block', borderRadius: 'var(--radius-md)', transition: 'transform 0.12s ease, box-shadow 0.12s ease' }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
    >
      {children}
    </Link>
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
        <Spinner center label="Loading…" />
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

      {/* Hero — overall score + trend side by side so the headline and the
          trend read together at the top instead of stacking. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) 1fr', gap: 16, marginBottom: 16 }}>
        <Card padding={18} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 6 }}>
            Overall Maturity
          </div>
          <div style={{ fontSize: 52, fontWeight: 800, color: overallColor(data.overall), lineHeight: 1 }}>
            {data.overall}
          </div>
          <div style={{ display: 'inline-block', marginTop: 8, padding: '4px 16px', borderRadius: 999, fontSize: 13, fontWeight: 600, background: overallColor(data.overall), color: '#fff' }}>
            {overallLabel(data.overall)}
          </div>
        </Card>
        <Card padding="12px 20px">
          <SectionHeading
            title="Maturity Over Time"
            marginBottom={8}
            right={
              <button
                onClick={() => takeSnapshot(data)}
                disabled={snapshotLoading}
                style={{
                  padding: '6px 16px', fontSize: 13, fontWeight: 600,
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  background: 'var(--color-surface)', color: 'var(--color-text)',
                  cursor: snapshotLoading ? 'not-allowed' : 'pointer',
                  opacity: snapshotLoading ? 0.6 : 1, transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => { if (!snapshotLoading) (e.target as HTMLButtonElement).style.background = 'var(--color-border)'; }}
                onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.background = 'var(--color-surface)'; }}
              >
                {snapshotLoading ? 'Saving…' : 'Take Snapshot'}
              </button>
            }
          />
          <MaturityChart snapshots={snapshots} />
        </Card>
      </div>

      {/* Recommendations — surfaced above the Dimensions grid so the
          "what to fix" lands before the full breakdown. */}
      {lowDimensions.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <SectionHeading title="Recommendations" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
            {lowDimensions.map((dim) => {
              const route = DIMENSION_ROUTES[dim.name];
              const card = (
                <div
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', height: '100%',
                    background: '#fef3c7', borderLeft: `4px solid ${dim.color}`, borderRadius: 'var(--radius-md)',
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{'⚠'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                      {dim.name} ({dim.score}%)
                    </div>
                    <div style={{ fontSize: 13, color: '#78350f' }}>
                      {RECOMMENDATIONS[dim.name] || 'Improve this dimension to strengthen your governance maturity.'}
                    </div>
                    {route && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginTop: 8 }}>
                        Fix&nbsp;→
                      </div>
                    )}
                  </div>
                </div>
              );
              if (!route) return <div key={dim.name}>{card}</div>;
              return (
                <LiftLink key={dim.name} to={route} ariaLabel={`${dim.name} at ${dim.score}% — open ${route} to fix it.`}>
                  {card}
                </LiftLink>
              );
            })}
          </div>
        </div>
      )}

      {/* Dimensions — one tile per dimension in a grid instead of a tall
          vertical list, so the whole scorecard reads at a glance. */}
      <div style={{ marginBottom: 16 }}>
        <SectionHeading title="Dimensions" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {data.dimensions.map((dim) => {
            const route = DIMENSION_ROUTES[dim.name];
            const tile = (
              <Card padding="14px 16px" style={{ height: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{dim.name}</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: dim.color, fontVariantNumeric: 'tabular-nums' }}>{dim.score}%</span>
                </div>
                <Meter value={dim.score} color={dim.color} height={8} style={{ margin: '8px 0' }} />
                <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {dim.description}
                </div>
              </Card>
            );
            if (!route) return <div key={dim.name}>{tile}</div>;
            return (
              <LiftLink key={dim.name} to={route} ariaLabel={`${dim.name} — ${dim.score}%. Open the related page.`}>
                {tile}
              </LiftLink>
            );
          })}
        </div>
      </div>

      {/* Dimension trend sparklines (once there is history) */}
      {snapshots.length >= 2 && (
        <div>
          <SectionHeading title="Dimension Trends" />
          {/* Same track template as the Dimensions grid above so the two rows
              wrap into identical column counts and each trend card lines up
              under its matching dimension tile. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {dimensionNames.map((name) => {
              const route = DIMENSION_ROUTES[name];
              const card = (
                <Card padding={12} style={{ height: '100%' }}>
                  <DimensionSparkline snapshots={snapshots} dimensionName={name} color={DIMENSION_COLORS[name] || '#6b7280'} />
                </Card>
              );
              if (!route) return <div key={name}>{card}</div>;
              return (
                <LiftLink key={name} to={route} ariaLabel={`${name} trend — open ${route} to analyze what's driving it.`}>
                  {card}
                </LiftLink>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
