import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader, AlertTriangle, type LucideIcon } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useOrgContext } from '@/stores/orgContext';
import { useSetupStore } from '@/stores/setupStore';
import { useToastStore } from '@/stores/toastStore';
import ProgressRing from '@/components/ProgressRing';
import Page from '@/components/Page';
import PageHeader from '@/components/PageHeader';
import Spinner from '@/components/Spinner';

// ──────────────────────────────────────────────────────────────────────────
// SetupHubPage — "Get Started". A resumable, data-driven journey that walks
// an organization through the three things Procela needs:
//   ① Capture   — org, people, processes, systems, data
//   ② Assign    — ownership & accountability for each
//   ③ Govern    — wrap data governance around it all
//
// Every task's status is DERIVED from live data (dashboard stats + a small
// governance-groups probe), not a checkbox the user ticks — so the hub is
// automatically accurate each time it's opened. The only persisted state is
// the user's "I'm done here" affirmation for the subjective capture steps,
// which lives in setupStore. The computed overall percentage is written back
// to setupStore so the sidebar can show a ring and auto-hide at 100%.
// ──────────────────────────────────────────────────────────────────────────

type TaskStatus = 'todo' | 'started' | 'attention' | 'done';

interface DashStats {
  people: number;
  valueStreams: number;
  processes: number;
  activities: number;
  systems: number;
  dataAssets: number;
  dataDomains: number;
  coverage: { mapped: number; unmapped: number; percentage: number };
  governance: { bronze: number; silver: number; gold: number };
  gaps: {
    unmappedActivities: number;
    ungovernedAssets: number;
    ownerlessItems: number;
    ungovernedDomains: number;
  };
}

interface Task {
  key: string;
  title: string;
  why: string;
  status: TaskStatus;
  detail: string;
  ctaLabel: string;
  to: string;
  secondaryLabel?: string;
  secondaryTo?: string;
  /** Subjective capture steps the user affirms as "done"; objective tasks omit this. */
  affirmable?: boolean;
  /** 0 excludes the task from the progress calculation (informational rows). */
  weight?: number;
}

interface Phase {
  num: number;
  title: string;
  subtitle: string;
  color: string;
  tasks: Task[];
}

const COVERAGE_DONE_THRESHOLD = 80;

const scoreOf = (s: TaskStatus): number => (s === 'done' ? 1 : s === 'started' || s === 'attention' ? 0.5 : 0);

// Lucide icons rather than Unicode glyphs so the visual is consistent
// across OSes (no Wingdings-fallback surprises on Windows, no emoji
// colour-shift on macOS). Todo has no icon — the bare bordered circle
// already reads as "empty / not started".
const STATUS_META: Record<TaskStatus, { Icon: LucideIcon | null; color: string; label: string }> = {
  done: { Icon: Check, color: '#22c55e', label: 'Done' },
  started: { Icon: Loader, color: '#3b82f6', label: 'In progress' },
  attention: { Icon: AlertTriangle, color: '#f59e0b', label: 'Needs attention' },
  todo: { Icon: null, color: 'var(--color-border)', label: 'Not started' },
};

