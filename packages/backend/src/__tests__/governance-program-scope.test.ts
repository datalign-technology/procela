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
