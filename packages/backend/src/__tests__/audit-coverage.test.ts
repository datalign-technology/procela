// Regression guard for audit coverage on core entity CRUD.
//
// Creating / updating / deleting a data asset, person, or mapping — and
// creating a glossary term — must each write an audit entry, scoped to the
// entity's own org and stamped with the acting user. Two concrete bugs this
// locks in:
//   1. Data-asset / people CRUD used to emit no audit entry at all, so the
//      Audit Log page read empty for the most common actions.
//   2. Glossary audit called log('system', orgId, …) — args swapped — so
//      glossary edits landed under a phantom 'system' org (never visible in
//      the real org's log) with the org id stored as the actor.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataAssetsRouter = require('../routes/data-assets').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const peopleRouter = require('../routes/people').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { people } = require('../routes/people');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mappingsRouter = require('../routes/mappings').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mappings } = require('../routes/mappings');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const glossaryRouter = require('../routes/business-glossary').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { glossaryTerms } = require('../routes/business-glossary');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const systemsRouter = require('../routes/systems').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { systems } = require('../routes/systems');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataDomainsRouter = require('../routes/data-domains').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataDomains } = require('../routes/data-domains');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const auditRouter = require('../routes/audit').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { organizations } = require('../routes/organizations');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { auditLogs } = require('../services/audit.service');

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STEP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data!) } : {} },
      (res) => {
        let chunks = '';
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode || 0, body: chunks ? JSON.parse(chunks) : null }); }
          catch { resolve({ status: res.statusCode || 0, body: chunks }); }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const entriesFor = (entityId: string) => auditLogs.filter((e: any) => e.entityId === entityId);

