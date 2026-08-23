// Unit tests for the SSO provisioning resolver — pure logic, no DB.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDomainMap,
  effectiveSsoRole,
  resolveProvisioningTarget,
  primaryOrgId,
  defaultSsoRole,
} from '../lib/provisioning';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000010';

test('parseDomainMap: string form → orgId rule', () => {
  assert.deepEqual(parseDomainMap('{"acme.com":"org-1"}'), { 'acme.com': { orgId: 'org-1' } });
});

test('parseDomainMap: object form carries a normalised role', () => {
  assert.deepEqual(
    parseDomainMap('{"beta.io":{"orgId":"org-2","role":"contributor"}}'),
    { 'beta.io': { orgId: 'org-2', role: 'CONTRIBUTOR' } },
  );
});

test('parseDomainMap: strips leading @, lower-cases the domain', () => {
  assert.deepEqual(parseDomainMap('{"@ACME.COM":"org-1"}'), { 'acme.com': { orgId: 'org-1' } });
});

test('parseDomainMap: empty / malformed / orgId-less are safe', () => {
  assert.deepEqual(parseDomainMap(''), {});
  assert.deepEqual(parseDomainMap('   '), {});
  assert.deepEqual(parseDomainMap('not json'), {}); // logs a warning, no throw
  assert.deepEqual(parseDomainMap('{"x.com":{"role":"EDITOR"}}'), {}); // no orgId → skipped
});

test('effectiveSsoRole: a real IdP role wins; else the fallback applies', () => {
  assert.equal(effectiveSsoRole('EDITOR', 'VIEWER'), 'EDITOR');
  assert.equal(effectiveSsoRole('org_admin', 'VIEWER'), 'ORG_ADMIN'); // case-insensitive
  assert.equal(effectiveSsoRole('VIEWER', 'CONTRIBUTOR'), 'CONTRIBUTOR'); // VIEWER = "no real role" → fallback
  assert.equal(effectiveSsoRole(undefined, 'VIEWER'), 'VIEWER');
  assert.equal(effectiveSsoRole('bogus', 'CONTRIBUTOR'), 'CONTRIBUTOR'); // unknown → fallback
});

test('resolveProvisioningTarget: default (no domain map configured) → primary org + default role', () => {
  // With no SSO_* env set in the test process, these are the defaults.
  assert.equal(primaryOrgId(), DEFAULT_ORG_ID);
  assert.equal(defaultSsoRole(), 'VIEWER');
  assert.deepEqual(resolveProvisioningTarget('anyone@nowhere.com'), { orgId: DEFAULT_ORG_ID, role: 'VIEWER' });
  assert.deepEqual(resolveProvisioningTarget('no-at-sign'), { orgId: DEFAULT_ORG_ID, role: 'VIEWER' });
});
