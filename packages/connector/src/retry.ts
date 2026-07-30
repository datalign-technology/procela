// Small retry-with-backoff helper. Used to wrap the /report POST so a
// transient network blip (backend redeploy, brief connectivity loss)
// doesn't drop a whole scan cycle until the next scan interval. Kept
// generic and pure — sleep / backoff / onRetry are injectable so the
// behaviour is unit-testable without real timers.

export interface RetryOptions {
  /** Total attempts before giving up (default 5). */
  maxAttempts?: number;
  /** Backoff in ms before the Nth retry (1-based). Default: capped
   *  exponential — 0.5s, 1s, 2s, 4s, … capped at 30s. */
  backoffMs?: (attempt: number) => number;
  /** Injectable delay (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Called before each backoff with the attempt number + the error. */
  onRetry?: (attempt: number, err: unknown) => void;
}

export const defaultBackoffMs = (attempt: number): number =>
  Math.min(30_000, 500 * 2 ** (attempt - 1));

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Run `fn`, retrying on a thrown error with backoff. Returns `fn`'s
 *  result on success; rethrows the last error once `maxAttempts` is
 *  exhausted. Only thrown errors are retried — a resolved value (even a
 *  logical failure like `{ success: false }`) is returned as-is, since
 *  the caller, not the transport, decides whether that's retryable. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const backoffMs = opts.backoffMs ?? defaultBackoffMs;
  const sleep = opts.sleep ?? realSleep;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts) break;
      opts.onRetry?.(attempt, err);
      await sleep(backoffMs(attempt));
    }
  }
  throw lastErr;
}
