import fs from 'fs';
import path from 'path';
import logger from './logger';

const DATA_DIR = path.resolve(process.cwd(), '.procela-data');

export function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function saveStore(name: string, data: any[]) {
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

export function loadStore<T>(name: string): T[] {
  const filePath = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    logger.warn({ name }, 'Failed to load store, starting fresh');
    return [];
  }
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
 *  catches only opted-in modules. */
export function wipeAllStores(): { filesCleared: number; storesReloaded: string[] } {
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
  return { filesCleared, storesReloaded };
}
