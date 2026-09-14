import { test } from 'node:test';
import assert from 'node:assert';

// ─────────────────────────────────────────────────────────────────────────
// Auto-lineage phase 4 — the SQL → column-to-column parser.
//
// Locks the column-level lineage the later persistence phase writes as edges:
// for each written column, which upstream column(s) feed it, across the common
// projection shapes (bare column, alias, expression, aggregate, function,
// join qualifiers, INSERT column lists) and the SELECT * / MERGE cases that
// produce no column lineage.
// ─────────────────────────────────────────────────────────────────────────

import { parseSqlColumnLineage, type ColumnLineage } from '../lib/sql-lineage/parse-columns';

// Compact "schema.table.column" key for a source ref (order-independent).
const srcKeys = (c: ColumnLineage) =>
  c.sources
    .map((s) => `${s.table ? [s.table.catalog ?? '', s.table.schema ?? '', s.table.name].join('.') : ''}:${s.column}`.toLowerCase())
    .sort();
const byTarget = (cols: ColumnLineage[], name: string) => cols.find((c) => c.targetColumn.toLowerCase() === name.toLowerCase());

test('INSERT with column list maps positionally, resolving join aliases', () => {
  const r = parseSqlColumnLineage(
    'INSERT INTO analytics.orders (oid, cname) SELECT o.id, c.name FROM raw.orders o JOIN raw.customers c ON o.cid = c.id',
  );
  assert.equal(r.method, 'ast');
  assert.equal(r.target && r.target.name, 'orders');
  const oid = byTarget(r.columns, 'oid');
  const cname = byTarget(r.columns, 'cname');
  assert.ok(oid && cname);
  assert.deepEqual(srcKeys(oid!), ['.raw.orders:id']);
  assert.deepEqual(srcKeys(cname!), ['.raw.customers:name']);
});

test('no insert list: alias, then bare column name, become the target names', () => {
  const r = parseSqlColumnLineage('INSERT INTO t SELECT a, b + c AS s FROM raw.x');
  assert.equal(r.target && r.target.name, 't');
  const a = byTarget(r.columns, 'a');
  const s = byTarget(r.columns, 's');
  assert.ok(a, 'bare column keeps its own name');
  assert.deepEqual(srcKeys(a!), ['.raw.x:a']);
  // Expression column: both operands are sources under the alias name.
  assert.ok(s);
  assert.deepEqual(srcKeys(s!), ['.raw.x:b', '.raw.x:c']);
});

test('CREATE TABLE AS SELECT: aggregate + aliased columns', () => {
  const r = parseSqlColumnLineage('CREATE TABLE analytics.daily AS SELECT d AS day, sum(x) AS total FROM events.raw GROUP BY d');
  assert.equal(r.target && r.target.name, 'daily');
  const day = byTarget(r.columns, 'day');
  const total = byTarget(r.columns, 'total');
  assert.deepEqual(srcKeys(day!), ['.events.raw:d']);
  assert.deepEqual(srcKeys(total!), ['.events.raw:x']); // sum(x) → x
});

test('CREATE VIEW AS SELECT: function wrapper keeps the inner column', () => {
  const r = parseSqlColumnLineage('CREATE VIEW v AS SELECT id, upper(name) AS name FROM raw.people');
  assert.equal(r.target && r.target.name, 'v');
  assert.deepEqual(srcKeys(byTarget(r.columns, 'id')!), ['.raw.people:id']);
  assert.deepEqual(srcKeys(byTarget(r.columns, 'name')!), ['.raw.people:name']); // upper(name) → name
});

test('unqualified columns resolve to the sole FROM table', () => {
  const r = parseSqlColumnLineage('INSERT INTO t SELECT a, b FROM db1.sch.src', { defaultCatalog: 'DEF' });
  const a = byTarget(r.columns, 'a')!;
  assert.deepEqual(a.sources[0].table, { catalog: 'db1', schema: 'sch', name: 'src' });
});

test('default catalog/schema fill unqualified source + target tables', () => {
  const r = parseSqlColumnLineage('INSERT INTO tgt SELECT a FROM src', { defaultCatalog: 'DB', defaultSchema: 'PUBLIC' });
  assert.deepEqual(r.target, { catalog: 'DB', schema: 'PUBLIC', name: 'tgt' });
  assert.deepEqual(byTarget(r.columns, 'a')!.sources[0].table, { catalog: 'DB', schema: 'PUBLIC', name: 'src' });
});

test('SELECT * yields a target but no column-level lineage', () => {
  const r = parseSqlColumnLineage('INSERT INTO t SELECT * FROM raw.x');
  assert.equal(r.target && r.target.name, 't');
  assert.deepEqual(r.columns, []);
});

test('a computed column with no alias is skipped (not nameable)', () => {
  const r = parseSqlColumnLineage('INSERT INTO t SELECT a, b + c FROM raw.x');
  // `a` maps; the unnamed `b + c` expression is dropped.
  assert.deepEqual(r.columns.map((c) => c.targetColumn), ['a']);
});

test('a source column referenced twice in one expression dedups', () => {
  const r = parseSqlColumnLineage('INSERT INTO t SELECT (x + x) AS d FROM raw.y');
  assert.deepEqual(srcKeys(byTarget(r.columns, 'd')!), ['.raw.y:x']);
});

test('two-table select without qualifiers leaves ambiguous columns unresolved-table', () => {
  // Both `a` and `b` are unqualified but there are two FROM tables → the source
  // table can't be determined, so table is null (still recorded as a source).
  const r = parseSqlColumnLineage('INSERT INTO t SELECT a AS x, b AS y FROM raw.p JOIN raw.q ON raw.p.k = raw.q.k');
  const x = byTarget(r.columns, 'x')!;
  assert.equal(x.sources.length, 1);
  assert.equal(x.sources[0].table, null);
  assert.equal(x.sources[0].column, 'a');
});

test('MERGE (unparseable by astify) yields no column lineage', () => {
  const r = parseSqlColumnLineage('MERGE INTO tgt.t d USING src.s s ON d.id = s.id WHEN MATCHED THEN UPDATE SET d.v = s.v');
  assert.equal(r.method, 'none');
  assert.deepEqual(r.columns, []);
});

test('a bare SELECT (no write) has no target and no column lineage', () => {
  const r = parseSqlColumnLineage('SELECT a, b FROM raw.x');
  assert.equal(r.target, null);
  assert.deepEqual(r.columns, []);
});

test('empty / whitespace input is inert', () => {
  assert.deepEqual(parseSqlColumnLineage(''), { target: null, columns: [], method: 'none' });
  assert.deepEqual(parseSqlColumnLineage('   \n '), { target: null, columns: [], method: 'none' });
});

test('quoted identifiers are unquoted in the target table + insert column list', () => {
  const r = parseSqlColumnLineage('INSERT INTO "Sch"."Tgt" ("Out") SELECT in_col FROM "Sch"."Src"');
  assert.equal(r.target && r.target.name, 'Tgt');
  assert.equal(r.target && r.target.schema, 'Sch');
  const out = byTarget(r.columns, 'Out')!; // insert-list name, unquoted
  assert.ok(out);
  assert.equal(out.sources[0].column, 'in_col');
  assert.equal(out.sources[0].table && out.sources[0].table.name, 'Src');
});
