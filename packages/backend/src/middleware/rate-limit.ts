import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';

// ──────────────────────────────────────────────────────────────────────────
// rate-limit — in-memory request limiter for sensitive endpoints.
//
// Used on /auth/login and the password routes to make brute-force and
// credential-stuffing patterns expensive. Keys requests by a caller-
// provided function (typically `${ip}:${email}` for login) so an
// attacker can't trivially spread attempts across emails.
//
// In-memory store: a Map<key, { count, windowStart }>. Production
// should swap this for Redis so the limiter survives process restarts
// and works across instances. The middleware factory's API is
// designed to allow that swap without touching call sites — just
// replace the store implementation.
//
// Successful actions don't reset the counter — that would let an
// attacker hide brute attempts inside a successful session's window.
// The counter ages out naturally when the window expires.
// ──────────────────────────────────────────────────────────────────────────

export interface RateLimitOptions {
  /** Window length in milliseconds. Counters reset when crossed. */
  windowMs: number;
  /** Max requests per key within the window. */
  max: number;
  /** Derive a key from the request. Default: IP only. */
  keyBy?: (req: Request) => string;
  /** Optional label for audit log entries. */
  label?: string;
}

interface Counter {
  count: number;
  windowStart: number;
}

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

export function rateLimit(opts: RateLimitOptions) {
  const store = new Map<string, Counter>();
  const keyBy = opts.keyBy || ((req: Request) => req.ip || 'unknown');
  const label = opts.label || 'rate-limit';

  // Sweep every minute to evict expired counters so the map doesn't
  // grow indefinitely under attack.
  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [k, c] of store) {
      if (now - c.windowStart > opts.windowMs) store.delete(k);
    }
  }, 60_000);
  // unref so a hung interval doesn't keep the test process alive.
  sweepInterval.unref?.();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = keyBy(req);
    const now = Date.now();
    const existing = store.get(key);

    if (!existing || now - existing.windowStart > opts.windowMs) {
      store.set(key, { count: 1, windowStart: now });
      next();
      return;
    }

    existing.count += 1;
    if (existing.count > opts.max) {
      const retryAfterSec = Math.ceil((existing.windowStart + opts.windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      // Audit the first time we tip over so brute patterns surface
      // in the log without flooding it on every blocked request.
      if (existing.count === opts.max + 1) {
        auditService.log(DEV_ORG_ID, null, 'Auth', label, 'RATE_LIMITED', null, {
          key, count: existing.count, windowMs: opts.windowMs,
        });
        logger.warn({ key, label, count: existing.count }, 'Rate limit exceeded');
      }
      res.status(429).json({ success: false, error: 'Too many requests — please try again shortly.' });
      return;
    }
    next();
  };
}
