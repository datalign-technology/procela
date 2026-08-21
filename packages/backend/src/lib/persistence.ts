import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import type { ZodType, ZodTypeDef } from 'zod';
import logger from './logger';
import { hasDatabase, getPrisma } from '../db/prisma';

// ──────────────────────────────────────────────────────────────────────────
// Postgres cutover PR 9 — stale-store read diagnostic.
//
// In Postgres mode the module-level `loadStore(...)` arrays hold only stale
// boot-state (empty on a fresh DB); the source of truth is the repository. Any
// consumer that still reads such an array directly is a cutover bug. To turn
// "which routes still read arrays?" from an open-ended grep into a loud,
// self-reporting worklist, in Postgres mode loadStore returns a Proxy that logs
// a one-time warning (with the calling site) the first time a read-ish member
// is accessed. In JSON mode it returns the plain array unchanged (zero
// behavioural difference), so this is inert for the default dev/test path.
// ──────────────────────────────────────────────────────────────────────────

// Stores that stay intentionally in-memory-per-instance even in Postgres mode
// (regenerable caches) — reads of these are NOT bugs, so don't flag them.
const IN_MEMORY_STORES = new Set<string>(['aiTemplateCache']);
const warnedStaleStores = new Set<string>();
const STALE_READ_KEYS = new Set<string>([
  'find', 'filter', 'some', 'every', 'map', 'forEach', 'reduce', 'length',
  'indexOf', 'findIndex', 'includes', 'slice', 'entries', 'values', 'keys',
]);

/** Wrap an array so the first read-ish access logs one diagnostic warning.
 *  Exported for tests; production goes through loadStore. */
