// Container liveness signal. The connector is outbound-only — it runs
// no HTTP server — so a Kubernetes / Docker liveness probe has nothing
// to connect to. Instead the loop touches a file every heartbeat with
// the current timestamp, and a `--healthcheck` invocation of the same
// binary reports healthy iff that file is fresh. A wedged loop stops
// touching the file, its timestamp goes stale, and the probe restarts
// the container.
//
// Note: liveness reflects the *loop*, not backend reachability — the
// file is refreshed each iteration whether or not the heartbeat POST
// succeeded, so a network outage doesn't get the agent killed.

import { readFileSync, writeFileSync } from 'fs';

/** Best-effort: write the current time (epoch ms) to the liveness file.
 *  Swallows errors — a failed touch must never crash the scan loop. */
export function writeLiveness(path: string, nowMs: number): void {
  try {
    writeFileSync(path, String(nowMs), 'utf-8');
  } catch {
    /* best-effort — e.g. a read-only /tmp; the probe will report stale */
  }
}

/** Pure freshness check: was `writtenAtMs` within `maxStaleMs` of now? */
export function isLivenessFresh(writtenAtMs: number, nowMs: number, maxStaleMs: number): boolean {
  if (!Number.isFinite(writtenAtMs)) return false;
  const age = nowMs - writtenAtMs;
  return age >= 0 && age <= maxStaleMs;
}

/** Read the liveness file and decide freshness. Missing / unreadable /
 *  unparseable all count as not-fresh (unhealthy). Used by the
 *  `--healthcheck` probe. */
export function checkLiveness(path: string, nowMs: number, maxStaleMs: number): boolean {
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return false;
  }
  return isLivenessFresh(Number(content.trim()), nowMs, maxStaleMs);
}
