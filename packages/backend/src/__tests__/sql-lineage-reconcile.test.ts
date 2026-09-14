import { test } from 'node:test';
import assert from 'node:assert';

// ─────────────────────────────────────────────────────────────────────────
// Auto-lineage phase 2 — query-history SQL builder + reconcile engine.
//
// The parser (phase 1) is exercised separately. Here we lock:
//   • buildQueryHistorySql — pure SQL shape + integer clamping.
//   • reconcileSqlLineage — name resolution across qualified forms, the
//     idempotent upsert/prune-by-sourceRef lifecycle scoped to source:'sql',
//     unresolved-ref counting, and self-reference skipping.
// The edge store is a trivial in-memory fake so no DB is touched.
// ─────────────────────────────────────────────────────────────────────────

import { buildQueryHistorySql } from '../lib/db-source/snowflake-query-history';
import {
  reconcileSqlLineage,
  type EdgeStore,
  type AssetLite,
} from '../lib/sql-lineage/reconcile';
import type { AssetLineageEdge } from '../routes/data-lineage';

// ── buildQueryHistorySql ─────────────────────────────────────────────────

test('buildQueryHistorySql: defaults are 7 days / 1000 rows', () => {
  const sql = buildQueryHistorySql();
  assert.match(sql, /snowflake\.account_usage\.query_history/i);
  assert.match(sql, /DATEADD\(day, -7, CURRENT_TIMESTAMP\(\)\)/);
  assert.match(sql, /LIMIT 1000$/);
  assert.match(sql, /execution_status = 'SUCCESS'/);
});

