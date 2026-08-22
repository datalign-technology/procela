// ──────────────────────────────────────────────────────────────────────────
// Scheduler leader election — the single-owner guard for background work.
//
// The backend runs a handful of shared, costly background timers (overdue-task
// sweep, weekly digest, agent-schedule ticker → Claude calls, data-quality
// runs, dbt polling, offline-connector scan). If more than one replica runs,
// every replica would fire all of them: doubled AI spend, duplicate user
// notifications, and races on `nextRunAt`. This module elects exactly one
// owner so those timers fire once, cluster-wide.
//
// Mechanism (Postgres mode): a single `scheduler_leases` row. Each process
// claims/renews it with an ATOMIC conditional upsert — the ON CONFLICT DO
// UPDATE only wins when the existing lease is expired or already ours, so at
// most one holder exists at a time. A heartbeat renews the lease well within
// its TTL; if the leader dies, the lease lapses and another replica takes over
// on its next heartbeat. No new dependency, no dedicated connection — the
// upsert rides the normal Prisma pool.
//
// JSON mode: exactly one process, so it is always the owner (no election).
// Tests / kill switch: no leadership loop starts, matching the timers that are
// themselves disabled there.
// ──────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import { getPrisma, hasDatabase } from '../db/prisma';
import { backgroundTimersDisabled } from './background-timer';
import logger from './logger';

// Stable per-process identity for the lifetime of this instance.
const INSTANCE_ID = randomUUID();
const LEASE_ID = 'scheduler';
// The lease is valid for TTL; we renew every RENEW_INTERVAL (< TTL) so a
// single missed heartbeat doesn't hand leadership away. Failover latency after
// a hard crash is bounded by the TTL.
const LEASE_TTL_MS = 90_000;
const RENEW_INTERVAL_MS = 30_000;

let _isLeader = false;
let heartbeat: NodeJS.Timeout | null = null;

/**
 * True when this process owns the background-timer work. Shared/costly timers
 * should gate their tick on this. Always true in JSON mode (single process).
 */
export function isSchedulerLeader(): boolean {
  return hasDatabase() ? _isLeader : true;
}

/**
 * Atomically claim or renew the lease. Returns whether we hold it now.
 * The `WHERE` on the DO UPDATE is what makes this safe under concurrency:
 * a live lease held by another instance blocks the takeover, so RETURNING
 * yields no row and we report non-leader.
 */
async function acquireOrRenew(): Promise<boolean> {
  const prisma = getPrisma() as unknown as {
    $queryRawUnsafe: (sql: string, ...args: unknown[]) => Promise<Array<{ holder: string }>>;
  };
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO scheduler_leases (id, holder, "expiresAt", "updatedAt")
       VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval, now())
     ON CONFLICT (id) DO UPDATE
       SET holder = EXCLUDED.holder,
           "expiresAt" = EXCLUDED."expiresAt",
           "updatedAt" = now()
       WHERE scheduler_leases."expiresAt" < now()
          OR scheduler_leases.holder = EXCLUDED.holder
     RETURNING holder`,
    LEASE_ID,
    INSTANCE_ID,
    String(LEASE_TTL_MS),
  );
  return Array.isArray(rows) && rows.length > 0 && rows[0].holder === INSTANCE_ID;
}

/**
 * Begin participating in leader election. No-op (always-leader) in JSON mode;
 * skipped under NODE_ENV=test / PROCELA_DISABLE_SCHEDULERS so the loop matches
 * the timers, which are also disabled there.
 */
export function startSchedulerLeadership(): void {
  if (!hasDatabase()) {
    _isLeader = true; // single process owns everything
    return;
  }
  if (backgroundTimersDisabled()) return;
  if (heartbeat) return;

  const run = async () => {
    try {
      const held = await acquireOrRenew();
      if (held && !_isLeader) logger.info({ instance: INSTANCE_ID }, 'Scheduler leadership acquired');
      else if (!held && _isLeader) logger.info({ instance: INSTANCE_ID }, 'Scheduler leadership lost');
      _isLeader = held;
    } catch (err) {
      // On error, relinquish so a healthy replica can take over rather than
      // two instances both believing they might be leader.
      _isLeader = false;
      logger.warn({ err }, 'Scheduler leadership renew failed');
    }
  };

  void run(); // claim immediately at boot
  heartbeat = setInterval(() => void run(), RENEW_INTERVAL_MS);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();
}

export function stopSchedulerLeadership(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  _isLeader = false;
}

// Test seam — lets a test drive the lease directly and reset process state.
export const __test__ = { acquireOrRenew, INSTANCE_ID, LEASE_TTL_MS, setLeader: (v: boolean) => { _isLeader = v; } };
