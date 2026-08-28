import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { useOrgContext } from '@/stores/orgContext';
import { useSetupStore } from '@/stores/setupStore';
import { useToastStore } from '@/stores/toastStore';
import Page from '@/components/Page';
import PageHeader from '@/components/PageHeader';
import Spinner from '@/components/Spinner';

// ──────────────────────────────────────────────────────────────────────────
// SetupHubPage — "Set up Procela". A single four-stage journey from an empty
// org to a running governance program:
//
//   ① Capture  → ② Assign → ③ Govern → ④ Operate
//
// Onboarding the organization (Capture, Assign) and standing up the
// governance program (Govern, Operate) are one spine, not two tracks:
// onboarding IS the first half of standing up governance. The program's
// lifecycle (Planning → Active → Paused → Completed) lives at the top and
// governs the whole arc.
//
// There is deliberately NO overall percentage — a single number that mixes
// "have I added my systems" with "is the program launched" is meaningless and
// oscillates. Each stage carries its own count instead. Every item's status is
// DERIVED from live data (dashboard stats + governance-program status), so the
// page is accurate each time it opens. The one number published back to
// setupStore (for the sidebar ring + auto-hide) is the ONBOARDING portion
// (Capture/Assign/Govern) — the guide is about getting set up; a program keeps
// maturing long after, so "Operate" must not keep the ring from ever filling.
// ──────────────────────────────────────────────────────────────────────────

const COVERAGE_DONE_THRESHOLD = 80;

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

interface ProgPhase { name: string; completed: boolean; progress: number; checks: { done: boolean }[] }
interface ProgStatus {
  currentPhase: 1 | 2 | 3 | 4;
  phases: { phase1: ProgPhase; phase2: ProgPhase; phase3: ProgPhase; phase4: ProgPhase };
  overallProgress: number;
}
interface Prog { id: string; status: 'PLANNING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' }

type Src = 'here' | 'auto';
interface StageItem { label: string; done: boolean; to: string; src: Src }
interface Stage { num: number; name: string; color: string; blurb: string; items: StageItem[] }

// Per-stage accent — Capture blue, Assign purple, Govern green, Operate amber.
// The four flow left→right through the stepper and the board.
const STAGE_COLOR = ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b'];

const LIFECYCLE: Array<{ key: Prog['status']; label: string }> = [
  { key: 'PLANNING', label: 'Planning' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'PAUSED', label: 'Paused' },
  { key: 'COMPLETED', label: 'Completed' },
];
const STATUS_PILL: Record<Prog['status'], { bg: string; fg: string }> = {
  PLANNING: { bg: '#e0edff', fg: '#1d4ed8' },
  ACTIVE: { bg: '#dcfce7', fg: '#15803d' },
  PAUSED: { bg: '#fef3c7', fg: '#b45309' },
  COMPLETED: { bg: '#ede9fe', fg: '#6d28d9' },
};

