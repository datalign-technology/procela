import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import Avatar from '../components/Avatar';
import Button from '../components/Button';
import SecondaryButton from '../components/SecondaryButton';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { usePermissions } from '../hooks/usePermissions';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import { errorMessage } from '../lib/errorToast';
import ActivityFeed from '../components/ActivityFeed';
import CommentsPanel from '../components/CommentsPanel';
import { fmtDate } from './GovernanceTasksPage';
import {
  ExpandedIssue, type GovernanceIssue,
  STATUS_COLORS, SEVERITY_COLORS, ISSUE_STATUS_TRANSITIONS,
  prettyLabel, dotPill,
} from './GovernanceIssuesPage';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceIssueDetailPage — the full record for one governance issue at
// /governance-work/issues/:id. Leads with severity + status pills and a
// progress tracker + primary next-step button that walks the lifecycle, a
// "What this affects" panel that links the real asset / system / domain, a
// "Follow-up tasks" panel that flags when nothing tracks the fix (with a
// one-click Create), a resolution summary when closed, and a Facts rail
// (assignee, reporter, severity, age). Overview / Activity tabs carry the
// editable detail, a notes thread, and the audit trail.
// ──────────────────────────────────────────────────────────────────────────

interface Person { id: string; name: string; }
interface NamedRef { id: string; name: string; }
interface LinkedTask { id: string; title: string; status: string; linkedObjectType: string | null; linkedObjectId: string | null; }

const BACK = '/governance-work?tab=issues';
const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};

// The happy-path lifecycle the progress tracker walks. WONT_FIX is a side exit.
const ISSUE_FLOW = ['OPEN', 'INVESTIGATING', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
const TERMINAL = new Set(['RESOLVED', 'CLOSED', 'WONT_FIX']);

function neutralPill(label: string): React.ReactNode {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
      {label}
    </span>
  );
}

// "Opened Oct 13 · 5 days ago" — plain-words age, which the page never showed.
function ageLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Opened today';
  if (days === 1) return 'Opened yesterday';
  return `Opened ${days} days ago`;
}

