# Postgres migration playbook

> **Status: the cutover is complete.** Every store now reads and writes
> through its repository; in Postgres mode the legacy in-memory arrays are
> retired (`loadStore` returns `[]`) and a live-DB suite gates it in CI.
> Postgres is a first-class path — set `DATABASE_URL` and the whole backend
> uses it. JSON-file persistence remains the zero-config **default** when
> `DATABASE_URL` is unset (local dev / demo). The per-handler conversion
> walkthrough below documents *how* the cutover was carried out and is
> retained as the reference pattern to mirror when adding a **new** entity —
> it is no longer an outstanding to-do list.

Procela's backend defaults to JSON-file persistence and switches to
Postgres when `DATABASE_URL` is set.

This document is the map: how to run the DB path locally, where the
pieces live, and the repository pattern every entity follows.

## Running against Postgres

1. **Start a Postgres**. Any Postgres 15+ works. Locally with Docker:

   ```bash
   docker run --name procela-pg -d \
     -e POSTGRES_PASSWORD=procela -e POSTGRES_DB=procela \
     -p 5432:5432 postgres:16-alpine
   ```

2. **Set `DATABASE_URL`** in `packages/backend/.env`:

   ```env
   DATABASE_URL=postgresql://postgres:procela@localhost:5432/procela?schema=public
   ```

3. **Apply the schema**:

   ```bash
   cd packages/backend
   npm run db:generate     # regenerate the Prisma client
   npx prisma migrate deploy  # applies prisma/migrations/*.sql
   ```

   The initial migration `20260716200000_init/migration.sql` was
   generated from the schema via `prisma migrate diff` and is the
   ground truth for the DB shape. Every future schema change should
   be captured as a new migration via `prisma migrate dev --name
   <describe-change>` against a local dev DB, then committed.

4. **Boot the backend**. With `DATABASE_URL` set, every route reads and
   writes through Postgres. With it unset, the same routes fall back to
   the JSON files under `.procela-data/`. The switch is per-store and
   automatic — no code change flips between them.

## The repository conversion pattern

Every entity has a repository (`db/<entity>.repo.ts`), and every route
now goes through it. This section documents the pattern that was applied
to each handler during the cutover — mirror it when you add a **new**
route or entity. The steps:

1. **Import the factory** at the top of the route file:
   ```ts
   import { getOrganizationsRepository } from '../db/organizations.repo';
   ```
2. **Cache the repo** at module load, right below the store:
   ```ts
   const orgRepo = getOrganizationsRepository(organizations);
   ```
3. **Convert one handler at a time** — the read handlers first
   (simpler, no cascade concerns). Add `async`, replace direct array
   reads with `await orgRepo.list()` / `.get()`, then keep the rest
   of the business logic unchanged.

   ```ts
   router.get('/', async (req, res) => {
     const all = await orgRepo.list();
     // ... same logic as before, operating on `all` instead of the
     // module-level `organizations` array.
   });
   ```
4. **Write handlers** (POST/PUT/DELETE) follow the same shape but
   call `.create()` / `.update()` / `.delete()`. When on the JSON
   path, the shared in-memory array stays consistent because
   `jsonRepository()` mutates the same reference. On the Postgres
   path, the array falls out of sync — cross-file consumers that
   still import the array would read stale data. That is why the cutover
   was done per-handler: each conversion had to account for what else
   read the array and either convert those too or keep the array in sync
   (dual-write). That work is finished — in Postgres mode `loadStore`
   returns `[]` and no consumer reads the arrays.

`routes/organizations.ts` was the reference `async` handler (GET / —
the whole-org list); every other handler across the codebase followed
the same shape.

End state (reached): every handler is async and the repository is the
only persistence surface on the Postgres path. The exported in-memory
arrays remain solely as the backing store for the JSON default.

## Where the pieces live

```
packages/backend/
├── prisma/
│   ├── schema.prisma            # 63 models, 7 enums — the source of truth
│   └── migrations/              # generated SQL migration files
└── src/
    └── db/
        ├── prisma.ts             # Prisma client singleton (lazy)
        ├── repository.ts         # Repository<T> interface + jsonRepository()
        └── organizations.repo.ts # Reference migration — mirror this shape
                                  #   for every subsequent entity
```