export default function SetupHubPage() {
  const navigate = useNavigate();
  const { activeOrgId, activeOrgName, orgs, refreshKey } = useOrgContext();
  const { setProgress, setVisibility } = useSetupStore();
  const addToast = useToastStore((s) => s.addToast);
  const hideGuide = () => {
    setVisibility('hidden');
    addToast('info', 'Get Started hidden from the sidebar. Turn it back on in Settings → Get Started guide.');
  };

  const [stats, setStats] = useState<DashStats | null>(null);
  const [prog, setProg] = useState<Prog | null>(null);
  const [status, setStatus] = useState<ProgStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeOrgId) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    Promise.all([
      // Process-side counts reflect only the operational domain, so the canned
      // governance value stream never masquerades as business-process progress.
      apiClient.get<{ success: boolean; data: DashStats }>(`/dashboard/stats?orgId=${activeOrgId}&domain=OPERATIONAL`),
      apiClient.get<{ success: boolean; data: Prog | null }>(`/governance-program?orgId=${activeOrgId}`).catch(() => ({ data: null as Prog | null })),
    ]).then(async ([statsRes, progRes]) => {
      if (!alive) return;
      setStats(statsRes.data);
      const p = progRes.data;
      setProg(p);
      if (p) {
        try {
          const s = await apiClient.get<{ success: boolean; data: ProgStatus }>(`/governance-program/${p.id}/status`);
          if (alive) setStatus(s.data);
        } catch { /* status may not be available yet */ }
      } else if (alive) {
        setStatus(null);
      }
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [activeOrgId, refreshKey]);

  const orgCount = orgs.length;

  const stages: Stage[] = useMemo(() => {
    const s = stats;
    const gt = (n?: number) => (n ?? 0) > 0;
    const ph = status?.phases;

    const capture: StageItem[] = [
      { label: 'Organization', done: orgCount > 0, to: '/organizations', src: 'here' },
      { label: 'People', done: gt(s?.people), to: '/people', src: 'here' },
      { label: 'Processes', done: gt(s?.valueStreams), to: '/processes', src: 'here' },
      { label: 'Systems', done: gt(s?.systems), to: '/systems', src: 'here' },
      { label: 'Data assets', done: gt(s?.dataAssets), to: '/data-assets', src: 'here' },
    ];
    const assign: StageItem[] = [
      { label: 'Process ownership', done: !!s && s.valueStreams > 0 && s.gaps.ownerlessItems === 0, to: '/setup/owners', src: 'auto' },
      { label: 'Domain ownership', done: !!s && s.dataDomains > 0 && s.gaps.ungovernedDomains === 0, to: '/setup/owners', src: 'auto' },
    ];
    const govern: StageItem[] = [
      { label: 'Connect data to processes', done: !!s && s.activities > 0 && s.coverage.percentage >= COVERAGE_DONE_THRESHOLD, to: '/mappings', src: 'here' },
      { label: 'Tier & grade assets', done: !!s && s.dataAssets > 0 && s.gaps.ungovernedAssets === 0, to: '/data-assets', src: 'here' },
      { label: 'Governance foundation', done: !!ph?.phase1.completed, to: '/governance/foundation', src: 'here' },
    ];
    // Operate reads strictly top-to-bottom: "Program launched" is gated
    // behind the structure and roles/policies it depends on, so it never
    // checks ahead of them even when the program's lifecycle is already
    // ACTIVE (the lifecycle badge at the top still shows the true status).
    const structureDone = !!ph?.phase2.completed;
    const rolesPoliciesDone = !!(ph?.phase3.completed && ph?.phase4.completed);
    const launched = prog?.status === 'ACTIVE' || prog?.status === 'COMPLETED';
    const operate: StageItem[] = [
      { label: 'Governance structure', done: structureDone, to: '/governance-groups', src: 'auto' },
      { label: 'Roles & policies', done: rolesPoliciesDone, to: '/governance-program', src: 'auto' },
      { label: 'Program launched', done: launched && structureDone && rolesPoliciesDone, to: '/governance-program', src: 'auto' },
    ];

    return [
      { num: 1, name: 'Capture', color: STAGE_COLOR[0], blurb: 'Tell Procela about your business.', items: capture },
      { num: 2, name: 'Assign', color: STAGE_COLOR[1], blurb: 'Give everything a clear owner.', items: assign },
      { num: 3, name: 'Govern', color: STAGE_COLOR[2], blurb: 'Wrap governance around the data.', items: govern },
      { num: 4, name: 'Operate', color: STAGE_COLOR[3], blurb: 'Run the program day to day.', items: operate },
    ];
  }, [stats, orgCount, prog, status]);

  const counts = useMemo(
    () => stages.map((st) => ({ done: st.items.filter((i) => i.done).length, total: st.items.length })),
    [stages],
  );
  // Current stage = the first that isn't fully done (else the last).
  const currentIdx = useMemo(() => {
    const idx = counts.findIndex((c) => c.done < c.total);
    return idx === -1 ? stages.length - 1 : idx;
  }, [counts, stages.length]);

  // Sidebar ring / auto-hide track the ONBOARDING portion only (stages 1–3).
  useEffect(() => {
    if (!activeOrgId || loading || !stats) return;
    let done = 0, total = 0;
    for (let i = 0; i < 3; i++) { done += counts[i].done; total += counts[i].total; }
    setProgress(activeOrgId, total > 0 ? Math.round((done / total) * 100) : 0);
  }, [activeOrgId, loading, stats, counts, setProgress]);

  if (!activeOrgId) {
    return (
      <Page width="narrow" padding="48px 0">
        <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 8 }}>Set up Procela</h1>
          <p>Select or create an organization from the header to begin.</p>
          <button onClick={() => navigate('/organizations')} style={primaryBtn}>Go to Organizations</button>
        </div>
      </Page>
    );
  }

  const progStatus: Prog['status'] = prog?.status ?? 'PLANNING';
  const pill = STATUS_PILL[progStatus];
  const launchLabel = !prog ? 'Set up program →'
    : progStatus === 'PLANNING' ? 'Launch program →'
    : 'Open program →';

  return (
    <Page padding="8px 0 64px">
      <PageHeader
        title="Set up Procela"
        subtitle={`One journey from an empty org to a running governance program for ${activeOrgName}.`}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" onClick={hideGuide} style={textBtnStyle}
              title="Hide the Get Started guide from the sidebar. Turn it back on any time in Settings.">
              Hide guide
            </button>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 20, background: pill.bg, color: pill.fg }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: pill.fg }} />
              {LIFECYCLE.find((l) => l.key === progStatus)?.label}
            </span>
          </div>
        }
      />

      {loading ? (
        <Spinner center label="Loading your setup status…" />
      ) : (
        <>
          {/* Lifecycle strip — the program status the whole arc drives toward. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {LIFECYCLE.map((l, i) => (
              <span key={l.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600,
                  padding: '5px 12px', borderRadius: 999,
                  border: `1px solid ${l.key === progStatus ? pill.fg : 'var(--color-border)'}`,
                  background: l.key === progStatus ? pill.bg : 'transparent',
                  color: l.key === progStatus ? pill.fg : 'var(--color-text-muted)',
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: l.key === progStatus ? pill.fg : 'var(--color-border)' }} />
                  {l.label}
                </span>
                {i < LIFECYCLE.length - 1 && <span style={{ color: 'var(--color-text-muted)' }}>→</span>}
              </span>
            ))}
            <button onClick={() => navigate('/governance-program')} style={{ ...primaryBtn, marginLeft: 'auto' }}>{launchLabel}</button>
          </div>

          {/* Stepper — the four stages, current highlighted. */}
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 14 }}>
            {stages.map((st, i) => {
              const c = counts[i];
              const isCurrent = i === currentIdx;
              const complete = c.done >= c.total;
              return (
                <div key={st.num} style={{ display: 'flex', alignItems: 'flex-start', flex: i < stages.length - 1 ? 1 : '0 0 auto', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span style={{
                      width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                      background: complete || isCurrent ? st.color : 'var(--color-surface)',
                      color: complete || isCurrent ? '#fff' : 'var(--color-text-muted)',
                      border: complete || isCurrent ? 'none' : '1.5px solid var(--color-border)',
                      display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800,
                    }}>{complete ? '✓' : st.num}</span>
                    <div style={{ minWidth: 0 }}>
                      {isCurrent && <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: st.color }}>You are here</div>}
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: isCurrent || complete ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>{st.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600 }}>{c.done} / {c.total}</div>
                    </div>
                  </div>
                  {i < stages.length - 1 && (
                    <div style={{ flex: 1, height: 2, background: 'var(--color-border)', margin: '15px 12px 0', minWidth: 12 }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Stage line — the single honest summary, no overall %. */}
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            <strong style={{ color: 'var(--color-text)' }}>Stage {currentIdx + 1} of 4 · {stages[currentIdx].name}</strong>
            {' — '}{counts[currentIdx].done} of {counts[currentIdx].total} done. Each stage carries its own count; there’s no overall %.
          </div>

          {/* Board — one column per stage. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {stages.map((st, i) => {
              const c = counts[i];
              return (
                <div key={st.num} style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 14, background: 'var(--color-surface)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: c.done >= c.total ? '#22c55e' : st.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{c.done >= c.total ? '✓' : st.num}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600 }}>{c.done}/{c.total}</span>
                  </div>
                  {/* segmented progress */}
                  <div style={{ display: 'flex', gap: 2, height: 5, marginBottom: 12 }}>
                    {st.items.map((it, k) => (
                      <span key={k} style={{ flex: 1, borderRadius: 2, background: it.done ? '#22c55e' : 'var(--color-border)' }} />
                    ))}
                  </div>
                  {/* checklist */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {st.items.map((it) => (
                      <button
                        key={it.label}
                        type="button"
                        onClick={() => navigate(it.to)}
                        title={it.src === 'here' ? 'You define this here in Procela' : 'Derived automatically from your catalog'}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                          background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit',
                          padding: '5px 2px', fontFamily: 'inherit', borderRadius: 6,
                        }}
                      >
                        <span style={{
                          width: 15, height: 15, flexShrink: 0, borderRadius: 4,
                          border: it.done ? 'none' : '1.5px solid var(--color-border)',
                          background: it.done ? '#22c55e' : 'transparent',
                          color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 800,
                        }}>{it.done ? '✓' : ''}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: it.done ? 'var(--color-text)' : 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                        <span style={{
                          flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase',
                          padding: '1px 5px', borderRadius: 4,
                          background: it.src === 'here' ? 'var(--color-primary-light)' : 'var(--color-bg)',
                          color: it.src === 'here' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                          border: it.src === 'here' ? 'none' : '1px solid var(--color-border)',
                        }}>{it.src === 'here' ? 'Here' : 'Auto'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14, fontSize: 11, color: 'var(--color-text-muted)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '1px 5px', borderRadius: 4, background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>Here</span>
              you define it in Procela
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '1px 5px', borderRadius: 4, background: 'var(--color-bg)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>Auto</span>
              derived from your catalog
            </span>
          </div>
        </>
      )}
    </Page>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '7px 16px', background: 'var(--color-primary)', color: '#fff', border: 'none',
  borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
};
const textBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: '2px 4px',
  color: 'var(--color-primary)', cursor: 'pointer',
  fontSize: 12, fontFamily: 'inherit',
};
