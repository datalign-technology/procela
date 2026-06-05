import fs from 'fs';
import path from 'path';

// Test helpers for snapshotting / restoring JSON store files under
// .procela-data/. Used by tests that exercise services with hard-
// coded persistence side effects (account-lockout saves people, the
// audit chain saves auditLogs, etc.) so a test run can't clobber a
// developer's local data directory.

const DATA_DIR = path.resolve(process.cwd(), '.procela-data');

export interface StoreSnapshot {
  name: string;
  existed: boolean;
  content: string | null;
}

/** Read the current contents of one store file into a snapshot the
 *  test can restore later. Returns `existed: false` when the file
 *  doesn't yet exist on disk — restore() then deletes whatever the
 *  test wrote rather than re-creating an empty file. */
export function snapshotStore(name: string): StoreSnapshot {
  const filePath = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    return { name, existed: false, content: null };
  }
  return { name, existed: true, content: fs.readFileSync(filePath, 'utf-8') };
}

/** Restore one store from its snapshot. Safe to call multiple times. */
export function restoreStore(snap: StoreSnapshot): void {
  const filePath = path.join(DATA_DIR, `${snap.name}.json`);
  if (!snap.existed) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath, snap.content || '[]');
}

/** Overwrite a store's file contents with the given array. Use to
 *  set up a known starting state for a test. */
export function writeStore(name: string, data: unknown[]): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

/** Replace the contents of an in-memory array with the given items,
 *  mutating in place so existing references still see the change. The
 *  pattern that lets us swap fixtures in / out of route-module arrays
 *  (people, auditLogs, etc.) without re-importing the module. */
export function replaceArray<T>(target: T[], items: T[]): void {
  target.splice(0, target.length, ...items);
}
