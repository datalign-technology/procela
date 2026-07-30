import { describe, it } from 'node:test';
import assert from 'node:assert';

import { parseOracleConnectionString, oracleOwnerFilter } from '../oracle';
import { normalizeNullable } from '../discovery';

describe('oracle — parseOracleConnectionString', () => {
  it('splits user/pass/host/port/service from the URL form', () => {
    const p = parseOracleConnectionString('oracle://procela_ro:s3cret@db.internal:1521/ORCLPDB1');
    assert.deepStrictEqual(p, { user: 'procela_ro', password: 's3cret', connectString: 'db.internal:1521/ORCLPDB1' });
  });

  it('defaults the port to 1521 when omitted', () => {
    const p = parseOracleConnectionString('oracle://u:p@host/SVC');
    assert.strictEqual(p.connectString, 'host:1521/SVC');
  });

  it('percent-decodes credentials (special chars in the password)', () => {
    const p = parseOracleConnectionString('oracle://u:p%40ss%2Fword@host:1521/SVC');
    assert.strictEqual(p.password, 'p@ss/word');
  });

  it('throws a clear error on a malformed string', () => {
    assert.throws(() => parseOracleConnectionString('not a url'), /invalid Oracle connectionString/);
  });
});

describe('oracle — oracleOwnerFilter', () => {
  it('defaults to the connecting user when no schemas are given', () => {
    assert.deepStrictEqual(oracleOwnerFilter(), { clause: 'owner = USER', binds: {} });
    assert.deepStrictEqual(oracleOwnerFilter([]), { clause: 'owner = USER', binds: {} });
  });

  it('binds an uppercased owner list (case-insensitive, injection-safe)', () => {
    const f = oracleOwnerFilter(['hr', 'Sales']);
    assert.strictEqual(f.clause, 'owner IN (:s0, :s1)');
    assert.deepStrictEqual(f.binds, { s0: 'HR', s1: 'SALES' });
  });
});

describe('discovery — normalizeNullable (Oracle Y/N)', () => {
  it("reads Oracle's Y/N alongside YES/NO", () => {
    assert.strictEqual(normalizeNullable('Y'), true);
    assert.strictEqual(normalizeNullable('N'), false);
    assert.strictEqual(normalizeNullable('y'), true);
  });
});
