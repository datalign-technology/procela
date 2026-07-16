# Postgres migration playbook

Procela's backend still runs JSON-file persistence by default. The
Postgres migration is opt-in via `DATABASE_URL` and being done
**incrementally** — one entity at a time — because a full-repo
cutover on 55 stores is unshippable in one PR.

This document is the map: how to run the DB path locally, where the
pieces live, and how to migrate the next entity.

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
   npm run db:migrate      # applies all migrations in prisma/migrations/
   ```

4. **Boot the backend**. It runs as before; any route that has been
   migrated to the async Repository pattern (see below) automatically
   uses Postgres, while unmigrated routes continue to read/write
   the JSON files under `.procela-data/`.

## Where the pieces live

```
packages/backend/
├── prisma/
│   ├── schema.prisma            # 31 models, 17 enums — the source of truth
│   └── migrations/              # generated SQL migration files
└── src/
    └── db/
        ├── prisma.ts             # Prisma client singleton (lazy)
        ├── repository.ts         # Repository<T> interface + jsonRepository()
        └── organizations.repo.ts # Reference migration — mirror this shape
                                  #   for every subsequent entity
```

The **schema** is complete for the 20 core entities (Organization,
Person, ProcessNode, System, DataAsset, DataDomain, Mapping,
Skill, DamaRole, AuditLog, Notification, GovernanceTask,
GovernanceIssue, GovernancePolicy, GovernanceControl,
GovernanceGroup, Comment, FlowRelationship, plus join tables).
Secondary stores (attachments, connectors, savedViews, scheduler
state, tags, etc.) are enumerated in a comment at the bottom of
`schema.prisma` and will be added as their routes migrate.

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

## What's left

Repository-mapped so far:

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

**All 18 core entities are now on the repository pattern.** The
schema is source-of-truth against the JSON row shape; the repos are
wired up but unused (routes still touch the in-memory arrays
directly).

Still on JSON only — the ~30 secondary stores:

- **Data catalog adjuncts**: DataAssetBinding, DataAssetColumn,
  ProcessVersion, GlossaryTerm, DataQualityRule, DbtAssetMapping,
  DbtTestMapping, DbtCloudConnection, DataLineageLink,
  AssetLineageEdge.
- **Integration + connectors**: Connection, Connector,
  ConnectorEvent, ConnectionSystemLink, SyncConnection, Agent,
  AgentSchedule, AgentExecution.
- **Governance ops**: SavedView, Report, AnalysisReport,
  OperationsManual, SOP, CalendarEvent, DecisionRight,
  RaciOverride, GapSnapshot, MaturitySnapshot,
  SuggestionDismissal, Tag.
- **Auth + system**: SchemaGroup, AiSettings, AiTemplateCache,
  Branding, SchedulerState.

These land in the schema + get a repo as their route needs them.

Each migration is one PR. That gives you an incremental cutover
you can pause or roll back at any point, versus a big-bang PR that
would touch every route file at once.

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
