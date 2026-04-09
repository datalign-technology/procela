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

// Auto-save on interval
export function startAutoSave(stores: Record<string, () => any[]>, intervalMs: number = 10000) {
  setInterval(() => {
    for (const [name, getData] of Object.entries(stores)) {
      saveStore(name, getData());
    }
  }, intervalMs);
  logger.info({ interval: intervalMs, stores: Object.keys(stores) }, 'Auto-save started');
}