export function instrumentStaleStore<T>(name: string, arr: T[]): T[] {
  return new Proxy(arr, {
    get(target, prop, receiver) {
      const isRead = prop === Symbol.iterator
        || (typeof prop === 'string' && (STALE_READ_KEYS.has(prop) || /^\d+$/.test(prop)));
      if (isRead && !warnedStaleStores.has(name)) {
        warnedStaleStores.add(name);
        const at = (new Error().stack || '').split('\n').slice(2, 4).map((s) => s.trim()).join(' <- ');
        logger.warn(
          { store: name, at },
          'Stale JSON-store read in Postgres mode — this consumer must go through the repository (cutover PR 9)',
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function maybeInstrumentStore<T>(name: string, arr: T[]): T[] {
  if (!hasDatabase() || IN_MEMORY_STORES.has(name)) return arr;
  return instrumentStaleStore(name, arr);
}

// Where JSON stores live. Defaults to `.procela-data` under the process
// cwd. PROCELA_DATA_DIR overrides it — used by tests that persist real
// rows (e.g. the demo-seed suite) to write into a private temp directory
// so their disk writes don't race other test files that share the
// default directory. Read once at module load, so a test that needs the
// override must set the env var before this module is first imported.
const DATA_DIR = process.env.PROCELA_DATA_DIR
  ? path.resolve(process.env.PROCELA_DATA_DIR)
  : path.resolve(process.cwd(), '.procela-data');

export function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Persist a store to disk atomically. Writes to a unique per-writer
 * `.tmp` file first, then renames over the real file — POSIX rename is
 * atomic, so a crash mid-write leaves either the old file or the
 * fully-written new file, never a truncated / half-serialized one. A
 * prior direct `writeFileSync` could produce a zero-byte JSON on power
 * loss which would then load as `[]` on next boot and silently wipe
 * the store.
 *
 * The tmp filename embeds `process.pid` + 6 random hex bytes so two
 * writers targeting the same store (parallel test workers under
 * `tsx --test`, a route handler that also autoWrites, etc.) don't
 * clobber each other's tmp — a fixed `.json.tmp` path caused a race
 * where writer A's rename raced writer B's write and one side threw
 * ENOENT.
 *
 * The write itself stays synchronous — Node's fs.rename is atomic on
 * the same filesystem (which .procela-data always is), and the sync
 * path keeps the existing call-site shape. If the rename fails the
 * temp file is best-effort deleted so we don't accumulate garbage on
 * repeated retries.
 *
 * Windows-specific: `fs.renameSync` can throw EPERM / EBUSY when the
 * antivirus or search indexer holds a transient handle on the target
 * file. Retry a handful of times with a tiny backoff before giving up
 * — this is Windows-only noise; POSIX renames don't hit it.
 */
const RENAME_RETRY_ERRNOS = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_MAX_ATTEMPTS = 5;

function renameWithRetry(tmpPath: string, finalPath: string): void {
  let lastErr: NodeJS.ErrnoException | null = null;
  for (let attempt = 0; attempt < RENAME_MAX_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(tmpPath, finalPath);
      return;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (!e.code || !RENAME_RETRY_ERRNOS.has(e.code)) throw err;
      lastErr = e;
      // Busy-wait a few ms before retrying. Sync sleep is fine — we're
      // already inside a sync write path and the retry window is short
      // enough that yielding to the event loop doesn't help (whatever
      // holds the file handle is another process, not this one).
      const until = Date.now() + 10 * (attempt + 1);
      while (Date.now() < until) { /* spin */ }
    }
  }
  throw lastErr;
}

export function saveStore(name: string, data: any[]) {
  ensureDataDir();
  const finalPath = path.join(DATA_DIR, `${name}.json`);
  const tmpPath = path.join(
    DATA_DIR,
    `${name}.json.${process.pid}-${randomBytes(6).toString('hex')}.tmp`,
  );
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  try {
    renameWithRetry(tmpPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore — tmp already gone */ }
    throw err;
  }
}

/**
 * Load a store from disk.
 *
 * Optional `rowSchema` (Zod) validates each row on load. Malformed
 * rows — the shape drifted after a rename, migration, or hand-edit —
 * are dropped from the returned array and logged individually so an
 * operator can trace which rows lost their shape. This is the
 * "log-and-quarantine" behaviour called out in the tech-debt sweep:
 * a shape mismatch surfaces at boot, not at the first mutation that
 * assumes the missing field.
 *
 * Without a schema, the store loads exactly as before — every row
 * comes through untyped, and the caller trusts the JSON. That path
 * stays the default so existing call sites don't need to adopt
 * schemas all at once.
 */
// rowSchema uses `unknown` for the Zod input type so callers can pass
// schemas that carry `.default(...)` for legacy fields (where the
// input shape differs from the parsed StoredX shape). Output type is
// still pinned to T, so downstream code sees the concrete row shape.
export function loadStore<T>(name: string, rowSchema?: ZodType<T, ZodTypeDef, unknown>): T[] {
  // Postgres mode: the repositories are the source of truth for every
  // store, so the JSON arrays are retired — return an empty,
  // stale-read-instrumented array instead of hydrating dead boot-state
  // from disk. This is the final step of the JSON→Postgres cutover (PR
  // 9b): with all readers repo-backed, nothing should touch the array in
  // Postgres mode, and anything that still does is a bug the instrument
  // proxy surfaces. The on-disk JSON files are left untouched (nothing
  // writes them in PG mode), so switching a machine back to JSON mode
  // still finds its data.
  //
  // IN_MEMORY_STORES (regenerable per-instance caches like
  // aiTemplateCache) are exempt: they legitimately use the array as their
  // backing store even in Postgres mode, so they load/stay real.
  if (hasDatabase() && !IN_MEMORY_STORES.has(name)) {
    return instrumentStaleStore(name, []);
  }
  return maybeInstrumentStore(name, loadStoreRaw(name, rowSchema));
}

function loadStoreRaw<T>(name: string, rowSchema?: ZodType<T, ZodTypeDef, unknown>): T[] {
  const filePath = path.join(DATA_DIR, `${name}.json`);
  // Stale `.tmp` siblings mean a crash occurred between the tmp
  // write and the rename. Sweep them so they don't accumulate — but
  // only tmps older than the STALE_TMP threshold, so a concurrent
  // writer mid-way through its writeFileSync + renameSync doesn't
  // have its in-flight file deleted out from under it. In practice a
  // JSON write finishes in single-digit ms; anything older than a
  // minute is definitely orphaned.
  const tmpPrefix = `${name}.json.`;
  const tmpSuffix = '.tmp';
  const STALE_MS = 60_000;
  const cutoff = Date.now() - STALE_MS;
  if (fs.existsSync(DATA_DIR)) {
    for (const entry of fs.readdirSync(DATA_DIR)) {
      if (!entry.startsWith(tmpPrefix) || !entry.endsWith(tmpSuffix)) continue;
      const p = path.join(DATA_DIR, entry);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      } catch { /* best-effort — file gone or unreadable */ }
    }
  }
  if (!fs.existsSync(filePath)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    logger.warn({ name }, 'Failed to load store, starting fresh');
    return [];
  }
  if (!Array.isArray(raw)) {
    logger.warn({ name }, 'Store root is not an array, starting fresh');
    return [];
  }
  if (!rowSchema) return raw as T[];
  const valid: T[] = [];
  let dropped = 0;
  for (let i = 0; i < raw.length; i++) {
    const parsed = rowSchema.safeParse(raw[i]);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      dropped++;
      logger.warn(
        { name, index: i, issues: parsed.error.issues.slice(0, 3) },
        'Store row failed schema validation, quarantining',
      );
    }
  }
  if (dropped > 0) {
    logger.warn({ name, kept: valid.length, dropped }, 'Store loaded with quarantined rows');
  }
  return valid;
}

// Auto-save on interval. Returns the timer handle so the caller can
// `clearInterval` it on shutdown. The timer is `unref`'d so it doesn't
// pin the event loop on its own — Ctrl+C exits cleanly even if the
// HTTP server has already stopped accepting connections.
export function startAutoSave(stores: Record<string, () => any[]>, intervalMs: number = 10000): NodeJS.Timeout {
  const handle = setInterval(() => {
    for (const [name, getData] of Object.entries(stores)) {
      saveStore(name, getData());
    }
  }, intervalMs);
  if (typeof handle.unref === 'function') handle.unref();
  logger.info({ interval: intervalMs, stores: Object.keys(stores) }, 'Auto-save started');
  return handle;
}

/**
 * Run a final save pass — used at shutdown to flush any in-memory
 * state to disk before exit. Skips the timer entirely.
 */
export function flushStores(stores: Record<string, () => any[]>): void {
  for (const [name, getData] of Object.entries(stores)) {
    try { saveStore(name, getData()); }
    catch (err) { logger.error({ err, name }, 'Final save failed'); }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Mutating reload registry — supports operations that rewrite store
// files on disk while route modules hold the in-memory copy. The GDPR
// cascade is the first consumer: after it scrubs personId references
// across every .procela-data/*.json file, it asks every registered
// store to splice its in-memory array back to match the disk.
//
// Each route module that wants to participate calls
//   registerStore('storeName', myInMemoryArray)
// at module-load time. After a cascade we walk the registry, reload
// from disk, and use array splice + push to mutate the existing
// reference in place so other modules that captured a reference
// still see the new content.
// ──────────────────────────────────────────────────────────────────────────

const reloadRegistry = new Map<string, any[]>();

/** Hook an in-memory store into the reload registry. Idempotent —
 *  registering the same name twice overwrites the registration. */
export function registerStore<T>(name: string, target: T[]): void {
  reloadRegistry.set(name, target);
}

/** Reload every registered store from disk, mutating the existing
 *  array references so callers that captured them see the new
 *  content. Used after a destructive on-disk operation (GDPR cascade)
 *  to bring in-memory state back in sync without a restart. Returns
 *  the list of stores that were touched. */
export function reloadAllStores(): string[] {
  const reloaded: string[] = [];
  for (const [name, target] of reloadRegistry) {
    try {
      const fresh = loadStore<any>(name);
      target.splice(0, target.length, ...fresh);
      reloaded.push(name);
    } catch (err) {
      logger.warn({ err, name }, 'Reload failed for registered store');
    }
  }
  return reloaded;
}

/** Hard-reset every JSON file under `.procela-data/` AND every
 *  registered in-memory array. Used by the "Reset everything" admin
 *  action behind a typed-confirmation gate. Returns a summary of
 *  what got cleared so the UI can surface counts to the operator.
 *
 *  Audit log files are intentionally NOT preserved here — the caller
 *  records a single ALL_DATA_RESET event after this returns so the
 *  reset itself is auditable. (Reset writes happen against the
 *  bootstrap chain immediately, since the prior chain is gone.)
 *
 *  Stores that aren't registered still have their files truncated
 *  on disk; their in-memory copies (if any) only reset on restart.
 *  Same caveat as the GDPR cascade — the file-level walk catches
 *  every JSON store including future ones; the in-memory registry
 *  catches only opted-in modules.
 *
 *  Postgres: when DATABASE_URL is set the source of truth is the
 *  database, not the JSON files, so the wipe also TRUNCATEs every
 *  application table. `_prisma_migrations` is preserved so the schema
 *  history stays intact; RESTART IDENTITY resets any serial sequences;
 *  CASCADE lets the truncate span the whole FK graph in one statement
 *  regardless of relation direction. Without this step a reset in
 *  Postgres mode cleared only the (stale) JSON files and left every
 *  real row in place. */
export async function wipeAllStores(): Promise<{ filesCleared: number; storesReloaded: string[]; tablesTruncated: number }> {
  let filesCleared = 0;
  if (fs.existsSync(DATA_DIR)) {
    for (const file of fs.readdirSync(DATA_DIR)) {
      if (!file.endsWith('.json')) continue;
      fs.writeFileSync(path.join(DATA_DIR, file), '[]');
      filesCleared++;
    }
  }
  const storesReloaded: string[] = [];
  for (const [name, target] of reloadRegistry) {
    target.splice(0, target.length);
    storesReloaded.push(name);
  }

  let tablesTruncated = 0;
  if (hasDatabase()) {
    const prisma = getPrisma();
    // Enumerate live tables from the catalog so the wipe stays correct
    // as the schema grows — no hardcoded table list to drift.
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    )) as Array<{ tablename: string }>;
    const tables = rows
      .map((r: { tablename: string }) => r.tablename)
      .filter((t: string) => t !== '_prisma_migrations');
    if (tables.length) {
      const list = tables.map((t) => `"public"."${t.replace(/"/g, '""')}"`).join(', ');
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
      tablesTruncated = tables.length;
    }
  }

  return { filesCleared, storesReloaded, tablesTruncated };
}
