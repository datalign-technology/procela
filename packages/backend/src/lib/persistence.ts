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
