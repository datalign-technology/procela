// Unit tests for the agent-push sync helpers that need no live database:
// the SELECT builder (identical dialect to the backend) and the source-
// selection logic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelectSql, assertIdentifier, clampLimit, normalizeRow, DEFAULT_ROW_LIMIT } from '../sync-query';
import { selectSourceForJob } from '../sync';
import type { Source, AgentSyncJob } from '../types';

test('buildSelectSql: per-engine dialect matches the backend', () => {
  assert.equal(buildSelectSql('POSTGRESQL', { schema: 'public', table: 'people', limit: 100 }), 'SELECT * FROM "public"."people" LIMIT 100');
  assert.equal(buildSelectSql('MYSQL', { schema: 'app', table: 'people', limit: 50 }), 'SELECT * FROM `app`.`people` LIMIT 50');
  assert.equal(buildSelectSql('SQLSERVER', { schema: 'dbo', table: 'org', limit: 25 }), 'SELECT TOP (25) * FROM [dbo].[org]');
  assert.equal(buildSelectSql('POSTGRESQL', { table: 't' }), `SELECT * FROM "t" LIMIT ${DEFAULT_ROW_LIMIT}`);
});

test('buildSelectSql: a raw query passes through untouched', () => {
  const q = 'SELECT id, name FROM v_active WHERE flag = 1';
  assert.equal(buildSelectSql('SQLSERVER', { query: q, table: 'ignored' }), q);
});

test('buildSelectSql / assertIdentifier: reject injection in identifiers', () => {
  for (const bad of ['a; DROP TABLE x', 'a b', 'sch.tbl', 'tbl"x', '1abc']) {
    assert.throws(() => assertIdentifier('table', bad), /Invalid table identifier/);
    assert.throws(() => buildSelectSql('POSTGRESQL', { table: bad }), /Invalid table identifier/);
  }
});

test('clampLimit + normalizeRow behave like the backend', () => {
  assert.equal(clampLimit(undefined), DEFAULT_ROW_LIMIT);
  assert.equal(clampLimit(-3), 1);
  assert.deepEqual(
    normalizeRow({ id: 5, name: 'Acme', note: null, when: new Date('2026-01-02T00:00:00.000Z') }),
    { id: '5', name: 'Acme', note: '', when: '2026-01-02T00:00:00.000Z' },
  );
});

const pg: Source = { type: 'postgres', name: 'primary-pg', connectionString: 'postgres://x' };
const my: Source = { type: 'mysql', name: 'hr-mysql', connectionString: 'mysql://x' };
const sources: Source[] = [pg, my];

function job(overrides: Partial<AgentSyncJob>): AgentSyncJob {
  return { id: 'j', name: 'job', targetEntity: 'people', matchKey: 'name', fieldMapping: {}, intervalMinutes: 60, nextRunAt: null, ...overrides };
}

test('selectSourceForJob: explicit sourceName wins', () => {
  assert.equal(selectSourceForJob(sources, job({ sourceName: 'hr-mysql', dbType: 'POSTGRESQL' })), my);
  assert.equal(selectSourceForJob(sources, job({ sourceName: 'nope' })), null);
});

test('selectSourceForJob: falls back to first source matching dbType', () => {
  assert.equal(selectSourceForJob(sources, job({ dbType: 'POSTGRESQL' })), pg);
  assert.equal(selectSourceForJob(sources, job({ dbType: 'MYSQL' })), my);
  assert.equal(selectSourceForJob(sources, job({ dbType: 'SQLSERVER' })), null);
});

test('selectSourceForJob: no name and no dbType → null', () => {
  assert.equal(selectSourceForJob(sources, job({})), null);
});
