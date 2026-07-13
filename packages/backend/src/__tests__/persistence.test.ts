import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

// We test the persistence functions directly by importing them.
// The module resolves DATA_DIR from process.cwd(), so we use a temp dir approach.
import { saveStore, loadStore, ensureDataDir } from '../lib/persistence';

const DATA_DIR = path.resolve(process.cwd(), '.procela-data');

describe('persistence', () => {
  // Clean up test files after each test
  const testFiles: string[] = [];

  function cleanupFile(name: string) {
    const filePath = path.join(DATA_DIR, `${name}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  afterEach(() => {
    for (const name of testFiles) {
      cleanupFile(name);
    }
    testFiles.length = 0;
  });

  describe('ensureDataDir', () => {
    it('creates the data directory if it does not exist', () => {
      ensureDataDir();
      assert.ok(fs.existsSync(DATA_DIR));
    });
  });

  describe('saveStore and loadStore round-trip', () => {
    it('saves and loads data correctly', () => {
      const storeName = '__test_roundtrip';
      testFiles.push(storeName);

      const testData = [
        { id: '1', name: 'Alpha' },
        { id: '2', name: 'Beta' },
      ];

      saveStore(storeName, testData);
      const loaded = loadStore<{ id: string; name: string }>(storeName);

      assert.deepStrictEqual(loaded, testData);
    });

    it('handles empty arrays', () => {
      const storeName = '__test_empty';
      testFiles.push(storeName);

      saveStore(storeName, []);
      const loaded = loadStore(storeName);

      assert.deepStrictEqual(loaded, []);
    });

    it('preserves complex nested objects', () => {
      const storeName = '__test_nested';
      testFiles.push(storeName);

      const testData = [
        {
          id: '1',
          nested: { deep: { value: 42 } },
          tags: ['a', 'b', 'c'],
          active: true,
          score: null,
        },
      ];

      saveStore(storeName, testData);
      const loaded = loadStore(storeName);

      assert.deepStrictEqual(loaded, testData);
    });
  });

  describe('loadStore', () => {
    it('returns empty array for non-existent file', () => {
      const loaded = loadStore('__nonexistent_store_xyz');
      assert.ok(Array.isArray(loaded));
      assert.strictEqual(loaded.length, 0);
    });

    it('returns empty array for corrupted JSON file', () => {
      const storeName = '__test_corrupted';
      testFiles.push(storeName);

      ensureDataDir();
      const filePath = path.join(DATA_DIR, `${storeName}.json`);
      fs.writeFileSync(filePath, 'this is not valid json {{{');

      const loaded = loadStore(storeName);
      assert.ok(Array.isArray(loaded));
      assert.strictEqual(loaded.length, 0);
    });
  });

  describe('atomic write', () => {
    // A crash between the tmp write and the rename would leave a stray
    // `.tmp` sibling. Loading a store that has one should clean it up
    // and read the (still valid) real file — otherwise stray tmps
    // accumulate on every restart after a bad shutdown.
    // Tmp shape: `<name>.json.<pid>-<random>.tmp` — the writer now
     // uses a unique per-writer suffix so parallel workers don't
     // clobber each other's mid-write file.
    const hasAnyTmp = (storeName: string) =>
      fs.readdirSync(DATA_DIR).some(
        (e) => e.startsWith(`${storeName}.json.`) && e.endsWith('.tmp'),
      );

    it('removes stale .tmp siblings on load and keeps the real file intact', () => {
      const storeName = '__test_stale_tmp';
      testFiles.push(storeName);

      const realPath = path.join(DATA_DIR, `${storeName}.json`);
      const straySuffix = `.${process.pid}-abc123.tmp`;
      const tmpPath = path.join(DATA_DIR, `${storeName}.json${straySuffix}`);
      ensureDataDir();

      // Real file: a valid, previously-committed store.
      const real = [{ id: 'keep-me', value: 1 }];
      fs.writeFileSync(realPath, JSON.stringify(real, null, 2));
      // Stray tmp: half-written garbage from a "crash" mid-write. Age
      // it past the 60s stale threshold so the sweep picks it up.
      fs.writeFileSync(tmpPath, '[{"id":"partial');
      const past = (Date.now() - 120_000) / 1000;
      fs.utimesSync(tmpPath, past, past);

      const loaded = loadStore<{ id: string; value: number }>(storeName);
      assert.deepStrictEqual(loaded, real);
      assert.strictEqual(hasAnyTmp(storeName), false, 'stale tmp should be cleaned up');
      assert.strictEqual(fs.existsSync(realPath), true, 'real file should survive');
    });

    // Guardrail: a fresh tmp (mtime < 60s) belongs to an in-flight
    // writer. loadStore MUST NOT unlink it, or we'd race a concurrent
    // saveStore's rename and leave the store empty.
    it('leaves an in-flight .tmp alone (younger than the stale threshold)', () => {
      const storeName = '__test_fresh_tmp';
      testFiles.push(storeName);

      const realPath = path.join(DATA_DIR, `${storeName}.json`);
      const freshSuffix = `.${process.pid}-fresh1.tmp`;
      const tmpPath = path.join(DATA_DIR, `${storeName}.json${freshSuffix}`);
      ensureDataDir();
      fs.writeFileSync(realPath, JSON.stringify([{ id: 'k' }]));
      fs.writeFileSync(tmpPath, '[]');

      loadStore(storeName);
      assert.strictEqual(fs.existsSync(tmpPath), true, 'in-flight tmp should survive load');

      // Cleanup — the file isn't part of a routed store, so nothing
      // else will remove it.
      fs.unlinkSync(tmpPath);
    });

    // The atomic-write guarantee: after saveStore returns, no `.tmp`
    // file remains — the rename was either successful (tmp gone, real
    // updated) or failed loudly with cleanup.
    it('leaves no .tmp file behind after a successful save', () => {
      const storeName = '__test_atomic_success';
      testFiles.push(storeName);

      saveStore(storeName, [{ id: 'x', v: 1 }]);
      assert.strictEqual(hasAnyTmp(storeName), false);
    });
  });
});
