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
- **PR 7c (done) — dashboard `raciOverrides`.** Fully migrated: `GET /raci`
  fetches the overrides once via the repo (`raciRepo.list()`) and the two matrix
  branches read that snapshot; `POST /raci/override` upserts/removes through the
  repo. Retires the PR-1 `raciOverrides` orphan store.
- **Remaining route migrations (own foreign-array reads) — broader than a tail.**
  `agent-executions.ts` and `data-lineage.ts` are full multi-handler routes that
  read their own still-array-backed entity across several handlers (plus the dbt
  mapping repos to wire), and `dashboard.ts`'s stats/scorecard handlers still read
  `people`/`systems`/`dataAssets`/… arrays. These are PR-3-style route migrations,
  not quick tail items. **PR 9 drives them**: gating `loadStore` hydration off in
  Postgres mode makes every remaining stale-array reader fail loudly, surfacing
  exactly which routes still need converting.

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

*Done:* `scripts/migrate-json-to-postgres.ts` (npm `db:migrate-json`). Reads
`.procela-data/*.json` and creates each row through the entity repositories
(which target Postgres when `DATABASE_URL` is set), in the FK-tier order above,
with a two-pass insert for the self-parent entities (`organizations`,
`processNodes`, `governanceGroups`). Idempotent (get-then-create skips existing
ids); the composite-key (`raciOverrides`, dbt mappings) and `appSetting` stores
upsert. A `--dry-run` flag reports per-store counts without writing (verified:
444 rows across 34 stores from the dev fixtures). `refreshTokens` (ephemeral)
and `aiTemplateCache` (regenerable) are skipped. **Caveat:** entity repos
persist scalar columns; M2M join tables (org memberships, stewards, skills,
process-node systems/controls) migrate only to the extent an entity's own
`create()` writes them — verify join coverage before relying on this for a
data-carrying cutover, or take the fresh-org path.

**PR 9 — Statelessness cleanup.**

- **9a (done) — stale-read diagnostic.** In Postgres mode `loadStore` now returns
  a Proxy that logs a one-time warning (with the calling site) the first time a
  consumer reads the array — turning "which routes still read arrays?" into a
  loud, self-reporting worklist. JSON mode returns the plain array unchanged
  (inert for dev/test). `aiTemplateCache` is allow-listed (intentionally
  in-memory). The Proxy is a faithful array (tested), so it never breaks a route
  — an unconverted route keeps working (on stale/empty data) but now announces
  itself in the logs.
