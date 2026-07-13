import logger from '../lib/logger';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { sweepOverdueTasks } from '../routes/governance-tasks';
import { digestForOrg } from './digest.service';
import { processNodes } from '../routes/process-catalog';
import { dataAssets } from '../routes/data-assets';
import { mappings } from '../routes/mappings';
import { organizations } from '../routes/organizations';

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

// The weekly-digest last-fired timestamp is persisted so a boot in the
// firing window (e.g. Sunday 23:30 after a Sunday 23:15 fire) doesn't
// forget the earlier run and double-notify. Stored as a single-row
// array to fit the loadStore/saveStore shape everything else uses.
interface SchedulerStateRow { key: string; lastWeeklyDigestFiredAt: number | null }
const schedulerState: SchedulerStateRow[] = loadStore<SchedulerStateRow>('schedulerState');
registerStore('schedulerState', schedulerState);
function getLastWeeklyDigestFiredAt(): number | null {
  return schedulerState[0]?.lastWeeklyDigestFiredAt ?? null;
}
function setLastWeeklyDigestFiredAt(ms: number): void {
  if (schedulerState.length === 0) {
    schedulerState.push({ key: 'default', lastWeeklyDigestFiredAt: ms });
  } else {
    schedulerState[0].lastWeeklyDigestFiredAt = ms;
  }
  saveStore('schedulerState', schedulerState);
}

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
  const last = getLastWeeklyDigestFiredAt();
  if (last === null) return true;
  // At least six days must have passed since the last fire so a
  // Sunday sweep at 23:15 and then 23:45 don't double-fire, and so a
  // restart during the firing window doesn't re-trigger.
  const sixDays = 6 * 24 * 60 * 60 * 1000;
  return nowMs - last >= sixDays;
}

async function tick(): Promise<void> {
  try {
    const overdue = sweepOverdueTasks();
    if (overdue.fired.length > 0) {
      logger.info({ fired: overdue.fired.length }, 'Scheduler: overdue sweep fired');
    }
  } catch (err) {
    logger.error({ err }, 'Scheduler: overdue sweep failed');
  }

  if (shouldFireWeeklyDigest(Date.now())) {
    try {
      let totalWritten = 0;
      for (const org of organizations) {
        try {
          const result = digestForOrg(org.id, { processNodes, dataAssets, mappings });
          totalWritten += result.notifications.length;
        } catch (err) {
          logger.error({ err, orgId: org.id }, 'Scheduler: digest failed for org');
        }
      }
      setLastWeeklyDigestFiredAt(Date.now());
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
// resetSchedulerState lets a test wipe the persisted last-fire time
// so its assertions don't depend on run ordering across suites.
function resetSchedulerState(): void {
  schedulerState.length = 0;
  saveStore('schedulerState', schedulerState);
}
export const __test__ = { tick, shouldFireWeeklyDigest, resetSchedulerState };
