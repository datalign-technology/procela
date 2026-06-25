# Backend test coverage map

A snapshot of where the 325 backend tests reach today, where they
don't, and which gaps to fill first when someone has time. Generated
with Node 22's built-in `--experimental-test-coverage`.

## Run it

```bash
npm run test:coverage -w packages/backend
```

The default reporter is the human-readable table you see if you scroll
to the bottom of the test output. For machine-readable LCOV (for CI
dashboards, codecov, etc.):

```bash
npm run test:coverage:lcov -w packages/backend
# writes coverage.lcov in the cwd
```

What's excluded by both scripts:
- `src/__tests__/**` — the test files themselves
- `src/index.ts` — the server bootstrap; runs every test indirectly
- `src/lib/markdown-pdf.ts` — wraps PDFKit which can't run headless
  in the test env

## Headline numbers

| | Lines | Branches | Functions |
|---|---|---|---|
| **Overall** | **62.9%** | **73.6%** | **63.3%** |

Healthy in absolute terms; gaps concentrate in a handful of files
rather than being spread thin. The map below sorts by exposure so the
back-fill order is obvious.

## By directory

| Directory | Avg. line cov | What's there |
|---|---|---|
| `lib/` | ~87% | Cross-cutting utilities (csv, logger, persistence, permissions, password policy). Mostly well-covered; only `org-scope.ts` (56%) stands out. |
| `middleware/` | ~94% | `auth.ts` at 100%, `rate-limit.ts` at 88%. Done. |
| `services/` | ~83% | The deeper logic. Most files >85%. Five outliers below. |
| `routes/` | ~55% | Where most of the gaps live. Patterns: GET endpoints tested, POST/PUT/DELETE often skipped, edge cases (validation, conflicts, cascade) mostly missed. |
| `stores/` | 97% | Just `skills.ts`. Done. |

## Where to look first

Three tiers, prioritised by what a regression would actually cost:

### Tier 1 — Security-adjacent (do these before anything else)

| File | Lines | Why it matters |
|---|---|---|
| `routes/auth.ts` | **62.6%** | 1400-line file covering local login, OIDC, SAML, password reset, MFA enrol, MFA verify, WebAuthn. Most flows have *some* coverage but the branch numbers (56%) say the failure paths aren't being tested. |
| `services/webauthn.service.ts` | **63.9%** | The credential creation + verification ceremony. Function coverage is **26%** — most of the helpers aren't being called from tests. |
| `services/kms-providers.ts` | **46.3%** | KMS interface for encrypted secrets at rest. The local fallback is exercised; AWS / GCP / Azure adapters aren't. |
| `services/mail.service.ts` | **58.0%** | SMTP wrapper. The "no SMTP configured" branch is the only path tested. |

### Tier 2 — Largest single exposure

| File | Lines | Notes |
|---|---|---|
| `routes/process-catalog.ts` | **27.6%** | 1100+ executable lines, only 27% covered. Function coverage **20%**. The most consequential file in the backend by complexity — wizards, reorder, mappings, agent execution promote, version history, lineage. Best ROI is probably a focused suite covering reorder + delete-cascade + version-history happy paths. |

### Tier 3 — CRUD routes in the 40-55% range

Same shape across most of these — happy-path GET works, mutations and
edge cases are thin. They'd benefit from a shared CRUD test harness
(create → list-confirms → update → delete) more than per-file work.

| File | Lines | Function cov |
|---|---|---|
| `routes/governance-groups.ts` | 39.3% | 40.0% |
| `routes/organizations.ts` | 43.6% | 38.1% |
| `routes/mappings.ts` | 45.1% | 38.1% |
| `routes/attachments.ts` | 45.9% | 35.3% |
| `routes/governance-policies.ts` | 47.4% | 28.6% |
| `routes/dama-roles.ts` | 48.3% | 42.1% |
| `routes/data-domains.ts` | 48.5% | 38.1% |
| `routes/tags.ts` | 48.5% | 58.3% |
| `routes/governance-tasks.ts` | 49.0% | 37.5% |
| `routes/systems.ts` | 51.7% | 30.0% |
| `routes/comments.ts` | 52.0% | 50.0% |
| `routes/connections.ts` | 56.3% | 44.1% |
| `routes/data-assets.ts` | 58.5% | 55.6% |
| `routes/people.ts` | 59.3% | 56.0% |
| `routes/data-lineage.ts` | 60.4% | 32.4% |
| `routes/notifications.ts` | 61.6% | 33.3% |
| `routes/data-quality.ts` | 62.6% | 63.2% |
| `routes/skills.ts` | 66.9% | 38.9% |

### Already well-covered (leave alone)

`services/audit.service.ts` (94%), `services/data-model.ts` (99%),
`services/dq-engine.ts` (99%), `services/skill-coverage.ts` (99%),
`services/gdpr.service.ts` (96%), `services/mfa.service.ts` (98%),
`services/account-lockout.ts` (99%), `services/login-challenge.ts`
(92%), `services/report-engine.ts` (92%), `routes/agents.ts` (83%),
`routes/backup.ts` (80%), `middleware/auth.ts` (100%),
`lib/logger.ts` (100%), `lib/persistence.ts` (90%),
`lib/permissions.ts` (83%).

## Not a goal

This is a map, not a mandate. Procela's tests should stay focused on
business-meaningful behaviour — there's no "must hit 80% line
coverage" rule worth chasing. Use this doc to spot the **specific
files where a regression would land in production unnoticed**, fix
those, and ignore the percentage on the others.

The exposure ranking (Tier 1 → 3) is the action list, not the
percentage column itself.