- **9b (in progress) — act on the worklist + retire arrays.** Run against
  Postgres, convert every route the diagnostic flags to its repository, then
  flip `loadStore` in Postgres mode to return `[]` (no proxy) and retire the
  dead module-level exports so an instance holds no per-process entity state.
  Multi-increment (like PR 7) — the diagnostic's live worklist below is larger
  than the three routes originally guessed: most route *list handlers* still
  read arrays even though every entity's repo exists and is proven.

  **The live worklist (booted the backend against a real Postgres, drove
  traffic, collected the one-time warnings).** 29 stores still have a direct
  array read, each at a precise call site:

  | store | first call site | store | first call site |
  |-------|-----------------|-------|-----------------|
  | agentExecutions | ~~agent-executions.ts~~ **done (9b.1)** | governanceGroups | governance-groups.ts:114 |
  | agents | agents.ts:47 | governancePolicies | governance-policies.ts:49 |
  | analysisReports | ~~analysis-reports.ts~~ **done (9b.2)** | governanceTasks | governance-tasks.ts:168 |
  | auditLogs | audit.service.ts:97 | mappings | org-scope.ts:135 † |
  | comments | comments.ts:76 | notifications | notifications.ts:59 |
  | connectionSystemLinks | systems.ts:211 | operationsManuals | ~~operations-manuals.ts~~ **done (9b.3)** |
  | connections | connections.ts:127 | organizations | dashboard.ts:140 |
  | connectors | ~~connectors.ts~~ **done (9b.4)** | people | people.ts:331 |
  | damaRoles | dama-roles.ts:85 | processNodes | process-catalog.ts:280 |
  | dataAssets | data-assets.ts:97 | reports | ~~reports.ts~~ **done (9b.2)** |
  | dataDomains | data-domains.ts:36 | sops | org-scope.ts:135 † (aggregator-gated) |
  | dataLineageLinks | data-lineage.ts:114 | suggestionDismissals | ~~process-catalog + dashboard~~ **done (9b.3)** |
  | dbtCloudConnections | ~~dbt-cloud-connections.ts~~ **done (9b.2)** | syncConnections | ~~sync-connections.ts~~ **done (9b.4)** |
  | decisionRights | ~~decision-rights.ts~~ **done (9b.2)** | systems | systems.ts:106 |
  | flowRelationships | ~~process-catalog + dashboard~~ **done (9b.4)** | (connectorEvents) | ~~connectors.ts~~ **done (9b.4, bonus)** |

  **Progress: 10 / 29 stores converted** (+ `connectorEvents`, a latent 30th the
  original traffic sweep never triggered, cleared as a bonus). Remaining: 19.

  † The `filterByOrgScope()` framing turned out too optimistic: the *first*
  diagnostic hit for these stores was a `filterByOrgScope` call, but a store's
  warning only clears once **every** reader of its array is converted — and the
  real shared readers are the **generic aggregators**: `organizations.ts` (org
  deletion-impact summary + export + reset read ~17 stores directly),
  `dashboard.ts` `/stats`, `process-catalog`, `chat`, `search`,
  `digest.service`, `gap-detection`, `enterprise-view`, `exports`, `docs`,
  `analysis`. `mappings` alone is read in **16 files**. So `sops` (gated on the
  `organizations.ts` aggregator) and `mappings` (16 files) are **not** isolable
  leaf work — they belong to the aggregator phase. `operationsManuals` (single
  reader) and `suggestionDismissals` (process-catalog + one dashboard line) were
  cleanly isolable and are done.

  Each store is independent work; the `loadStore → []` flip is the *last* step,
  only safe once the table above is empty.

  - **9b.1 (done) — `agent-executions`.** Self-contained (sole live reader of the
    `agentExecutions` array; `agent-schedules` imports only `runAgentExecution`,
    and `index.ts`'s autosave closure is inert in PG mode). Converted all six
    handlers to `agentExecutionsRepo` (list/get/update/delete), guarded the
    boot-time `promotedDocumentId` backfill to JSON mode (Postgres rows always
    carry the column). Verified against a **local Postgres**: list/get read from
    PG, review + delete-all write to PG, and the `agentExecutions` boot warning
    is gone. PG mapping already covered by the live-db round-trip suite; JSON
    behaviour unchanged (repo wraps the same array), full suite green.
    *Deferred to their own line items:* the promote handler's foreign writes to
    `governancePolicies` / `mappings` (those stores' own conversions).

  - **9b.2 (done) — simple-leaf batch: `analysis-reports`, `reports`,
    `decision-rights`, `dbt-cloud-connections`.** Four self-contained single-store
    CRUD routes (no foreign-array reads of their own store). Each converted its
    remaining list/get reads to its repository (writes already went through the
    repo). Route-specific notes: `decision-rights`/seed now pre-fetches the org's
    rights once and creates each via the repo (dropped the `push` + `saveStore`);
    `dbt-cloud-connections` guarded its boot-time polling-field backfill to JSON
    mode, made the `requireConn` helper async, and moved `performRefresh`'s two
    saves + the scheduler tick's array scan onto the repo. Verified against a
    **local Postgres**: create/list/seed round-trip through PG (e.g. decision-
    rights create + seed → 11 rows in `decision_rights`; dbt token never leaked
    via `publicShape`), and all four boot/traffic warnings are gone. tsc clean,
    full suite green (890).

  - **9b.3 (done) — the isolable `filterByOrgScope` stores: `operations-manuals`,
    `suggestion-dismissals`.** Investigating "the filterByOrgScope four" surfaced
    the aggregator finding above (see †). Of the four, only these two had a
    bounded reader set and could be fully cleared:
    - `operations-manuals` — single reader (its own route). Converted list
      (`filterByOrgScope(await repo.list(), …)`), get/put/delete, and the seed
      dup-check (pre-fetch once). Seed → 7 rows in `operations_manuals`.
    - `suggestionDismissals` — read in `process-catalog` (the `dismissedTargetsFor`
      helper, now async; three dismissal CRUD handlers) and one `dashboard` `/stats`
      line. `process-catalog` now `export`s its `suggestionDismissalsRepo`; the
      dashboard reader uses it via the existing lazy `require` (keeps JSON mode
      wrapping the real array — passing `[]` to the factory would have read empty
      in file mode). `/stats` + the three suggestion handlers made async.
    Verified against a **local Postgres**: both readers work, and neither store
    warns at boot or under traffic. `sops` and `mappings` deferred to the
    aggregator phase (see †). tsc clean, full suite green (890).

  - **9b.4 (done) — isolable-leaf sweep: `sync-connections`, `connectors`
    (+ `connectorEvents`), `flowRelationships`.** Re-ran the reader-footprint
    check (read-triggering methods only — `push`/`splice` don't trip the Proxy,
    so `demo-seed`'s array writes never counted) to find stores with a bounded
    reader set:
    - `sync-connections` — single reader. Five id-`find`s → `repo.get`, list →
      `repo.list({orgId})`, boot-time `connectionId` backfill guarded to JSON
      mode. Create → 1 row in `sync_connections`.
    - `connectors` — single reader. Token-lookup middleware (`requireConnectorToken`,
      now async), list, three `find`s, and the exported `scanForOfflineConnectors`
      (sync → async: reads via `repo.list()`, writes each transition via
      `repo.update`; callers in `index.ts`'s offline-scan interval and the connector
      test updated to await). Its `connectorEvents` reader (one handler) was cleared
      in the same pass — a latent store the original traffic sweep never triggered.
    - `flowRelationships` — read in six `process-catalog` sites (delete-all,
      node-delete cascade, GET `/flows`, the POST `/flows` dup-check + cycle-BFS,
      DELETE `/flows/:id`) and one `dashboard` `/stats` line. `process-catalog`
      now `export`s its `flowRelationshipsRepo`; dashboard imports it. The POST
      `/flows` handler fetches the flow set once and reuses it for both the
      duplicate check and the cycle BFS. GET `/flows` made async.
    Verified against a **local Postgres**: sync-connections + connectors create
    rows in PG, all readers work, and none of the four warn at boot or under
    traffic. tsc clean, full suite green (890).

  **Aggregator phase.** The 19 remaining stores are all read by the generic
  multi-store aggregators (see †), so they clear only once those aggregators
  are converted. Unlike the leaf increments, converting one aggregator doesn't
  make a store's warning disappear (the store has other readers) — the payoff is
  (a) **correctness**: in Postgres mode these endpoints currently read empty boot
  arrays and silently return wrong results, and (b) removing a shared reader so
  each store drops toward its last one. Verification shifts from "warning gone"
  to "endpoint reads/writes the right PG data + emits no stale read of its own."

  - **9b.5a (done) — `organizations.ts` read aggregators: `/:id/impact`,
    `/:id/snapshot`.** Both tally / export every entity in an org subtree across
    ~16 foreign stores. Added a repo-backed `loadOrgScopeStores()` helper (a
    registry of `{routePath, storeExport, repoPath, repoFactory}` per store; lazy
    `require` avoids the import cycle, `make(arr).list()` reads Postgres in DB
    mode and the wrapped array in JSON mode) and routed both endpoints through it;
    the `organizations` tree itself now comes from `orgRepo.list()`. Both handlers
    made async. Verified against a **local Postgres**: seeded a data-asset in an
    org → `/impact` reports `dataAssets:1` and `/snapshot` includes it, read from
    PG (pre-conversion both would read the empty boot array and report 0). tsc
    clean, full suite green (890). *Deferred to 9b.5b:* the `DELETE /:id` cascade
    (reads **and** deletes/moves/orphans the same 16 stores — higher blast radius,
    its own PR).

  - **9b.5b (done) — `organizations.ts` `DELETE /:id` cascade.** The subtree
    deletion that removes descendant orgs and, per a `{actions}` body, deletes /
    moves / orphans rows across the same 16 foreign stores — previously all direct
    array `splice` + `saveStore`, i.e. **completely broken in Postgres mode** (it
    mutated JSON files, deleting nothing from the DB). Rewrote it repo-backed:
    - The subtree is computed locally from `orgRepo.list()` — `people.getDescendantOrgIds`
      reads the stale org array (would return `[]` in PG mode, so the cascade would
      only touch the root); reparent/delete of orgs now go through `orgRepo`.
    - `applySingleOrg` / `applyMultiOrg` are now async and take a `Repository`
      instead of a store array: `list()` once, then `delete()` / `update()` each
      matched row (orphan rewrites `orgIds[]` and re-homes `orgId`). A new
      `repoForStore(key)` accessor (same registry as the loader) hands each helper
      its repo.
    - The cross-reference cleanup (prune `governanceGroups.members`, delete
      `damaRoles`/`mappings` by dangling FK, strip `dataDomains.dataAssetIds`) is
      likewise repo-backed.
    Verified against a **local Postgres** across every path — seeded an org
    subtree + foreign rows directly in PG (the create endpoints that would seed
    them are themselves unconverted aggregators — see below), then: descendant +
    root org delete (3 orgs → 1), foreign single-org delete (`data_assets` → 0),
    multi-org **orphan** rewriting a person's `person_orgs` join from `[child,
    keeper]` to `[keeper]`, multi-org **move** re-homing a process node to a keeper
    org, and cross-ref cleanup pruning a mapping whose data-asset was deleted.
    tsc clean, full suite green (890). **`organizations.ts` is now fully
    converted.** *Surfaced along the way:* `POST /organizations` and
    `POST /data-assets` still validate against the stale org array (reject
    PG-created parents/orgs), so they're on the aggregator worklist too.

  - **9b.6 (done) — `dashboard.ts` (all 7 handlers).** The read aggregator behind
    the dashboards: `stats`, `scorecard`, `raci`, `raci/override`, `my-items`,
    `my-dashboard`, `governance-status` tally data across 13 stores. Added
    module-level repo handles (`getXRepository(<importedArray>)` for each store),
    then gave every handler a `Promise.all([...repo.list()])` at the top whose
    local consts **shadow the array imports** — so each handler's tallying logic
    is otherwise unchanged. The five sync handlers became async. Verified against
    a **local Postgres**: all seven endpoints return 200 with **zero** dashboard
    stale-read warnings, and `stats` reflects PG data (seeded a BRONZE asset →
    `dataAssets:1, bronze:1`, where the pre-conversion path reported 0). tsc
    clean, full suite green (890). (`flowRelationships` + `suggestionDismissals`
    readers here were already converted in 9b.3/9b.4.)

  - **9b.7 (done) — `search.ts` (global Cmd-K search).** A single `GET /` handler
    that scores a query across 9 stores (`systems`, `dataAssets`, `processNodes`,
    `connections`, `people`, `dataDomains`, `governanceGroups`, `glossaryTerms`,
    `mappings`). Added module-level repo handles + one `Promise.all` fetch at the
    handler top (local consts shadow the imports); handler made async. Verified
    against a **local Postgres**: seeded a "Zephyr SCADA" system → `?q=Zephyr`
    returns it (`type: system`), read from PG (pre-conversion: empty array, 0
    results); zero `search.ts` stale warnings. tsc clean, full suite green (890).

  - **9b.8 (done) — `gap-detection.ts`.** A single `GET /` handler computing 11
    gap categories across 7 stores (`processNodes`, `dataAssets`, `dataDomains`,
    `people`, `connections`, `systems`, `mappings`). Same shadowing pattern; the
    module-level `findAncestorPath` helper was parameterised to take the
    repo-loaded node set (it read the `processNodes` import directly), and the
    lazy `require('./mappings')` became a static import + repo handle (no cycle:
    `mappings` imports only entity routes). Handler made async. Verified against a
    **local Postgres**: seeded an unmapped BRONZE asset → `orphanedAssets:1,
    unlinkedAssets:1`, read from PG (pre-conversion: 0); zero `gap-detection.ts`
    stale warnings. tsc clean, full suite green (890).

  **Entity routes (own list/read handlers).** The core entities' *write*
  handlers were converted long ago, but their read handlers + boot migrations
  still scan the arrays. Converting an entity's own route removes its single
  biggest reader; the store fully clears once the remaining aggregators drop it
  too. (Verification: the store no longer appears in the diagnostic when the
  route is exercised; any residual warnings the file still emits are for
  *foreign* stores it reads, tracked under those stores.)

  - **9b.9a (done) — `systems.ts`.** Nine handlers + a helper chain
    (`decorate` → `enrichIntegrations`/`referencedByIntegrations`, plus
    `validateIntegrations`) that read the `systems` array. Parameterised the four
    helpers to take the repo-loaded list; each handler fetches
    `await systemsRepo.list()` (or `.get`) and threads it through. Two boot
    migrations (the connectivity/integrations legacy rewrite and the
    `process.nextTick` dangling-reference prune) guarded to JSON mode — Postgres
    carries the canonical shape and enforces referential integrity via FKs. The
    import dup-check pre-fetches once and appends created rows so intra-import
    duplicates are still caught. Verified against a **local Postgres**: created
    two systems (one integrating with the other) → list resolves the integration
    target name from PG (`targetSystemName: "SysA"`) and `/:id/360` shows the
    reverse edge (`referencedByIntegrations: ["SysB"]`); the `systems` store no
    longer warns (the file's two residual warnings are foreign reads —
    `connectionSystemLinks`, `mappings`). tsc clean, full suite green (890).

  - **9b.9b (done) — `data-assets.ts` (`dataAssets` store).** 21 handlers; scoped
    to the `dataAssets` store (its sub-stores `dataAssetBindings`/`dataAssetColumns`
    weren't in the flagged set, and touching them would force the exported
    `getPrimaryBinding`/`purgeBindingsForConnection` async — cross-module ripple
    into `data-quality`/`connections` — so deferred). Converted the ~15 uniform
    `dataAssets.find(id)` lookups to `dataAssetsRepo.get`, the two
    `filterByOrgScope(dataAssets,…)` list handlers (list + orphans) to
    `repo.list()`, and `DELETE /all` to list+delete; three boot migrations
    (steward/dataType/health/origin backfills, `backfillOwnerPersonIds`,
    `migrateLegacySourceFieldsToBindings`) guarded to JSON mode. Six sync handlers
    made async. Verified against a **local Postgres**: create → list/get/orphans
    all read PG (`count:1`); the `dataAssets` store no longer warns (the one
    residual warning is a foreign `systems` read, tracked under systems). tsc
    clean, full suite green (890).

  - **9b.9c (done, partial) — `people.ts` handler reads.** Converted the CRUD/list
    handlers to repos: `DELETE /all`, `GET /`, `GET /:id`, `/:id/360`,
    `/:id/impact`, `/:id/forget` (GDPR), and the create/import email-dup checks
    (list-then-find; import prefetches once and appends created rows for
    intra-import dedup). The two legacy boot migrations (role→EDITOR, skillIds
    backfill) guarded to JSON mode. Verified against a **local Postgres** (person
    seeded directly): `GET /`, `GET /:id`, `/impact` all read PG and
    `publicPerson` still strips the password hash. **`people` is NOT yet fully
    cleared** — its *exported, synchronous* access-control helpers
    (`getVisibleOrgIds` / `canAccessOrg`, read on every request by auth middleware
    across the codebase) still read the array (people.ts:291). Making them async
    would ripple through the whole auth layer; the correct fix is a repo-hydrated
    **people cache** mirroring PR 4's org-scope cache — a distinct, auth-sensitive
    follow-up. Also surfaced: `POST /people` (like `POST /organizations` /
    `/data-assets`) validates the org against the stale array and has a
    create-path failure on PG — part of the create-endpoints worklist. tsc clean,
    full suite green (890).

**PR 10 (done) — Expand live-db CI.** `live-db.test.ts` had a
`live-db repository round-trips` suite proving each repo maps to Postgres in
isolation. Added a `live-db business flows` suite that drives the
cutover-converted *services* against the same live Postgres — the paths that
broke most subtly during the cutover, where a service still closing over a
stale boot-time array would pass the repo tests but return empty here. Seeds via
the Prisma repos, then asserts the service reads what the DB holds:
report-engine `executeReport` resolving a `processNodes → responsiblePerson`
join off Postgres; org-scope `getVisibleOrgScope` cascading over a
`refreshOrgScopeCache()`-hydrated tree; `SettingRepository` set→get round-trip
through the `app_settings` Json column. Same SKIP-when-`DATABASE_URL`-unset
harness, so `npm test` stays fast locally and the suite runs in CI's
`test-backend-live-db` job (checklist #24).

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
