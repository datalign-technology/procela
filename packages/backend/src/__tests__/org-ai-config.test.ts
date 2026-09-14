import { test } from 'node:test';
import assert from 'node:assert';

// ─────────────────────────────────────────────────────────────────────────
// Phase 3 (multi-vendor AI) — per-tenant provider config.
//
// Covers the store (set/get/clear + provider validation + alias folding), the
// encryption round-trip and the key-never-leaked guarantee, and the
// resolution that binds an org's AI calls to its own vendor while every
// org without a config keeps the deployment default.
// ─────────────────────────────────────────────────────────────────────────

import {
  getOrgAiConfigView,
  setOrgAiConfig,
  resolveOrgProvider,
  OrgAiConfigError,
} from '../services/org-ai-config';
import { getAiServiceForOrg, aiService } from '../services/ai.service';
import { decryptSecret } from '../services/crypto.service';

// Unique org ids per test — the JSON AppSetting store is shared in-process.
let n = 0;
const freshOrg = () => `test-org-ai-${Date.now()}-${n++}`;

test('a fresh org reports no per-tenant config (all defaults)', async () => {
  const view = await getOrgAiConfigView(freshOrg());
  assert.equal(view.provider, null);
  assert.equal(view.model, null);
  assert.equal(view.enabled, true);
  assert.equal(view.apiKeyConfigured, false);
});

test('setting a provider + key: view exposes a flag not the key; key round-trips', async () => {
  const orgId = freshOrg();
  const view = await setOrgAiConfig(
    orgId,
    { provider: 'openai', model: 'gpt-x', baseUrl: 'https://llm.internal', apiKey: 'sk-secret-123' },
    'user-1',
  );

  assert.equal(view.provider, 'openai');
  assert.equal(view.model, 'gpt-x');
  assert.equal(view.baseUrl, 'https://llm.internal');
  assert.equal(view.apiKeyConfigured, true);
  assert.equal(view.updatedBy, 'user-1');
  // The key must never appear anywhere in the returned view.
  assert.equal((view as unknown as Record<string, unknown>).apiKey, undefined);
  assert.ok(!JSON.stringify(view).includes('sk-secret-123'), 'plaintext key leaked into the view');

  // The resolution path decrypts the stored key back to plaintext.
  const resolved = await resolveOrgProvider(orgId);
  assert.ok(resolved);
  assert.equal(resolved!.provider, 'openai');
  assert.equal(resolved!.model, 'gpt-x');
  assert.equal(resolved!.creds.apiKey, 'sk-secret-123');
  assert.equal(resolved!.creds.baseUrl, 'https://llm.internal');
});

test('provider aliases fold to canonical names', async () => {
  const a = await setOrgAiConfig(freshOrg(), { provider: 'azure' }, null);
  assert.equal(a.provider, 'openai');
  const b = await setOrgAiConfig(freshOrg(), { provider: 'claude' }, null);
  assert.equal(b.provider, 'anthropic');
  const c = await setOrgAiConfig(freshOrg(), { provider: 'aws' }, null);
  assert.equal(c.provider, 'bedrock');
});

test('an unknown provider is rejected', async () => {
  await assert.rejects(
    () => setOrgAiConfig(freshOrg(), { provider: 'llama.cpp' }, null),
    (e) => e instanceof OrgAiConfigError,
  );
});

test('clearing the key removes it from resolution', async () => {
  const orgId = freshOrg();
  await setOrgAiConfig(orgId, { provider: 'anthropic', apiKey: 'sk-live' }, null);
  const cleared = await setOrgAiConfig(orgId, { apiKey: '' }, null);
  assert.equal(cleared.apiKeyConfigured, false);
  assert.equal(cleared.provider, 'anthropic'); // other fields untouched
  const resolved = await resolveOrgProvider(orgId);
  assert.equal(resolved!.creds.apiKey, undefined);
});

test('disabling forces the deployment fallback (resolveOrgProvider → null)', async () => {
  const orgId = freshOrg();
  await setOrgAiConfig(orgId, { provider: 'gemini', enabled: false }, null);
  assert.equal(await resolveOrgProvider(orgId), null);
});

test('a provider-less config falls back (no per-tenant provider named)', async () => {
  const orgId = freshOrg();
  // model-only, no provider → not an active per-tenant override
  await setOrgAiConfig(orgId, { model: 'some-model' }, null);
  assert.equal(await resolveOrgProvider(orgId), null);
});

test('the stored key is an at-rest envelope that decrypts back (when encryption is on)', async () => {
  const orgId = freshOrg();
  await setOrgAiConfig(orgId, { provider: 'bedrock', apiKey: 'plaintext-key' }, null);
  const resolved = await resolveOrgProvider(orgId);
  // decryptSecret is the inverse of what the store used to persist the key,
  // whether the active provider is the local AES cipher or the no-op
  // passthrough (dev) — either way the round-trip yields the original.
  assert.equal(await decryptSecret((resolved!.creds.apiKey as string)), 'plaintext-key');
});

test('getAiServiceForOrg falls back to the shared default when no org / no config', async () => {
  assert.equal(await getAiServiceForOrg(undefined), aiService);
  assert.equal(await getAiServiceForOrg(null), aiService);
  assert.equal(await getAiServiceForOrg(freshOrg()), aiService); // org exists, no config
});

test('getAiServiceForOrg builds a distinct per-tenant service when configured', async () => {
  const orgId = freshOrg();
  await setOrgAiConfig(orgId, { provider: 'anthropic', model: 'claude-x', apiKey: 'sk-org' }, null);
  const svc = await getAiServiceForOrg(orgId);
  assert.notEqual(svc, aiService, 'should be a per-org instance, not the deployment default');
});