export default function GovernanceIssueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const [issue, setIssue] = useState<GovernanceIssue | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [domains, setDomains] = useState<NamedRef[]>([]);
  const [systems, setSystems] = useState<NamedRef[]>([]);
  const [tasks, setTasks] = useState<LinkedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'overview' | 'activity'>('overview');
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  const fetchIssue = useCallback(async () => {
    if (!id) return;
    setError(null);
    const q = activeOrgId ? `?orgId=${activeOrgId}` : '';
    try {
      const [res, pplRes, domRes, sysRes, taskRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GovernanceIssue }>(`/governance-issues/${id}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: NamedRef[] }>(`/data-domains${q}`).catch(() => ({ success: true, data: [] as NamedRef[] })),
        apiClient.get<{ success: boolean; data: NamedRef[] }>(`/systems${q}`).catch(() => ({ success: true, data: [] as NamedRef[] })),
        apiClient.get<{ success: boolean; data: LinkedTask[] }>(`/governance-tasks${q}`).catch(() => ({ success: true, data: [] as LinkedTask[] })),
      ]);
      setIssue(res.data);
      setPeople(pplRes.data || []);
      setDomains(domRes.data || []);
      setSystems(sysRes.data || []);
      setTasks(taskRes.data || []);
    } catch (err) {
      setError(errorMessage(err, 'Could not load issue'));
    } finally {
      setLoading(false);
    }
  }, [id, activeOrgId]);

  useEffect(() => { fetchIssue(); }, [fetchIssue]);
  useBreadcrumbLeaf(issue?.title);

  const handleTransition = async (target: string) => {
    if (!id) return;
    setBusy(true);
    try {
      await apiClient.put(`/governance-issues/${id}`, { status: target });
      addToast('success', `Issue status changed to ${prettyLabel(target)}`);
      await fetchIssue();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Failed to update status'));
    } finally {
      setBusy(false);
    }
  };

  // Create a remediation task already linked back to this issue, so the fix is
  // tracked — the follow-up the board flags as missing.
  const createFollowUp = async () => {
    if (!issue) return;
    setBusy(true);
    try {
      const priority = issue.severity === 'CRITICAL' ? 'CRITICAL' : issue.severity === 'HIGH' ? 'HIGH' : 'MEDIUM';
      const res = await apiClient.post<{ success: boolean; data: { id: string } }>('/governance-tasks', {
        title: `Resolve: ${issue.title}`,
        description: `Follow-up to governance issue "${issue.title}".`,
        taskType: 'REMEDIATION', priority, status: 'OPEN',
        assigneeId: issue.assignedTo || null, dueDate: null, automationMode: 'HUMAN',
        linkedObjectType: 'GovernanceIssue', linkedObjectId: issue.id,
        ...(activeOrgId ? { orgId: activeOrgId } : {}),
      });
      addToast('success', 'Follow-up task created');
      navigate(`/governance-work/tasks/${res.data.id}`);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Failed to create task'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader kicker="Governance issue" title="Loading…" actions={<Link to={BACK} style={backLinkStyle}>{'←'} Back to Governance Work</Link>} />
        <Card><SkeletonRows rows={3} columns={2} /></Card>
      </div>
    );
  }

  if (error || !issue) {
    return (
      <EmptyState
        title="Couldn't load this issue"
        description={error || 'It may have been deleted.'}
        action={{ label: 'Back to Governance Work', onClick: () => navigate(BACK) }}
      />
    );
  }

  // ── Derived facts ──
  const systemName = issue.systemId ? (systems.find((s) => s.id === issue.systemId)?.name ?? null) : null;
  const affects: { kind: string; name: string; to: string }[] = [];
  if (issue.dataAssetName && issue.dataAssetId) affects.push({ kind: 'Data asset', name: issue.dataAssetName, to: `/data-assets/${issue.dataAssetId}` });
  if (systemName && issue.systemId) affects.push({ kind: 'System', name: systemName, to: `/systems/${issue.systemId}` });
  if (issue.domainName && issue.domainId) affects.push({ kind: 'Data domain', name: issue.domainName, to: `/data-domains/${issue.domainId}` });

  const followUps = tasks.filter((t) => (t.linkedObjectType || '').toLowerCase().includes('issue') && t.linkedObjectId === issue.id);
  const isClosed = TERMINAL.has(issue.status);

  const transitions = ISSUE_STATUS_TRANSITIONS[issue.status] || [];
  const primary = transitions.find((t) => t.style === 'primary') || transitions.find((t) => t.style === 'secondary');
  const rest = transitions.filter((t) => t !== primary);
  const wontFix = issue.status === 'WONT_FIX';

  return (
    <div>
      <PageHeader
        kicker="Governance issue"
        title={issue.title}
        copyId={issue.id}
        copyLabel="Copy issue ID"
        actions={<>
          <Link to={BACK} style={backLinkStyle}>{'←'} Back to Governance Work</Link>
          <span ref={setActionsSlot} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} />
        </>}
      />

      {/* State pills — severity / status / type, surfaced not hidden. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 20 }}>
        {dotPill(SEVERITY_COLORS[issue.severity] || SEVERITY_COLORS.LOW, `${prettyLabel(issue.severity)} severity`)}
        {dotPill(STATUS_COLORS[issue.status] || STATUS_COLORS.OPEN, prettyLabel(issue.status), issue.status === 'OPEN')}
        {neutralPill(prettyLabel(issue.issueType))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <main style={{ flex: '999 1 540px', minWidth: 0 }}>
          {/* Next step + progress tracker. */}
          <Card marginBottom={16}>
            <SectionLabel marginBottom={12}>Progress</SectionLabel>
            {wontFix ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                This issue was marked <strong style={{ color: 'var(--color-text)' }}>won't fix</strong>. Reopen it if it needs to be revisited.
              </p>
            ) : (
              <ProgressTracker current={issue.status} />
            )}
            {isAdmin && (primary || rest.length > 0) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                {primary && (
                  <Button variant="primary" disabled={busy} onClick={() => handleTransition(primary.target)}>
                    {primary.label}
                  </Button>
                )}
                {rest.map((tr) => (
                  <SecondaryButton key={tr.target} disabled={busy} onClick={() => handleTransition(tr.target)}>
                    {tr.label}
                  </SecondaryButton>
                ))}
              </div>
            )}
          </Card>

          {/* Resolution summary — the audit trail for a closed issue. */}
          {isClosed && (
            <Card marginBottom={16} style={{ borderColor: 'var(--color-success)' }}>
              <SectionLabel marginBottom={6}>Resolution</SectionLabel>
              <p style={{ margin: 0, fontSize: 13, color: issue.resolutionSummary ? 'var(--color-text)' : 'var(--color-text-muted)', fontStyle: issue.resolutionSummary ? undefined : 'italic', whiteSpace: 'pre-wrap' }}>
                {issue.resolutionSummary || 'No resolution summary was recorded.'}
              </p>
              {issue.closedAt && <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>Closed {fmtDate(issue.closedAt)}</p>}
            </Card>
          )}

          {/* Overview / Activity tabs. */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
            {(['overview', 'activity'] as const).map((t) => (
              <button
                key={t} type="button" onClick={() => setTab(t)}
                style={{
                  font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'none',
                  border: 'none', padding: '8px 12px', textTransform: 'capitalize',
                  color: tab === t ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  borderBottom: `2px solid ${tab === t ? 'var(--color-primary)' : 'transparent'}`,
                  marginBottom: -1,
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'overview' ? (
            <>
              <Card marginBottom={16}>
                <ExpandedIssue issue={issue} people={people} domains={domains as { id: string; name: string }[]} orgId={activeOrgId} canEdit={isAdmin} onSaved={fetchIssue} actionsSlot={actionsSlot} hideMeta />
              </Card>

              {/* What this affects — real links to the governed records. */}
              <Card marginBottom={16}>
                <SectionLabel marginBottom={10}>What this affects</SectionLabel>
                {affects.length === 0 ? (
                  <Muted>Not linked to a specific asset, system, or domain.</Muted>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {affects.map((a) => (
                      <div key={a.to} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                        <span style={{ flex: '0 0 92px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>{a.kind}</span>
                        <Link to={a.to} style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}>{a.name}</Link>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Follow-up tasks — flag when nothing tracks the fix. */}
              <Card marginBottom={16}>
                <SectionLabel marginBottom={10}>Follow-up tasks</SectionLabel>
                {followUps.length === 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>No task tracks this fix yet.</span>
                    {isAdmin && !isClosed && <Button variant="primary" size="sm" disabled={busy} onClick={createFollowUp}>Create follow-up task</Button>}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {followUps.map((t) => (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {dotPill(STATUS_COLORS[t.status] || STATUS_COLORS.OPEN, prettyLabel(t.status), t.status === 'OPEN')}
                        <Link to={`/governance-work/tasks/${t.id}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}>{t.title}</Link>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <SectionLabel marginBottom={10}>Notes</SectionLabel>
                <CommentsPanel entityType="governanceIssue" entityId={issue.id} entityLabel={issue.title} />
              </Card>
            </>
          ) : (
            <Card>
              <SectionLabel marginBottom={10}>Activity</SectionLabel>
              <ActivityFeed inline entityType="GovernanceIssue" entityId={issue.id} />
            </Card>
          )}
        </main>

        {/* Facts rail. */}
        <aside style={{ flex: '1 1 280px', minWidth: 0 }}>
          <Card>
            <SectionLabel marginBottom={12}>Facts</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Fact label="Assignee">
                {issue.assigneeName ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Avatar name={issue.assigneeName} size="sm" /><span>{issue.assigneeName}</span>
                  </span>
                ) : <Muted>Unassigned</Muted>}
              </Fact>
              <Fact label="Reported by">
                {issue.reporterName ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Avatar name={issue.reporterName} size="sm" /><span>{issue.reporterName}</span>
                  </span>
                ) : <Muted>—</Muted>}
              </Fact>
              <Fact label="Severity">{dotPill(SEVERITY_COLORS[issue.severity] || SEVERITY_COLORS.LOW, prettyLabel(issue.severity))}</Fact>
              <Fact label="Status">{dotPill(STATUS_COLORS[issue.status] || STATUS_COLORS.OPEN, prettyLabel(issue.status), issue.status === 'OPEN')}</Fact>
              <Fact label="Age">{fmtDate(issue.createdAt)}<span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)' }}>{ageLabel(issue.createdAt)}</span></Fact>
              <Fact label="Domain">
                {issue.domainName && issue.domainId ? (
                  <Link to={`/data-domains/${issue.domainId}`} style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'none' }}>{issue.domainName}</Link>
                ) : <Muted>—</Muted>}
              </Fact>
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Fact label="Created">{fmtDate(issue.createdAt)}</Fact>
                <Fact label="Updated">{fmtDate(issue.updatedAt)}</Fact>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

// ── Pieces ──

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--color-text)' }}>{children}</div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{children}</span>;
}

// Open → Investigating → In progress → Resolved → Closed, current step lit.
function ProgressTracker({ current }: { current: string }) {
  const idx = ISSUE_FLOW.indexOf(current as typeof ISSUE_FLOW[number]);
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {ISSUE_FLOW.map((step, i) => {
        const done = idx >= 0 && i < idx;
        const active = i === idx;
        const colors = STATUS_COLORS[step];
        const dotBg = done ? 'var(--color-success)' : active ? colors.color : 'var(--color-border)';
        return (
          <div key={step} style={{ display: 'flex', alignItems: 'center', flex: i < ISSUE_FLOW.length - 1 ? 1 : '0 0 auto', minWidth: 0 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', background: dotBg, color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {done ? '✓' : i + 1}
              </span>
              <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: active ? 'var(--color-text)' : 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{prettyLabel(step)}</span>
            </span>
            {i < ISSUE_FLOW.length - 1 && (
              <span style={{ flex: 1, height: 2, margin: '0 8px', minWidth: 8, background: done ? 'var(--color-success)' : 'var(--color-border)' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
