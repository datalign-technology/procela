// Unit tests for the driver-free SQL builder + result normalizer. No live
// database and no pg/mysql2/mssql import — the same pure/adapter split the
// on-prem connector uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSelectSql,
  clampLimit,
  assertIdentifier,
  normalizeValue,
  normalizeRow,
  DEFAULT_ROW_LIMIT,
  MAX_ROW_LIMIT,
} from '../lib/db-source/sql';

test('buildSelectSql: Postgres table-scan quotes idents and uses LIMIT', () => {
  assert.equal(
    buildSelectSql('POSTGRESQL', { schema: 'public', table: 'systems', limit: 100 }),
    'SELECT * FROM "public"."systems" LIMIT 100',
  );
  // No schema → unqualified, search_path resolves it.
  assert.equal(
    buildSelectSql('POSTGRESQL', { table: 'systems', limit: 100 }),
    'SELECT * FROM "systems" LIMIT 100',
  );
});

test('buildSelectSql: MySQL uses backticks + LIMIT', () => {
  assert.equal(
    buildSelectSql('MYSQL', { schema: 'app', table: 'people', limit: 50 }),
    'SELECT * FROM `app`.`people` LIMIT 50',
  );
});

test('buildSelectSql: SQL Server uses TOP, not LIMIT', () => {
  assert.equal(
    buildSelectSql('SQLSERVER', { schema: 'dbo', table: 'org', limit: 25 }),
    'SELECT TOP (25) * FROM [dbo].[org]',
  );
});

test('buildSelectSql: Oracle uses bare identifiers + FETCH FIRST', () => {
  // Bare (unquoted) so Oracle's upper-case folding matches the stored object.
  assert.equal(
    buildSelectSql('ORACLE', { schema: 'HR', table: 'EMPLOYEES', limit: 40 }),
    'SELECT * FROM HR.EMPLOYEES FETCH FIRST 40 ROWS ONLY',
  );
  assert.equal(
    buildSelectSql('ORACLE', { table: 'EMPLOYEES' }),
    `SELECT * FROM EMPLOYEES FETCH FIRST ${DEFAULT_ROW_LIMIT} ROWS ONLY`,
  );
  // Injection is still rejected even though identifiers are emitted bare.
  assert.throws(() => buildSelectSql('ORACLE', { table: 'emp; DROP TABLE x' }), /Invalid table identifier/);
});

test('buildSelectSql: a raw query is returned verbatim (trusted admin SQL)', () => {
  const q = 'SELECT id, name FROM v_customers WHERE active = 1';
  assert.equal(buildSelectSql('POSTGRESQL', { query: q, table: 'ignored' }), q);
  // Even for SQL Server, a raw query is untouched (no TOP injected).
  assert.equal(buildSelectSql('SQLSERVER', { query: q }), q);
});

test('buildSelectSql: default limit applied when none given', () => {
  assert.equal(
    buildSelectSql('POSTGRESQL', { table: 't' }),
    `SELECT * FROM "t" LIMIT ${DEFAULT_ROW_LIMIT}`,
  );
});

test('buildSelectSql: missing table AND query throws', () => {
  assert.throws(() => buildSelectSql('POSTGRESQL', {}), /requires either a table or a query/);
});

test('assertIdentifier / buildSelectSql: reject injection attempts in identifiers', () => {
  const injections = ['systems; DROP TABLE users', 'a b', 'tbl"x', "t'x", 'schema.table', '1abc', 'tab\\e'];
  for (const bad of injections) {
    assert.throws(() => assertIdentifier('table', bad), /Invalid table identifier/, `expected reject: ${bad}`);
    assert.throws(() => buildSelectSql('POSTGRESQL', { table: bad }), /Invalid table identifier/);
  }
  // Empty/whitespace-only is a *missing* table, caught earlier with a
  // different message — assertIdentifier still rejects it as invalid.
  assert.throws(() => assertIdentifier('table', ''), /Invalid table identifier/);
  assert.throws(() => buildSelectSql('POSTGRESQL', { table: '   ' }), /requires either a table or a query/);
  // Legit identifiers pass, including underscores / digits / $.
  for (const ok of ['systems', 'data_assets', '_tmp', 'tbl$1', 'A1']) {
    assert.equal(assertIdentifier('table', ok), ok);
  }
});

test('clampLimit: defaults, floors, and caps', () => {
  assert.equal(clampLimit(undefined), DEFAULT_ROW_LIMIT);
  assert.equal(clampLimit(NaN), DEFAULT_ROW_LIMIT);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(-5), 1);
  assert.equal(clampLimit(10.9), 10);
  assert.equal(clampLimit(MAX_ROW_LIMIT + 1), MAX_ROW_LIMIT);
});

test('normalizeValue: nulls collapse to empty, types stringify', () => {
  assert.equal(normalizeValue(null), '');
  assert.equal(normalizeValue(undefined), '');
  assert.equal(normalizeValue('hi'), 'hi');
  assert.equal(normalizeValue(42), '42');
  assert.equal(normalizeValue(true), 'true');
  assert.equal(normalizeValue(10n), '10');
  assert.equal(normalizeValue(new Date('2026-01-02T03:04:05.000Z')), '2026-01-02T03:04:05.000Z');
  assert.equal(normalizeValue(Buffer.from('abc')), 'abc');
  assert.equal(normalizeValue({ a: 1 }), '{"a":1}');
});

test('normalizeRow: maps every column through normalizeValue', () => {
  assert.deepEqual(
    normalizeRow({ id: 7, name: 'Acme', note: null, when: new Date('2026-05-05T00:00:00.000Z') }),
    { id: '7', name: 'Acme', note: '', when: '2026-05-05T00:00:00.000Z' },
  );
});
