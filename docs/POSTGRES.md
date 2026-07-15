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
- **Live DB tests** — not yet in CI. When the reference migration is
  proven end-to-end against a real Postgres, add a Docker Compose
  service to the E2E job that spins up Postgres, sets `DATABASE_URL`,
  runs migrations, and re-runs a targeted subset of the existing route
  tests through the Postgres path. Until then, live-DB validation is
  a manual step on the developer machine.

## What's left

Every entity beyond `Organization` is still on JSON only. The
migration order that makes the fewest downstream ripples:

1. **Organization** (done — reference).
2. **Person** (foundational; every ownership pointer joins here).
3. **System / DataDomain / DataAsset** (the data-catalog trio).
4. **ProcessNode** (the biggest entity by field count; do it after
   the smaller ones so any adapter-pattern refinements settle first).
5. **Mapping** (needs ProcessNode + DataAsset in place first).
6. **AuditLog** (has the hash-chain quirk — test carefully).
7. Notification, GovernanceTask, GovernanceIssue, etc.

Each migration is one PR. That gives you an incremental cutover
you can pause or roll back at any point, versus a big-bang PR that
would touch every route file at once.
