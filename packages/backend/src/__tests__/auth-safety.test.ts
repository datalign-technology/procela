import { describe, it } from 'node:test';
import assert from 'node:assert';

import { authSafetyError } from '../services/auth-providers';

// Guards the production auth-safety check: the `dev` provider authenticates
// ANY email with no password, so the backend must refuse to serve production
// traffic when the effective provider resolves to `dev` — including the
// dangerous case where an unrecognized AUTH_PROVIDER (e.g. "cognito") silently
// falls back to dev.
describe('authSafetyError', () => {
  it('rejects an explicit dev provider in production', () => {
    const err = authSafetyError('production', 'dev', 'dev');
    assert.ok(err, 'expected a fatal message');
    assert.match(err!, /must not run in production/);
  });

  it('rejects an unrecognized provider that fell back to dev, naming the value', () => {
    const err = authSafetyError('production', 'dev', 'cognito');
    assert.ok(err, 'expected a fatal message');
    assert.match(err!, /"cognito"/);
    assert.match(err!, /silently fell back/);
    // Points the operator at the real fix.
    assert.match(err!, /AUTH_PROVIDER=oidc/);
  });

  it('allows a recognized non-dev provider in production', () => {
    assert.strictEqual(authSafetyError('production', 'oidc', 'oidc'), null);
    assert.strictEqual(authSafetyError('production', 'saml', 'saml'), null);
    assert.strictEqual(authSafetyError('production', 'local', 'local'), null);
  });

  it('never blocks outside production, even with the dev provider', () => {
    assert.strictEqual(authSafetyError('development', 'dev', 'dev'), null);
    assert.strictEqual(authSafetyError('test', 'dev', 'cognito'), null);
    assert.strictEqual(authSafetyError('staging', 'dev', 'dev'), null);
  });
});
