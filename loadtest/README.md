# Procela load-test harness

A throughput/latency backstop for the Procela API — checklist item
**#21**. The e2e smoke proves the app is *correct*; this proves it
stays *fast* under concurrent load, and fails the run when a scenario
regresses past its budget.

It drives the API with [autocannon](https://github.com/mcollina/autocannon)
(a Node HTTP load generator — no external binary, installs with the
rest of the workspace) and checks each endpoint against a per-scenario
budget: p99 latency, sustained throughput, and zero non-2xx.

## Run it

The harness does **not** boot the server — point it at a running one.

```bash
# terminal 1 — start the stack (backend on :3001)
npm run dev

# terminal 2 — run the load test against it
npm run loadtest
```

Output is a per-scenario table and a non-zero exit if anything breaches
budget:

```
  scenario            kind        req/s     p50     p90     p99    non2xx  verdict
  ─────────────────────────────────────────────────────────────────────────────────
  health              baseline        1336       6       9      40        0  PASS
  organizations       list             909       8      15      62        0  PASS
  dashboard-stats     aggregate       1336       6       9      13        0  PASS
  …
  ✔ all 10 scenario(s) within budget
```

Exit codes: **0** all within budget · **1** one or more breached ·
**2** target unreachable / couldn't authenticate.

## Point it at another environment

```bash
PROCELA_LOADTEST_URL=https://staging.example.com/api/v1 npm run loadtest
```

## Knobs (env vars)

| Var | Default | Meaning |
|---|---|---|
| `PROCELA_LOADTEST_URL` | `http://localhost:3001/api/v1` | API base to hit. |
| `LOADTEST_CONNECTIONS` | `10` | Concurrent connections. The throughput floor scales with this. |
| `LOADTEST_DURATION` | `10` | Measured seconds per scenario. |
| `LOADTEST_WARMUP` | `2` | Warm-up seconds per scenario (discarded). |
| `LOADTEST_ONLY` | _(all)_ | Comma-separated scenario names to run (e.g. `health,people`). |
| `LOADTEST_EMAIL` | `loadtest@momentumindustries.com` | Dev-login email used to mint the shared bearer token. |
| `LOADTEST_TOKEN` | _(none)_ | Pre-minted bearer to use instead of dev login (needed against a Local/OIDC/SAML backend). |
| `LOADTEST_JSON` | _(none)_ | Write machine-readable results to this path (for CI artifacts / trend tracking). |

## How it works

1. **Pre-flight** — `GET /health`; bail with guidance if the target is down.
2. **Authenticate once** — one `POST /auth/login` (Dev provider) and the
   bearer is reused for every authed scenario. This is deliberate: the
   auth route is rate-limited (5/min per IP+email) and runs argon2, so
   re-logging-in per request would both trip the limiter and measure the
   wrong thing. The load lands on the endpoints under test.
3. **Warm-up then measure** — a short discarded pass lets the JIT and any
   lazy caches settle, then the measured pass records latency percentiles
   and throughput.
4. **Gate** — each scenario fails if p99 > `maxP99Ms`, throughput <
   `minReqPerSec` (scaled to `LOADTEST_CONNECTIONS`), or any non-2xx /
   socket error occurs. Any failure ⇒ non-zero exit.

## Scenarios

Defined in [`scenarios.ts`](./scenarios.ts). They mix the cheap,
most-clicked list reads (organizations, people, systems, data-assets,
process-catalog) with the heavy aggregations (dashboard stats,
control-tower, gap-detection, enterprise-view) that fan out across the
whole catalog — where a throughput regression bites first — plus an
unauthenticated `health` baseline.

**AI / chat endpoints are excluded on purpose.** They are billed
per call and their latency is the model's, not Procela's — load-testing
them burns money to measure something we don't own. Test those with a
tiny, explicit run against a mock or a budget you accept, not here.

Only `GET` scenarios ship: repeated writes would mutate persistence and
skew a re-run. To load-test a write path, stand up a throwaway
environment and add a scenario with a body.

### Tuning budgets

The defaults in `scenarios.ts` are generous, calibrated for a single-node
dev box on the JSON persistence path. **The harness is for catching a
regression against a known-good baseline, not asserting an absolute SLA.**
After a representative deploy, capture a baseline (`LOADTEST_JSON=...`)
and tighten `maxP99Ms` / `minReqPerSec` per environment.

## CI

Wired as a **manual** workflow — `.github/workflows/loadtest.yml`, run
from the Actions tab (`workflow_dispatch`) with optional duration /
connections inputs. It's intentionally *not* on the per-PR path:
throughput numbers vary with runner load, so gating every PR on them
would be flaky. Run it on demand — before a release, or when a change
is expected to touch a hot path — and read the uploaded JSON artifact.
