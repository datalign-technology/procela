// Connector DQ engine: query generation per dialect/rule-type, source
// resolution, and the run loop (with injected deps so no live DB is needed).

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  buildAggregateQuery, dialectFor, pickSource, runDqRules,
  type Dialect,
} from '../dq';
import { defaultResolvers } from '../secrets';
import type { ConnectorConfig, DqPlanEntry, Source } from '../types';

const entry = (over: Partial<DqPlanEntry> = {}): DqPlanEntry => ({
  ruleId: 'r1', table: 'public.customers', column: 'email',
  ruleType: 'NOT_NULL', parameters: {}, systemId: 'sys-1', ...over,
});

describe('buildAggregateQuery', () => {
  it('NOT_NULL (postgres) counts non-nulls, no params', () => {
    const q = buildAggregateQuery('postgres', entry())!;
    assert.match(q.sql, /SELECT COUNT\(\*\) AS total/);
    assert.match(q.sql, /SUM\(CASE WHEN "email" IS NOT NULL THEN 1 ELSE 0 END\)/);
    assert.match(q.sql, /FROM "public"\."customers"/);
    assert.deepStrictEqual(q.params, []);
  });

  it('UNIQUE uses a grouped subquery (rows appearing exactly once pass)', () => {
    const q = buildAggregateQuery('oracle', entry({ ruleType: 'UNIQUE', column: 'EMAIL', table: 'HR.CUSTOMERS' }))!;
    assert.match(q.sql, /GROUP BY "EMAIL"/);
    assert.match(q.sql, /SUM\(CASE WHEN cnt = 1 THEN 1 ELSE 0 END\)/);
    assert.match(q.sql, /FROM "HR"\."CUSTOMERS"/);
    assert.deepStrictEqual(q.params, []);
  });

  it('IN_SET binds each value as a parameter (dialect placeholders)', () => {
    const pg = buildAggregateQuery('postgres', entry({ ruleType: 'IN_SET', column: 'status', parameters: { allowedValues: ['A', 'B'] } }))!;
    assert.match(pg.sql, /"status" IN \(\$1, \$2\)/);
    assert.deepStrictEqual(pg.params, ['A', 'B']);

    const ms = buildAggregateQuery('sqlserver', entry({ ruleType: 'IN_SET', column: 'status', parameters: { allowedValues: ['A', 'B'] } }))!;
    assert.match(ms.sql, /\[status\] IN \(@p0, @p1\)/);
  });

  it('IN_SET with no allowed values is unsupported (null)', () => {
    assert.strictEqual(buildAggregateQuery('postgres', entry({ ruleType: 'IN_SET', parameters: { allowedValues: [] } })), null);
  });

  it('NUMERIC_RANGE (mysql) binds bounds, backtick-quotes the column', () => {
    const q = buildAggregateQuery('mysql', entry({ ruleType: 'NUMERIC_RANGE', column: 'amount', parameters: { min: 0, max: 100 } }))!;
    assert.match(q.sql, /`amount` >= \? AND `amount` <= \?/);
    assert.deepStrictEqual(q.params, [0, 100]);
  });

  it('NUMERIC_RANGE with only a min binds one param', () => {
    const q = buildAggregateQuery('postgres', entry({ ruleType: 'NUMERIC_RANGE', column: 'amount', parameters: { min: 5 } }))!;
    assert.match(q.sql, /"amount" >= \$1/);
    assert.ok(!/<=/.test(q.sql));
    assert.deepStrictEqual(q.params, [5]);
  });

  it('LENGTH_RANGE uses LEN on SQL Server, LENGTH elsewhere; NULL treated as 0', () => {
    const ms = buildAggregateQuery('sqlserver', entry({ ruleType: 'LENGTH_RANGE', column: 'code', parameters: { minLength: 2, maxLength: 8 } }))!;
    assert.match(ms.sql, /COALESCE\(LEN\(\[code\]\), 0\) >= @p0 AND COALESCE\(LEN\(\[code\]\), 0\) <= @p1/);
    const pg = buildAggregateQuery('postgres', entry({ ruleType: 'LENGTH_RANGE', column: 'code', parameters: { minLength: 2 } }))!;
    assert.match(pg.sql, /COALESCE\(LENGTH\("code"\), 0\) >= \$1/);
    assert.deepStrictEqual(pg.params, [2]);
  });

  it('quotes identifiers safely (embedded quote chars are escaped)', () => {
    const q = buildAggregateQuery('postgres', entry({ column: 'we"ird', table: 'public.tab"le' }))!;
    assert.match(q.sql, /"we""ird"/);
    assert.match(q.sql, /"tab""le"/);
  });
});