export default function SetupHubPage() {
  const navigate = useNavigate();
  const { activeOrgId, activeOrgName, orgs, refreshKey } = useOrgContext();
  const { setProgress, toggleAffirm, isAffirmed, setVisibility } = useSetupStore();
  const addToast = useToastStore((s) => s.addToast);
  const hideGuide = () => {
    setVisibility('hidden');
    addToast('info', 'Get Started hidden from the sidebar. Turn it back on in Settings → Get Started guide.');
  };
  // Subscribe to the active org's affirmation list so toggling "mark
  // complete" actually re-derives task status. isAffirmed is a stable
  // store-method reference, so depending on it alone never recomputes the
  // phases memo — we key off the data instead.
  const affirmedKeys = useSetupStore((s) => s.affirmedByOrg[activeOrgId]);

  const [stats, setStats] = useState<DashStats | null>(null);
  const [groupsCount, setGroupsCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeOrgId) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    Promise.all([
      // The Get Started journey is about capturing and governing the
      // *business* — so the process-side counts must reflect only the
      // operational domain. Without this, generating the canned governance
      // value stream ("Data Governance Management") would masquerade as
      // business-process progress and inflate coverage/ownership gaps. The
      // governance scaffold is tracked separately by the Phase 3
      // "Governance operating model" task (off governance groups).
      apiClient.get<{ success: boolean; data: DashStats }>(`/dashboard/stats?orgId=${activeOrgId}&domain=OPERATIONAL`),
      apiClient.get<{ success: boolean; data: unknown[] }>(`/governance-groups?orgId=${activeOrgId}`).catch(() => ({ data: [] as unknown[] })),
    ]).then(([statsRes, groupsRes]) => {
      if (!alive) return;
      setStats(statsRes.data);
      setGroupsCount((groupsRes.data || []).length);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [activeOrgId, refreshKey]);

  const orgCount = orgs.length;

  const phases: Phase[] = useMemo(() => {
    const s = stats;
    const captureStatus = (count: number, key: string): TaskStatus =>
      count > 0 ? (isAffirmed(activeOrgId, key) ? 'done' : 'started') : 'todo';

    return [
      {
        num: 1,
        title: 'Capture',
        subtitle: 'Tell Procela about your business — the organization, people, processes, systems, and data.',
        color: '#3b82f6',
        tasks: [
          {
            key: 'org',
            title: 'Organization structure',
            why: 'Everything in Procela is scoped to your org. Add the divisions, departments, and teams that make it up.',
            status: captureStatus(orgCount, 'org'),
            detail: orgCount > 0 ? `${orgCount} org${orgCount === 1 ? '' : 's'}` : 'none yet',
            ctaLabel: orgCount > 1 ? 'Manage structure' : 'Add structure',
            to: '/organizations',
            affirmable: true,
          },
          {
            key: 'people',
            title: 'People',
            why: 'The humans who own and steward everything. Owners and stewards are picked from this list.',
            status: captureStatus(s?.people ?? 0, 'people'),
            detail: s && s.people > 0 ? `${s.people} people` : 'none yet',
            ctaLabel: s && s.people > 0 ? 'Add more' : 'Add people',
            to: '/people?new=1',
            secondaryLabel: 'View all',
            secondaryTo: '/people',
            affirmable: true,
          },
          {
            key: 'processes',
            title: 'Processes',
            why: 'Describe how the business works as Value Stream → Process → Sub-Process → Step. Generate a starter hierarchy by industry.',
            status: captureStatus(s?.valueStreams ?? 0, 'processes'),
            detail: s && s.valueStreams > 0
              ? `${s.valueStreams} value stream${s.valueStreams === 1 ? '' : 's'}, ${s.activities} step${s.activities === 1 ? '' : 's'}`
              : 'none yet',
            ctaLabel: s && s.valueStreams > 0 ? 'Open catalog' : 'Generate hierarchy',
            to: s && s.valueStreams > 0 ? '/processes' : '/processes/wizard',
            secondaryLabel: s && s.valueStreams > 0 ? 'Add more' : 'Build manually',
            secondaryTo: '/processes',
            affirmable: true,
          },
          {
            key: 'systems',
            title: 'Systems',
            why: 'The applications and platforms that hold your data — ERP, CRM, GIS, and the rest.',
            status: captureStatus(s?.systems ?? 0, 'systems'),
            detail: s && s.systems > 0 ? `${s.systems} system${s.systems === 1 ? '' : 's'}` : 'none yet',
            ctaLabel: s && s.systems > 0 ? 'Add more' : 'Add systems',
            to: '/systems?new=1',
            secondaryLabel: 'View all',
            secondaryTo: '/systems',
            affirmable: true,
          },
          {
            key: 'data',
            title: 'Data assets',
            why: 'Define the data your processes rely on, in plain business language.',
            status: captureStatus(s?.dataAssets ?? 0, 'data'),
            detail: s && s.dataAssets > 0 ? `${s.dataAssets} asset${s.dataAssets === 1 ? '' : 's'}` : 'none yet',
            ctaLabel: s && s.dataAssets > 0 ? 'Add more' : 'Add data assets',
            to: '/data-assets?new=1',
            secondaryLabel: 'View all',
            secondaryTo: '/data-assets',
            affirmable: true,
          },
        ],
      },
      {
        num: 2,
        title: 'Assign',
        subtitle: 'Give every process, system, domain, and data asset a clear owner and steward.',
        color: '#8b5cf6',
        tasks: [
          {
            key: 'ownerless-processes',
            title: 'Process ownership',
            why: 'Value streams and processes with no owner have no one accountable for them.',
            status: !s || s.valueStreams === 0 ? 'todo' : s.gaps.ownerlessItems === 0 ? 'done' : 'attention',
            detail: !s || s.valueStreams === 0 ? 'add processes first'
              : s.gaps.ownerlessItems === 0 ? 'all assigned'
              : `${s.gaps.ownerlessItems} need an owner`,
            ctaLabel: 'Review & assign',
            to: '/setup/owners',
          },
          {
            key: 'unowned-domains',
            title: 'Data domain ownership',
            why: 'Data domains group related assets under a single accountable owner.',
            // Match the "Process ownership" pattern above: the step
            // is 'todo' until at least one domain exists. Without
            // this guard, an empty org has zero unowned domains and
            // the step misleadingly flips to 'done'.
            status: !s || s.dataDomains === 0 ? 'todo'
              : s.gaps.ungovernedDomains === 0 ? 'done' : 'attention',
            detail: !s ? '—'
              : s.dataDomains === 0 ? 'no domains defined yet'
              : s.gaps.ungovernedDomains === 0 ? 'all assigned'
              : `${s.gaps.ungovernedDomains} unowned`,
            ctaLabel: 'Review & assign',
            to: '/setup/owners',
            secondaryLabel: 'Manage domains',
            secondaryTo: '/data-domains',
          },
        ],
      },
      {
        num: 3,
        title: 'Govern',
        subtitle: 'Wrap data governance around it — connect data to processes, tier and grade assets, and stand up your operating model.',
        color: '#22c55e',
        tasks: [
          {
            key: 'coverage',
            title: 'Connect data to processes',
            why: 'Link data assets to the process steps they support so dependencies are visible and governable.',
            status: !s || s.activities === 0 ? 'todo' : s.coverage.percentage >= COVERAGE_DONE_THRESHOLD ? 'done' : 'attention',
            detail: !s || s.activities === 0 ? 'add processes first' : `${s.coverage.percentage}% of steps covered`,
            ctaLabel: 'Map data',
            to: '/mappings',
          },
          {
            key: 'ungoverned-assets',
            title: 'Tier & grade assets',
            why: 'Assets on live processes that are still Bronze-tier are ungoverned risk. Promote them to Silver or Gold.',
            status: !s || s.dataAssets === 0 ? 'todo' : s.gaps.ungovernedAssets === 0 ? 'done' : 'attention',
            detail: !s || s.dataAssets === 0 ? 'add data assets first'
              : s.gaps.ungovernedAssets === 0 ? 'all governed'
              : `${s.gaps.ungovernedAssets} ungoverned on live processes`,
            ctaLabel: 'Review assets',
            to: '/data-assets',
          },
          {
            key: 'governance-model',
            title: 'Governance operating model',
            why: 'Stand up the program: governance groups, DAMA roles, decision rights, and policies.',
            status: groupsCount > 0 ? (isAffirmed(activeOrgId, 'governance-model') ? 'done' : 'started') : 'todo',
            detail: groupsCount > 0 ? `${groupsCount} group${groupsCount === 1 ? '' : 's'} defined` : 'not defined',
            ctaLabel: groupsCount > 0 ? 'Open program' : 'Define program',
            to: '/governance-program',
            secondaryLabel: 'Governance groups',
            secondaryTo: '/governance-groups',
            affirmable: true,
          },
          {
            key: 'gaps-review',
            title: 'Review remaining gaps',
            why: 'See every unmapped step, ownerless item, and ungoverned asset in one place.',
            status: !s ? 'todo'
              : (s.gaps.unmappedActivities + s.gaps.ownerlessItems + s.gaps.ungovernedAssets + s.gaps.ungovernedDomains) === 0 ? 'done' : 'attention',
            detail: 'open the gap report',
            ctaLabel: 'Gap detection',
            to: '/gap-detection',
            weight: 0,
          },
        ],
      },
    ];
  }, [stats, groupsCount, orgCount, activeOrgId, isAffirmed, affirmedKeys]);

  // Overall + per-phase progress from the counted tasks.
  const { overall, phaseProgress } = useMemo(() => {
    let total = 0;
    let score = 0;
    const perPhase: Record<number, number> = {};
    for (const ph of phases) {
      let pT = 0;
      let pS = 0;
      for (const t of ph.tasks) {
        const w = t.weight ?? 1;
        if (w === 0) continue;
        total += 1; score += scoreOf(t.status);
        pT += 1; pS += scoreOf(t.status);
      }
      perPhase[ph.num] = pT > 0 ? Math.round((pS / pT) * 100) : 0;
    }
    return { overall: total > 0 ? Math.round((score / total) * 100) : 0, phaseProgress: perPhase };
  }, [phases]);

  // Publish progress for the sidebar ring / auto-hide. Only meaningful once
  // stats have loaded for a real org.
  useEffect(() => {
    if (activeOrgId && !loading && stats) setProgress(activeOrgId, overall);
  }, [activeOrgId, loading, stats, overall, setProgress]);

  // Expand/collapse. Smart default — done items collapse, everything else
  // stays open — is derived from status; an explicit user toggle is recorded
  // as an override that wins over the default for that one phase/task.
  const [phaseOverride, setPhaseOverride] = useState<Record<number, boolean>>({});
  const [taskOverride, setTaskOverride] = useState<Record<string, boolean>>({});
  // Default everything closed. The previous behaviour ("open every
  // phase / task that has incomplete work") meant a brand-new org
  // landed on a dense wall of expanded content with no overview;
  // this anchors the page on a clean three-row summary and lets the
  // operator open whatever they want. Expand-all / Collapse-all
  // controls in the header give one-click access to the older
  // see-everything behaviour.
  const isPhaseOpen = (ph: Phase) => phaseOverride[ph.num] ?? false;
  const isTaskOpen = (t: Task) => taskOverride[t.key] ?? false;
  const togglePhase = (ph: Phase) => setPhaseOverride((m) => ({ ...m, [ph.num]: !isPhaseOpen(ph) }));
  const toggleTask = (t: Task) => setTaskOverride((m) => ({ ...m, [t.key]: !isTaskOpen(t) }));

  const expandAll = () => {
    const ph: Record<number, boolean> = {};
    const tk: Record<string, boolean> = {};
    for (const p of phases) {
      ph[p.num] = true;
      for (const t of p.tasks) tk[t.key] = true;
    }
    setPhaseOverride(ph);
    setTaskOverride(tk);
  };
  const collapseAll = () => {
    // Clearing the overrides reverts to the closed defaults — same
    // end state as setting every key to false, with less state to
    // carry.
    setPhaseOverride({});
    setTaskOverride({});
  };

  if (!activeOrgId) {
    return (
      <Page width="narrow" padding="48px 0">
        <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 8 }}>Get Started</h1>
          <p>Select or create an organization from the header to begin setting up Procela.</p>
          <button onClick={() => navigate('/organizations')} style={primaryBtn}>Go to Organizations</button>
        </div>
      </Page>
    );
  }

  return (
    <Page padding="8px 0 64px">
      {/* Was a custom card with a bordered container + h1 (20px) +
          ProgressRing on the left. Now uses the shared PageHeader
          so the title lands at the same 26px every other page uses;
          the ProgressRing slots into the right-aligned actions area
          where the progress is still glanceable but stops looking
          like a competing hero panel. */}
      <PageHeader
        title="Get Started with Procela"
        subtitle={overall === 100
          ? `${activeOrgName} is fully set up. Revisit any step below to keep it current.`
          : `Set up ${activeOrgName} in three phases — capture your business, assign ownership, then wrap governance around it.`}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={hideGuide}
              style={textBtnStyle}
              title="Hide the Get Started guide from the sidebar. You can turn it back on any time in Settings."
            >
              Hide guide
            </button>
            <ProgressRing percent={overall} size={56} stroke={6} showLabel />
          </div>
        }
      />


      {/* Expand-all / Collapse-all row. Matches the pattern used on
          Decision Rights, RACI Matrix, and Governance Groups —
          small text-style buttons aligned to the right above the
          accordion list. The default state is collapsed; this gives
          one-click access to the see-everything view when an
          operator wants the dense layout. */}
      {!loading && (
        <div style={{
          display: 'flex', justifyContent: 'flex-start', gap: 4,
          alignItems: 'center', fontSize: 12, marginBottom: 12,
        }}>
          <button type="button" onClick={expandAll} style={textBtnStyle}>Expand all</button>
          <span style={{ color: 'var(--color-border)' }}>·</span>
          <button type="button" onClick={collapseAll} style={textBtnStyle}>Collapse all</button>
        </div>
      )}

      {loading ? (
        <Spinner center label="Loading your setup status…" />
      ) : (
        phases.map((ph) => {
          const phaseOpen = isPhaseOpen(ph);
          return (
          <section key={ph.num} style={{ marginBottom: 20 }}>
            {/* Phase header — clickable accordion toggle for the whole phase. */}
            <button
              type="button"
              onClick={() => togglePhase(ph)}
              aria-expanded={phaseOpen}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit',
                padding: '4px 2px', marginBottom: phaseOpen ? 12 : 0, fontFamily: 'inherit',
              }}
            >
              <span style={{
                width: 28, height: 28, borderRadius: '50%', background: ph.color, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0,
              }}>{ph.num}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700 }}>{ph.title}</h2>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{phaseProgress[ph.num]}%</span>
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.45 }}>{ph.subtitle}</p>
              </div>
              <Chevron open={phaseOpen} />
            </button>

            {phaseOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ph.tasks.map((t) => {
                const meta = STATUS_META[t.status];
                const taskOpen = isTaskOpen(t);
                return (
                  <div key={t.key} style={{
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden',
                  }}>
                    {/* Task header — clickable summary row that toggles detail. */}
                    <button
                      type="button"
                      onClick={() => toggleTask(t)}
                      aria-expanded={taskOpen}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
                        padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer',
                        color: 'inherit', fontFamily: 'inherit',
                      }}
                    >
                      <span aria-label={meta.label} title={meta.label} style={{
                        width: 22, height: 22, flexShrink: 0, borderRadius: '50%',
                        border: t.status === 'todo' ? `2px solid ${meta.color}` : 'none',
                        background: t.status === 'todo' ? 'transparent' : meta.color,
                        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{meta.Icon && <meta.Icon size={14} strokeWidth={3} />}</span>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{t.title}</span>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 999,
                          background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)',
                        }}>{t.detail}</span>
                      </div>
                      <Chevron open={taskOpen} />
                    </button>

                    {/* Task body — description, affirmation, and actions. */}
                    {taskOpen && (
                      <div style={{ padding: '0 16px 14px 52px' }}>
                        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{t.why}</p>

                        {t.affirmable && t.status === 'started' && (
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={false} onChange={() => toggleAffirm(activeOrgId, t.key)} style={{ cursor: 'pointer' }} />
                            Mark this step complete
                          </label>
                        )}
                        {t.affirmable && t.status === 'done' && (
                          <button onClick={() => toggleAffirm(activeOrgId, t.key)}
                            style={{ display: 'block', marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                            Reopen this step
                          </button>
                        )}

                        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                          <button onClick={() => navigate(t.to)} style={primaryBtn}>{t.ctaLabel}</button>
                          {t.secondaryLabel && t.secondaryTo && (
                            <button onClick={() => navigate(t.secondaryTo!)} style={secondaryBtn}>{t.secondaryLabel}</button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </section>
          );
        })
      )}
    </Page>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
      style={{ flexShrink: 0, opacity: 0.55, transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none' }}
    >
      <path d="M9 5 L15 12 L9 19" />
    </svg>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '7px 16px', background: 'var(--color-primary)', color: '#fff', border: 'none',
  borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
};
const secondaryBtn: React.CSSProperties = {
  padding: '6px 16px', background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
};
// Small text-style button used by the Expand all / Collapse all
// controls in the page header. Matches the same style on Decision
// Rights and RACI Matrix so the affordance reads identically across
// the app.
const textBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: '2px 4px',
  color: 'var(--color-primary)', cursor: 'pointer',
  fontSize: 12, fontFamily: 'inherit',
};