describe('audit coverage — core entity CRUD writes audit entries', () => {
  let server: http.Server; let port: number;

  before(async () => {
    // Seed a company-level org so data-asset (ownership-level guard) and
    // people (org-existence check) creates pass validation.
    organizations.push({ id: ORG, parentId: null, name: 'Audit Test Co', type: 'company', industry: '', description: '', headCount: 0 });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { sub: ACTOR, email: 'a@t.test', orgId: ORG, role: 'ORG_ADMIN' }; next(); });
    app.use('/data-assets', dataAssetsRouter);
    app.use('/people', peopleRouter);
    app.use('/mappings', mappingsRouter);
    app.use('/business-glossary', glossaryRouter);
    app.use('/systems', systemsRouter);
    app.use('/data-domains', dataDomainsRouter);
    app.use('/audit', auditRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    // Remove seeded org, entities, and audit entries scoped to the test org.
    for (const arr of [organizations, dataAssets, people, mappings, glossaryTerms, systems, dataDomains]) {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].id === ORG || arr[i].orgId === ORG || (arr[i].orgIds && arr[i].orgIds.includes(ORG))) arr.splice(i, 1);
      }
    }
    for (let i = auditLogs.length - 1; i >= 0; i--) {
      if (auditLogs[i].orgId === ORG) auditLogs.splice(i, 1);
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('data-asset create / update / delete each write an audit entry (org + actor)', async () => {
    const created = await request(port, 'POST', '/data-assets', { name: 'Audit Asset', orgId: ORG, governanceTier: 'SILVER' });
    assert.strictEqual(created.status, 201);
    const id = created.body.data.id;

    await request(port, 'PUT', `/data-assets/${id}`, { name: 'Audit Asset Renamed' });
    const del = await request(port, 'DELETE', `/data-assets/${id}`);
    assert.strictEqual(del.status, 204);

    const actions = entriesFor(id).map((e: any) => e.action);
    assert.ok(actions.includes('CREATE'), 'expected a CREATE audit entry');
    assert.ok(actions.includes('UPDATE'), 'expected an UPDATE audit entry');
    assert.ok(actions.includes('DELETE'), 'expected a DELETE audit entry');
    for (const e of entriesFor(id)) {
      assert.strictEqual(e.orgId, ORG, 'audit entry scoped to the asset org');
      assert.strictEqual(e.entityType, 'DataAsset');
      assert.strictEqual(e.userId, ACTOR, 'audit entry stamps the acting user');
    }
  });

  it('person create / update / delete each write an audit entry (org + actor)', async () => {
    const created = await request(port, 'POST', '/people', { name: 'Audit Person', email: 'audit.person@t.test', orgIds: [ORG], role: 'VIEWER' });
    assert.strictEqual(created.status, 201);
    const id = created.body.data.id;

    await request(port, 'PUT', `/people/${id}`, { title: 'Analyst' });
    const del = await request(port, 'DELETE', `/people/${id}`);
    assert.ok(del.status === 204 || del.status === 200);

    const actions = entriesFor(id).map((e: any) => e.action);
    assert.ok(actions.includes('CREATE'), 'expected a CREATE audit entry');
    assert.ok(actions.includes('UPDATE'), 'expected an UPDATE audit entry');
    assert.ok(actions.includes('DELETE'), 'expected a DELETE audit entry');
    for (const e of entriesFor(id)) {
      assert.strictEqual(e.orgId, ORG);
      assert.strictEqual(e.entityType, 'Person');
      assert.strictEqual(e.userId, ACTOR);
    }
  });

  it('mapping create / update / delete each write an audit entry', async () => {
    const created = await request(port, 'POST', '/mappings', { processStepId: STEP, dataAssetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', linkType: 'consumes', orgId: ORG });
    assert.strictEqual(created.status, 201);
    const id = created.body.data.id;

    await request(port, 'PUT', `/mappings/${id}`, { notes: 'updated' });
    const del = await request(port, 'DELETE', `/mappings/${id}`);
    assert.strictEqual(del.status, 204);

    const actions = entriesFor(id).map((e: any) => e.action);
    assert.ok(actions.includes('CREATE'));
    assert.ok(actions.includes('UPDATE'));
    assert.ok(actions.includes('DELETE'));
    for (const e of entriesFor(id)) {
      assert.strictEqual(e.orgId, ORG);
      assert.strictEqual(e.entityType, 'Mapping');
    }
  });

  it('glossary create logs under the term org with the actor — never a phantom "system" org', async () => {
    const created = await request(port, 'POST', '/business-glossary', { term: 'Audit Term', orgId: ORG });
    assert.strictEqual(created.status, 201);
    const id = created.body.data.id;

    const entries = entriesFor(id);
    assert.ok(entries.length >= 1, 'expected a glossary CREATE audit entry');
    const e = entries[0];
    assert.strictEqual(e.orgId, ORG, 'glossary audit must be scoped to the term org, not "system"');
    assert.notStrictEqual(e.orgId, 'system');
    assert.strictEqual(e.entityType, 'GlossaryTerm');
    assert.strictEqual(e.userId, ACTOR, 'glossary audit records the acting user, not the org id');
  });

  it('system create / update / delete each write an audit entry (org + actor)', async () => {
    const created = await request(port, 'POST', '/systems', { name: 'Audit System', orgId: ORG, systemType: 'ERP' });
    assert.strictEqual(created.status, 201);
    const id = created.body.data.id;

    await request(port, 'PUT', `/systems/${id}`, { description: 'changed' });
    const del = await request(port, 'DELETE', `/systems/${id}`);
    assert.strictEqual(del.status, 204);

    const actions = entriesFor(id).map((e: any) => e.action);
    assert.ok(actions.includes('CREATE'));
    assert.ok(actions.includes('UPDATE'));
    assert.ok(actions.includes('DELETE'));
    for (const e of entriesFor(id)) {
      assert.strictEqual(e.orgId, ORG);
      assert.strictEqual(e.entityType, 'System');
      assert.strictEqual(e.userId, ACTOR);
    }
  });

  it('data-domain create/update/delete audit is scoped to the domain org — never "system"', async () => {
    const created = await request(port, 'POST', '/data-domains', { name: 'Audit Domain', orgId: ORG });
    assert.strictEqual(created.status, 201);
    const id = created.body.data.id;

    await request(port, 'PUT', `/data-domains/${id}`, { description: 'changed' });
    const del = await request(port, 'DELETE', `/data-domains/${id}`);
    assert.strictEqual(del.status, 204);

    const entries = entriesFor(id);
    const actions = entries.map((e: any) => e.action);
    assert.ok(actions.includes('CREATE'));
    assert.ok(actions.includes('UPDATE'));
    assert.ok(actions.includes('DELETE'));
    for (const e of entries) {
      assert.strictEqual(e.orgId, ORG, 'data-domain audit must be scoped to the domain org, not "system"');
      assert.notStrictEqual(e.orgId, 'system');
      assert.strictEqual(e.entityType, 'DataDomain');
      assert.strictEqual(e.userId, ACTOR);
    }

    // The /audit route resolves a display name for the domain from the
    // entry's own snapshot — not the "(deleted)" fallback — even though
    // DataDomain has no dedicated name-store lookup.
    const feed = await request(port, 'GET', `/audit?orgId=${ORG}&limit=50`);
    assert.strictEqual(feed.status, 200);
    const domainEntry = (feed.body.data || []).find((e: any) => e.entityType === 'DataDomain' && e.action === 'CREATE');
    assert.ok(domainEntry, 'expected the DataDomain CREATE entry in the audit feed');
    assert.strictEqual(domainEntry.entityName, 'Audit Domain', 'audit feed resolves the domain name, not "(deleted)"');
  });
});