describe('dialectFor / pickSource', () => {
  it('maps live engines and rejects dbt', () => {
    assert.strictEqual(dialectFor('postgres'), 'postgres');
    assert.strictEqual(dialectFor('sqlserver'), 'sqlserver');
    assert.strictEqual(dialectFor('dbt'), null);
  });

  const src = (over: Partial<Source> = {}): Source =>
    ({ type: 'postgres', name: 's', connectionString: 'postgres://u:p@h/db', ...over } as Source);

  it('matches a source by systemId', () => {
    const sources = [src({ name: 'a', systemId: 'sys-a' }), src({ name: 'b', systemId: 'sys-b' })];
    assert.strictEqual(pickSource(sources, 'sys-b')!.name, 'b');
  });

  it('falls back to the sole live source when systemId does not resolve', () => {
    const sources = [src({ name: 'only', systemId: 'sys-x' })];
    assert.strictEqual(pickSource(sources, null)!.name, 'only');
    assert.strictEqual(pickSource(sources, 'no-match')!.name, 'only');
  });

  it('is ambiguous (null) with multiple sources and no systemId match', () => {
    const sources = [src({ name: 'a', systemId: 'sys-a' }), src({ name: 'b', systemId: 'sys-b' })];
    assert.strictEqual(pickSource(sources, 'no-match'), null);
  });
});

describe('runDqRules (injected deps)', () => {
  const cfg: ConnectorConfig = {
    procelaUrl: 'http://x', token: 't', heartbeatSeconds: 60, scanSeconds: 1800,
    sources: [{ type: 'postgres', name: 's1', connectionString: 'postgres://u:p@h/db', systemId: 'sys-1' } as Source],
  };
  const resolvers = defaultResolvers(() => '');
  const noop = () => { /* silent */ };

  it('evaluates each rule and pushes only aggregate counts', async () => {
    const execCalls: Array<{ sql: string }> = [];
    let pushed: any[] = [];
    await runDqRules(cfg, noop, resolvers, {
      fetchPlan: async () => [
        entry({ ruleId: 'r1', ruleType: 'NOT_NULL', column: 'email' }),
        entry({ ruleId: 'r2', ruleType: 'IN_SET', column: 'status', parameters: { allowedValues: ['A'] } }),
      ],
      exec: async (_source, sql) => { execCalls.push({ sql }); return { total: 100, passes: 97 }; },
      pushResults: async (_c, results) => { pushed = results; },
    });
    assert.strictEqual(execCalls.length, 2);
    assert.deepStrictEqual(pushed, [
      { ruleId: 'r1', totalRows: 100, passCount: 97 },
      { ruleId: 'r2', totalRows: 100, passCount: 97 },
    ]);
  });

  it('skips a rule whose source cannot be resolved and does not push when empty', async () => {
    let pushCalled = false;
    await runDqRules(
      { ...cfg, sources: [
        { type: 'postgres', name: 'a', connectionString: 'postgres://u:p@h/a', systemId: 'sys-a' } as Source,
        { type: 'postgres', name: 'b', connectionString: 'postgres://u:p@h/b', systemId: 'sys-b' } as Source,
      ] },
      noop, resolvers,
      {
        fetchPlan: async () => [entry({ systemId: 'sys-unknown' })],
        exec: async () => { throw new Error('should not run'); },
        pushResults: async () => { pushCalled = true; },
      },
    );
    assert.strictEqual(pushCalled, false);
  });

  it('a single rule execution failure is skipped, others still push', async () => {
    let pushed: any[] = [];
    await runDqRules(cfg, noop, resolvers, {
      fetchPlan: async () => [
        entry({ ruleId: 'ok', column: 'email' }),
        entry({ ruleId: 'boom', column: 'phone' }),
      ],
      // Fail only the query that targets "phone".
      exec: async (_s, sql) => {
        if (sql.includes('"phone"')) throw new Error('perm denied');
        return { total: 50, passes: 50 };
      },
      pushResults: async (_c, r) => { pushed = r; },
    });
    assert.deepStrictEqual(pushed, [{ ruleId: 'ok', totalRows: 50, passCount: 50 }]);
  });
});
