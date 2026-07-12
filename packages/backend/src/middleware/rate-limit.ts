import { Request, Response, NextFunction } from 'express';
import { createClient, RedisClientType } from 'redis';
import logger from '../lib/logger';
import config from '../config';
import { auditService } from '../services/audit.service';

// ──────────────────────────────────────────────────────────────────────────
// rate-limit — request limiter for sensitive endpoints.
//
// Used on /auth/login and the password routes to make brute-force and
// credential-stuffing patterns expensive. Keys requests by a caller-
// provided function (typically `${ip}:${email}` for login) so an
// attacker can't trivially spread attempts across emails.
//
// Two backends, picked at boot:
//   - Redis (production): one shared counter across instances; survives
//     process restarts. Uses INCR + EXPIRE on a per-key bucket so the
//     atomic semantics are correct under load. Activated by REDIS_URL
//     env var.
//   - In-memory (dev / single-instance): a Map<key, {count, windowStart}>
//     with periodic sweep. Used when Redis isn't configured OR when the
//     Redis connection fails to come up — we fall back rather than
//     refusing to start so a misconfigured production env doesn't lock
//     everyone out.
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
  /** Optional label for audit log entries + Redis key namespace. */
  label?: string;
}

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

// ── Redis backend ──
// Lazy-singleton client shared across all limiter instances. The first
// rate-limited route call triggers connection; subsequent ones reuse.
// We don't fail boot if Redis is misconfigured — the per-key get()
// helper catches and downgrades to in-memory so the app keeps running.
//
// Fail-fast configuration is critical: the connect() call sits inside
// the /auth/login request path, so any hang here translates to a hung
// login. We cap the initial connect attempt at REDIS_CONNECT_TIMEOUT_MS
// and disable the client's built-in reconnect loop entirely. A
// transient Redis blip means the next request falls through to the
// in-memory backend; an admin who fixes the Redis config has to
// restart Procela to bring the Redis backend back. That's the right
// trade — we'd rather degrade fast than wedge a user-facing endpoint.
const REDIS_CONNECT_TIMEOUT_MS = parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '2000', 10);

let redisClient: RedisClientType | null = null;
let redisReady = false;
let redisAttempted = false;

