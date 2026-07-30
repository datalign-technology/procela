import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { evaluateRule, suggestTemplates, describeRule, RULE_TEMPLATES } from '../services/dq-engine';

describe('dq-engine: real evaluation against LOCAL files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procela-dq-'));
  const csvPath = path.join(tmpDir, 'people.csv');
  const jsonlPath = path.join(tmpDir, 'events.jsonl');

  before(() => {
    fs.writeFileSync(
      csvPath,
      [
        'id,email,age,status',
        '1,alice@example.com,30,active',
        '2,bob@example.com,42,active',
        '3,,25,inactive',
        '4,not-an-email,17,active',
        '5,carol@example.com,200,retired',
        '1,duplicate@example.com,50,active',
      ].join('\n'),
    );
    fs.writeFileSync(
      jsonlPath,
      [
        '{"id":1,"email":"a@x.com"}',
        '{"id":2}',
        '{"id":3,"email":null}',
      ].join('\n'),
    );
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function subjectForCsv(col: string, assetId = 'a1', ruleId = 'r1') {
    return {
      connectionType: 'FILE_STORAGE',
      storageType: 'LOCAL',
      localFilePath: csvPath,
      sourceColumn: col,
      assetId, ruleId,
    };
  }

  it('NOT_NULL counts empty CSV cells as failures', () => {
    const r = evaluateRule('NOT_NULL', {}, subjectForCsv('email'));
    assert.strictEqual(r.simulated, false);
    assert.strictEqual(r.totalRows, 6);
    assert.strictEqual(r.failCount, 1); // row 3 has empty email
    assert.strictEqual(r.passCount, 5);
    assert.strictEqual(r.passRate, 83);
  });

  it('NOT_NULL treats JSON missing keys and explicit nulls as failures', () => {
    const r = evaluateRule('NOT_NULL', {}, {
      connectionType: 'FILE_STORAGE', storageType: 'LOCAL',
      localFilePath: jsonlPath, sourceColumn: 'email',
      assetId: 'a', ruleId: 'r',
    });
    assert.strictEqual(r.totalRows, 3);
    assert.strictEqual(r.failCount, 2);
    assert.strictEqual(r.passCount, 1);
  });

  it('UNIQUE reports duplicates with counts', () => {
    const r = evaluateRule('UNIQUE', {}, subjectForCsv('id'));
    // "1" appears twice
    assert.strictEqual(r.failCount, 2);
    assert.ok(r.failureSamples.some((s) => s.includes('1 (\u00D72)')));
  });

  it('REGEX_MATCH counts non-matching and empty values as failures', () => {
    const r = evaluateRule('REGEX_MATCH', { pattern: '^[\\w.+-]+@[\\w-]+\\.[\\w.-]+$' }, subjectForCsv('email'));
    // rows: 1 alice@, 2 bob@, 3 empty(fail), 4 not-an-email(fail), 5 carol@, 6 duplicate@
    assert.strictEqual(r.failCount, 2);
    assert.ok(r.failureSamples.includes('not-an-email'));
  });

  it('IN_SET flags values outside the allowed set', () => {
    const r = evaluateRule('IN_SET', { allowedValues: ['active', 'inactive'] }, subjectForCsv('status'));
    // row 5 status=retired is the only failure
    assert.strictEqual(r.failCount, 1);
    assert.deepStrictEqual(r.failureSamples, ['retired']);
  });

  it('NUMERIC_RANGE flags values outside bounds and non-numeric', () => {
    const r = evaluateRule('NUMERIC_RANGE', { min: 18, max: 120 }, subjectForCsv('age'));
    // row 4 age=17 too low, row 5 age=200 too high
    assert.strictEqual(r.failCount, 2);
  });

  it('LENGTH_RANGE flags values outside length bounds', () => {
    const r = evaluateRule('LENGTH_RANGE', { minLength: 5, maxLength: 30 }, subjectForCsv('email'));
    // row 3 email='' -> len 0 (fail); row 4 'not-an-email' len 12 (ok); others ok
    // "alice@example.com" = 17, "bob@example.com" = 15, "carol@example.com" = 17,
    // "duplicate@example.com" = 21, all within 5..30
    assert.strictEqual(r.failCount, 1);
  });

  it('returns a clear error for unknown columns', () => {
    const r = evaluateRule('NOT_NULL', {}, subjectForCsv('does_not_exist'));
    assert.strictEqual(r.totalRows, 0);
    assert.match(r.message, /not found/i);
  });

  it('returns a clear error when REGEX_MATCH is missing a pattern', () => {
    const r = evaluateRule('REGEX_MATCH', {}, subjectForCsv('email'));
    assert.strictEqual(r.passRate, 0);
    assert.match(r.message, /pattern/i);
  });
});

