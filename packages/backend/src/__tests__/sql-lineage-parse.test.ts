import { test } from 'node:test';
import assert from 'node:assert';

// ─────────────────────────────────────────────────────────────────────────
// Auto-lineage phase 1 — the SQL → table-to-table parser.
//
// Locks the coarse lineage the later query-log phase persists as edges: the
// write target and the read sources of a statement, across the common ELT
// statement shapes, dialect quirks, CTEs, subqueries, and the MERGE case that
// falls through to the regex heuristic.
// ─────────────────────────────────────────────────────────────────────────

import { parseSqlLineage, type TableRef } from '../lib/sql-lineage/parse';

// Compact comparable key for a ref (order-independent source comparison).
const key = (r: TableRef) => `${r.catalog ?? ''}.${r.schema ?? ''}.${r.name}`.toLowerCase();
const keys = (rs: TableRef[]) => rs.map(key).sort();

test('INSERT … SELECT: target + joined sources', () => {
  const r = parseSqlLineage(
    'INSERT INTO analytics.orders SELECT * FROM raw.orders o JOIN raw.customers c ON o.cid = c.id',
  );
  assert.equal(r.target && key(r.target), '.analytics.orders');
  assert.deepEqual(keys(r.sources), ['.raw.customers', '.raw.orders']);
});

test('CREATE TABLE AS SELECT with a GROUP BY', () => {
  const r = parseSqlLineage('CREATE TABLE analytics.daily AS SELECT d, sum(x) FROM events.raw GROUP BY d');
  assert.equal(r.target && key(r.target), '.analytics.daily');
  assert.deepEqual(keys(r.sources), ['.events.raw']);
});

test('CTE names are excluded from sources; real tables kept', () => {
  const r = parseSqlLineage(
    'CREATE TABLE t AS WITH s AS (SELECT * FROM raw.a) SELECT * FROM s JOIN raw.b USING (k)',
  );
  assert.equal(r.target && r.target.name, 't');
  // `s` is a CTE, not a source; raw.a (inside the CTE) and raw.b are.
  assert.deepEqual(keys(r.sources), ['.raw.a', '.raw.b']);
});

test('three-part names split into catalog + schema', () => {
  const r = parseSqlLineage('INSERT INTO db1.sch.tgt SELECT * FROM db2.sch2.src');
  assert.deepEqual(r.target, { catalog: 'db1', schema: 'sch', name: 'tgt' });
  assert.deepEqual(r.sources, [{ catalog: 'db2', schema: 'sch2', name: 'src' }]);
});

test('MERGE (heuristic path): INTO target, USING source', () => {
  const r = parseSqlLineage(
    'MERGE INTO tgt.t AS d USING src.s AS s ON d.id = s.id WHEN MATCHED THEN UPDATE SET d.v = s.v',
  );
  assert.equal(r.method, 'heuristic'); // node-sql-parser can't parse MERGE
  assert.equal(r.target && key(r.target), '.tgt.t');
  assert.deepEqual(keys(r.sources), ['.src.s']);
});

test('subquery sources are captured', () => {
  const r = parseSqlLineage(
    'INSERT INTO a.tgt SELECT * FROM a.base WHERE id IN (SELECT id FROM a.filter_ref)',
  );
  assert.equal(r.target && key(r.target), '.a.tgt');
  assert.deepEqual(keys(r.sources), ['.a.base', '.a.filter_ref']);
});

test('default catalog + schema fill unqualified refs', () => {
  const r = parseSqlLineage('INSERT INTO tgt SELECT * FROM src', { defaultCatalog: 'DB', defaultSchema: 'PUBLIC' });
  assert.deepEqual(r.target, { catalog: 'DB', schema: 'PUBLIC', name: 'tgt' });
  assert.deepEqual(r.sources, [{ catalog: 'DB', schema: 'PUBLIC', name: 'src' }]);
});

test('a self-referential write drops the target from sources', () => {
  const r = parseSqlLineage('INSERT INTO s.t SELECT * FROM s.t WHERE flag');
  assert.equal(r.target && key(r.target), '.s.t');
  assert.deepEqual(r.sources, []); // only source was the target itself
});

test('a bare SELECT has no target and produces no lineage edge', () => {
  const r = parseSqlLineage('SELECT * FROM a.b JOIN a.c ON a.b.id = a.c.id');
  assert.equal(r.target, null);
});

test('string literals and comments cannot masquerade as sources', () => {
  const r = parseSqlLineage(
    "INSERT INTO t /* from nowhere */ SELECT 'text from a fake table' AS note, x FROM real.src -- from comment",
  );
  assert.equal(r.target && r.target.name, 't');
  assert.deepEqual(keys(r.sources), ['.real.src']);
});

test('quoted identifiers are unquoted', () => {
  const r = parseSqlLineage('INSERT INTO "Sch"."Tgt" SELECT * FROM "Sch"."Src"');
  assert.equal(r.target && r.target.name, 'Tgt');
  assert.equal(r.target && r.target.schema, 'Sch');
  assert.deepEqual(keys(r.sources), ['.sch.src']);
});

test('empty / whitespace input is inert', () => {
  assert.deepEqual(parseSqlLineage(''), { target: null, sources: [], method: 'none' });
  assert.deepEqual(parseSqlLineage('   \n  '), { target: null, sources: [], method: 'none' });
});

test('dedups repeated sources', () => {
  const r = parseSqlLineage('INSERT INTO t SELECT * FROM s.a a1 JOIN s.a a2 ON a1.k = a2.k');
  assert.deepEqual(keys(r.sources), ['.s.a']);
});
