// Unit tests for the driver-free DQ aggregate SQL builder. No live database —
// mirrors the on-prem connector's dq.test.ts. The real execution over Postgres
// is exercised in dq-db-live.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDqAggregateSql, DB_MEASURABLE_RULE_TYPES } from '../lib/db-source/dq-sql';

test('NOT_NULL: counts non-null passes, no params', () => {
  const q = buildDqAggregateSql('POSTGRESQL', { table: 'customers', column: 'email', ruleType: 'NOT_NULL', parameters: {} })!;
  assert.match(q.sql, /SELECT COUNT\(\*\) AS total/);
  assert.match(q.sql, /"email" IS NOT NULL/);
  assert.match(q.sql, /FROM "customers"/);
  assert.deepEqual(q.params, []);
});

test('qualified schema.table is split and each part quoted', () => {
  const q = buildDqAggregateSql('POSTGRESQL', { table: 'sales.orders', column: 'id', ruleType: 'NOT_NULL', parameters: {} })!;
  assert.match(q.sql, /FROM "sales"\."orders"/);
});

test('IN_SET: values are bound as params, not interpolated', () => {
  const q = buildDqAggregateSql('POSTGRESQL', {
    table: 't', column: 'status', ruleType: 'IN_SET',
    parameters: { allowedValues: ['OPEN', 'CLOSED'] },
  })!;
  assert.match(q.sql, /"status" IN \(\$1, \$2\)/);
  assert.deepEqual(q.params, ['OPEN', 'CLOSED']);
});

test('IN_SET with no values is not measurable (null)', () => {
  assert.equal(buildDqAggregateSql('POSTGRESQL', { table: 't', column: 'c', ruleType: 'IN_SET', parameters: { allowedValues: [] } }), null);
});

test('NUMERIC_RANGE: only provided bounds are applied, bound as params', () => {
  const q = buildDqAggregateSql('POSTGRESQL', { table: 't', column: 'amount', ruleType: 'NUMERIC_RANGE', parameters: { min: 0 } })!;
  assert.match(q.sql, /"amount" >= \$1/);
  assert.doesNotMatch(q.sql, /<=/);
  assert.deepEqual(q.params, [0]);
});

test('LENGTH_RANGE: SQL Server uses LEN, others LENGTH', () => {
  const pg = buildDqAggregateSql('POSTGRESQL', { table: 't', column: 'code', ruleType: 'LENGTH_RANGE', parameters: { minLength: 3, maxLength: 10 } })!;
  assert.match(pg.sql, /LENGTH\("code"\)/);
  assert.match(pg.sql, /@?\$1/);
  const ms = buildDqAggregateSql('SQLSERVER', { table: 't', column: 'code', ruleType: 'LENGTH_RANGE', parameters: { minLength: 3 } })!;
  assert.match(ms.sql, /LEN\(\[code\]\)/);
  assert.match(ms.sql, /@p0/);
});

test('UNIQUE: subquery groups, no params', () => {
  const q = buildDqAggregateSql('POSTGRESQL', { table: 't', column: 'sku', ruleType: 'UNIQUE', parameters: {} })!;
  assert.match(q.sql, /GROUP BY "sku"/);
  assert.match(q.sql, /cnt = 1/);
  assert.deepEqual(q.params, []);
});

test('per-engine identifier quoting + placeholder style', () => {
  assert.match(buildDqAggregateSql('MYSQL', { table: 't', column: 'c', ruleType: 'IN_SET', parameters: { allowedValues: ['a'] } })!.sql, /`c` IN \(\?\)/);
  assert.match(buildDqAggregateSql('ORACLE', { table: 't', column: 'c', ruleType: 'IN_SET', parameters: { allowedValues: ['a'] } })!.sql, /"c" IN \(:1\)/);
  assert.match(buildDqAggregateSql('SQLSERVER', { table: 't', column: 'c', ruleType: 'IN_SET', parameters: { allowedValues: ['a'] } })!.sql, /\[c\] IN \(@p0\)/);
});

test('REGEX_MATCH / CUSTOM are not DB-measurable (null)', () => {
  assert.equal(buildDqAggregateSql('POSTGRESQL', { table: 't', column: 'c', ruleType: 'REGEX_MATCH', parameters: { pattern: '.*' } }), null);
  assert.equal(buildDqAggregateSql('POSTGRESQL', { table: 't', column: 'c', ruleType: 'CUSTOM', parameters: { body: 'true' } }), null);
  assert.ok(!DB_MEASURABLE_RULE_TYPES.includes('REGEX_MATCH'));
  assert.ok(!DB_MEASURABLE_RULE_TYPES.includes('CUSTOM'));
});