describe('dq-engine: simulated evaluation for non-LOCAL connections', () => {
  it('returns deterministic results keyed by (assetId, ruleId, ruleType)', () => {
    const subj = {
      connectionType: 'DATABASE',
      assetId: 'asset-xyz', ruleId: 'rule-abc',
    };
    const a = evaluateRule('NOT_NULL', {}, subj);
    const b = evaluateRule('NOT_NULL', {}, subj);
    assert.strictEqual(a.simulated, true);
    assert.strictEqual(b.simulated, true);
    assert.strictEqual(a.passRate, b.passRate);
    assert.strictEqual(a.totalRows, b.totalRows);
    assert.match(a.message, /simulated/i);
  });

  it('produces different numbers for different rule types on the same asset', () => {
    const base = { connectionType: 'DATABASE', assetId: 'asset-xyz', ruleId: 'rule-abc' };
    const notNull = evaluateRule('NOT_NULL', {}, base);
    const unique = evaluateRule('UNIQUE', {}, base);
    // Not a guarantee they differ — but with different seeds + bands they
    // almost always will. Assert at least one of rate/total differs.
    assert.ok(notNull.passRate !== unique.passRate || notNull.totalRows !== unique.totalRows);
  });
});

describe('suggestTemplates', () => {
  it('suggests UNIQUE for *_id style columns', () => {
    const { suggested } = suggestTemplates('customer_id');
    assert.ok(suggested.some((t) => t.id === 'unique'));
  });

  it('suggests the email regex for email-ish columns', () => {
    const { suggested } = suggestTemplates('user_email');
    assert.ok(suggested.some((t) => t.id === 'regex-email'));
  });

  it('suggests ISO-date regex for created_at / timestamps', () => {
    const { suggested } = suggestTemplates('created_at');
    assert.ok(suggested.some((t) => t.id === 'regex-iso-date'));
  });

  it('falls back to generic when the column is unknown', () => {
    const { suggested, generic } = suggestTemplates(undefined);
    assert.strictEqual(suggested.length, 0);
    // Every template should appear as generic in this case.
    assert.strictEqual(generic.length, RULE_TEMPLATES.length);
  });

  it('every template in the catalog has a stable id and parameters object', () => {
    for (const t of RULE_TEMPLATES) {
      assert.ok(t.id);
      assert.ok(t.ruleType);
      assert.ok(t.name);
      assert.strictEqual(typeof t.parameters, 'object');
    }
  });
});

