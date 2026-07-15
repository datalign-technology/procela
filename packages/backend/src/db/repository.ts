// Repository — the abstraction routes call so they don't have to
// know whether the row is stored in a JSON array or Postgres.
//
// Every repository is a small object of async CRUD verbs. Wrapping
// even the JSON path in a Promise keeps route code identical whether
// it's talking to memory or a database — the only work to migrate a
// route to Postgres is swapping the concrete repository behind it.
//
// Migration pattern:
//   1. Define the shared entity type (T)
//   2. Write a JsonRepository<T> factory over the existing in-memory
//      array (this is the "keep JSON working" path).
//   3. Write a PrismaRepository<T> that maps the same verbs onto a
//      Prisma delegate + a JSON<->row mapper.
//   4. Export `pickRepository()` that returns Postgres when
//      DATABASE_URL is set, JSON otherwise.
//   5. Convert the route handlers to `async` and await the repository
//      calls. That's the only route-side change; the rest of the
//      business logic stays put.
//
// The reference migration for this pattern is `organizations`
// (see db/organizations.repo.ts) — every subsequent entity follows
// the same three-file shape: entity type / json repo / prisma repo.

export interface Repository<T extends { id: string }> {
  /** List rows, optionally filtered by orgId. */
  list(filter?: { orgId?: string }): Promise<T[]>;
  /** Get one row by primary key, or null if not found. */
  get(id: string): Promise<T | null>;
  /** Persist a new row. Caller supplies the full row including id. */
  create(row: T): Promise<T>;
  /** Merge a partial patch onto an existing row. Returns the updated
   *  row, or null if the row does not exist. */
  update(id: string, patch: Partial<T>): Promise<T | null>;
  /** Delete a row. Returns true if a row was removed. */
  delete(id: string): Promise<boolean>;
}

/**
 * Wrap an existing in-memory JSON store as an async Repository. The
 * store keeps its current shape — the array is mutated in place and
 * `save()` is invoked on every write to preserve the atomic-rename
 * durability guarantee that saveStore provides.
 *
 * This lets a route migrate to the async Repository interface without
 * moving to Postgres in the same step — the Repository call path
 * still exercises the same durable JSON store the rest of the
 * backend uses.
 */
export function jsonRepository<T extends { id: string; orgId?: string }>(
  store: T[],
  save: () => void,
): Repository<T> {
  return {
    async list(filter) {
      if (filter?.orgId) return store.filter((r) => r.orgId === filter.orgId);
      return [...store];
    },
    async get(id) {
      return store.find((r) => r.id === id) ?? null;
    },
    async create(row) {
      store.push(row);
      save();
      return row;
    },
    async update(id, patch) {
      const row = store.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      save();
      return row;
    },
    async delete(id) {
      const idx = store.findIndex((r) => r.id === id);
      if (idx < 0) return false;
      store.splice(idx, 1);
      save();
      return true;
    },
  };
}