async function getRedisClient(): Promise<RedisClientType | null> {
  if (redisReady) return redisClient;
  if (redisAttempted) return null;
  redisAttempted = true;
  const url = config.redisUrl;
  if (!url) {
    logger.info('REDIS_URL not set — rate limiter using in-memory backend');
    return null;
  }
  try {
    redisClient = createClient({
      url,
      socket: {
        // Cap the initial connect attempt. Without this Windows in
        // particular sits on the TCP SYN retry budget (~20–30s) when
        // Redis isn't listening — the request hangs for that long
        // before falling through.
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        // Disable the client's built-in reconnect loop. We only need
        // a single yes/no on the first request; if Redis is down the
        // limiter degrades to in-memory and stays there for the
        // process's lifetime. An admin restart re-attempts.
        reconnectStrategy: false,
      },
    });
    redisClient.on('error', (err) => {
      // Don't spam the log; one warning at first failure is enough.
      // Subsequent requests fall through to the in-memory backend
      // automatically because incrInRedis() catches.
      if (redisReady) logger.warn({ err }, 'Redis connection error — falling back to in-memory rate limiter');
      redisReady = false;
    });
    // Race the connect against an explicit timeout. node-redis's
    // socket.connectTimeout handles the TCP-level wait, but the
    // promise it returns can still sit pending under odd network
    // conditions; the race is belt-and-braces.
    await Promise.race([
      redisClient.connect(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Redis connect timed out after ${REDIS_CONNECT_TIMEOUT_MS}ms`)),
          REDIS_CONNECT_TIMEOUT_MS,
        ),
      ),
    ]);
    redisReady = true;
    logger.info({ url: url.replace(/:[^:@/]+@/, ':***@') }, 'Connected to Redis for rate limiter');
    return redisClient;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'Failed to connect to Redis — using in-memory rate limiter for the rest of this process');
    // Tear down whatever partial state the client left behind so a
    // lingering reconnect attempt doesn't keep the process alive at
    // shutdown.
    try {
      await redisClient?.disconnect();
    } catch { /* ignore */ }
    redisClient = null;
    redisReady = false;
    return null;
  }
}

/**
 * Atomic INCR + EXPIRE on a windowed counter. Returns the post-increment
 * count and the remaining TTL in ms (so the middleware can populate
 * Retry-After). Returns null if the Redis hop fails — the caller falls
 * back to in-memory.
 */
async function incrInRedis(key: string, windowMs: number): Promise<{ count: number; ttlMs: number } | null> {
  const client = await getRedisClient();
  if (!client || !redisReady) return null;
  try {
    // Multi to keep INCR + PEXPIRE atomic; PEXPIRE only applies when
    // the key was freshly created (count === 1) so we don't keep
    // pushing the expiry out and turn a 60-second window into a
    // perpetual lockout.
    const multi = client.multi();
    multi.incr(key);
    multi.pTTL(key);
    const [countRaw, ttlRaw] = (await multi.exec()) as unknown as [number, number];
    const count = Number(countRaw);
    let ttlMs = Number(ttlRaw);
    if (ttlMs < 0) {
      // First hit in this window — set the expiry.
      await client.pExpire(key, windowMs);
      ttlMs = windowMs;
    }
    return { count, ttlMs };
  } catch (err) {
    logger.warn({ err, key }, 'Redis rate-limit op failed — falling back to in-memory');
    redisReady = false;
    return null;
  }
}

// ── In-memory backend ──
interface Counter {
  count: number;
  windowStart: number;
}
const memStore = new Map<string, Counter>();

/** Reset the in-memory store. Test-only; production code should never
 *  call this since the limiter is the only thing protecting login
 *  routes from brute-force. Exported for the integration tests that
 *  hammer the auth endpoints in a tight loop. */
export function _resetRateLimitForTesting(): void {
  memStore.clear();
}
import { startBackgroundSweep } from '../lib/background-timer';
startBackgroundSweep(() => {
  const now = Date.now();
  for (const [k, c] of memStore) {
    if (now - c.windowStart > 24 * 60 * 60_000) memStore.delete(k);
  }
}, 60_000);

function incrInMemory(key: string, windowMs: number): { count: number; ttlMs: number } {
  const now = Date.now();
  const existing = memStore.get(key);
  if (!existing || now - existing.windowStart > windowMs) {
    memStore.set(key, { count: 1, windowStart: now });
    return { count: 1, ttlMs: windowMs };
  }
  existing.count += 1;
  return { count: existing.count, ttlMs: existing.windowStart + windowMs - now };
}

// ── Middleware factory ──
export function rateLimit(opts: RateLimitOptions) {
  const keyBy = opts.keyBy || ((req: Request) => req.ip || 'unknown');
  const label = opts.label || 'rate-limit';

  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const baseKey = keyBy(req);
    // Namespace Redis keys by window length so two limiters on the
    // same route (e.g. 5/min and 20/hour login limits) don't collide
    // on the same counter.
    const fullKey = `procela:ratelimit:${label}:${opts.windowMs}:${baseKey}`;

    const redisResult = await incrInRedis(fullKey, opts.windowMs);
    const result = redisResult ?? incrInMemory(fullKey, opts.windowMs);

    if (result.count > opts.max) {
      const retryAfterSec = Math.max(1, Math.ceil(result.ttlMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      // Audit the first time we tip over so brute patterns surface
      // in the log without flooding it on every blocked request.
      if (result.count === opts.max + 1) {
        auditService.log(DEV_ORG_ID, null, 'Auth', label, 'RATE_LIMITED', null, {
          key: baseKey, count: result.count, windowMs: opts.windowMs,
          backend: redisResult ? 'redis' : 'memory',
        });
        logger.warn({ key: baseKey, label, count: result.count }, 'Rate limit exceeded');
      }
      res.status(429).json({ success: false, error: 'Too many requests — please try again shortly.' });
      return;
    }
    next();
  };
}
