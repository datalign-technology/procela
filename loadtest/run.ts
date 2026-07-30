// Procela API load-test harness.
//
//   npm run loadtest
//
// Boots nothing itself — point it at an already-running backend (the
// dev server, a staging deploy, whatever). It:
//   1. pre-flights GET /health and bails with a clear message if the
//      target isn't up;
//   2. authenticates ONCE via the dev login and reuses the bearer for
//      every authed scenario (so the auth rate limiter never trips and
//      the load lands on the endpoints under test, not on argon2);
//   3. runs a short warm-up then a measured pass per scenario with
//      autocannon;
//   4. prints a per-scenario table (p50/p90/p99, req/s, non-2xx) and
//      exits non-zero if any scenario breaches its budget or returns a
//      non-2xx — so CI can gate on it.
//
// Everything is env-tunable; see the constants below and README.md.
//
// This is a throughput/latency backstop, deliberately separate from the
// e2e smoke (correctness) — checklist item #21.

import autocannon from 'autocannon';
import { SCENARIOS, type Scenario } from './scenarios';

// ── Config (all env-overridable) ─────────────────────────────────────
const BASE_URL = (process.env.PROCELA_LOADTEST_URL || 'http://localhost:3001/api/v1').replace(/\/$/, '');
const LOGIN_EMAIL = process.env.LOADTEST_EMAIL || 'loadtest@momentumindustries.com';
const CONNECTIONS = intEnv('LOADTEST_CONNECTIONS', 10);
const DURATION = intEnv('LOADTEST_DURATION', 10); // seconds, measured pass
const WARMUP = intEnv('LOADTEST_WARMUP', 2); // seconds, discarded
const ONLY = (process.env.LOADTEST_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const JSON_OUT = process.env.LOADTEST_JSON || ''; // write machine-readable results here
// Budgets scale with load: the defaults in scenarios.ts are calibrated
// for the default CONNECTIONS. When an operator dials connections up or
// down we scale the min-throughput floor proportionally so the gate
// stays meaningful instead of trivially passing or failing.
const THROUGHPUT_SCALE = CONNECTIONS / 10;

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ── Small ANSI helpers (skip colour when not a TTY / in CI) ──────────
const useColour = process.stdout.isTTY && !process.env.CI;
const c = {
  dim: (s: string) => (useColour ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (useColour ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s: string) => (useColour ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (useColour ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColour ? `\x1b[33m${s}\x1b[0m` : s),
};

function log(msg = ''): void {
  process.stdout.write(msg + '\n');
}

// ── Pre-flight: is the target up? ────────────────────────────────────
async function preflight(): Promise<void> {
  const url = `${BASE_URL}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`GET /health returned ${res.status}`);
  } catch (err: any) {
    log(c.red(`✖ Target not reachable at ${url}`));
    log(c.dim(`  ${err?.message || String(err)}`));
    log('');
    log('  Start the stack first, then re-run:');
    log(c.dim('    npm run dev          # backend on :3001, frontend on :5173'));
    log(c.dim('    npm run loadtest'));
    log('');
    log(c.dim('  Or point at another environment:'));
    log(c.dim('    PROCELA_LOADTEST_URL=https://staging.example.com/api/v1 npm run loadtest'));
    process.exit(2);
  }
}

// ── Authenticate once, reuse the token everywhere ────────────────────
async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LOGIN_EMAIL, name: 'Load Test', role: 'ORG_ADMIN' }),
  });
  const json: any = await res.json().catch(() => ({}));
  const token = json?.data?.accessToken;
  if (!res.ok || !token) {
    log(c.red('✖ Could not obtain an access token from /auth/login.'));
    log(c.dim(`  status ${res.status}; body: ${JSON.stringify(json).slice(0, 200)}`));
    log(c.dim('  The harness needs the Dev auth provider (AUTH_PROVIDER=dev, the default).'));
    log(c.dim('  Against a Local/OIDC/SAML backend, mint a token out-of-band and pass'));
    log(c.dim('  it via LOADTEST_TOKEN instead.'));
    process.exit(2);
  }
  return token;
}

interface Result {
  scenario: Scenario;
  reqPerSec: number;
  p50: number;
  p90: number;
  p99: number;
  non2xx: number;
  errors: number;
  breaches: string[];
}

async function runScenario(s: Scenario, token: string): Promise<Result> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (s.auth) headers.authorization = `Bearer ${token}`;

  const opts: autocannon.Options = {
    url: `${BASE_URL}${s.path}`,
    method: s.method,
    connections: CONNECTIONS,
    headers,
    // 2xx and 3xx are expected; anything else counts as non-2xx and
    // fails the scenario. (List endpoints answer 200; no redirects.)
    expectBody: undefined,
  };

  // Warm-up pass — let the JIT settle and any lazy caches populate.
  // Results discarded.
  if (WARMUP > 0) {
    await autocannon({ ...opts, duration: WARMUP } as autocannon.Options);
  }

  const result = await autocannon({ ...opts, duration: DURATION } as autocannon.Options);

  const non2xx = result.non2xx ?? 0;
  const errors = result.errors ?? 0;
  const reqPerSec = round(result.requests.average);
  const p50 = round(result.latency.p50);
  const p90 = round(result.latency.p90);
  const p99 = round(result.latency.p99);

  const minReqPerSec = s.minReqPerSec * THROUGHPUT_SCALE;
  const breaches: string[] = [];
  if (p99 > s.maxP99Ms) breaches.push(`p99 ${p99}ms > ${s.maxP99Ms}ms`);
  if (reqPerSec < minReqPerSec) breaches.push(`throughput ${reqPerSec}/s < ${round(minReqPerSec)}/s`);
  if (non2xx > 0) breaches.push(`${non2xx} non-2xx responses`);
  if (errors > 0) breaches.push(`${errors} socket/timeout errors`);

  return { scenario: s, reqPerSec, p50, p90, p99, non2xx, errors, breaches };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function pad(s: string | number, w: number): string {
  const str = String(s);
  return str.length >= w ? str : str + ' '.repeat(w - str.length);
}
function padStart(s: string | number, w: number): string {
  const str = String(s);
  return str.length >= w ? str : ' '.repeat(w - str.length) + str;
}

function printTable(results: Result[]): void {
  log();
  log(c.bold('  scenario            kind        req/s     p50     p90     p99    non2xx  verdict'));
  log(c.dim('  ─────────────────────────────────────────────────────────────────────────────────'));
  for (const r of results) {
    const ok = r.breaches.length === 0;
    const verdict = ok ? c.green('PASS') : c.red('FAIL');
    log(
      '  ' +
        pad(r.scenario.name, 20) +
        pad(r.scenario.kind, 12) +
        padStart(r.reqPerSec, 8) +
        padStart(r.p50, 8) +
        padStart(r.p90, 8) +
        padStart(r.p99, 8) +
        padStart(r.non2xx, 9) +
        '  ' +
        verdict,
    );
    if (!ok) log(c.red(`      ↳ ${r.breaches.join('; ')}`));
  }
  log(c.dim('  ─────────────────────────────────────────────────────────────────────────────────'));
}

async function main(): Promise<void> {
  log(c.bold('\nProcela API load test'));
  log(c.dim(`  target       ${BASE_URL}`));
  log(c.dim(`  connections  ${CONNECTIONS}   duration ${DURATION}s   warmup ${WARMUP}s`));

  let scenarios = SCENARIOS;
  if (ONLY.length) {
    scenarios = SCENARIOS.filter((s) => ONLY.includes(s.name));
    if (!scenarios.length) {
      log(c.red(`✖ LOADTEST_ONLY matched no scenarios. Known: ${SCENARIOS.map((s) => s.name).join(', ')}`));
      process.exit(2);
    }
  }
  log(c.dim(`  scenarios    ${scenarios.length} (${scenarios.map((s) => s.name).join(', ')})`));

  await preflight();

  const needAuth = scenarios.some((s) => s.auth);
  let token = process.env.LOADTEST_TOKEN || '';
  if (needAuth && !token) token = await login();

  const results: Result[] = [];
  for (const s of scenarios) {
    process.stdout.write(c.dim(`  running ${s.name}… `));
    const r = await runScenario(s, token);
    log(r.breaches.length === 0 ? c.green('ok') : c.red('breach'));
    results.push(r);
  }

  printTable(results);

  if (JSON_OUT) {
    const fs = await import('fs');
    const payload = {
      target: BASE_URL,
      connections: CONNECTIONS,
      durationSeconds: DURATION,
      results: results.map((r) => ({
        name: r.scenario.name,
        kind: r.scenario.kind,
        reqPerSec: r.reqPerSec,
        p50: r.p50,
        p90: r.p90,
        p99: r.p99,
        non2xx: r.non2xx,
        errors: r.errors,
        passed: r.breaches.length === 0,
        breaches: r.breaches,
      })),
    };
    fs.writeFileSync(JSON_OUT, JSON.stringify(payload, null, 2));
    log(c.dim(`\n  wrote ${JSON_OUT}`));
  }

  const failed = results.filter((r) => r.breaches.length > 0);
  log();
  if (failed.length) {
    log(c.red(`✖ ${failed.length}/${results.length} scenario(s) breached budget: ${failed.map((r) => r.scenario.name).join(', ')}`));
    log('');
    process.exit(1);
  }
  log(c.green(`✔ all ${results.length} scenario(s) within budget`));
  log('');
}

main().catch((err) => {
  log(c.red(`\n✖ load test crashed: ${err?.message || String(err)}`));
  process.exit(1);
});
