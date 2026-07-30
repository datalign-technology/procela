import { describe, it } from 'node:test';
import assert from 'node:assert';

import { parseDbtManifest, dbtAssetName, type DbtManifest } from '../dbt';

const MANIFEST: DbtManifest = {
  nodes: {
    'model.shop.orders': {
      resource_type: 'model', name: 'orders', schema: 'analytics',
      description: 'Cleaned orders',
      columns: {
        id: { name: 'id', data_type: 'integer' },
        total: { name: 'total', data_type: 'numeric' },
      },
    },
    'seed.shop.country_codes': {
      resource_type: 'seed', name: 'country_codes', schema: 'analytics',
    },
    // A test node — not an asset, must be ignored.
    'test.shop.not_null_orders_id': {
      resource_type: 'test', name: 'not_null_orders_id', schema: 'analytics',
    },
    // An analysis — also ignored.
    'analysis.shop.adhoc': { resource_type: 'analysis', name: 'adhoc', schema: 'analytics' },
  },
  sources: {
    'source.shop.raw.customers': {
      resource_type: 'source', name: 'customers', identifier: 'customers_raw', schema: 'raw',
      columns: { email: { name: 'email', data_type: 'text' } },
    },
  },
};

describe('dbt — dbtAssetName', () => {
  it('uses schema.identifier for sources, schema.name for models', () => {
    assert.strictEqual(dbtAssetName({ resource_type: 'model', name: 'orders', schema: 'analytics' }), 'analytics.orders');
    assert.strictEqual(dbtAssetName({ resource_type: 'source', name: 'customers', identifier: 'customers_raw', schema: 'raw' }), 'raw.customers_raw');
    assert.strictEqual(dbtAssetName({ resource_type: 'model', name: 'x', schema: '' }), 'x');
  });
});

describe('dbt — parseDbtManifest', () => {
  it('includes models / seeds / sources and skips tests + analyses', () => {
    const assets = parseDbtManifest(MANIFEST, 'sys-1');
    const names = assets.map((a) => a.name).sort();
    assert.deepStrictEqual(names, ['analytics.country_codes', 'analytics.orders', 'raw.customers_raw']);
    assert.ok(assets.every((a) => a.systemId === 'sys-1'));
  });

  it('maps columns with ordinals, preserving manifest order', () => {
    const orders = parseDbtManifest(MANIFEST).find((a) => a.name === 'analytics.orders')!;
    assert.deepStrictEqual(orders.columns, [
      { name: 'id', dataType: 'integer', ordinal: 1 },
      { name: 'total', dataType: 'numeric', ordinal: 2 },
    ]);
  });

  it('uses the dbt description, falling back to a synthesised one', () => {
    const assets = parseDbtManifest(MANIFEST);
    assert.strictEqual(assets.find((a) => a.name === 'analytics.orders')!.description, 'Cleaned orders');
    assert.strictEqual(assets.find((a) => a.name === 'analytics.country_codes')!.description, 'dbt seed analytics.country_codes');
  });

  it('omits columns when a node has none', () => {
    const seed = parseDbtManifest(MANIFEST).find((a) => a.name === 'analytics.country_codes')!;
    assert.strictEqual(seed.columns, undefined);
  });

  it('is safe on an empty / malformed manifest', () => {
    assert.deepStrictEqual(parseDbtManifest({}), []);
    assert.deepStrictEqual(parseDbtManifest({ nodes: {} }), []);
  });
});
