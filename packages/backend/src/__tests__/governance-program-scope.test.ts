// The governance program's structured scope — systemIds / domainIds /
// valueStreamIds — persists through PUT, is sanitized (string ids only,
// deduped), and a partial save that omits an array leaves the stored one
// intact (so editing the free-text note doesn't wipe the references).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const programRouter = require('../routes/governance-program').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governancePrograms } = require('../routes/governance-program');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataDomains } = require('../routes/data-domains');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { systems } = require('../routes/systems');

const orgId = 'progscope-org';

function req(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(Buffer.byteLength(data)); }
    const r = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let c = ''; res.on('data', (d) => { c += d; });
      res.on('end', () => { try { resolve({ status: res.statusCode || 0, body: c ? JSON.parse(c) : null }); } catch { resolve({ status: res.statusCode || 0, body: c }); } });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

describe('Governance program structured scope', () => {
  let server: http.Server; let port: number; let programId: string;

  before(async () => {
    const app = express(); app.use(express.json()); app.use('/', programRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, () => r()));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    for (let i = governancePrograms.length - 1; i >= 0; i--) {
      if (governancePrograms[i].orgId === orgId) governancePrograms.splice(i, 1);
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('creates a default program with empty scope reference arrays', async () => {
    const res = await req(port, 'GET', `/?orgId=${orgId}`);
    assert.equal(res.status, 200);
    programId = res.body.data.id;
    assert.deepEqual(res.body.data.scope.systemIds, []);
    assert.deepEqual(res.body.data.scope.domainIds, []);
    assert.deepEqual(res.body.data.scope.valueStreamIds, []);
  });

  it('persists and sanitizes the scope reference arrays on PUT', async () => {
    const res = await req(port, 'PUT', `/${programId}`, {
      scope: {
        inScope: 'Enterprise systems and domains.',
        systemIds: ['s1', 's1', 's2', 42, null],  // dupe + non-strings
        domainIds: ['d1'],
        valueStreamIds: [],
      },
    });
    assert.equal(res.status, 200);
    const scope = res.body.data.scope;
    assert.deepEqual(scope.systemIds, ['s1', 's2'], 'deduped, non-strings dropped');
    assert.deepEqual(scope.domainIds, ['d1']);
    assert.deepEqual(scope.valueStreamIds, []);
    assert.equal(scope.inScope, 'Enterprise systems and domains.');
  });

  it('keeps stored reference arrays when a later save omits them', async () => {
    const res = await req(port, 'PUT', `/${programId}`, {
      scope: { inScope: 'Just editing the note.' },  // no arrays supplied
    });
    assert.equal(res.status, 200);
    const scope = res.body.data.scope;
    assert.equal(scope.inScope, 'Just editing the note.');
    assert.deepEqual(scope.systemIds, ['s1', 's2'], 'partial save must not wipe references');
    assert.deepEqual(scope.domainIds, ['d1']);
  });
});

// Scope versioning: the version bumps only when the *structured* scope
// changes (anchors / overrides), so coverage snapshots can be compared
// apples-to-apples. Free-text edits and no-op re-saves don't move it.
describe('Governance program scope versioning', () => {
  let server: http.Server; let port: number; let id: string;
  before(async () => {
    const app = express(); app.use(express.json()); app.use('/', programRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, () => r()));
    port = (server.address() as AddressInfo).port;
    const created = await req(port, 'GET', `/?orgId=verscope-org`);
    id = created.body.data.id;
  });
  after(async () => {
    for (let i = governancePrograms.length - 1; i >= 0; i--) {
      if (governancePrograms[i].orgId === 'verscope-org') governancePrograms.splice(i, 1);
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('starts at version 1 with no change timestamp', async () => {
    const s = await req(port, 'GET', `/${id}/status`); // touch to ensure it exists
    assert.equal(s.status, 200);
    const p = governancePrograms.find((x: any) => x.id === id);
    assert.equal(p.scopeVersion, 1);
    assert.equal(p.scopeChangedAt, null);
  });

  it('bumps the version + stamps changedAt when the structured scope changes', async () => {
    const r = await req(port, 'PUT', `/${id}`, { scope: { domainIds: ['d1'] } });
    assert.equal(r.body.data.scopeVersion, 2);
    assert.ok(r.body.data.scopeChangedAt, 'changedAt set');
  });

  it('does NOT bump on a no-op re-save of the same scope', async () => {
    const r = await req(port, 'PUT', `/${id}`, { scope: { domainIds: ['d1'] } });
    assert.equal(r.body.data.scopeVersion, 2, 'unchanged structured scope keeps the version');
  });

  it('does NOT bump on a free-text-only edit', async () => {
    const r = await req(port, 'PUT', `/${id}`, { scope: { boundaries: 'Some guardrails.' } });
    assert.equal(r.body.data.scopeVersion, 2, 'free-text does not move the scope version');
  });

  it('bumps again when the entity set actually changes', async () => {
    const r = await req(port, 'PUT', `/${id}`, { scope: { domainIds: ['d1', 'd2'], excludeIds: ['a9'] } });
    assert.equal(r.body.data.scopeVersion, 3);
  });
});

// scope-membership resolves the org's scope to concrete id sets so an entity
// list can badge each row "in scope / not governed". applied:false + empty
// arrays when there's no program / an empty scope.
describe('GET /scope-membership — resolved id sets', () => {
  let server: http.Server; let port: number;
  const O = 'memb-org';
  const dM = 'memb-dM', dX = 'memb-dX', aM = 'memb-aM', aX = 'memb-aX', sM = 'memb-sM', sX = 'memb-sX';
  let progId: string;

  before(async () => {
    const app = express(); app.use(express.json()); app.use('/', programRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, () => r()));
    port = (server.address() as AddressInfo).port;
    dataDomains.push(
      { id: dM, orgId: O, name: 'M', dataAssetIds: [aM], parentDomainId: null, stewardIds: [] } as any,
      { id: dX, orgId: O, name: 'X', dataAssetIds: [aX], parentDomainId: null, stewardIds: [] } as any,
    );
    dataAssets.push(
      { id: aM, orgId: O, name: 'AM', systemId: sM } as any,
      { id: aX, orgId: O, name: 'AX', systemId: sX } as any,
    );
    systems.push({ id: sM, orgId: O, name: 'SM' } as any, { id: sX, orgId: O, name: 'SX' } as any);
    // Create the org's program and scope it to domain dM.
    const created = await req(port, 'GET', `/?orgId=${O}`);
    progId = created.body.data.id;
    await req(port, 'PUT', `/${progId}`, { scope: { domainIds: [dM] } });
  });

  after(async () => {
    const sweep = (arr: any[]) => { for (let i = arr.length - 1; i >= 0; i--) if (String(arr[i].id).startsWith('memb-') || arr[i].orgId === O) arr.splice(i, 1); };
    sweep(governancePrograms); sweep(dataDomains); sweep(dataAssets); sweep(systems);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('returns the in-scope id sets and marks the scope applied', async () => {
    const res = await req(port, 'GET', `/scope-membership?orgId=${O}`);
    assert.equal(res.status, 200);
    const d = res.body.data;
    assert.equal(d.applied, true);
    assert.deepEqual([...d.domainIds].sort(), [dM]);
    assert.deepEqual([...d.dataAssetIds].sort(), [aM]);          // dM's asset, not dX's
    assert.deepEqual([...d.systemIds].sort(), [sM]);             // system holding the in-scope asset
    assert.ok(!d.domainIds.includes(dX) && !d.dataAssetIds.includes(aX) && !d.systemIds.includes(sX));
    assert.ok(d.version && typeof d.version.number === 'number');
  });

  it('is applied:false with empty sets when the scope is cleared', async () => {
    await req(port, 'PUT', `/${progId}`, { scope: { domainIds: [] } });
    const res = await req(port, 'GET', `/scope-membership?orgId=${O}`);
    assert.equal(res.body.data.applied, false);
    assert.deepEqual(res.body.data.dataAssetIds, []);
    assert.equal(res.body.data.version, null);
  });

  it('is applied:false for an org with no program', async () => {
    const res = await req(port, 'GET', `/scope-membership?orgId=memb-absent`);
    assert.equal(res.body.data.applied, false);
    assert.deepEqual(res.body.data.systemIds, []);
  });
});

// Phase 1's "Scope defined" check is now satisfied by selecting governed
// entities — the free-text In/Out of Scope boxes were removed from the UI.
// Legacy free-text still counts so programs authored before the picker
// don't regress.
describe('Phase 1 "Scope defined" — governed entities', () => {
  let server: http.Server; let port: number; let programId: string;
  const scopeCheck = (status: any) => status.phases.phase1.checks.find((c: any) => c.label === 'Scope defined');

  before(async () => {
    const app = express(); app.use(express.json()); app.use('/', programRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, () => r()));
    port = (server.address() as AddressInfo).port;
    const created = await req(port, 'GET', `/?orgId=phase1scope-org`);
    programId = created.body.data.id;
  });

  after(async () => {
    for (let i = governancePrograms.length - 1; i >= 0; i--) {
      if (governancePrograms[i].orgId === 'phase1scope-org') governancePrograms.splice(i, 1);
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('is NOT defined with no entities and no free-text', async () => {
    const status = await req(port, 'GET', `/${programId}/status`);
    assert.equal(status.status, 200);
    assert.equal(scopeCheck(status.body.data).done, false);
  });

  it('IS defined once a governed entity is selected (no free-text needed)', async () => {
    await req(port, 'PUT', `/${programId}`, { scope: { domainIds: ['dom-1'] } });
    const status = await req(port, 'GET', `/${programId}/status`);
    assert.equal(scopeCheck(status.body.data).done, true, 'a governed data domain defines scope');
  });

  it('still honours legacy free-text scope when no entities are selected', async () => {
    const other = await req(port, 'GET', `/?orgId=phase1scope-org-legacy`);
    const legacyId = other.body.data.id;
    await req(port, 'PUT', `/${legacyId}`, { scope: { inScope: 'Everything the finance org touches.' } });
    const status = await req(port, 'GET', `/${legacyId}/status`);
    assert.equal(scopeCheck(status.body.data).done, true, 'legacy free-text still counts');
    for (let i = governancePrograms.length - 1; i >= 0; i--) {
      if (governancePrograms[i].orgId === 'phase1scope-org-legacy') governancePrograms.splice(i, 1);
    }
  });
});
