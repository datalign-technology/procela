# PR 5 design — report-engine Postgres conversion

Detailed conversion design for the highest-risk step of the
[Postgres cutover](./POSTGRES_CUTOVER_PLAN.md): making
`services/report-engine.ts` read through repositories instead of the
in-memory JSON arrays, so custom reports return correct data in Postgres mode.
Write this design down **before** touching the code — the risk is not the store
swap, it's the per-row join closures.

## 1. Why this one is risky

`executeReport()` is **synchronous** and resolves cross-entity joins **lazily,
once per row, inside closures**. Two facts collide:

- Repositories are **async** (`list()` returns a `Promise`).
- The join reads happen deep inside `read(row)` closures called in a tight
  projection loop (`report-engine.ts`, `resolveFieldPath` → `targetStore()` at
  the `one`/`many` branches). You cannot `await` per row, and you must not fire
  one query per row (N+1 against Postgres).

So the conversion is not a find-and-replace; it changes *when* data is fetched.

## 2. Current shape (as-is)

`services/report-engine.ts`:

- Imports 9 store arrays directly: `people`, `skills`, `processNodes`,
  `dataAssets`, `systems`, `mappings`, `dataDomains`, `damaRoles`, `organizations`.
- `STORES: Record<string, () => unknown[]>` maps LDM entity id → a thunk over the
  array; `getStore(entityId)` returns the array (throws on unknown entity).
- `validateDefinition(def)` — **pure over the LDM only** (`getEntity`), touches
  **no** store. Stays synchronous.
- `resolveFieldPath(entity, fieldPath)` returns `{ label, read(row) }`. For a
  joined path (`relId.fieldId`) the `read` closure calls
  `targetStore() = getStore(rel.target)` and then:
  - `cardinality: 'one'` → `targetStore().find(r => r.id === fk)` where `fk = row[rel.via]`.
  - `cardinality: 'many'` → `targetStore().filter(r => fks.includes(r.id))`,
    `fks = row[rel.via]`.
- `executeReport(def, orgId)` (sync):
  1. validate,
  2. `rows = getStore(def.entity)` then `filterByOrg(def.entity, rows, orgId)`,
  3. apply direct-field WHERE filters,
  4. project columns (calls each `read(row)`),
  5. sort (post-projection), 6. limit.
- `filterByOrg(entityId, rows, orgId)`: `organizations` unfiltered; `people`
  filtered on `orgIds[]`; everything else on `orgId`.

Callers — `routes/reports.ts`: handlers are already `async`.
`validateDefinition` at create (`:70`) and update (`:99`); `executeReport` at
`POST /:id/run` (`:127`) and `POST /preview` (`:142`).

## 3. Target shape (to-be)

Keep the exact filtering/projection/sort/limit semantics; change only the data
source and make the entry point async. Two principles:

1. **Fetch each needed entity once, up front** (materialize), then resolve joins
   against in-memory indexes — same as today, but sourced from a repo.
