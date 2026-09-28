import { useState } from 'react';
import { apiClient } from '@/api/client';
import { useToastStore } from '@/stores/toastStore';
import ConfirmDialog from '@/components/ConfirmDialog';

// ──────────────────────────────────────────────────────────────────────────
// ProgramLifecycleBar — the governed lifecycle control surface for a
// governance program (Planning → Active → Paused → Completed).
//
// Extracted from the Get Started hub so the program's *steady-state* controls
// (launch / pause / resume / reopen) have a home that isn't labelled
// "onboarding": they now live on Governance → Foundation, next to the
// foundation artifacts a launch depends on. Get Started keeps a read-only
// status strip and links here.
//
// The backend (PUT /governance-program/:id) is authoritative — it enforces
// role, valid transitions, the Phase-1 hard prerequisite, and the early-launch
// soft gate. This component only decides which buttons to show and surfaces
// what the backend rejects. The Phase-1 gate is passed in as `phase1Complete`
// (the host page already computes it), so the bar makes no extra network call
// just to disable the Launch button.
// ──────────────────────────────────────────────────────────────────────────

export type ProgramStatus = 'PLANNING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
export interface LifecycleProgram { id: string; status: ProgramStatus; launchedAt?: string | null }

// Client mirror of the backend lifecycle state machine — the backend is
// authoritative; this only decides which transition buttons to show.
// "Complete program" is intentionally NOT offered: data governance is a
// continuous discipline, not a project that finishes — ACTIVE ⇄ PAUSED models
// the real lifecycle. COMPLETED remains a valid backend state (and can still be
// reopened here) only so any program a prior version marked complete isn't
// stranded.
const VALID_TRANSITIONS: Record<ProgramStatus, ProgramStatus[]> = {
  PLANNING: ['ACTIVE'],
  ACTIVE: ['PAUSED'],
  PAUSED: ['ACTIVE'],
  COMPLETED: ['ACTIVE'],
};
const STATUS_ACTION_LABEL: Record<string, string> = {
  'PLANNING>ACTIVE': 'Launch program',
  'PAUSED>ACTIVE': 'Resume program',
  'COMPLETED>ACTIVE': 'Reopen program',
  'ACTIVE>PAUSED': 'Pause program',
};
export const LIFECYCLE: Array<{ key: ProgramStatus; label: string }> = [
  { key: 'PLANNING', label: 'Planning' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'PAUSED', label: 'Paused' },
  { key: 'COMPLETED', label: 'Completed' },
];
export const STATUS_PILL: Record<ProgramStatus, { bg: string; fg: string }> = {
  PLANNING: { bg: '#e0edff', fg: '#1d4ed8' },
  ACTIVE: { bg: '#dcfce7', fg: '#15803d' },
  PAUSED: { bg: '#fef3c7', fg: '#b45309' },
  COMPLETED: { bg: '#ede9fe', fg: '#6d28d9' },
};

export function programStatusLabel(status: ProgramStatus): string {
  return LIFECYCLE.find((l) => l.key === status)?.label ?? status;
}

interface IncompletePhase { phase: number; name: string; missing: string[] }

const primaryBtn: React.CSSProperties = {
  padding: '7px 16px', background: 'var(--color-primary)', color: '#fff', border: 'none',
  borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
};

