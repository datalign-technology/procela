import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import StatusBadge, { type StatusBadgeVariant } from '../components/StatusBadge';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import { errorMessage } from '../lib/errorToast';
import { ExpandedRule, type QualityRule } from './DataQualityPage';

// ──────────────────────────────────────────────────────────────────────────
// DataQualityRuleDetailPage — the full record for one quality rule at
// /data-assets/rules/:id, matching the People detail-page family. A two-column
// body: the readable record (what it checks, latest result, run history) plus
// a Facts rail. Editing the rule's fields still goes through the shared
// ExpandedRule body (view → Edit → Save), mounted in the definition card so
// its Edit / Save cluster portals up next to Back.
// ──────────────────────────────────────────────────────────────────────────

// The detail fetch enriches the base rule with the owning asset's facts and a
// full last-run result (GET /api/v1/data-quality/:id).
interface RuleRun {
  ranAt: string;
  simulated: boolean;
  totalRows: number;
  passCount: number;
  failCount: number;
  passRate: number;
  failureSamples?: string[];
  message?: string;
}
interface RuleDefinition {
  language: 'sql' | 'js' | 'pseudo';
  body: string;
  /** True when the engine could actually run this against the bound source. */
  executable: boolean;
}
interface RuleDetail extends QualityRule {
  definition?: RuleDefinition | null;
  lastRun?: RuleRun | null;
  assetOwnerName?: string | null;
  assetSystemId?: string | null;
  assetSystemName?: string | null;
  assetGovernanceTier?: 'BRONZE' | 'SILVER' | 'GOLD' | null;
  assetHealthScore?: number | null;
}

const RULE_TYPE_LABELS: Record<string, string> = {
  NOT_NULL: 'Not null',
  UNIQUE: 'Unique',
  IN_SET: 'In set (allowed values)',
  NUMERIC_RANGE: 'Numeric range',
  LENGTH_RANGE: 'Length range',
  REGEX_MATCH: 'Regex match (simulated)',
  CUSTOM: 'Custom (simulated)',
};
const MEASURED_RULE_TYPES = new Set(['NOT_NULL', 'UNIQUE', 'IN_SET', 'NUMERIC_RANGE', 'LENGTH_RANGE']);

const SCHEDULE_LABELS: Record<string, string> = {
  NEVER: 'Manual only', HOURLY: 'Hourly', DAILY: 'Daily', WEEKLY: 'Weekly',
};

function statusVariant(status: string): StatusBadgeVariant {
  switch (status) {
    case 'PASSING': return 'success';
    case 'WARNING': return 'warning';
    case 'FAILING': return 'danger';
    default: return 'neutral';
  }
}
function statusLabel(status: string): string {
  return status === 'NOT_MEASURED' ? 'Not measured' : status.charAt(0) + status.slice(1).toLowerCase();
}
function titleCase(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
  display: 'inline-flex', alignItems: 'center',
};
const BACK = '/data-assets?tab=rules';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--color-text)' }}>{children}</div>
    </div>
  );
}
function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--color-text-muted)' }}>{children}</span>;
}

