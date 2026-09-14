import { test } from 'node:test';
import assert from 'node:assert';

// ─────────────────────────────────────────────────────────────────────────
// Auto-lineage phase 4b — the column-level reconcile engine.
//
// Locks: resolution of parsed (table, column) refs to governed
// DataAssetColumns, the idempotent upsert/prune-by-sourceRef lifecycle scoped
// to source:'sql', unresolved-column counting, self-reference skipping, and
// org isolation. The edge store is a trivial in-memory fake.
// ─────────────────────────────────────────────────────────────────────────

import {
  reconcileSqlColumnLineage,
  type ColumnEdgeStore,
  type ColumnLite,
} from '../lib/sql-lineage/reconcile-columns';
import type { AssetLite } from '../lib/sql-lineage/reconcile';
import type { ColumnLineageEdge } from '../routes/data-lineage';

function fakeStore(seed: ColumnLineageEdge[] = []): ColumnEdgeStore & { rows: ColumnLineageEdge[] } {
  const rows = [...seed];
  return {
    rows,
    async list() { return rows.map((r) => ({ ...r })); },
    async create(row) { rows.push({ ...row }); return { ...row }; },
    async update(id, patch) {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return null;
      rows[i] = { ...rows[i], ...patch };
      return { ...rows[i] };
    },
    async delete(id) {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
  };
}

// Two governed assets, each with a couple of columns.
const ASSETS: AssetLite[] = [
  { id: 'a-raw-orders', name: 'raw.orders' },
  { id: 'a-analytics-orders', name: 'analytics.orders' },
];
const COLUMNS: ColumnLite[] = [
  { id: 'c-src-id', dataAssetId: 'a-raw-orders', columnName: 'id' },
  { id: 'c-src-amount', dataAssetId: 'a-raw-orders', columnName: 'amount' },
  { id: 'c-tgt-oid', dataAssetId: 'a-analytics-orders', columnName: 'oid' },
  { id: 'c-tgt-total', dataAssetId: 'a-analytics-orders', columnName: 'total' },
];

test('resolves column refs and creates one edge per mapped column', async () => {
  const edges = fakeStore();
  const summary = await reconcileSqlColumnLineage({
    orgId: 'org1',
    assets: ASSETS,
    columns: COLUMNS,
    edges,
    statements: [{ sql: 'INSERT INTO analytics.orders (oid, total) SELECT id, amount FROM raw.orders' }],
    now: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(summary.statementsParsed, 1);
  assert.equal(summary.edgesCreated, 2);
  assert.equal(summary.unresolvedColumns, 0);
  const pairs = edges.rows.map((e) => `${e.sourceColumnId}->${e.targetColumnId}`).sort();
  assert.deepEqual(pairs, ['c-src-amount->c-tgt-total', 'c-src-id->c-tgt-oid']);
  for (const e of edges.rows) {
    assert.equal(e.source, 'sql');
    assert.match(e.sourceRef!, /^sqlcol:/);
  }
});

test('counts columns that resolve to no governed column', async () => {
  const edges = fakeStore();
  const summary = await reconcileSqlColumnLineage({
    orgId: 'org1',
    assets: ASSETS,
    columns: COLUMNS,
    edges,
    // `oid` maps; `total` maps but its source `missing` is not a governed column.
    statements: [{ sql: 'INSERT INTO analytics.orders (oid, total) SELECT id, missing FROM raw.orders' }],
    now: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(summary.edgesCreated, 1);
  assert.equal(summary.unresolvedColumns, 1);
  assert.equal(edges.rows[0].targetColumnId, 'c-tgt-oid');
});

test('is idempotent: re-running touches lastSeenAt, creates nothing', async () => {
  const edges = fakeStore();
  const stmt = { sql: 'INSERT INTO analytics.orders (oid) SELECT id FROM raw.orders' };
  await reconcileSqlColumnLineage({ orgId: 'org1', assets: ASSETS, columns: COLUMNS, edges, statements: [stmt], now: '2026-01-01T00:00:00.000Z' });
  const id0 = edges.rows[0].id;
  const summary = await reconcileSqlColumnLineage({ orgId: 'org1', assets: ASSETS, columns: COLUMNS, edges, statements: [stmt], now: '2026-02-02T00:00:00.000Z' });
  assert.equal(summary.edgesCreated, 0);
  assert.equal(summary.edgesTouched, 1);
  assert.equal(edges.rows.length, 1);
  assert.equal(edges.rows[0].id, id0);
  assert.equal(edges.rows[0].lastSeenAt, '2026-02-02T00:00:00.000Z');
});

test('prunes sql column edges no longer produced, keeps dbt/manual', async () => {
  const seed: ColumnLineageEdge[] = [
    { id: 'sql-old', orgId: 'org1', sourceColumnId: 'c-src-amount', targetColumnId: 'c-tgt-total', source: 'sql', sourceRef: 'sqlcol:c-src-amount->c-tgt-total', lastSeenAt: '2025-01-01T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z' },
    { id: 'dbt-keep', orgId: 'org1', sourceColumnId: 'c-src-id', targetColumnId: 'c-tgt-oid', source: 'dbt', sourceRef: 'dbt:x', lastSeenAt: '2025-01-01T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z' },
  ];
  const edges = fakeStore(seed);
  const summary = await reconcileSqlColumnLineage({
    orgId: 'org1', assets: ASSETS, columns: COLUMNS, edges,
    // Only declares id->oid this run; the prior sql amount->total edge is stale.
    statements: [{ sql: 'INSERT INTO analytics.orders (oid) SELECT id FROM raw.orders' }],
    now: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(summary.edgesCreated, 1);
  assert.equal(summary.edgesRemoved, 1);
  const ids = edges.rows.map((r) => r.id);
  assert.ok(ids.includes('dbt-keep'));
  assert.ok(!ids.includes('sql-old'));
});

test('skips a self-referential column mapping', async () => {
  // A statement mapping a column to itself (same governed column) produces no edge.
  const edges = fakeStore();
  const cols: ColumnLite[] = [
    { id: 'c-x', dataAssetId: 'a-raw-orders', columnName: 'id' },
    { id: 'c-x', dataAssetId: 'a-analytics-orders', columnName: 'oid' }, // same id on both → self
  ];
  const summary = await reconcileSqlColumnLineage({
    orgId: 'org1', assets: ASSETS, columns: cols, edges,
    statements: [{ sql: 'INSERT INTO analytics.orders (oid) SELECT id FROM raw.orders' }],
    now: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(summary.edgesCreated, 0);
  assert.equal(edges.rows.length, 0);
});

test('scopes to orgId — other orgs column edges untouched', async () => {
  const seed: ColumnLineageEdge[] = [
    { id: 'other', orgId: 'org2', sourceColumnId: 'x', targetColumnId: 'y', source: 'sql', sourceRef: 'sqlcol:x->y', lastSeenAt: '2025-01-01T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z' },
  ];
  const edges = fakeStore(seed);
  await reconcileSqlColumnLineage({
    orgId: 'org1', assets: ASSETS, columns: COLUMNS, edges,
    statements: [{ sql: 'INSERT INTO analytics.orders (oid) SELECT id FROM raw.orders' }],
    now: '2026-01-01T00:00:00.000Z',
  });
  assert.ok(edges.rows.some((r) => r.id === 'other'));
});

test('an expression column feeds the target from every referenced source column', async () => {
  const edges = fakeStore();
  const cols: ColumnLite[] = [
    { id: 'c-a', dataAssetId: 'a-raw-orders', columnName: 'a' },
    { id: 'c-b', dataAssetId: 'a-raw-orders', columnName: 'b' },
    { id: 'c-t', dataAssetId: 'a-analytics-orders', columnName: 'total' },
  ];
  const summary = await reconcileSqlColumnLineage({
    orgId: 'org1', assets: ASSETS, columns: cols, edges,
    statements: [{ sql: 'INSERT INTO analytics.orders (total) SELECT a + b FROM raw.orders' }],
    now: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(summary.edgesCreated, 2);
  const srcIds = edges.rows.map((e) => e.sourceColumnId).sort();
  assert.deepEqual(srcIds, ['c-a', 'c-b']);
  assert.ok(edges.rows.every((e) => e.targetColumnId === 'c-t'));
});