2. **Route through the repository, passing the existing module array**, so JSON
   mode is byte-identical (the repo's JSON path wraps that same array) and
   Postgres mode reads Postgres. No `hasDatabase()` branch inside the engine.

### 3.1 Repository registry (replaces `STORES`)

Replace the `() => array` thunks with repo accessors. Each entry returns a
`Repository<Row>` built from the same array the engine imports today:

```ts
import { getPeopleRepository }       from '../db/people.repo';
import { getProcessNodesRepository } from '../db/process-nodes.repo';
import { getDataAssetsRepository }   from '../db/data-assets.repo';
import { getSystemsRepository }      from '../db/systems.repo';
import { getMappingsRepository }     from '../db/mappings.repo';
import { getDataDomainsRepository }  from '../db/data-domains.repo';
import { getDamaRolesRepository }    from '../db/dama-roles.repo';
import { getOrganizationsRepository }from '../db/organizations.repo';
import { getSkillsRepository }       from '../db/skills.repo';

type Row = Record<string, unknown>;

const REPOS: Record<string, () => Repository<Row>> = {
  processNodes: () => getProcessNodesRepository(processNodes as Row[]),
  dataAssets:   () => getDataAssetsRepository(dataAssets as Row[]),
  systems:      () => getSystemsRepository(systems as Row[]),
  people:       () => getPeopleRepository(people as Row[]),
  organizations:() => getOrganizationsRepository(organizations as Row[]),
  mappings:     () => getMappingsRepository(mappings as Row[]),
  dataDomains:  () => getDataDomainsRepository(dataDomains as Row[]),
  damaRoles:    () => getDamaRolesRepository(damaRoles as Row[]),
  skills:       () => getSkillsRepository(skills as Row[]),
};

function repoFor(entityId: string): Repository<Row> {
  const f = REPOS[entityId];
  if (!f) throw new Error(`No repository registered for entity '${entityId}'`);
  return f();
}
```

The `as Row[]` casts bridge the concrete `StoredX[]` element types to the
engine's generic row shape; the repo factory still enforces its own type on the
JSON branch. (Confirm each factory takes the store array as its sole arg — all
nine do today.)

### 3.2 Materialization pass

Before projecting, compute the set of entities the report touches and fetch each
once. **Join targets must be fetched unfiltered** (today's `targetStore()` returns
the whole array), while the **primary** entity is fetched then `filterByOrg`'d —
identical to now.

```ts
// Which entities does this definition read? Primary + every join target
// referenced by a projected column or the sort field.
function neededEntities(entity: LdmEntity, def: ReportDefinition): Set<string> {
  const ids = new Set<string>([def.entity]);
  const paths = [...(def.columns ?? []).map(c => c.field),
                 ...(def.sort ? [def.sort.field] : [])];
  for (const p of paths) {
    if (!p.includes('.')) continue;
    const rel = entity.relationships.find(r => r.id === p.split('.')[0]);
    if (rel) ids.add(rel.target);
  }
  return ids;
}

// Fetch each needed entity once; build an id-index for O(1) join lookups.
async function materialize(ids: Set<string>): Promise<Map<string, Map<string, Row>>> {
  const byEntity = new Map<string, Map<string, Row>>();
  await Promise.all([...ids].map(async (id) => {
    const rows = await repoFor(id).list();           // unfiltered, whole entity
    const index = new Map<string, Row>();
    for (const r of rows) index.set(r.id as string, r);
    byEntity.set(id, index);
  }));
  return byEntity;
}
```

An **id-indexed `Map`** replaces the repeated `.find`/`.filter(includes)` scans —
`one` becomes `index.get(fk)`, `many` becomes `fks.map(fk => index.get(fk))`. This
is a strict improvement over today's per-row linear scans, so large reports get
faster, not just correct.

### 3.3 Thread the index into `resolveFieldPath`

`resolveFieldPath` gains a `resolveTarget: (entityId) => Map<string, Row>`
parameter; the join closures read from it instead of calling `getStore`:

```ts
function resolveFieldPath(
  entity: LdmEntity,
  fieldPath: string,
  resolveTarget: (entityId: string) => Map<string, Row>,
): ResolvedField | null {
  // ... direct-field branch unchanged ...
  const targetIndex = () => resolveTarget(rel.target);
  if (rel.cardinality === 'one') {
    return { label, read: (row) => {
      const fk = row[rel.via];
      if (!fk) return null;
      const hit = targetIndex().get(fk as string);
      return hit ? hit[targetFieldId] : null;
    }};
  }
  return { label, read: (row) => {
    const fks = (row[rel.via] as string[]) || [];
    if (!Array.isArray(fks) || fks.length === 0) return '';
    return fks.map(fk => targetIndex().get(fk))
              .filter(Boolean)
              .map(h => (h as Row)[targetFieldId])
              .filter(v => v != null).join(', ');
  }};
}
```

`validateDefinition` calls `resolveFieldPath` only to check existence — pass a
`() => new Map()` stub there (it never invokes `read`), so validation stays
synchronous and store-free.

### 3.4 `executeReport` becomes async

```ts
export async function executeReport(def: ReportDefinition, orgId: string): Promise<ReportRunResult> {
  const errors = validateDefinition(def);
  if (errors.length) throw new Error(`Invalid report definition: ${errors.map(e => e.message).join('; ')}`);
  const entity = getEntity(def.entity)!;

  const byEntity = await materialize(neededEntities(entity, def));
  const resolveTarget = (id: string) => byEntity.get(id) ?? new Map<string, Row>();

  // Primary rows: values of the primary index, then the existing org filter.
  let rows = [...(byEntity.get(def.entity)?.values() ?? [])];
  rows = filterByOrg(def.entity, rows, orgId);

  for (const f of def.filters ?? []) rows = rows.filter(r => matches(r[f.field], f.op, f.value));
  const totalMatched = rows.length;

  const resolved = (def.columns ?? []).map(c => {
    const r = resolveFieldPath(entity, c.field, resolveTarget)!;
    return { field: c.field, label: c.label ?? r.label, read: r.read };
  });
  const projected = rows.map(row => {
    const out: Row = {};
    for (const col of resolved) out[col.field] = col.read(row);
    return out;
  });
  // sort + limit unchanged.
  ...
}
```

`filterByOrg`, `matches`, sort, and limit are **unchanged**.

> **Ordering note.** Iterating a `Map`'s values preserves insertion order, and
> `repo.list()` on the JSON path returns array order, so JSON-mode output order is
> preserved. The Postgres path has no inherent order guarantee — if any report
> relies on natural store order without an explicit `sort`, add a stable
> `ORDER BY id` (or `createdAt,id`) in the repos' `list()` so JSON and Postgres
> agree. Verify against the snapshot cases in `report-engine.test.ts`.

## 4. Caller changes (`routes/reports.ts`)

Both call sites are already in `async` handlers — add `await`:

- `:127` `const result = await executeReport(report.definition, report.orgId);`
- `:142` `const result = await executeReport(definition, orgId);`

`validateDefinition` stays synchronous — no change at `:70`, `:99`.

## 5. Test changes

- `src/__tests__/report-engine.test.ts` — `executeReport` is now async; every call
  becomes `await`. The fixture pattern that "replaces array contents by reference"
  still works: the repo JSON path reads the same live array binding the test
  mutates. Add an assertion that a joined column resolves after the target array
  is repopulated (guards the materialize-once behavior).
- `src/__tests__/live-db.test.ts` (already references report-engine at `:474`) —
  add a report with a `one` join and a `many` join executed against Postgres,
  asserting parity with the JSON-mode expectation. This is the real proof the
  cutover works; it runs in the `test-backend-live-db` CI job.

## 6. Risk register

| Risk | Mitigation |
|------|-----------|
| Per-row `await` / N+1 against Postgres | Materialize each entity once up front; resolve joins from in-memory id-index. |
| Output-order drift JSON vs Postgres | Stable `ORDER BY id` in `list()`; assert parity in live-db test. |
| Over-fetching whole entities | Matches today's behavior (v1). Follow-up: push primary-entity WHERE + org filter into `repo.list({orgId, ...})`; keep join targets whole. |
| `people`/`organizations` org-scope semantics | Keep the existing `filterByOrg` (organizations unfiltered, people by `orgIds[]`) — do **not** delegate org scoping to `repo.list({orgId})`, whose semantics differ. |
| Type friction (`StoredX[]` vs `Row[]`) | Localized `as Row[]` at the registry boundary; engine stays generic. |

## 7. Scope boundary

This PR converts **only** `report-engine.ts` + its two callers + its tests. It
does **not** change the LDM, the report-builder UI, or push filters into SQL
(that's the noted follow-up). It can land independently of PRs 3/4/6 and is safe
to start early even if it merges later.
