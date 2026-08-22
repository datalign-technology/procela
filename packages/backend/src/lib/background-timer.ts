// ──────────────────────────────────────────────────────────────────────────
// startBackgroundSweep — the one place module-level background timers
// (in-memory Map TTL sweeps, token expiry, scheduler ticks) get created.
//
// The rule every one of these paths ought to follow:
//   1. don't start when NODE_ENV=test — otherwise every test process
//      inherits ambient timers that fire against shared state and
//      turn ordering bugs into flakes;
//   2. don't start when PROCELA_DISABLE_SCHEDULERS=1 — a global kill
//      switch for CLI tools, migrations, and one-shot admin scripts
//      that shouldn't spin up background loops;
//   3. call .unref() so a Node process that has nothing else to do
//      still exits cleanly on Ctrl+C rather than hanging on the timer.
//
// Callers get the same NodeJS.Timeout | null they'd have got from
// setInterval directly, so `if (handle) clearInterval(handle)` is
// still the shutdown idiom.
// ──────────────────────────────────────────────────────────────────────────

export function backgroundTimersDisabled(): boolean {
  return process.env.NODE_ENV === 'test'
    || process.env.PROCELA_DISABLE_SCHEDULERS === '1';
}

export interface BackgroundSweepOptions {
  // Gate the tick on scheduler leadership: run only on the one instance that
  // owns the background work. Use for SHARED / costly sweeps (DB writes,
  // external calls, notifications, `nextRunAt` advances) that must fire once
  // cluster-wide. Leave off for per-instance work (in-memory cache TTL sweeps),
  // which must run on every replica. See lib/scheduler-leadership.ts.
  leaderOnly?: boolean;
}

export function startBackgroundSweep(
  fn: () => void,
  intervalMs: number,
  opts: BackgroundSweepOptions = {},
): NodeJS.Timeout | null {
  if (backgroundTimersDisabled()) return null;
  const tick = opts.leaderOnly
    // Lazy require breaks the import cycle (scheduler-leadership imports
    // backgroundTimersDisabled from this module).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ? () => { if ((require('./scheduler-leadership') as typeof import('./scheduler-leadership')).isSchedulerLeader()) fn(); }
    : fn;
  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === 'function') handle.unref();
  return handle;
}
