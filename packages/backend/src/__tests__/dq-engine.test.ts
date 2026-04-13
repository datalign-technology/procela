import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { evaluateRule, suggestTemplates, RULE_TEMPLATES } from '../services/dq-engine';

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