export default function ProgramLifecycleBar({
  program,
  activeOrgId,
  isAdmin,
  phase1Complete,
  onChanged,
}: {
  program: LifecycleProgram;
  activeOrgId: string | null;
  isAdmin: boolean;
  /** Whether the program's Foundation (Phase 1) is complete — the hard
   *  prerequisite the backend enforces for going ACTIVE. Used only to
   *  pre-disable the Launch button; the backend still rejects a bad launch. */
  phase1Complete: boolean;
  /** Called with the updated program after a successful transition, so the
   *  host page can refresh anything derived from program status. */
  onChanged?: (updated: LifecycleProgram) => void;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const [statusTarget, setStatusTarget] = useState<ProgramStatus | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [earlyLaunchInfo, setEarlyLaunchInfo] = useState<IncompletePhase[] | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const progStatus = program.status;
  const pill = STATUS_PILL[progStatus];
  const launchedLabel = program.launchedAt
    ? new Date(program.launchedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  // Governed status change. The backend enforces role, valid transitions, the
  // Phase-1 hard prerequisite, and the early-launch soft gate:
  //   400 blockingPhase   → hard-blocked, show what's missing
  //   409 requiresConfirm → open the early-launch confirm, retry with force
  const changeStatus = async (to: ProgramStatus, opts: { force?: boolean; reason?: string } = {}) => {
    setStatusBusy(true);
    try {
      const res = await apiClient.put<{ success: boolean; data: LifecycleProgram }>(
        `/governance-program/${program.id}`,
        { status: to, ...(opts.force ? { force: true } : {}), ...(opts.reason ? { reason: opts.reason } : {}) },
      );
      addToast('success', `Program ${to.toLowerCase()}.`);
      setStatusTarget(null);
      setStatusReason('');
      setEarlyLaunchInfo(null);
      if (res.data && onChanged) onChanged(res.data);
    } catch (e: any) {
      const body = (e && typeof e === 'object' && 'body' in e ? e.body : null) || {};
      if (body?.requiresConfirmation && Array.isArray(body.incompletePhases)) {
        setEarlyLaunchInfo(body.incompletePhases);
        setStatusTarget(to);
      } else if (body?.blockingPhase) {
        addToast('error', `${body.error} Missing: ${(body.missing || []).join(', ')}`);
        setStatusTarget(null);
      } else {
        addToast('error', body?.error || e?.message || 'Status change failed');
        setStatusTarget(null);
      }
    } finally {
      setStatusBusy(false);
    }
  };

  const startTransition = (to: ProgramStatus) => {
    if (!activeOrgId) { addToast('error', 'Select an organization first.'); return; }
    setStatusReason('');
    setEarlyLaunchInfo(null);
    if (to === 'ACTIVE' && progStatus === 'PLANNING') changeStatus('ACTIVE');
    else setStatusTarget(to);
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
        {launchedLabel && (
          <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginLeft: 4 }}>
            Launched <strong style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>{launchedLabel}</strong>
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(VALID_TRANSITIONS[progStatus] || []).map((to) => {
            const label = STATUS_ACTION_LABEL[`${progStatus}>${to}`] || `Set ${to}`;
            const isPrimary = to === 'ACTIVE';
            const isDanger = to === 'COMPLETED';
            // Foundation (Phase 1) is a hard prerequisite for going ACTIVE — the
            // backend rejects it, so disable the button rather than let it fail.
            // Later phases stay allowed (audited early launch).
            const needsFoundation = to === 'ACTIVE' && progStatus === 'PLANNING' && !phase1Complete;
            const disabled = !isAdmin || statusBusy || needsFoundation;
            const title = !isAdmin ? 'Only an admin / program owner can change the program status'
              : needsFoundation ? 'Complete the Foundation (Phase 1) — scope, principles, and operating model — before launching.'
              : undefined;
            return (
              <button
                key={to}
                disabled={disabled}
                title={title}
                onClick={() => startTransition(to)}
                style={{
                  ...primaryBtn,
                  background: disabled ? 'var(--color-border)' : isDanger ? '#b91c1c' : isPrimary ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: disabled ? 'var(--color-text-muted)' : (isPrimary || isDanger) ? '#fff' : 'var(--color-text)',
                  border: isPrimary || isDanger ? 'none' : '1px solid var(--color-border)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Early-launch confirmation — phases incomplete; backend returned the
          list, admin confirms to force it. */}
      <ConfirmDialog
        open={!!earlyLaunchInfo}
        title="Launch with incomplete phases?"
        message="The program isn't fully set up. Launching now marks it active in the scorecard and dashboards with these gaps:"
        confirmLabel="Launch anyway"
        variant="danger"
        onConfirm={() => statusTarget && changeStatus(statusTarget, { force: true, reason: statusReason })}
        onCancel={() => { setEarlyLaunchInfo(null); setStatusTarget(null); setStatusReason(''); }}
      >
        <div style={{ marginTop: 8, marginBottom: 12 }}>
          {(earlyLaunchInfo || []).map((p) => (
            <div key={p.phase} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Phase {p.phase} — {p.name}</div>
              <ul style={{ margin: '2px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                {p.missing.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          ))}
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginTop: 8, marginBottom: 4 }}>Reason (recorded in the audit log)</label>
          <input
            aria-label="Reason (recorded in the audit log)"
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
            placeholder="e.g. running a 30-day pilot ahead of full rollout"
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 6, boxSizing: 'border-box' }}
          />
        </div>
      </ConfirmDialog>

      {/* Plain transition confirmation — Pause / Resume / Reopen. (Launch from
          PLANNING goes direct; the backend may bounce it into the early-launch
          dialog above.) */}
      <ConfirmDialog
        open={statusTarget !== null && !earlyLaunchInfo}
        title={
          statusTarget === 'COMPLETED' ? 'Complete this program?'
          : statusTarget === 'PAUSED' ? 'Pause this program?'
          : statusTarget === 'ACTIVE' && progStatus === 'COMPLETED' ? 'Reopen this completed program?'
          : statusTarget === 'ACTIVE' ? 'Resume this program?'
          : 'Change program status?'
        }
        message={
          statusTarget === 'COMPLETED' ? 'Completed marks the program as closed out. Reopening later is possible but is an explicit, audited action.'
          : statusTarget === 'PAUSED' ? 'Pausing keeps all configuration but signals the program is not actively operating (e.g. a reorg or budget freeze).'
          : statusTarget === 'ACTIVE' && progStatus === 'COMPLETED' ? 'This moves a closed program back to active. The reopen is recorded in the audit log.'
          : 'This resumes active operations.'
        }
        confirmLabel={statusTarget ? (STATUS_ACTION_LABEL[`${progStatus}>${statusTarget}`] || `Set ${statusTarget}`) : 'Confirm'}
        variant={statusTarget === 'COMPLETED' ? 'danger' : 'primary'}
        onConfirm={() => statusTarget && changeStatus(statusTarget, { reason: statusReason })}
        onCancel={() => { setStatusTarget(null); setStatusReason(''); }}
      >
        <div style={{ marginTop: 8 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Reason (optional — recorded in the audit log)</label>
          <input
            aria-label="Reason (optional — recorded in the audit log)"
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
            placeholder="Why is the status changing?"
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 6, boxSizing: 'border-box' }}
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