describe('describeRule', () => {
  it('renders SQL with COUNT(*) FILTER for a DB-backed NOT_NULL', () => {
    const d = describeRule('NOT_NULL', {}, {
      connectionType: 'DATABASE', dbType: 'POSTGRESQL',
      sourceAsset: 'customers', sourceColumn: 'email',
    });
    assert.strictEqual(d.language, 'sql');
    assert.match(d.body, /FROM customers/);
    assert.match(d.body, /email IS NULL/);
    assert.strictEqual(d.executable, false); // no driver wired
  });

  it('uses NOT REGEXP for MySQL REGEX_MATCH', () => {
    const d = describeRule('REGEX_MATCH', { pattern: '^[a-z]+$' }, {
      connectionType: 'DATABASE', dbType: 'MYSQL',
      sourceAsset: 't', sourceColumn: 'c',
    });
    assert.match(d.body, /NOT REGEXP/);
  });

  it('defaults to !~ for PostgreSQL-style REGEX_MATCH', () => {
    const d = describeRule('REGEX_MATCH', { pattern: '^x$' }, {
      connectionType: 'DATABASE', dbType: 'POSTGRESQL',
      sourceAsset: 't', sourceColumn: 'c',
    });
    assert.match(d.body, /!~/);
    assert.ok(!/NOT REGEXP/.test(d.body));
  });

  it('emits executable JS for a LOCAL NOT_NULL rule', () => {
    const d = describeRule('NOT_NULL', {}, {
      connectionType: 'FILE_STORAGE', storageType: 'LOCAL',
      sourceAsset: 'customers.csv', sourceColumn: 'email',
      originalFileName: 'customers.csv',
    });
    assert.strictEqual(d.language, 'js');
    assert.strictEqual(d.executable, true);
    assert.match(d.body, /filter/);
  });

  it('uses {table} / {column} placeholders when context is empty', () => {
    const d = describeRule('UNIQUE', {}, {
      connectionType: 'DATABASE',
    });
    assert.match(d.body, /\{table\}/);
    assert.match(d.body, /\{column\}/);
  });

  it('emits pseudocode for connection types without a driver', () => {
    const d = describeRule('IN_SET', { allowedValues: ['a', 'b'] }, {
      connectionType: 'API',
      sourceAsset: '/api/users', sourceColumn: 'status',
    });
    assert.strictEqual(d.language, 'pseudo');
    assert.strictEqual(d.executable, false);
    assert.match(d.body, /simulated/i);
  });

  it('quotes IN_SET values safely (escapes single quotes) for SQL', () => {
    const d = describeRule('IN_SET', { allowedValues: ["O'Brien", 'normal'] }, {
      connectionType: 'DATABASE', sourceAsset: 't', sourceColumn: 'name',
    });
    assert.match(d.body, /'O''Brien'/);
  });
});

describe('CUSTOM rule evaluation', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'procela-custom-'));
  const csv = path.join(tmp, 'parts.csv');
  fs.writeFileSync(csv, 'id,code\n1,MSB-001\n2,msb-002\n3,OTHER\n4,MSB-9\n');

  function subj(ruleId: string) {
    return {
      connectionType: 'FILE_STORAGE', storageType: 'LOCAL',
      localFilePath: csv, sourceColumn: 'code',
      assetId: 'a', ruleId,
    };
  }

  it('executes a bare JS expression per value', () => {
    const r = evaluateRule('CUSTOM', { language: 'js', body: "value?.startsWith('MSB-')" }, subj('r1'));
    assert.strictEqual(r.simulated, false);
    // MSB-001 and MSB-9 pass; msb-002 and OTHER fail
    assert.strictEqual(r.passCount, 2);
    assert.strictEqual(r.failCount, 2);
  });

  it('accepts a statement form with an explicit return', () => {
    const r = evaluateRule('CUSTOM', { language: 'js', body: "return value && value.length > 5;" }, subj('r2'));
    assert.strictEqual(r.simulated, false);
    // MSB-001 (7), msb-002 (7), OTHER (5) -> fails, MSB-9 (5) -> fails
    assert.strictEqual(r.passCount, 2);
    assert.strictEqual(r.failCount, 2);
  });

  it('treats per-row runtime errors as failures, not crashes', () => {
    const r = evaluateRule('CUSTOM', { language: 'js', body: 'value.toUpperCase().nonExistent.x' }, subj('r3'));
    assert.strictEqual(r.failCount, 4);
    assert.strictEqual(r.passCount, 0);
  });

  it('surfaces a clear error for invalid JS syntax', () => {
    const r = evaluateRule('CUSTOM', { language: 'js', body: 'value ===' }, subj('r4'));
    assert.strictEqual(r.totalRows, 0);
    assert.match(r.message, /invalid expression/i);
  });

  it('refuses to locally execute a SQL-language CUSTOM rule', () => {
    const r = evaluateRule('CUSTOM', { language: 'sql', body: 'SELECT 1' }, subj('r5'));
    assert.strictEqual(r.totalRows, 0);
    assert.match(r.message, /no local executor/i);
  });

  it('simulates when the source is not LOCAL', () => {
    const r = evaluateRule('CUSTOM', { language: 'sql', body: 'SELECT COUNT(*) FROM t' }, {
      connectionType: 'DATABASE', assetId: 'a', ruleId: 'r6',
    });
    assert.strictEqual(r.simulated, true);
    assert.match(r.message, /simulated/i);
  });
});
