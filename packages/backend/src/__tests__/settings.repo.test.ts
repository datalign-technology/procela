import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonSettingRepository,
  prismaSettingRepository,
  type AppSettingRow,
  type PrismaAppSettingDelegate,
} from '../db/settings.repo';
import { useStoreIsolation } from './_helpers/store-isolation';

describe('jsonSettingRepository', () => {
  useStoreIsolation({ file: 'appSettings' });
  let store: AppSettingRow[];
  beforeEach(() => { store = []; });

  it('round-trips a value under a key', async () => {
    const repo = jsonSettingRepository(store);
    await repo.set('branding', { companyName: 'Acme' }, 'u1');
    assert.deepStrictEqual(await repo.get('branding'), { companyName: 'Acme' });
  });

  it('set overwrites an existing key in place', async () => {
    const repo = jsonSettingRepository(store);
    await repo.set('aiSettings', { model: 'a' });
    await repo.set('aiSettings', { model: 'b' }, 'u2');
    assert.strictEqual(store.length, 1);
    assert.deepStrictEqual(await repo.get('aiSettings'), { model: 'b' });
    assert.strictEqual(store[0].updatedBy, 'u2');
  });

  it('get returns null for an unset key', async () => {
    const repo = jsonSettingRepository(store);
    assert.strictEqual(await repo.get('never-set'), null);
  });
});

describe('prismaSettingRepository', () => {
  function delegate(over: Partial<PrismaAppSettingDelegate> = {}): PrismaAppSettingDelegate {
    return {
      findUnique: async () => null,
      upsert: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('get maps the JSONB value column', async () => {
    const d = delegate({
      findUnique: async () => ({
        key: 'branding', value: { companyName: 'Acme' },
        updatedAt: new Date('2026-07-20T00:00:00.000Z'), updatedBy: 'u1',
      }),
    });
    const repo = prismaSettingRepository(() => ({ appSetting: d }));
    assert.deepStrictEqual(await repo.get('branding'), { companyName: 'Acme' });
  });

  it('get returns null when the key is absent', async () => {
    const repo = prismaSettingRepository(() => ({ appSetting: delegate() }));
    assert.strictEqual(await repo.get('gone'), null);
  });

  it('set upserts with create+update carrying the value', async () => {
    const captured: Array<{ create: Record<string, unknown>; update: Record<string, unknown> }> = [];
    const d = delegate({
      upsert: async (arg) => {
        captured.push({ create: arg.create, update: arg.update });
        return { key: 'k', value: {}, updatedAt: new Date(), updatedBy: null };
      },
    });
    const repo = prismaSettingRepository(() => ({ appSetting: d }));
    await repo.set('schedulerState', { key: 's', lastWeeklyDigestFiredAt: 42 }, null);
    assert.strictEqual(captured.length, 1);
    assert.deepStrictEqual(captured[0].create.value, { key: 's', lastWeeklyDigestFiredAt: 42 });
    assert.deepStrictEqual(captured[0].update.value, { key: 's', lastWeeklyDigestFiredAt: 42 });
  });
});