test('buildQueryHistorySql: clamps out-of-range days and limit', () => {
  const tooBig = buildQueryHistorySql({ days: 9999, limit: 999999 });
  assert.match(tooBig, /DATEADD\(day, -365,/);
  assert.match(tooBig, /LIMIT 10000$/);
  const tooSmall = buildQueryHistorySql({ days: 0, limit: 0 });
  assert.match(tooSmall, /DATEADD\(day, -1,/);
  assert.match(tooSmall, /LIMIT 1$/);
});

test('buildQueryHistorySql: floors fractional / rejects non-finite', () => {
  assert.match(buildQueryHistorySql({ days: 3.9, limit: 42.7 }), /DATEADD\(day, -3,/);
  assert.match(buildQueryHistorySql({ days: 3.9, limit: 42.7 }), /LIMIT 42$/);
  // NaN → defaults
  assert.match(buildQueryHistorySql({ days: NaN, limit: NaN }), /DATEADD\(day, -7,/);
});

test('buildQueryHistorySql: restricts to write-shaped statement types', () => {
  const sql = buildQueryHistorySql();
  for (const t of ['INSERT', 'CREATE_TABLE_AS_SELECT', 'MERGE', 'UPDATE', 'DELETE']) {
    assert.ok(sql.includes(`'${t}'`), `expected ${t} in query_type filter`);
  }
});

// ── reconcile fake store ─────────────────────────────────────────────────

function fakeStore(seed: AssetLineageEdge[] = []): EdgeStore & { rows: AssetLineageEdge[] } {
  const rows = [...seed];
  return {
    rows,
    async list() {
      return rows.map((r) => ({ ...r }));
    },
    async create(row) {
      rows.push({ ...row });
      return { ...row };
    },
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

const ASSETS: AssetLite[] = [
  { id: 'a-raw-orders', name: 'raw.orders' },
  { id: 'a-raw-customers', name: 'raw.customers' },
  { id: 'a-analytics-orders', name: 'analytics.orders' },
  { id: 'a-bare', name: 'widgets' },
];

// ── reconcileSqlLineage ──────────────────────────────────────────────────

test('resolves schema.table sources + target and creates one edge each', async () => {
  const edges = fakeStore();
  const summary = await reconcileSqlLineage({
    orgId: 'org1',
    assets: ASSETS,
    edges,
    statements: [
      {
        sql: 'INSERT INTO analytics.orders SELECT * FROM raw.orders o JOIN raw.customers c ON o.cid = c.id',
      },
    ],
    now: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(summary.statementsParsed, 1);
  assert.equal(summary.edgesCreated, 2);
  assert.equal(summary.edgesTouched, 0);
  assert.equal(summary.unresolvedRefs, 0);
  assert.equal(edges.rows.length, 2);
  for (const e of edges.rows) {
    assert.equal(e.source, 'sql');
    assert.equal(e.targetAssetId, 'a-analytics-orders');
    assert.equal(e.orgId, 'org1');
    assert.match(e.sourceRef!, /^sql:a-raw-(orders|customers)->a-analytics-orders$/);
  }
});

test('resolves a bare table name via defaultSchema/defaultCatalog fallthrough', async () => {
  const edges = fakeStore();
  // target "widgets" is a bare-named asset; source resolves via schema.table.
  const summary = await reconcileSqlLineage({
    orgId: 'org1',
    assets: ASSETS,
    edges,
    statements: [{ sql: 'INSERT INTO widgets SELECT * FROM raw.orders' }],
    now: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(summary.edgesCreated, 1);
  assert.equal(edges.rows[0].sourceAssetId, 'a-raw-orders');
  assert.equal(edges.rows[0].targetAssetId, 'a-bare');
});

test('counts unresolved refs and does not create edges for them', async () => {
  const edges = fakeStore();
  const summary = await reconcileSqlLineage({
    orgId: 'org1',
    assets: ASSETS,
    edges,
    statements: [
      // target resolves, one source resolves, one does not (raw.unknown)
      { sql: 'INSERT INTO analytics.orders SELECT * FROM raw.orders JOIN raw.unknown u ON 1=1' },
      // target itself does not resolve → whole statement skipped, target counted
      { sql: 'INSERT INTO nope.table SELECT * FROM raw.orders' },
    ],
    now: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(summary.edgesCreated, 1);
  assert.equal(summary.unresolvedRefs, 2); // raw.unknown + nope.table
  assert.equal(edges.rows.length, 1);
});

test('is idempotent: re-running touches lastSeenAt, creates nothing new', async () => {
  const edges = fakeStore();
  const stmt = {
    sql: 'INSERT INTO analytics.orders SELECT * FROM raw.orders',
  };
  await reconcileSqlLineage({
    orgId: 'org1', assets: ASSETS, edges, statements: [stmt], now: '2026-01-01T00:00:00.000Z',
  });
  const created = edges.rows[0];
  const summary = await reconcileSqlLineage({
    orgId: 'org1', assets: ASSETS, edges, statements: [stmt], now: '2026-02-02T00:00:00.000Z',
  });
  assert.equal(summary.edgesCreated, 0);
  assert.equal(summary.edgesTouched, 1);
  assert.equal(summary.edgesRemoved, 0);
  assert.equal(edges.rows.length, 1);
  assert.equal(edges.rows[0].id, created.id); // same row updated in place
  assert.equal(edges.rows[0].lastSeenAt, '2026-02-02T00:00:00.000Z');
});

test('prunes sql edges no longer produced by the batch, keeps dbt/manual', async () => {
  const seed: AssetLineageEdge[] = [
    {
      id: 'sql-old', orgId: 'org1', sourceAssetId: 'a-raw-customers', targetAssetId: 'a-analytics-orders',
      source: 'sql', sourceRef: 'sql:a-raw-customers->a-analytics-orders',
      lastSeenAt: '2025-01-01T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: 'dbt-keep', orgId: 'org1', sourceAssetId: 'a-raw-orders', targetAssetId: 'a-analytics-orders',
      source: 'dbt', sourceRef: 'model.p.o', lastSeenAt: '2025-01-01T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z',
    },
  ];
  const edges = fakeStore(seed);
  const summary = await reconcileSqlLineage({
    orgId: 'org1',
    assets: ASSETS,
    edges,
    // this batch only declares raw.orders -> analytics.orders (a different sql edge)
    statements: [{ sql: 'INSERT INTO analytics.orders SELECT * FROM raw.orders' }],
    now: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(summary.edgesCreated, 1);
  assert.equal(summary.edgesRemoved, 1); // sql-old pruned
  const ids = edges.rows.map((r) => r.id).sort();
  assert.ok(ids.includes('dbt-keep'), 'dbt edge must survive');
  assert.ok(!ids.includes('sql-old'), 'stale sql edge must be pruned');
});

test('skips self-referential writes (target == source)', async () => {
  const edges = fakeStore();
  const summary = await reconcileSqlLineage({
    orgId: 'org1',
    assets: ASSETS,
    edges,
    statements: [{ sql: 'INSERT INTO raw.orders SELECT * FROM raw.orders WHERE flag' }],
    now: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(summary.edgesCreated, 0);
  assert.equal(edges.rows.length, 0);
});

test('scopes everything to orgId — other orgs edges untouched', async () => {
  const seed: AssetLineageEdge[] = [
    {
      id: 'other-org-sql', orgId: 'org2', sourceAssetId: 'x', targetAssetId: 'y',
      source: 'sql', sourceRef: 'sql:x->y', lastSeenAt: '2025-01-01T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z',
    },
  ];
  const edges = fakeStore(seed);
  await reconcileSqlLineage({
    orgId: 'org1',
    assets: ASSETS,
    edges,
    statements: [{ sql: 'INSERT INTO analytics.orders SELECT * FROM raw.orders' }],
    now: '2026-01-01T00:00:00.000Z',
  });
  // org2 edge must survive (not pruned as "stale" for org1's batch)
  assert.ok(edges.rows.some((r) => r.id === 'other-org-sql'));
});

test('dedups a source repeated within one statement into a single edge', async () => {
  const edges = fakeStore();
  const summary = await reconcileSqlLineage({
    orgId: 'org1',
    assets: ASSETS,
    edges,
    statements: [{ sql: 'INSERT INTO analytics.orders SELECT * FROM raw.orders a JOIN raw.orders b ON a.k=b.k' }],
    now: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(summary.edgesCreated, 1);
  assert.equal(edges.rows.length, 1);
});
