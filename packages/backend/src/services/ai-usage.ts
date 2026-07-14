import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// ai-usage — per-org rate-limit counters for AI calls.
//
// This is a cost-control proxy, not real token accounting. Every
// call to an AI endpoint (/ai/*, /chat/*) increments the caller's
// org counter; the middleware refuses new calls once the org has
// exceeded the configured per-hour or per-day ceiling until the
// counter rolls over.
//
// In-memory Map with periodic pruning — good enough for a single-
// process demo / small-tenant install. A real multi-instance
// deployment should back this with Redis, keyed the same way, so
// counters are shared across replicas. See `AI_MAX_CALLS_PER_ORG_*`
// env vars for the ceilings and `AI_COST_CONTROLS_ENABLED` for the
// on/off switch.
// ──────────────────────────────────────────────────────────────────────────

interface OrgUsageBuckets {
  hourStart: number; // epoch ms of the current hour window
  hourCount: number;
  dayStart: number;  // epoch ms of the current day window
  dayCount: number;
}

const usage = new Map<string, OrgUsageBuckets>();

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function bucketStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

function ensureBuckets(orgId: string, now: number): OrgUsageBuckets {
  const existing = usage.get(orgId);
  const hourStart = bucketStart(now, HOUR_MS);
  const dayStart = bucketStart(now, DAY_MS);
  if (!existing) {
    const fresh: OrgUsageBuckets = { hourStart, hourCount: 0, dayStart, dayCount: 0 };
    usage.set(orgId, fresh);
    return fresh;
  }
  // Roll windows forward if the wall-clock crossed a boundary.
  if (existing.hourStart !== hourStart) {
    existing.hourStart = hourStart;
    existing.hourCount = 0;
  }
  if (existing.dayStart !== dayStart) {
    existing.dayStart = dayStart;
    existing.dayCount = 0;
  }
  return existing;
}

export interface UsageLimits {
  maxCallsPerHour: number;
  maxCallsPerDay: number;
}

export function getConfiguredLimits(): UsageLimits {
  // Defaults tuned to be generous for a healthy demo but stop
  // runaway loops. Override per-tenant via env.
  const maxCallsPerHour = parseInt(process.env.AI_MAX_CALLS_PER_ORG_PER_HOUR || '60', 10);
  const maxCallsPerDay = parseInt(process.env.AI_MAX_CALLS_PER_ORG_PER_DAY || '500', 10);
  return { maxCallsPerHour, maxCallsPerDay };
}

export function isEnabled(): boolean {
  const raw = process.env.AI_COST_CONTROLS_ENABLED;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  // Default: on in production, off elsewhere so dev + tests don't
  // trip the ceiling unexpectedly.
  return process.env.NODE_ENV === 'production';
}

export interface UsageStatus {
  hourCount: number;
  hourLimit: number;
  dayCount: number;
  dayLimit: number;
  hourResetAtMs: number;
  dayResetAtMs: number;
}

/** Snapshot of an org's current usage without touching it. */
export function statusFor(orgId: string, now: number = Date.now()): UsageStatus {
  const buckets = ensureBuckets(orgId, now);
  const limits = getConfiguredLimits();
  return {
    hourCount: buckets.hourCount,
    hourLimit: limits.maxCallsPerHour,
    dayCount: buckets.dayCount,
    dayLimit: limits.maxCallsPerDay,
    hourResetAtMs: buckets.hourStart + HOUR_MS,
    dayResetAtMs: buckets.dayStart + DAY_MS,
  };
}

export interface EnforceResult {
  allowed: boolean;
  status: UsageStatus;
  reason?: 'hour' | 'day';
}

/** Check + increment an org's usage counter. Returns allowed=false
 *  without incrementing when either limit is at cap. */
export function checkAndRecord(orgId: string, now: number = Date.now()): EnforceResult {
  const buckets = ensureBuckets(orgId, now);
  const limits = getConfiguredLimits();
  if (buckets.hourCount >= limits.maxCallsPerHour) {
    return { allowed: false, status: statusFor(orgId, now), reason: 'hour' };
  }
  if (buckets.dayCount >= limits.maxCallsPerDay) {
    return { allowed: false, status: statusFor(orgId, now), reason: 'day' };
  }
  buckets.hourCount++;
  buckets.dayCount++;
  return { allowed: true, status: statusFor(orgId, now) };
}

/** Wipe counters — tests only. */
export function _resetForTesting(): void {
  usage.clear();
}

// Housekeeping: drop stale buckets so an install with lots of
// short-lived orgs doesn't leak memory. Called by the scheduler
// service on its next tick (see services/scheduler.service.ts).
export function pruneStaleBuckets(now: number = Date.now()): number {
  const cutoff = now - 7 * DAY_MS;
  let pruned = 0;
  for (const [orgId, b] of usage) {
    if (b.dayStart < cutoff) {
      usage.delete(orgId);
      pruned++;
    }
  }
  if (pruned > 0) logger.debug({ pruned }, 'ai-usage: pruned stale org buckets');
  return pruned;
}
