// node-readiness — the "required before activation" field set that backs the
// per-tenant activation gate (Organization.requireFieldsForActivation). Mirrors
// the frontend ReadinessPanel definition; these tests pin the per-level sets and
// the empty/filled semantics the gate relies on.

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { missingRequiredFields } from '../lib/node-readiness';

describe('missingRequiredFields', () => {
  it('reports every required field missing on an empty value stream', () => {
    const missing = missingRequiredFields({ level: 'VALUE_STREAM' });
    assert.deepStrictEqual(missing.sort(), [
      'Customer type', 'Effective date', 'End state', 'Executive sponsor',
      'Review cadence', 'Value proposition',
    ].sort());
  });

  it('returns [] when a value stream has every required field filled', () => {
    const missing = missingRequiredFields({
      level: 'VALUE_STREAM',
      valueProposition: 'Fast, safe restoration',
      customerType: 'External',
      endState: 'Service restored',
      executiveSponsor: 'VP Ops',
      effectiveDate: '2026-01-01',
      reviewCadence: 'Annual',
    });
    assert.deepStrictEqual(missing, []);
  });

  it('treats whitespace-only and empty-array values as unfilled', () => {
    const missing = missingRequiredFields({
      level: 'ACTIVITY',
      responsibleRole: '   ', // whitespace → unfilled
      accountableRole: 'Owner',
      activityType: 'Manual',
      completionCriteria: 'Done when closed',
      workInstructions: '', // empty → unfilled
    });
    assert.deepStrictEqual(missing.sort(), ['Responsible Role', 'Work instructions'].sort());
  });

  it('uses ownerId (not a name) for the sub-process Owner requirement', () => {
    const withOwner = missingRequiredFields({
      level: 'SUBPROCESS',
      ownerId: 'person-1',
      entryCriteria: 'ready',
      exitCriteria: 'complete',
      performingOrg: 'Ops',
      effectiveDate: '2026-01-01',
      reviewCadence: 'Annual',
    });
    assert.deepStrictEqual(withOwner, []);
    const noOwner = missingRequiredFields({ level: 'SUBPROCESS', ownerId: '' });
    assert.ok(noOwner.includes('Owner'));
  });

  it('returns [] for a level with no required set (e.g. a bare level or TASK)', () => {
    assert.deepStrictEqual(missingRequiredFields({ level: 'TASK' }), []);
    assert.deepStrictEqual(missingRequiredFields({ level: null }), []);
  });
});
