// Tests for services/people-suggestion.service — Phase 3 expansion
// piece that ranks Persons as candidates for involvement on a process
// node.
//
// Validates: title/role overlap, required-skill match, system-owner
// affinity, already-on-node exclusion, and dismissal filtering.
import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  rankPeopleSuggestions,
  type PeopleSuggestionNode,
  type PeopleSuggestionPerson,
  type PeopleSuggestionSystem,
} from '../services/people-suggestion.service';

function node(partial: Partial<PeopleSuggestionNode>): PeopleSuggestionNode {
  return {
    id: 'n-1',
    name: '',
    description: '',
    systemIds: [],
    requiredSkillIds: [],
    ownerId: null,
    responsiblePersonId: null,
    ...partial,
  };
}
function person(partial: Partial<PeopleSuggestionPerson> & { id: string; name: string }): PeopleSuggestionPerson {
  return { ...partial };
}

describe('rankPeopleSuggestions', () => {
  it('ranks a title-matching person above an unrelated one', () => {
    const n = node({ name: 'Customer billing reconciliation' });
    const out = rankPeopleSuggestions(
      n,
      [
        person({ id: 'p-billing', name: 'Alice', title: 'Billing analyst', jobRole: '' }),
        person({ id: 'p-hr', name: 'Bob', title: 'HR coordinator', jobRole: '' }),
      ],
      [],
      new Set(),
    );
    assert.strictEqual(out[0].personId, 'p-billing');
    assert.ok(out[0].rationale.some((r) => /title.*overlap/i.test(r)));
  });

  it('rewards required-skill coverage', () => {
    const n = node({ name: 'reconcile', requiredSkillIds: ['skill-sql', 'skill-erp'] });
    const out = rankPeopleSuggestions(
      n,
      [
        person({ id: 'p-1', name: 'A', skillIds: ['skill-sql', 'skill-erp'] }),
        person({ id: 'p-2', name: 'B', skillIds: ['skill-paint'] }),
      ],
      [],
      new Set(),
    );
    assert.strictEqual(out[0].personId, 'p-1');
    assert.ok(out[0].rationale.some((r) => /2 of 2/.test(r)));
  });

  it('rewards system-ownership affinity with the step\'s declared systems', () => {
    const n = node({ name: 'reconcile', systemIds: ['sys-erp'] });
    const systems: PeopleSuggestionSystem[] = [
      { id: 'sys-erp', ownerPersonId: 'p-owner', custodianIds: [] },
    ];
    const out = rankPeopleSuggestions(
      n,
      [person({ id: 'p-owner', name: 'Owner', title: '' })],
      systems,
      new Set(),
    );
    assert.strictEqual(out[0].personId, 'p-owner');
    assert.ok(out[0].rationale.some((r) => /Owns.*system/i.test(r)));
  });

  it('excludes the existing ownerId / responsiblePersonId', () => {
    const n = node({ name: 'reconcile', ownerId: 'p-1' });
    const out = rankPeopleSuggestions(
      n,
      [person({ id: 'p-1', name: 'Already on', title: 'reconcile reconcile' })],
      [],
      new Set(),
    );
    assert.strictEqual(out.length, 0);
  });

  it('filters out dismissed persons', () => {
    const n = node({ name: 'billing reconciliation' });
    const out = rankPeopleSuggestions(
      n,
      [person({ id: 'p-1', name: 'A', title: 'billing reconciliation' })],
      [],
      new Set(['p-1']),
    );
    assert.strictEqual(out.length, 0);
  });
});
