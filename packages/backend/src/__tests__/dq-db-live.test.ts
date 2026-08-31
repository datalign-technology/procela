// Live-Postgres integration test for measured DQ over a direct connection.
// NO-OP when DATABASE_URL is unset. Creates a temp table with known data, runs
// rules through measureRuleOverDb, and asserts the measured (simulated:false)
// counts — the direct-connect equivalent of the on-prem connector's push path.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { Client } from 'pg';

import { hasDatabase } from '../db/prisma';
import { measureRuleOverDb, type DbRuleSubject } from '../services/dq-db';

const TABLE = 'dq_live_test';

function subjectFor(column: string): DbRuleSubject {
  const u = new URL(process.env.DATABASE_URL as string);
  return {
    dbType: 'POSTGRESQL',
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    schema: 'public',
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    table: TABLE,
    column,
  };
}

const SKIP = !hasDatabase();
const suite = SKIP
  ? (name: string, _fn: () => unknown) => describe.skip(name, () => { /* no-op */ })
  : describe;

suite('measured DQ over a live database', () => {
  before(async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query(`DROP TABLE IF EXISTS ${TABLE}`);
      await c.query(`CREATE TABLE ${TABLE} (email TEXT, status TEXT)`);
      await c.query(
        `INSERT INTO ${TABLE} (email, status) VALUES `
        + `('a@x', 'OPEN'), ('b@x', 'CLOSED'), (NULL, 'OPEN'), ('a@x', 'PENDING')`,
      );
    } finally { await c.end(); }
  });

  after(async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { await c.query(`DROP TABLE IF EXISTS ${TABLE}`); }
    finally { await c.end(); }
  });

  it('NOT_NULL measures real non-null count', async () => {
    const r = (await measureRuleOverDb('NOT_NULL', {}, subjectFor('email')))!;
    assert.ok(r, 'NOT_NULL should be measurable');
    assert.strictEqual(r.simulated, false);
    assert.strictEqual(r.totalRows, 4);
    assert.strictEqual(r.passCount, 3);   // one NULL email
    assert.strictEqual(r.passRate, 75);
  });

  it('UNIQUE measures rows whose value appears once', async () => {
    const r = (await measureRuleOverDb('UNIQUE', {}, subjectFor('email')))!;
    assert.strictEqual(r.totalRows, 4);
    assert.strictEqual(r.passCount, 2);   // 'b@x' + the single NULL group; 'a@x' ×2 fails
    assert.strictEqual(r.simulated, false);
  });

  it('IN_SET measures against a bound allow-list', async () => {
    const r = (await measureRuleOverDb('IN_SET', { allowedValues: ['OPEN', 'CLOSED'] }, subjectFor('status')))!;
    assert.strictEqual(r.totalRows, 4);
    assert.strictEqual(r.passCount, 3);   // PENDING fails
    assert.strictEqual(r.passRate, 75);
  });

  it('REGEX_MATCH is not DB-measurable (returns null → caller simulates)', async () => {
    const r = await measureRuleOverDb('REGEX_MATCH', { pattern: '.*' }, subjectFor('email'));
    assert.strictEqual(r, null);
  });
});
