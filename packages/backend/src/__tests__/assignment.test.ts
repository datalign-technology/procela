import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isAssignedTo,
  isAssignedScopedRole,
  enforceAssignment,
  ownerOnCreate,
} from '../lib/assignment';

const contributor = { sub: 'person-1', role: 'CONTRIBUTOR' };
const editor = { sub: 'person-2', role: 'EDITOR' };
const admin = { sub: 'person-3', role: 'ORG_ADMIN' };

describe('isAssignedScopedRole', () => {
  it('only CONTRIBUTOR is assigned-scoped', () => {
    assert.strictEqual(isAssignedScopedRole('CONTRIBUTOR'), true);
    assert.strictEqual(isAssignedScopedRole('EDITOR'), false);
    assert.strictEqual(isAssignedScopedRole('ORG_ADMIN'), false);
    assert.strictEqual(isAssignedScopedRole('VIEWER'), false);
    assert.strictEqual(isAssignedScopedRole(undefined), false);
  });
});

describe('isAssignedTo', () => {
  it('matches any assignment field against user.sub', () => {
    assert.ok(isAssignedTo(contributor, { ownerId: 'person-1' }));
    assert.ok(isAssignedTo(contributor, { ownerPersonId: 'person-1' }));
    assert.ok(isAssignedTo(contributor, { responsiblePersonId: 'person-1' }));
    assert.ok(isAssignedTo(contributor, { stewardId: 'person-1' }));
    assert.ok(isAssignedTo(contributor, { assigneeId: 'person-1' }));
    assert.ok(isAssignedTo(contributor, { createdBy: 'person-1' }));
    assert.ok(isAssignedTo(contributor, { userId: 'person-1' }));
    assert.ok(isAssignedTo(contributor, { uploadedBy: 'person-1' }));
  });

  it('is false when no field matches', () => {
    assert.strictEqual(isAssignedTo(contributor, { ownerId: 'someone-else' }), false);
    assert.strictEqual(isAssignedTo(contributor, { ownerId: null }), false);
    assert.strictEqual(isAssignedTo(contributor, {}), false);
  });

  it('is false for a missing user or record', () => {
    assert.strictEqual(isAssignedTo(undefined, { ownerId: 'person-1' }), false);
    assert.strictEqual(isAssignedTo(contributor, null), false);
    assert.strictEqual(isAssignedTo({ role: 'CONTRIBUTOR' }, { ownerId: 'person-1' }), false);
  });
});

describe('enforceAssignment', () => {
  it('403s a CONTRIBUTOR modifying an unassigned record', () => {
    const err = enforceAssignment(contributor, { ownerId: 'someone-else' });
    assert.strictEqual(err?.statusCode, 403);
  });

  it('passes a CONTRIBUTOR modifying their own record', () => {
    assert.strictEqual(enforceAssignment(contributor, { ownerId: 'person-1' }), undefined);
  });

  it('never blocks org-wide roles', () => {
    assert.strictEqual(enforceAssignment(editor, { ownerId: 'someone-else' }), undefined);
    assert.strictEqual(enforceAssignment(admin, { ownerId: 'someone-else' }), undefined);
  });

  it('passes through when there is no authenticated user (unit-test mounts)', () => {
    assert.strictEqual(enforceAssignment(undefined, { ownerId: 'x' }), undefined);
    assert.strictEqual(enforceAssignment({ sub: 'x' }, { ownerId: 'y' }), undefined);
  });
});

describe('ownerOnCreate', () => {
  it('keeps an explicit owner for any role', () => {
    assert.strictEqual(ownerOnCreate(contributor, 'chosen'), 'chosen');
    assert.strictEqual(ownerOnCreate(admin, 'chosen'), 'chosen');
  });

  it('defaults a CONTRIBUTOR creator as owner when none supplied', () => {
    assert.strictEqual(ownerOnCreate(contributor, undefined), 'person-1');
    assert.strictEqual(ownerOnCreate(contributor, null), 'person-1');
  });

  it('leaves owner null for org-wide roles when none supplied', () => {
    assert.strictEqual(ownerOnCreate(editor, undefined), null);
    assert.strictEqual(ownerOnCreate(admin, null), null);
    assert.strictEqual(ownerOnCreate(undefined, undefined), null);
  });
});
