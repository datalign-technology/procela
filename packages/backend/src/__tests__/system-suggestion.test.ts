// Tests for services/system-suggestion.service — Phase 3 expansion
// piece that ranks Systems as candidates for a process node.
//
// Validates: name/description scoring, sibling-step affinity bump,
// already-declared exclusion, and dismissal filtering (the learning
// loop entry point on the system surface).
import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  rankSystemSuggestions,
  type SystemSuggestionNode,
  type SystemSuggestionSystem,
} from '../services/system-suggestion.service';

function node(partial: Partial<SystemSuggestionNode>): SystemSuggestionNode {
  return { id: 'n-1', parentId: 'p-1', name: '', description: '', systemIds: [], ...partial };
}
function sys(partial: Partial<SystemSuggestionSystem> & { name: string }): SystemSuggestionSystem {
  return { id: 'sys-1', description: '', ...partial };
}

describe('rankSystemSuggestions', () => {
  it('ranks a name-matching system above an unrelated one', () => {
    const n = node({ name: 'Update billing record' });
    const out = rankSystemSuggestions(
      n,
      [sys({ id: 's-billing', name: 'SAP Billing' }), sys({ id: 's-hr', name: 'Workday HR' })],
      [],
      new Set(),
    );
    assert.strictEqual(out[0].systemId, 's-billing');
    assert.ok(out[0].score > 0);
  });

  it('excludes systems already declared on the node', () => {
    const n = node({ name: 'Customer billing', systemIds: ['s-billing'] });
    const out = rankSystemSuggestions(
      n,
      [sys({ id: 's-billing', name: 'SAP Billing' })],
      [],
      new Set(),
    );
    assert.strictEqual(out.length, 0);
  });

  it('bumps a system that sibling steps already use', () => {
    const n = node({ id: 'me', parentId: 'p-1', name: 'reconcile' });
    const siblings = [
      { id: 'me', parentId: 'p-1' as string | null, systemIds: [] },
      { id: 's-a', parentId: 'p-1' as string | null, systemIds: ['s-erp'] },
      { id: 's-b', parentId: 'p-1' as string | null, systemIds: ['s-erp'] },
    ];
    const out = rankSystemSuggestions(
      n,
      [sys({ id: 's-erp', name: 'NetSuite' })],
      siblings,
      new Set(),
    );
    assert.strictEqual(out[0].systemId, 's-erp');
    assert.ok(out[0].rationale.some((r) => /sibling/.test(r)));
  });

  it('filters out dismissed systems even if they would otherwise rank', () => {
    const n = node({ name: 'billing record' });
    const out = rankSystemSuggestions(
      n,
      [sys({ id: 's-billing', name: 'SAP Billing' })],
      [],
      new Set(['s-billing']),
    );
    assert.strictEqual(out.length, 0);
  });
});
