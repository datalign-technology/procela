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
import {
  ExpandedTask, type GovernanceTask,
  STATUS_COLORS, PRIORITY_COLORS, MODE_COLORS,
  STATUS_TRANSITIONS,
  prettyLabel, dotPill, fmtDate, relativeDue, daysUntil,
} from './GovernanceTasksPage';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceTaskDetailPage — the full record for one governance task at
// /governance-work/tasks/:id. Leads with the task's state (status / priority /
// type / due pills), a progress tracker + one primary next-step button that
// walks the lifecycle, and a right "Facts" rail (assignee, requester, due,
// priority, linked record, human-vs-AI mode). Overview / Activity tabs carry
// the editable detail, a notes thread, and the audit trail. The shared
// ExpandedTask body still owns view → Edit → Save so the form never drifts.
// ──────────────────────────────────────────────────────────────────────────

interface Person { id: string; name: string; }
interface NamedRef { id: string; name: string; }

const BACK = '/governance-work?tab=tasks';
const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};

// The happy-path lifecycle the progress tracker walks. CANCELLED is a side exit.
const TASK_FLOW = ['OPEN', 'IN_PROGRESS', 'COMPLETED'] as const;

// Human-readable automation mode — "AGENT" reads better as "AI agent".
const MODE_LABEL: Record<string, string> = { HUMAN: 'Human', AGENT: 'AI agent', HYBRID: 'Human + AI' };

// A neutral (non-semantic) pill for the task type — colour is reserved for
// status / priority, so the type stays quiet.
function neutralPill(label: string): React.ReactNode {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
      {label}
    </span>
  );
}

