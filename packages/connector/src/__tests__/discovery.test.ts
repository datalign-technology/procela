import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  assetName,
  kindLabel,
  freshnessSignal,
  rowToAsset,
  pgSchemaFilter,
  type RawCatalogRow,
} from '../discovery';

describe('discovery — assetName', () => {
  it('qualifies the object with its schema', () => {
    assert.strictEqual(assetName('public', 'orders'), 'public.orders');
    assert.strictEqual(assetName('sales', 'orders'), 'sales.orders');
  });
});

describe('discovery — kindLabel', () => {
  it('maps relkind-style codes to human labels', () => {
    assert.strictEqual(kindLabel('r'), 'table');
    assert.strictEqual(kindLabel('v'), 'view');
    assert.strictEqual(kindLabel('m'), 'materialized view');
    assert.strictEqual(kindLabel('anything-else'), 'table');
  });
});

describe('discovery — freshnessSignal', () => {
  it('returns undefined for no signal (null / undefined)', () => {
    assert.strictEqual(freshnessSignal(null), undefined);
    assert.strictEqual(freshnessSignal(undefined), undefined);
  });

  it('treats epoch / pre-1972 as no signal, not a 1970 timestamp', () => {
    assert.strictEqual(freshnessSignal(new Date('1970-01-01T00:00:00Z')), undefined);
    assert.strictEqual(freshnessSignal('1971-06-01T00:00:00Z'), undefined);
  });

  it('returns undefined for an unparseable value', () => {
    assert.strictEqual(freshnessSignal('not-a-date'), undefined);
  });

  it('returns an ISO string for a real timestamp (Date or string input)', () => {
    assert.strictEqual(freshnessSignal(new Date('2026-01-02T03:04:05Z')), '2026-01-02T03:04:05.000Z');
    assert.strictEqual(freshnessSignal('2026-01-02T03:04:05Z'), '2026-01-02T03:04:05.000Z');
  });
});

describe('discovery — rowToAsset', () => {
  const base: RawCatalogRow = {
    schema: 'sales', name: 'orders', kind: 'r',
    row_count: 1234, last_activity: '2026-01-02T03:04:05Z', description: null,
  };

  it('builds the schema.table name, coerces row count, carries systemId', () => {
    const a = rowToAsset(base, 'Postgres', 'sys-1');
    assert.strictEqual(a.name, 'sales.orders');
    assert.strictEqual(a.rowCount, 1234);
    assert.strictEqual(a.systemId, 'sys-1');
    assert.strictEqual(a.lastWriteAt, '2026-01-02T03:04:05.000Z');
  });

  it('falls back to an engine/kind description when none is provided', () => {
    assert.strictEqual(rowToAsset(base, 'Postgres').description, 'Postgres table sales.orders');
    assert.strictEqual(rowToAsset({ ...base, kind: 'v' }, 'MySQL').description, 'MySQL view sales.orders');
    assert.strictEqual(rowToAsset({ ...base, kind: 'm' }, 'Postgres').description, 'Postgres materialized view sales.orders');
  });

  it('prefers a real object comment over the fallback', () => {
    const a = rowToAsset({ ...base, description: 'Customer orders ledger' }, 'SQL Server');
    assert.strictEqual(a.description, 'Customer orders ledger');
  });

  it('coerces a string / NaN row count to a number', () => {
    assert.strictEqual(rowToAsset({ ...base, row_count: '42' }, 'MySQL').rowCount, 42);
    assert.strictEqual(rowToAsset({ ...base, row_count: 'x' as unknown as number }, 'MySQL').rowCount, 0);
  });

  it('omits freshness when there is no signal', () => {
    assert.strictEqual(rowToAsset({ ...base, last_activity: null }, 'Postgres').lastWriteAt, undefined);
  });
});

describe('discovery — pgSchemaFilter', () => {
  it("defaults to 'public' when no schemas are configured", () => {
    assert.strictEqual(pgSchemaFilter(), "'public'");
    assert.strictEqual(pgSchemaFilter([]), "'public'");
  });

  it('quotes and comma-joins an explicit list', () => {
    assert.strictEqual(pgSchemaFilter(['sales', 'hr']), "'sales','hr'");
  });

  it('escapes single quotes to prevent SQL injection via a schema name', () => {
    // A hostile schema name must not break out of the quoted literal.
    assert.strictEqual(pgSchemaFilter(["o'brien"]), "'o''brien'");
    assert.strictEqual(pgSchemaFilter(["x'); DROP TABLE users;--"]), "'x''); DROP TABLE users;--'");
  });
});
