import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// scheduler.service — self-driving background loops that turn
// otherwise-manual endpoints into automation. Two jobs, one timer:
//
//   * Overdue task sweep — every SWEEP_INTERVAL_MS. Fires the same
//     sweepOverdueTasks helper the /sweep-overdue endpoint calls.
//
//   * Weekly digest — hits digestForOrg for every org, once, on the
//     scheduled weekly boundary. In dev + demo we lean into a shorter
//     "weekly if the wall clock crosses Sunday 23:59 UTC since the
//     last check" rule so the loop is testable without waiting seven
//     days. In production this stays exactly as tight; the same
//     boundary catches the real cron moment.
//
// The scheduler holds a single Node interval. Callers should invoke
// startScheduler() during boot and stopScheduler() during graceful
// shutdown. The intervals are wrapped in try/catch so a
// per-tick failure doesn't take the loop down.
//
// Disable in tests via the PROCELA_DISABLE_SCHEDULER env var — the
// scheduler is heavy for a unit-test suite and each test can drive
// the underlying functions directly instead.
// ──────────────────────────────────────────────────────────────────────────

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let timer: NodeJS.Timeout | null = null;
let lastWeeklyDigestFiredAt: number | null = null;

function isDisabled(): boolean {
  return process.env.PROCELA_DISABLE_SCHEDULER === '1'
    || process.env.NODE_ENV === 'test';
}

/**
 * Detects whether the wall clock has crossed the weekly-digest boundary
 * (Sunday 23:59 UTC) since the last check. Simpler than a real cron
 * because the interval always runs at a coarse boundary anyway — we
 * just need "did the boundary pass since we last fired?".
 */
function shouldFireWeeklyDigest(nowMs: number): boolean {
  const now = new Date(nowMs);
  // Sunday = 0 in JS. Fire when it's Sunday AFTER 23:00 UTC, once.
  const isSundayLate = now.getUTCDay() === 0 && now.getUTCHours() >= 23;
  if (!isSundayLate) return false;
  if (lastWeeklyDigestFiredAt === null) return true;
  // At least six days must have passed since the last fire so a
  // Sunday sweep at 23:15 and then 23:45 don't double-fire.
  const sixDays = 6 * 24 * 60 * 60 * 1000;
  return nowMs - lastWeeklyDigestFiredAt >= sixDays;
}

async function tick(): Promise<void> {
  // Every store is required lazily so the scheduler module doesn't
  // pull the whole route graph in at import time (nothing else does
  // — index.ts wires the routes; this service only needs the data).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { sweepOverdueTasks } = require('../routes/governance-tasks') as typeof import('../routes/governance-tasks');
    const overdue = sweepOverdueTasks();
    if (overdue.fired.length > 0) {
      logger.info({ fired: overdue.fired.length }, 'Scheduler: overdue sweep fired');
    }
  } catch (err) {
    logger.error({ err }, 'Scheduler: overdue sweep failed');
  }

  if (shouldFireWeeklyDigest(Date.now())) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { digestForOrg } = require('./digest.service') as typeof import('./digest.service');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { processNodes } = require('../routes/process-catalog');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { dataAssets } = require('../routes/data-assets');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { mappings } = require('../routes/mappings');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { organizations } = require('../routes/organizations');
      let totalWritten = 0;
      for (const org of organizations) {
        try {
          const result = digestForOrg(org.id, { processNodes, dataAssets, mappings });
          totalWritten += result.notifications.length;
        } catch (err) {
          logger.error({ err, orgId: org.id }, 'Scheduler: digest failed for org');
        }
      }
      lastWeeklyDigestFiredAt = Date.now();
      logger.info({ totalWritten, orgs: organizations.length }, 'Scheduler: weekly digest fired');
    } catch (err) {
      logger.error({ err }, 'Scheduler: weekly digest failed');
    }
  }
}

export function startScheduler(): void {
  if (isDisabled()) {
    logger.info('Scheduler disabled by env');
    return;
  }
  if (timer) return;
  // Fire once shortly after boot so the first sweep doesn't wait a
  // full hour when the server starts up mid-day.
  setTimeout(() => { void tick(); }, 30_000);
  timer = setInterval(() => { void tick(); }, SWEEP_INTERVAL_MS);
  if (typeof (timer as any).unref === 'function') (timer as any).unref();
  logger.info({ intervalMs: SWEEP_INTERVAL_MS }, 'Scheduler started');
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Exports for tests. The tick and boundary helper are pure over the
// stores, so tests can drive them directly without touching the timer.
export const __test__ = { tick, shouldFireWeeklyDigest };