// A pass-rate bar with the rule's threshold marked — so a result reads against
// the bar it had to clear, not just as a number.
function ThresholdBar({ passRate, threshold }: { passRate: number; threshold: number }) {
  const pass = passRate >= threshold;
  const color = pass ? 'var(--color-success)' : 'var(--color-error)';
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return (
    <div>
      {/* The fill is the measured pass rate; the vertical marker is the
          threshold it had to clear — a result reads against its own bar. */}
      <div style={{ position: 'relative', height: 12, borderRadius: 6, background: 'var(--color-border)', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', insetBlock: 0, left: 0, width: `${clamp(passRate)}%`, background: color }} />
        <div title={`Threshold ${threshold}%`} aria-hidden="true" style={{ position: 'absolute', insetBlock: 0, left: `${clamp(threshold)}%`, width: 2, background: 'var(--color-text)', transform: 'translateX(-1px)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
        <span style={{ fontWeight: 600, color }}>{passRate}% pass</span>
        <span>Threshold {threshold}%</span>
      </div>
    </div>
  );
}

export default function DataQualityRuleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canWrite } = usePermissions();
  const { addToast } = useToastStore();
  const [rule, setRule] = useState<RuleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // Header slot the ExpandedRule body portals its Edit / Save·Cancel cluster
  // into, so it sits in the PageHeader next to Back (the People detail layout).
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  const fetchRule = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const res = await apiClient.get<{ success: boolean; data: RuleDetail }>(`/data-quality/${id}`);
      setRule(res.data);
    } catch (err) {
      setError(errorMessage(err, 'Could not load quality rule'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchRule(); }, [fetchRule]);
  useBreadcrumbLeaf(rule?.name);

  const runNow = async () => {
    if (!rule) return;
    setRunning(true);
    try {
      const res = await apiClient.post<{ success: boolean; data: { passRate: number; simulated: boolean } }>(`/data-quality/${rule.id}/run`);
      const r = res.data;
      const verdict = r.passRate >= 95 ? 'success' : r.passRate >= 80 ? 'info' : 'error';
      addToast(verdict as 'success' | 'info' | 'error', `${rule.name}: ${r.passRate}% pass${r.simulated ? ' (simulated)' : ''}`);
      await fetchRule();
    } catch (err) {
      addToast('error', errorMessage(err, 'Failed to run rule'));
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader kicker="Quality rule" title="Loading…" actions={<Link to={BACK} style={backLinkStyle}>{'←'} Back to Data Assets</Link>} />
        <Card><SkeletonRows rows={3} columns={2} /></Card>
      </div>
    );
  }

  if (error || !rule) {
    return (
      <EmptyState
        title="Couldn't load this rule"
        description={error || 'It may have been deleted.'}
        action={{ label: 'Back to Data Assets', onClick: () => navigate(BACK) }}
      />
    );
  }

  const lastRun = rule.lastRun;
  const simulated = !!lastRun?.simulated;
  // Seeded / older rules carry a currentScore + lastMeasured without a full
  // lastRun object. Fall back to those so the result sections stay meaningful
  // instead of claiming the rule was never measured.
  const measuredOnly = !lastRun && !!rule.lastMeasured;
  const lastRunAt = lastRun?.ranAt || rule.lastMeasured || null;
  const ruleTypeLabel = rule.ruleType ? (RULE_TYPE_LABELS[rule.ruleType] || titleCase(rule.ruleType)) : 'None — manual / unmeasured';
  const neverMeasures = !rule.ruleType || !MEASURED_RULE_TYPES.has(rule.ruleType);
  const schedule = rule.scheduleFrequency || 'NEVER';
  const colName = rule.columnName;

  return (
    <div>
      <PageHeader
        kicker="Quality rule"
        title={rule.name}
        copyId={rule.id}
        copyLabel="Copy rule ID"
        subtitle={rule.dataAssetName || rule.dataAssetId}
        meta={
          <>
            <StatusBadge variant={statusVariant(rule.status)}>{statusLabel(rule.status)}</StatusBadge>
            {simulated && <StatusBadge variant="neutral" title="The last result was simulated — it does not count toward measured health.">Simulated</StatusBadge>}
          </>
        }
        actions={
          <>
            <Link to={BACK} style={backLinkStyle}>{'←'} Back to Data Assets</Link>
            {canWrite && (
              <Button variant="secondary" onClick={runNow} disabled={running}>{running ? 'Running…' : 'Run now'}</Button>
            )}
            <span ref={setActionsSlot} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} />
          </>
        }
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        {/* Main column */}
        <div style={{ flex: '999 1 440px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* What this rule checks — the rule-type definition + the editable record. */}
          <Card>
            <SectionLabel>What this rule checks</SectionLabel>
            {rule.definition ? (
              <div style={{ marginTop: 8, marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <StatusBadge variant="neutral">{rule.definition.language.toUpperCase()}</StatusBadge>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {rule.definition.executable ? 'Runs against the bound source' : 'Illustrative — no live driver for this source yet'}
                  </span>
                </div>
                <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-text)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{rule.definition.body}</pre>
              </div>
            ) : (
              <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 8, marginBottom: 14 }}>
                A manual rule — its score is set by hand or by a connector, not by a typed check.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 14 }}>
              <Fact label="Dimension">{titleCase(rule.dimension)}</Fact>
              <Fact label="Check type">{ruleTypeLabel}</Fact>
              <Fact label="Column">{colName ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{colName}</span> : <Muted>Whole asset</Muted>}</Fact>
            </div>
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
              <ExpandedRule rule={rule} canWrite={canWrite} onSaved={fetchRule} actionsSlot={actionsSlot} />
            </div>
          </Card>

          {/* Latest result */}
          <Card>
            <SectionLabel>Latest result</SectionLabel>
            {lastRun ? (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <ThresholdBar passRate={lastRun.passRate} threshold={rule.threshold} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14 }}>
                  <Fact label="Rows checked">{lastRun.totalRows.toLocaleString()}</Fact>
                  <Fact label="Passing">{lastRun.passCount.toLocaleString()}</Fact>
                  <Fact label="Failing">{lastRun.failCount.toLocaleString()}</Fact>
                  <Fact label="Run at">{fmtDate(lastRun.ranAt)}</Fact>
                </div>
                {simulated && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px' }}>
                    This was a <strong>simulated</strong> run — it returns a labelled result but does not count toward the asset's measured health. Measured results come from a CSV upload, a direct-connect database, or an on-prem connector running a typed rule.
                  </div>
                )}
                {lastRun.message && !simulated && <Muted>{lastRun.message}</Muted>}
              </div>
            ) : measuredOnly ? (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <ThresholdBar passRate={rule.currentScore} threshold={rule.threshold} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14 }}>
                  <Fact label="Measured">{fmtDate(rule.lastMeasured)}</Fact>
                </div>
                <Muted>Per-row pass/fail counts aren&rsquo;t retained for this measurement. Use &ldquo;Run now&rdquo; to capture a fresh run.</Muted>
              </div>
            ) : (
              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                Not run yet. {canWrite ? 'Use “Run now” to measure this rule.' : 'No result has been recorded for this rule.'}
              </div>
            )}
          </Card>

          {/* Run history — only the most recent run is retained today. */}
          <Card>
            <SectionLabel>Run history</SectionLabel>
            {lastRun ? (
              <div style={{ marginTop: 10, fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <span>{fmtDate(lastRun.ranAt)}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, color: lastRun.passRate >= rule.threshold ? 'var(--color-success)' : 'var(--color-error)' }}>{lastRun.passRate}%</span>
                    {simulated && <StatusBadge variant="neutral">Simulated</StatusBadge>}
                  </span>
                </div>
                <div style={{ marginTop: 8 }}><Muted>Only the most recent run is retained.</Muted></div>
              </div>
            ) : measuredOnly ? (
              <div style={{ marginTop: 10, fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <span>{fmtDate(rule.lastMeasured)}</span>
                  <span style={{ fontWeight: 600, color: rule.currentScore >= rule.threshold ? 'var(--color-success)' : 'var(--color-error)' }}>{rule.currentScore}%</span>
                </div>
                <div style={{ marginTop: 8 }}><Muted>Only the most recent measurement is retained.</Muted></div>
              </div>
            ) : (
              <div style={{ marginTop: 10, fontSize: 13 }}><Muted>No runs recorded yet.</Muted></div>
            )}
          </Card>
        </div>

        {/* Facts rail */}
        <div style={{ flex: '1 1 260px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <SectionLabel>Facts</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
              <Fact label="Asset">
                <Link to={`/data-assets/${rule.dataAssetId}`} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{rule.dataAssetName || rule.dataAssetId}</Link>
              </Fact>
              <Fact label="Asset owner">{rule.assetOwnerName || <Muted>Unassigned</Muted>}</Fact>
              <Fact label="System">{rule.assetSystemName || <Muted>—</Muted>}</Fact>
              <Fact label="Threshold">{rule.threshold}%</Fact>
              <Fact label="Weight in health">{rule.weight}</Fact>
              <Fact label="Schedule">
                {SCHEDULE_LABELS[schedule] || schedule}
                {schedule !== 'NEVER' && rule.nextRunAt && <Muted> · next {fmtDate(rule.nextRunAt)}</Muted>}
              </Fact>
              <Fact label="Last run">{lastRunAt ? fmtDate(lastRunAt) : <Muted>Never</Muted>}</Fact>
            </div>
          </Card>

          <Card>
            <SectionLabel>If it fails</SectionLabel>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>
              {neverMeasures
                ? <>This rule only ever simulates, so it never moves <strong>{rule.dataAssetName || 'the asset'}</strong>’s measured health — switch it to a measured check type to have it count.</>
                : <>A failing result lowers <strong>{rule.dataAssetName || 'the asset'}</strong>’s measured health (weighted by {rule.weight}) and surfaces the asset on Gap Detection and the dashboard.</>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
