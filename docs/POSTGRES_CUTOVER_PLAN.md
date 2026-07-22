# Postgres cutover plan

Moving the backend from JSON-file persistence to Postgres so that setting
`DATABASE_URL` yields a correct, multi-instance-safe system. This is the
detailed engineering plan behind checklist items **#3, #4, #5** in
[`GO_LIVE_CHECKLIST.md`](./GO_LIVE_CHECKLIST.md). It is grounded in the current
code under `packages/backend/src`, not a summary.

## 1. Where we actually are

**Already done (the hard ~80%):**

- 47 `db/*.repo.ts` repositories, each with a JSON path and a Prisma path,
  switched on `hasDatabase()` (`= !!process.env.DATABASE_URL`, `db/prisma.ts`).
- 56 Prisma models (47 entities + 9 join tables); `prisma/migrations/20260716200000_init`.
- ~37 route files route **their own** entity's writes through `getXRepository(store)`.
- CI has a `test-backend-live-db` job: spins up `postgres:16-alpine`, runs
  `prisma migrate deploy`, runs `live-db.test.ts` against real Postgres.

**The failure mode (why flipping `DATABASE_URL` today is unsafe):**

Every module-level array is loaded from JSON at boot **unconditionally**
(`export const people = loadStore('people')`, no `DATABASE_URL` gate). In
Postgres mode the repo ignores that array and writes only to Postgres — so the
array stays frozen at boot state (empty on a fresh DB). Anything reading the raw
array sees empty/stale data forever.

Two **boot hazards** compounded it (both fixed in PR 0 below): `startAutoSave`
and the shutdown `flushStores` ran unconditionally, so Postgres mode would
overwrite `.procela-data/*.json` with the stale/empty arrays every 10s.

**The scope is bigger than the checklist's four files.** Direct-array readers
that break under Postgres:

- The four checklist consumers: `services/report-engine`, `services/digest.service`,
  `services/scheduler.service`, `lib/org-scope`.
- **The entire auth subsystem**: `routes/auth.ts`, `auth-password.ts`,
  `auth-mfa.ts`, `auth-webauthn.ts`, `routes/scim.ts`,
  `services/account-lockout.ts`, `services/scim-groups.ts` — all mutate the
  `people` array + `saveStore`, all sync handlers.
- **Cross-entity foreign-array writes even inside repo-converted routes**:
  `agent-executions.ts` → `governancePolicies.push`/`mappings.push`;
  `data-lineage.ts` → `dataAssets.push`/`dataQualityRules.push`;
  `dama-roles.ts` → `governanceTasks.push`; `dashboard.ts` → `raciOverrides`.
- **8 stores with no Prisma model** (would be lost in a cutover): `scim-groups`,
  `branding`, `raciOverrides`, `schedulerState`, `aiTemplateCache`, `aiSettings`,
  `dbtAssetMappings`, `dbtTestMappings`.
- **In-memory-only auth state with no store *and* no model**: refresh-token
  sessions (`validRefreshTokens` Map, `auth.ts`), `authConfig`, `oidcProviders`.

## 2. The one strategic decision (make this first)

**How do direct-array consumers get their data in Postgres mode?**

- **Option A — Hydration bridge (fast, single-instance only).** At boot, hydrate
  each module array from Postgres; keep arrays in sync on write. Lets the 25+
  direct-array call sites keep working unchanged. But every instance has its own
  array → violates the stateless / horizontal-scaling mandate in `CLAUDE.md`,
  and goes stale across instances. Acceptable only for a **single-node pilot**.
- **Option B — Full repo conversion (correct end state).** Convert every
  direct-array read to `await repo.list({orgId})` and every write to
  `await repo.*`. Stateless, multi-instance safe. This is the destination and
  what the PRs below assume.

**Recommendation:** Option B. If a single pilot must go live sooner, PR 0 plus a
scoped Option-A bridge gives a correct single-node deployment in ~2 PRs, then
continue with B behind it.

## 3. PR sequence

Each PR is independently mergeable, keeps the JSON path (and all 833 existing
tests) green, and is verified by extending `live-db.test.ts` so the new path runs
against real Postgres in CI.