The **schema** is complete for the 18 core entities (Organization,
Person, ProcessNode, System, DataAsset, DataDomain, Mapping,
Skill, DamaRole, AuditLog, Notification, GovernanceTask,
GovernanceIssue, GovernancePolicy, GovernanceControl,
GovernanceGroup, Comment, FlowRelationship, plus join tables).
Secondary stores (attachments, connectors, savedViews, scheduler
state, tags, etc.) are enumerated in a comment at the bottom of
`schema.prisma`; all of them have since been added and migrated.

## Migrating the next entity

Follow the shape of `db/organizations.repo.ts`. Every entity gets
three layers:

1. **JSON adapter** — one line:

   ```ts
   export function jsonPeopleRepository(store: StoredPerson[]): Repository<StoredPerson> {
     return jsonRepository(store, () => saveStore('people', store));
   }
   ```

2. **Prisma adapter** — a mapper between the on-disk shape and the
   Prisma row (dates as ISO strings on the way out, nulls translated
   to sensible defaults, join-table rows loaded eagerly if the JSON
   shape flattened them into an `orgIds: string[]`), plus the five
   CRUD methods calling the injected Prisma delegate. Follow the
   pattern in `organizations.repo.ts` — especially the injectable
   `clientFactory` argument so the repo is testable without a live DB.

3. **Factory** — one line:

   ```ts
   export function getPeopleRepository(store: StoredPerson[]): Repository<StoredPerson> {
     return hasDatabase() ? prismaPeopleRepository() : jsonPeopleRepository(store);
   }
   ```

Then in the route file:

- Import the factory at module load time. Cache the returned
  repository in module scope. Existing `loadStore/registerStore` calls
  can stay for now — they populate the JSON array that the JSON
  adapter wraps, and Postgres runs beside it without conflict.
- Convert the handlers that touch this entity to `async` and swap
  `store.find(...)` / `store.push(...)` for `await repo.get(...)`
  / `await repo.create(...)`.
- Add a stubbed-Prisma unit test mirroring
  `__tests__/repository.test.ts` (the "prismaOrganizationsRepository"
  suite) — cover at least the null translations, the `orgId` filter
  argument, and the P2025 → null translation.

## Testing

- **Unit tests** — the JSON adapter path runs on every CI build; the
  Prisma adapter path uses an injected stub delegate to avoid needing
  a live database. See `src/__tests__/repository.test.ts` for the
  pattern. This is enough to catch mapping bugs (StoredOrg ↔ Prisma
  row) and interface drift.
- **Live-DB tests** — `src/__tests__/live-db.test.ts` exercises each
  repository's Prisma path against a real Postgres. The file is a
  no-op when `DATABASE_URL` is unset, so `npm test` locally stays
  fast; the `test-backend-live-db` CI job sets the env var and
  spins up a Postgres 16 service container. Any schema drift or
  mapping bug that the stubbed unit tests can't see (unknown column,
  missing FK, wrong Postgres type) fails there.
- **Adding a live-DB case for a new entity**: import the
  `prisma<Entity>Repository` factory, seed any FK prereqs via
  `loadPrisma()`, run a create → get → update → delete cycle.
  `truncateAll()` runs before each test so state doesn't leak.
  Add the entity's table to that helper's list too.

## Repository coverage

Repository-mapped (complete):

- **Organization** (reference — `db/organizations.repo.ts`).
- **DataDomain** (`db/data-domains.repo.ts`, includes the M2M
  stewardIds join-table rewrite pattern — see the update() method
  for the delete-all + createMany idiom).
- **DataAsset** (`db/data-assets.repo.ts`, adds native Postgres
  `String[]` for sensitivity tags, JSONB payloads for
  retentionDuration, and multiple string-enum fields that keep
  the storage layer permissive while the code enforces the
  vocabulary in validation).
- **Mapping** (`db/mappings.repo.ts`, scalar-only shape with
  multiple optional FK slots — dataAssetId / policyId / attachmentId,
  exactly one set at a time. Attachment isn't in the schema yet so
  attachmentId is a bare uuid; the other two are proper FKs).
- **Person** (`db/people.repo.ts`, the field-heaviest entity so
  far. Two M2M joins on one entity — orgIds via PersonOrg + skillIds
  via PersonSkill — both rewritten via delete-all + createMany. JSONB
  payloads for orgRoles and webauthnCredentials. Native String[] for
  mfaBackupCodes + accessibleOrgIds. Sensitive-field passthrough for
  passwordHash / mfaSecret — column-level KMS is a schema follow-up).
