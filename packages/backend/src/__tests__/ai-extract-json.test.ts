import { describe, it } from 'node:test';
import assert from 'node:assert';

// extractJson is internal to ai.service.ts. We re-implement-friendly the
// behaviour we expect — black-box tests by invoking the public methods
// would need the Anthropic SDK mocked, which is heavier than warranted
// for parser-only logic. Tests run against the same module by importing
// the service and exercising it indirectly via a stub-friendly approach
// would be cleaner, but the current export shape doesn't expose the
// helper. So instead: import the module dynamically and reach for the
// helper via test reflection, then assert. If the export shape changes,
// these tests should be updated to match.

// We mirror what the helper does — minimal contract:
//   - parses clean JSON
//   - strips ```json fences
//   - extracts JSON embedded in narrative
//   - throws (not returns null / undefined) when nothing parses

// Import the actual helper. ai.service.ts doesn't export it today; for
// these tests to compile we add a `_test` export. See ai.service.ts.

import { _extractJsonForTests as extractJson } from '../services/ai.service';

describe('AI response JSON extraction', () => {
  it('parses a clean JSON array', () => {
    const out = extractJson('[{"name":"Customer"}]');
    assert.deepStrictEqual(out, [{ name: 'Customer' }]);
  });

  it('parses a clean JSON object', () => {
    const out = extractJson('{"a":1}');
    assert.deepStrictEqual(out, { a: 1 });
  });

  it('strips ```json fences', () => {
    const out = extractJson('```json\n[1,2,3]\n```');
    assert.deepStrictEqual(out, [1, 2, 3]);
  });

  it('strips bare ``` fences', () => {
    const out = extractJson('```\n[1,2,3]\n```');
    assert.deepStrictEqual(out, [1, 2, 3]);
  });

  it('strips ~~~ fences', () => {
    const out = extractJson('~~~\n[1,2,3]\n~~~');
    assert.deepStrictEqual(out, [1, 2, 3]);
  });

  it('extracts JSON when the model prefaces with prose', () => {
    const out = extractJson(
      'Here are the data domains for the Utilities industry:\n\n[{"name":"Customer Data"}]',
    );
    assert.deepStrictEqual(out, [{ name: 'Customer Data' }]);
  });

  it('extracts JSON when the model adds trailing prose', () => {
    const out = extractJson(
      '[{"name":"Customer Data"}]\n\nLet me know if you want more!',
    );
    assert.deepStrictEqual(out, [{ name: 'Customer Data' }]);
  });

  it('handles brackets inside string values', () => {
    const out = extractJson('[{"description":"Contains [legacy] fields"}]');
    assert.deepStrictEqual(out, [{ description: 'Contains [legacy] fields' }]);
  });

  it('handles escaped quotes inside string values', () => {
    const out = extractJson('[{"name":"He said \\"hi\\" loudly"}]');
    assert.deepStrictEqual(out, [{ name: 'He said "hi" loudly' }]);
  });

  it('throws when the response has no JSON at all', () => {
    assert.throws(
      () => extractJson("I'm sorry, I can't help with that."),
      /Couldn.t parse JSON/,
    );
  });

  it('throws on empty response', () => {
    assert.throws(() => extractJson(''), /Empty response/);
  });

  it('attaches the raw response to the thrown error', () => {
    try {
      extractJson('not json at all');
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.ok(err.rawResponse, 'rawResponse is populated on the error');
      assert.strictEqual(err.rawResponse, 'not json at all');
    }
  });
});