export default function GovernanceTaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const [task, setTask] = useState<GovernanceTask | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [assets, setAssets] = useState<NamedRef[]>([]);
  const [domains, setDomains] = useState<NamedRef[]>([]);
  const [systems, setSystems] = useState<NamedRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'overview' | 'activity'>('overview');
  // Header slot the ExpandedTask body portals its Edit / Save·Cancel cluster
  // into, so it rides in the PageHeader next to Back (the detail-page layout).
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  const fetchTask = useCallback(async () => {
    if (!id) return;
    setError(null);
    const q = activeOrgId ? `?orgId=${activeOrgId}` : '';
    try {
      const [res, pplRes, assetRes, domRes, sysRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GovernanceTask }>(`/governance-tasks/${id}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: NamedRef[] }>(`/data-assets${q}`),
        apiClient.get<{ success: boolean; data: NamedRef[] }>(`/data-domains${q}`),
        apiClient.get<{ success: boolean; data: NamedRef[] }>(`/systems${q}`),
      ]);
      setTask(res.data);
      setPeople(pplRes.data || []);
      setAssets(assetRes.data || []);
      setDomains(domRes.data || []);
      setSystems(sysRes.data || []);
    } catch (err) {
      setError(errorMessage(err, 'Could not load task'));
    } finally {
      setLoading(false);
    }
  }, [id, activeOrgId]);

  useEffect(() => { fetchTask(); }, [fetchTask]);
  useBreadcrumbLeaf(task?.title);

  const handleTransition = async (target: string) => {
    if (!id) return;
    setBusy(true);
    try {
      await apiClient.put(`/governance-tasks/${id}`, { status: target });
      addToast('success', `Task status changed to ${prettyLabel(target)}`);
      await fetchTask();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Failed to update status'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader kicker="Governance task" title="Loading…" actions={<Link to={BACK} style={backLinkStyle}>{'←'} Back to Governance Work</Link>} />
        <Card><SkeletonRows rows={3} columns={2} /></Card>
      </div>
    );
  }

  if (error || !task) {
    return (
      <EmptyState
        title="Couldn't load this task"
        description={error || 'It may have been deleted.'}
        action={{ label: 'Back to Governance Work', onClick: () => navigate(BACK) }}
      />
    );
  }

  // ── Derived facts ──
  const requester = task.createdBy ? (people.find((p) => p.id === task.createdBy)?.name ?? null) : null;
  const linked = resolveLinked(task, assets, domains, systems);
  const dueRel = relativeDue(task.dueDate);
  const overdue = task.dueDate != null && task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && (daysUntil(task.dueDate) ?? 99) < 0;

  const transitions = STATUS_TRANSITIONS[task.status] || [];
  const primary = transitions.find((t) => t.style === 'primary') || transitions.find((t) => t.style === 'secondary');
  const rest = transitions.filter((t) => t !== primary);
  const cancelled = task.status === 'CANCELLED';

  return (
    <div>
      <PageHeader
        kicker="Governance task"
        title={task.title}
        copyId={task.id}
        copyLabel="Copy task ID"
        actions={<>
          <Link to={BACK} style={backLinkStyle}>{'←'} Back to Governance Work</Link>
          <span ref={setActionsSlot} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} />
        </>}
      />

      {/* State pills — status / priority / type / due, surfaced not hidden. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 20 }}>
        {dotPill(STATUS_COLORS[task.status] || STATUS_COLORS.OPEN, prettyLabel(task.status), task.status === 'OPEN')}
        {dotPill(PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.LOW, `${prettyLabel(task.priority)} priority`)}
        {neutralPill(prettyLabel(task.taskType))}
        {task.dueDate && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', background: overdue ? '#fbe4e4' : 'var(--color-surface)', border: `1px solid ${overdue ? '#f0bcbc' : 'var(--color-border)'}`, color: overdue ? '#9a1c1c' : 'var(--color-text-secondary)' }}>
            Due {fmtDate(task.dueDate)}{dueRel ? ` · ${dueRel}` : ''}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <main style={{ flex: '999 1 540px', minWidth: 0 }}>
          {/* Next step + progress tracker. */}
          <Card marginBottom={16}>
            <SectionLabel marginBottom={12}>Progress</SectionLabel>
            {cancelled ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                This task was <strong style={{ color: 'var(--color-text)' }}>cancelled</strong>. Reopen it to put it back in the queue.
              </p>
            ) : (
              <ProgressTracker current={task.status} />
            )}
            {isAdmin && (primary || rest.length > 0) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                {primary && (
                  <Button variant="primary" disabled={busy} onClick={() => handleTransition(primary.target)}>
                    {nextStepLabel(primary.label)}
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
                <ExpandedTask task={task} people={people} orgId={activeOrgId} canEdit={isAdmin} onSaved={fetchTask} actionsSlot={actionsSlot} hideMeta />
              </Card>
              <Card>
                <SectionLabel marginBottom={10}>Notes</SectionLabel>
                <CommentsPanel entityType="governanceTask" entityId={task.id} entityLabel={task.title} />
              </Card>
            </>
          ) : (
            <Card>
              <SectionLabel marginBottom={10}>Activity</SectionLabel>
              <ActivityFeed inline entityType="GovernanceTask" entityId={task.id} />
            </Card>
          )}
        </main>

        {/* Facts rail. */}
        <aside style={{ flex: '1 1 280px', minWidth: 0 }}>
          <Card>
            <SectionLabel marginBottom={12}>Facts</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Fact label="Assignee">
                {task.assigneeName ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Avatar name={task.assigneeName} size="sm" /><span>{task.assigneeName}</span>
                  </span>
                ) : <Muted>Unassigned</Muted>}
              </Fact>
              <Fact label="Raised by">
                {requester ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Avatar name={requester} size="sm" /><span>{requester}</span>
                  </span>
                ) : <Muted>—</Muted>}
              </Fact>
              <Fact label="Due">
                {task.dueDate ? (
                  <span>
                    {fmtDate(task.dueDate)}
                    {dueRel && <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: overdue ? 'var(--color-error)' : 'var(--color-text-muted)' }}>{dueRel}</span>}
                  </span>
                ) : <Muted>No due date</Muted>}
              </Fact>
              <Fact label="Priority">{dotPill(PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.LOW, prettyLabel(task.priority))}</Fact>
              <Fact label="Mode">{dotPill(MODE_COLORS[task.automationMode] || MODE_COLORS.HUMAN, MODE_LABEL[task.automationMode] || prettyLabel(task.automationMode))}</Fact>
              <Fact label="Linked record">
                {linked ? (
                  linked.to ? (
                    <Link to={linked.to} style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'none' }}>{linked.name}</Link>
                  ) : <span>{linked.name}</span>
                ) : <Muted>Nothing linked</Muted>}
                {linked && <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)' }}>{linked.kind}</span>}
              </Fact>
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Fact label="Created">{fmtDate(task.createdAt)}</Fact>
                <Fact label="Updated">{fmtDate(task.updatedAt)}</Fact>
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

// The happy-path stepper: Open → In progress → Completed, current step lit.
function ProgressTracker({ current }: { current: string }) {
  const idx = TASK_FLOW.indexOf(current as typeof TASK_FLOW[number]);
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {TASK_FLOW.map((step, i) => {
        const done = idx >= 0 && i < idx;
        const active = i === idx;
        const colors = STATUS_COLORS[step];
        const dotBg = done ? 'var(--color-success)' : active ? colors.color : 'var(--color-border)';
        return (
          <div key={step} style={{ display: 'flex', alignItems: 'center', flex: i < TASK_FLOW.length - 1 ? 1 : '0 0 auto' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: dotBg, color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {done ? '✓' : i + 1}
              </span>
              <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>{prettyLabel(step)}</span>
            </span>
            {i < TASK_FLOW.length - 1 && (
              <span style={{ flex: 1, height: 2, margin: '0 10px', background: done ? 'var(--color-success)' : 'var(--color-border)' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Linked-record resolution — a real named, clickable link where we can
// resolve the target, instead of the raw object-type string. ──
function resolveLinked(
  task: GovernanceTask,
  assets: NamedRef[],
  domains: NamedRef[],
  systems: NamedRef[],
): { kind: string; name: string; to: string | null } | null {
  if (!task.linkedObjectType || !task.linkedObjectId) return null;
  const type = task.linkedObjectType;
  const key = type.toLowerCase();
  if (key.includes('asset')) {
    const a = assets.find((x) => x.id === task.linkedObjectId);
    return { kind: 'Data asset', name: a?.name || 'Unknown asset', to: a ? `/data-assets/${a.id}` : null };
  }
  if (key.includes('domain')) {
    const d = domains.find((x) => x.id === task.linkedObjectId);
    return { kind: 'Data domain', name: d?.name || 'Unknown domain', to: d ? `/data-domains/${d.id}` : null };
  }
  if (key.includes('system')) {
    const s = systems.find((x) => x.id === task.linkedObjectId);
    return { kind: 'System', name: s?.name || 'Unknown system', to: s ? `/systems/${s.id}` : null };
  }
  // Known-but-unresolved types (CalendarEvent, DamaRole, …): show the kind,
  // not a raw code, and don't invent a link.
  return { kind: prettyLabel(type), name: prettyLabel(type), to: null };
}

// "Start" → "Start task", "Complete" → "Mark complete" — the next step reads
// as a sentence on the big button.
function nextStepLabel(label: string): string {
  if (label === 'Start') return 'Start task';
  if (label === 'Complete') return 'Mark complete';
  if (label === 'Reopen') return 'Reopen task';
  return label;
}
