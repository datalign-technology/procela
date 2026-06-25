// Tests for services/asset-suggestion.service — the first piece of
// Phase 3 Discover. Validates the ranking contract: name match wins
// over description match, same-system affinity moves the needle,
// already-mapped assets get excluded, and the rationale strings carry
// the why.
//
// The service takes its inputs by injection so tests don't have to
// touch the shared in-memory stores other tests depend on.
import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  rankSuggestions,
  tokenise,
  type SuggestionNode,
  type SuggestionAsset,
  type SuggestionMapping,
} from '../services/asset-suggestion.service';

function node(partial: Partial<SuggestionNode>): SuggestionNode {
  return {
    id: 'n-1',
    name: '',
    description: '',
    systemIds: [],
    ...partial,
  };
}

function asset(partial: Partial<SuggestionAsset> & { name: string }): SuggestionAsset {
  return {
    id: 'a-1',
    description: '',
    systemId: 'sys-default',
    ...partial,
  };
}

describe('tokenise', () => {
  it('strips punctuation, lower-cases, removes stop words and short tokens', () => {
    const out = tokenise('The Customer Master & Billing Records, Updated Daily!');
    // 'data', 'the', 'and' are stop words; '&', '!' are dropped.
    assert.ok(out.has('customer'));
    assert.ok(out.has('master'));
    assert.ok(out.has('billing'));
    assert.ok(out.has('records'));
    assert.ok(out.has('updated'));
    assert.ok(out.has('daily'));
    assert.ok(!out.has('the'));
    assert.ok(!out.has('and'));
    assert.ok(!out.has('data'));
  });

  it('returns an empty set for empty input', () => {
    assert.strictEqual(tokenise('').size, 0);
    assert.strictEqual(tokenise('a an the').size, 0);
  });
});

describe('rankSuggestions', () => {
  it('returns empty when there are no assets', () => {
    const out = rankSuggestions(node({ name: 'anything' }), [], []);
    assert.deepStrictEqual(out, []);
  });

  it('ranks a strong name match first', () => {
    const out = rankSuggestions(
      node({
        id: 'n1',
        name: 'Update customer billing record',
        description: 'Posts the latest charge against the active subscription.',
      }),
      [
        asset({ id: 'a-billing', name: 'Customer Billing Master' }),
        asset({ id: 'a-inv',     name: 'Inventory Snapshot' }),
        asset({ id: 'a-roster',  name: 'Employee Roster' }),
      ],
      [],
    );
    assert.ok(out.length >= 1);
    assert.strictEqual(out[0].assetId, 'a-billing');
    assert.ok(out[0].score > 0);
    assert.ok(out[0].rationale.some((r) => /Name match/i.test(r)));
  });

  it('breaks ties via system affinity when the step declares its system', () => {
    const sysFinance = 'sys-finance';
    const sysWarehouse = 'sys-warehouse';
    const out = rankSuggestions(
      node({ id: 'n1', name: 'Reconcile customer invoices', systemIds: [sysFinance] }),
      [
        asset({ id: 'a-wh',  name: 'Customer Invoice Snapshot', systemId: sysWarehouse }),
        asset({ id: 'a-fin', name: 'Customer Invoice Ledger',   systemId: sysFinance }),
      ],
      [],
    );
    assert.strictEqual(out[0].assetId, 'a-fin', 'same-system asset must rank first');
    assert.ok(out[0].score > out[1].score, 'same-system asset must score strictly higher');
    assert.ok(out[0].rationale.some((r) => /Same system/i.test(r)));
    assert.ok(out.some((s) => s.assetId === 'a-wh'), 'warehouse asset still surfaces');
  });

  it('weights a description-only signal below a name signal', () => {
    const out = rankSuggestions(
      node({
        id: 'n1',
        name: 'Quarterly close',
        description: 'Reconciles subscription billing records for the closing month.',
      }),
      [
        asset({ id: 'a-name', name: 'Quarterly Close Worksheet' }),
        asset({
          id: 'a-desc',
          name: 'Revenue Snapshot',
          description: 'Pulled from the billing records each month for the subscription team.',
        }),
      ],
      [],
    );
    const nameRow = out.find((s) => s.assetId === 'a-name');
    const descRow = out.find((s) => s.assetId === 'a-desc');
    assert.ok(nameRow, 'name-match asset must appear');
    assert.ok(descRow, 'desc-match asset must appear');
    assert.ok(nameRow!.score > descRow!.score, 'name match must outscore desc-only match');
  });

  it('excludes assets that are already mapped to this node', () => {
    const mappings: SuggestionMapping[] = [
      { processStepId: 'n1', dataAssetId: 'a-billing' },
    ];
    const out = rankSuggestions(
      node({ id: 'n1', name: 'Update customer billing record' }),
      [
        asset({ id: 'a-billing', name: 'Customer Billing Master' }),
        asset({ id: 'a-summary', name: 'Customer Billing Summary' }),
      ],
      mappings,
    );
    assert.ok(!out.some((s) => s.assetId === 'a-billing'), 'already-mapped asset must be excluded');
    assert.ok(out.some((s) => s.assetId === 'a-summary'), 'unmapped peer asset must remain');
  });

  it('respects limit and minScore options', () => {
    const assets: SuggestionAsset[] = [];
    for (let i = 0; i < 10; i++) {
      assets.push(asset({ id: `a-${i}`, name: `Customer billing master ${i}` }));
    }
    const top3 = rankSuggestions(node({ id: 'n1', name: 'Customer billing master' }), assets, [], { limit: 3 });
    assert.strictEqual(top3.length, 3);

    const strict = rankSuggestions(node({ id: 'n1', name: 'Customer billing master' }), assets, [], { minScore: 0.99 });
    // The combined weights make the perfect-name-match score 0.6 on
    // name alone, so minScore=0.99 cuts everything.
    assert.strictEqual(strict.length, 0);
  });

  it('handles a step with no description gracefully', () => {
    const out = rankSuggestions(
      node({ id: 'n1', name: 'Customer billing', description: '' }),
      [asset({ id: 'a1', name: 'Customer Billing Master', description: 'Master table' })],
      [],
    );
    assert.ok(out.length >= 1, 'name match alone is enough');
  });
});
