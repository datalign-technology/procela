import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonSuggestionDismissalsRepository,
  prismaSuggestionDismissalsRepository,
  type PrismaSuggestionDismissalDelegate,
} from '../db/suggestion-dismissals.repo';
import type { SuggestionDismissal } from '../routes/process-catalog';

const make = (over: Partial<SuggestionDismissal> = {}): SuggestionDismissal => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  nodeId: 'n1',
  kind: 'asset',
  targetId: 't1',
  dismissedBy: null,
  dismissedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonSuggestionDismissalsRepository', () => {
  let store: SuggestionDismissal[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonSuggestionDismissalsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('delete returns true when found, false otherwise', async () => {
    const repo = jsonSuggestionDismissalsRepository(store);
    store.push(make({ id: 'a' }));
    assert.strictEqual(await repo.delete('a'), true);
    assert.strictEqual(await repo.delete('gone'), false);
  });
});

describe('prismaSuggestionDismissalsRepository', () => {
  function delegate(over: Partial<PrismaSuggestionDismissalDelegate> = {}): PrismaSuggestionDismissalDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps kind through as-is', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', nodeId: 'n1', kind: 'system',
        targetId: 't1', dismissedBy: 'u1',
        dismissedAt: '2026-07-15T00:00:00.000Z',
      }],
    });
    const repo = prismaSuggestionDismissalsRepository(() => ({ suggestionDismissal: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].kind, 'system');
    assert.strictEqual(rows[0].dismissedBy, 'u1');
  });

  it('delete returns false on P2025', async () => {
    const d = delegate({
      delete: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaSuggestionDismissalsRepository(() => ({ suggestionDismissal: d }));
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