- **System** (`db/systems.repo.ts`, three named Person FK slots on
  one row — ownerPersonId, deputyOwnerId, stewardId — each with its
  own Prisma relation name. JSONB integrations alongside a free-text
  integrationPoints. custodianIds M2M via a new SystemCustodian join
  table).
- **ProcessNode** (`db/process-nodes.repo.ts`, the field-heaviest
  and M2M-heaviest entity — 30+ scalar fields including rich docs
  (purpose, businessOutcome, stakeholders, inputsOutputs), BCM
  (criticalityTier, rtoHours, successMeasure, slaTarget), the
  change-management review workflow fields, and **four M2M join
  tables** rewritten on update: orgIds, controlIds, requiredSkillIds,
  systemIds. The `rewriteJoin()` helper collapses the four rewrites
  into one shared code path).
- **AuditLog** (`db/audit-logs.repo.ts`, scalar-only with the
  hash-chain quirk. Schema loosened to accept the "system" sentinel
  orgId used by the bootstrap chain marker + arbitrary-string
  entityIds like "chain" / "password" / "*". The hash-chain
  computation stays in auditService; the repo just persists whatever
  prevHash / entryHash the service supplied — a round-trip preserving
  the fields byte-for-byte is the key contract).
- **Notification, GovernanceTask, GovernanceIssue, GovernancePolicy,
  GovernanceControl, GovernanceGroup, Comment, FlowRelationship,
  Skill, DamaRole** — the remaining 10 core entities, migrated in
  one batch (`db/<entity>.repo.ts`). Two new patterns worth noting:
  - **FlowRelationship** and **DamaRole** have no top-level `orgId`
    column. FlowRelationship's Prisma path filters via the join on
    `fromNode.orgId` (mirrors Person's post-map filter approach).
    DamaRole's ORG/DOMAIN scope resolves through `dataDomains` which
    is out-of-repo, so the `orgId` filter is a no-op on the repo
    side — callers filter in the route.
  - Every governance status / priority / tier is now `String` (not
    Prisma enum) so a customer can extend the vocabulary without a
    schema migration. Ten Prisma enums (TaskStatus, TaskPriority,
    IssueSeverity/Status/Source, PolicyType, ControlType,
    AutomationMode, GroupLevel, FlowType, DamaScopeType) were
    dropped when the fuller Stored* types landed.

**All 18 core entities + 29 secondary entities are now on the
repository pattern.** Every non-trivial store has schema + repo +
stubbed-Prisma tests + live-DB integration coverage.

Skipped as low-value or requiring source-shape changes:
- `branding` — Organization-level; already on Organization model.
- `aiSettings`, `schedulerState` — singletons without id/orgId.
- `raciOverrides`, `dbtAssetMappings`, `dbtTestMappings` —
  composite-key mapping rows without a real `id` field.

The schema is source-of-truth against the JSON row shape.

**Route conversion status**: complete. Every route handler reads and
writes through its repository; in Postgres mode the in-memory arrays are
retired (`loadStore` returns `[]`). The repository conversion pattern
above is the shape to reuse for any future route. See
[`POSTGRES_CUTOVER_PLAN.md`](./POSTGRES_CUTOVER_PLAN.md) for the full
record of how the cutover was delivered.

## Handling schema drift

Every entity discovered so far has some drift between the JSON row
and the initial Prisma model — the JSON stores kept evolving after
the schema was scaffolded. When migrating an entity, expect to:

1. Read the `Stored<Entity>` interface from the route file (or
   `stores/*.ts`). This is the ground truth for what fields exist.
2. Diff against the current model in `schema.prisma`. Add any
   missing fields to the model, keep the same names.
3. Run `npx prisma format && npx prisma validate` (from
   `packages/backend/`) to confirm the schema still parses.
4. When you're ready to actually run against Postgres, generate the
   migration with `npx prisma migrate dev --name migrate_<entity>`.
   Until then the schema is source-of-truth documentation.

For array fields (`stewardIds: string[]`, `orgIds: string[]`), the
Prisma model has an explicit join table already. Match the JSON
shape one-for-one in the mapper — flatten the join rows to a plain
`string[]` on read, delete-all + createMany on write. See
`data-domains.repo.ts` for the reference pattern.