| PR | Title | Scope | Effort | Risk |
|----|-------|-------|--------|------|
| 0 | Postgres boot safety | Gate `startAutoSave`/`flushStores` on JSON mode; boot log for persistence mode | S | Low |
| 1 | Close the model gaps | Prisma models + repos for the 8 model-less stores (or explicit "accept loss") | M | Low |
| 2 | Auth persistence foundation | Models for sessions/refresh tokens, `authConfig`, `oidcProviders` (or Redis for sessions) | M | Med |
| 3 | Auth/SCIM → repo (async) | Convert `auth*.ts`, `scim.ts`, `account-lockout`, `scim-groups` off the `people` array to `await peopleRepo.*`; sync→async handlers | L | Med |
| 4 | org-scope conversion | Load org tree once per request, thread it through the ~25 route callers of `lib/org-scope` | L | Med (wide) |
| 5 | report-engine conversion | Pre-materialize the 9 stores; move join reads out of per-row closures; `executeReport`→async — see [`POSTGRES_CUTOVER_PR5_REPORT_ENGINE.md`](./POSTGRES_CUTOVER_PR5_REPORT_ENGINE.md) | M | **High** |
| 6 | digest + scheduler | `gapSnapshots`→repo (preserve push-order via `ORDER BY`); org iteration + `schedulerState`→repo | M | Med |
| 7 | Foreign-array long tail | Every `<foreignArray>.push/splice` outside its owning route → foreign repo | M | Med |
| 8 | JSON→Postgres migration script | `scripts/migrate-json-to-postgres.ts` (the missing `prisma/seed.ts`) | M | Med |
| 9 | Statelessness cleanup | Gate `loadStore` hydration off in PG mode; retire dead arrays | S–M | Low |
| 10 | Expand live-db CI | Business-flow tests under `DATABASE_URL`, not just one file (checklist #24) | M | Low |

### Detail per PR

**PR 0 — Postgres boot safety.** *Prerequisite for everything. Landed.*
Gates `startAutoSave(stores)` / `flushStores(stores)` on `!hasDatabase()` and logs
the resolved persistence mode at boot, so Postgres mode never overwrites the JSON
files. No behavior change in JSON mode (all 833 tests green).

**PR 1 — Close the model gaps.** *Implemented.* Seven of the eight orphan stores
don't fit the standard `{id}` entity repository, so they're modeled by shape:

- **`AppSetting`** — one generic key-value table (`key` PK, JSONB `value`) backing
  the three global singletons `branding`, `aiSettings`, `schedulerState`. Exposed
  via a `SettingRepository` (`get`/`set`), not the CRUD `Repository<T>`.
- **`ScimGroup`** — standard `{id}` model + `Repository<StoredScimGroup>` (members
  as a JSON column; no orgId — SCIM groups are directory-global).
- **`RaciOverride`** — composite `@@id([nodeId, personId])`, FK-free; repo exposes
  `list`/`upsert`/`remove`.
- **`DbtAssetMapping`** / **`DbtTestMapping`** — composite `@@id([orgId,
  dbtUniqueId])`, served by one generic org-keyed mapping repository.
- **`aiTemplateCache`** — deliberately **not** modeled; it is a regenerable AI
  cache and stays in-memory per instance in Postgres mode.

Adds a Prisma migration (`20260721000000_pg_cutover_pr1_orphan_stores`) and repo
tests (JSON path + stubbed-delegate Prisma path). No consumer changes yet — the
wiring lands per-subsystem in PRs 3/6/7.

**PR 2 — Auth persistence foundation.** *Implemented.* Backs the auth state that
was in-memory-only (no store, no model):

- **`RefreshToken`** model + `RefreshTokenRepository` (`list`/`get`/`upsert`/
  `remove`, keyed by `jti`) — replaces the `validRefreshTokens` Map in
  `auth.ts`. Timestamps kept as ISO strings to match `RefreshTokenContext`
  verbatim. (Postgres-backed; Redis with TTL remains a valid production
  alternative for this high-churn store.)
- **`OidcProvider`** model + standard `{id}` repo — replaces the `oidcProviders`
  Map; persists the plain `OidcConfig` (running providers reconstructed at the
  call site in PR 3). `clientSecret` must be KMS-encrypted at rest before
  production (checklist #11).
- **`authConfig`** — the one-field `{ activeProvider }` global singleton reuses
  the PR 1 `AppSetting` table (key `"authConfig"`); **no new model**.

Adds a migration (`20260721010000_pg_cutover_pr2_auth_persistence`) and repo
tests. No consumer wiring yet — the auth/SCIM cutover is PR 3.

**PR 3 — Auth/SCIM → repo.** *First behavior-changing PR — delivered as small,
independently-reviewable slices rather than one large diff.* The `Person` model
**already carries every auth column** (`passwordHash`, `mfaSecret`,
`webauthnCredentials`, `lockedUntil`, …), so no people-schema change — the routes
just bypass the repo.

Slices:
- **3a — SCIM Groups (done).** `services/scim-groups.ts` + the `scim.ts` `/Groups`
  handlers converted to async over the `ScimGroup` repo; the `/Users` DELETE
  handler awaits the (now async) member cleanup. Added the first SCIM-groups
  service tests (the subsystem had none). Self-contained — `scim.ts` is the only
  consumer.
- **3b — SCIM Users (done).** `scim.ts` `/Users` handlers converted to async over
  a local `getPeopleRepository(people)`: list/get/create/update/delete replace the
  `people.find/some/push/splice` + `saveStore` calls, mirroring the proven
  mutate-then-`update(id, person)` pattern from `routes/people.ts`. Added the
  first SCIM `/Users` route tests.
- **3c — Auth-providers config (done).** `authConfig` → `AppSetting` (key
  `"authConfig"`) via a shared `stores/app-settings.ts`; `oidcProviders` Map →
  `OidcProvider` repo. The read API (`getAuthProvider`/`getOidcProvider`) stays
  **synchronous** over the in-memory instances; the three writes
  (`updateAuthConfig`/`upsertOidcProvider`/`removeOidcProvider`) became async and
  persist, and a new `initAuthProviders()` (called at boot in `index.ts`)
  rehydrates the in-memory state from persistence. Added persistence tests.
- **3d — Refresh tokens (done).** `validRefreshTokens` Map → `RefreshTokenRepository`
  across `auth.ts` (mint / refresh / rotation / logout / SLO / the three
  `/sessions` handlers). `createRefreshToken` became async, so its callers in
  `auth.ts`, `auth-mfa.ts`, `auth-webauthn.ts` await it (their handlers were
  already async). Added the first `/sessions` + `/refresh`-rotation tests.
- **3e — Password / MFA / WebAuthn / lockout (done).** `auth-password.ts`,
  `auth-mfa.ts`, `auth-webauthn.ts`, `account-lockout.ts`, plus the remaining
  `people.find` + `saveStore('people', …)` in `auth.ts`'s login/callback/refresh
  handlers → `await peopleRepo.*` (mutate-then-`update(id, person)`). Lockout
  helpers (`recordFailedLogin`/`clearLockout`/`adminClearLockout`) became async;
  their callers and the `account-lockout` test were updated to await.

**PR 3 complete:** no direct `people`-array or `saveStore('people', …)` access
remains anywhere in the auth/SCIM subsystem — it reads and writes entirely
through the repositories.

Verify each slice: `tsc` + JSON suite green, plus the live-db CI job for the
Postgres path. This subsystem had almost no prior test coverage, so each slice
adds tests as it lands.

**PR 4 — org-scope (done).** Widest blast radius: `lib/org-scope` helpers are
called inline at **80+ sites across 24 route modules**, so an async conversion
would ripple `await` everywhere. Instead — since the org tree is small,
slowly-changing reference data read synchronously — org-scope keeps its public
API and reads from a **repo-backed cached snapshot in Postgres mode** (the live
`organizations` array in JSON mode): hydrated at boot via `initOrgScope()`
(wired in `index.ts`), refreshed on a short background TTL, and only ever
under-inclusive while cold (never over-inclusive → no cross-org leak). The
scoping logic is factored into pure `*In(orgs, …)` helpers with direct unit
tests. **All 24 caller files are untouched** and JSON-mode behavior is
byte-identical. *Follow-up:* invalidate the cache on org writes for immediate
read-your-writes (currently eventually-consistent within the TTL).

**PR 5 — report-engine (done).** Implemented per its design doc
[`POSTGRES_CUTOVER_PR5_REPORT_ENGINE.md`](./POSTGRES_CUTOVER_PR5_REPORT_ENGINE.md):
the `STORES` array-thunk registry became a `REPOS` registry over the 9 entity
repositories; `executeReport` is async and **materializes each needed entity
once** into an id-indexed `Map`, so the per-row join closures resolve via O(1)
lookups (no N+1 against Postgres). `filterByOrg`/`matches`/sort/limit are
unchanged; `validateDefinition` stays sync (empty-index stub). The two
`reports.ts` callers `await`. JSON-mode behavior is byte-identical.

**PR 6 — digest + scheduler (done).** `digest.service`: `gapSnapshots` → the
gap-snapshots repo; `takeGapSnapshot`/`findPreviousSnapshot`/`digestForOrg` are
async. Push-order is preserved — the repo's Postgres `list()` now `ORDER BY
takenAt` (matching the JSON array/push order `findPreviousSnapshot` walks); the
same-millisecond tie is a test/rapid-trigger edge only. `scheduler.service`:
`for (const org of organizations)` → `await orgRepo.list()`, the injected digest
inputs fetched once via repos, and `schedulerState` → the shared `AppSetting`
table (key `"schedulerState"`); `getLastWeeklyDigestFiredAt` /
`shouldFireWeeklyDigest` / `setLastWeeklyDigestFiredAt` / `resetSchedulerState`
are async. `tick()` was already async, so the timer plumbing is unchanged.
`routes/digest.ts` fetches inputs via repos and awaits. JSON-mode behavior
unchanged.

**PR 7 — Foreign-array long tail.** Grep-driven sweep: every
`<foreignArray>.push/splice/find/filter` outside the array's owning route, routed
through that entity's repo. Split into two mergeable parts:

- **PR 7a (done) — config stores → AppSetting.** `branding` and `aiSettings`
  retired to the shared `AppSetting` table via the 3c hydrate-at-boot + persist
  pattern (`initBranding()` wired into `index.ts`; `rehydrateAiOverride()` async).
  Reads stay synchronous over the in-memory copy; writes are async. The old
  `brandingStoreArray` autosave entry is removed. `aiTemplateCache` stays
  in-memory (unmodeled, per PR 1).
- **PR 7b (done) — clean foreign-entity creates.** The routes that create a
  *foreign* entity but whose own reads were already fine: `dama-roles.ts` +
  `governance-calendar.ts` (governanceTasks) and `connectors.ts` (dataAssets) now
  create through the target repository instead of `array.push` + `saveStore`.
  (The governance-tasks repo is built lazily inside the handler to avoid a
  circular-import init cycle.) The cascade `mappings.splice` in `organizations.ts`
  / `process-catalog.ts` are JSON-mode cleanups Postgres FK cascades handle, and
  `demo-seed` / one-time migrations are boot/dev tooling — all left as-is.
- **PR 7c (pending) — entangled routes needing a fuller migration.**
  `agent-executions.ts`, `data-lineage.ts`, and `dashboard.ts` mix reads of their
  *own* still-array-backed entity with foreign writes, so converting only the
  foreign write would leave reads on the stale array — they need a PR-3-style
  route migration (own reads → repo too). This also covers wiring the PR-1
  `raciOverrides` and dbt-mapping repos (their consumers live in those routes).

**PR 8 — Migration script.** No `prisma/seed.ts` exists though `package.json`
points at it. Model on `services/demo-seed.service.ts` (already inserts in
dependency order). Swap each `saveStore(name, arr)` for a loop of
`getXRepository(arr).create(row)` (auto-targets Postgres). FK insert order:
1. `Organization` (self-parent `parentId`, `onDelete: Restrict` → two-pass:
   insert with null parent, then set), then `Person` (root, `email @unique`).
2. `System`, `ProcessNode` (self-parent), `DataDomain`, `Skill`, `DamaRole`, `PersonOrg`.
3. `DataAsset`, join tables (`SystemCustodian`, `DataDomainSteward`, `ProcessNode*`).
4. `GovernancePolicy` → `Mapping`, `FlowRelationship`, `DataAssetBinding/Column/Steward`.
5. Leaves (Org-only or no FK): tasks, issues, comments, notifications, audit logs,
   connectors, lineage links, snapshots, agents, etc.
Person `onDelete: SetNull` FKs let you insert even if a referenced person is
missing. Make it idempotent (skip/upsert on existing id). *Optional* — most
customers cut over on a fresh org with no JSON to preserve.

**PR 9 — Statelessness cleanup.** Once all consumers go through repos, gate the
`loadStore` array hydration off in PG mode and retire the dead exports so an
instance holds no per-process entity state.

**PR 10 — Expand live-db CI.** Today the `test-backend-live-db` job runs only
`live-db.test.ts`. Add real business-flow coverage (catalog CRUD, mapping,
gap-detection, auth) under `DATABASE_URL` (checklist #24).

## 4. Critical path & sequencing

```
PR0 (boot safety) ─┬─> PR3 (auth) ──> PR7 (long tail) ──> PR9 (cleanup) ──> PR10 (CI)
                   ├─> PR4 (org-scope) ─┘        (PR8 migration can land any time after PR1)
PR1 (models) ──────┼─> PR6 (digest/scheduler)
PR2 (auth models) ─┘
                   └─> PR5 (report-engine)  [parallelizable, highest risk — start early]
```

- **PR 0 first, always** — it stops Postgres mode from corrupting the JSON files.
- **PR 1 + PR 2 (models)** unblock PR 3 and PR 6.
- **PR 5 (report-engine)** is the long pole on risk — scope it early even if it
  merges later.
- PRs 3–7 are the bulk; each is verifiable in isolation against the live-db harness.

## 5. Deploy prerequisites (ops, not app code — parallel track)

Go-live checklist items that gate an actual Postgres deploy but need no app
changes: **#1** provision Postgres, **#2** `prisma migrate deploy`, **#7** RS256
`JWT_PRIVATE_KEY`/`PUBLIC_KEY`, **#8** real `REDIS_URL`, **#11** `KMS_PROVIDER`
for at-rest MFA/password secrets.

## 6. Rough size

~10 PRs. PRs 4, 5, 7 are the large ones; PRs 0, 9 are small. The critical path
for a **single-node pilot** (0→1→2→3→6 + migration) is a couple of weeks; full
statelessness (4, 5, 7, 9, 10) is the tail.
