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
});
