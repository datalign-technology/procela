// HTTP coverage for the governance-process template endpoints on
// routes/process-catalog. The "Generate governance processes" wand
// on the Process Catalog drives these — a preview (GET) that feeds
// the wizard's Review screen, and the apply (POST) that plants the
// standard DAMA-aligned hierarchy. The wand reportedly "partially
// worked" (value streams + processes created, activities missing),
// so these tests pin down that the apply creates the WHOLE tree —
// value stream → processes → activities — not just the upper levels.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const catalogRouter = require('../routes/process-catalog').default;

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data!) } : {},
      },
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

describe('routes/process-catalog governance template', () => {
  let server: http.Server;
  let port: number;
  // Unique per run — the dev JSON store persists across local runs, so a
  // fixed org id would trip the "already exists" guard on a re-run. CI
  // starts from an empty (gitignored) store, so this is belt-and-braces.
  const orgId = `gov-tpl-test-${Date.now()}`;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/process-catalog', catalogRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('GET /governance-template previews the full hierarchy without creating anything', async () => {
    const res = await request(port, 'GET', '/process-catalog/governance-template');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const vss = res.body.data?.valueStreams;
    assert.ok(Array.isArray(vss) && vss.length === 1, 'one governance value stream in the preview');
    const vs = vss[0];
    assert.strictEqual(vs.name, 'Data Governance Management');
    assert.strictEqual(vs.processes.length, 6, 'six governance processes');
    // Every process must carry at least one activity — the leaf level
    // that the wand was dropping.
    for (const proc of vs.processes) {
      assert.ok(Array.isArray(proc.activities) && proc.activities.length > 0, `process "${proc.name}" has activities`);
    }
    const totalActivities = vs.processes.reduce((n: number, p: any) => n + p.activities.length, 0);
    assert.strictEqual(totalActivities, 30, 'thirty activities across the six processes');
  });

  it('POST /apply-governance-template creates value stream + processes + ALL activities', async () => {
    const res = await request(port, 'POST', '/process-catalog/apply-governance-template', { orgId });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    const created: any[] = res.body.data;
    assert.ok(Array.isArray(created), 'created nodes returned');

    const byLevel = (lvl: string) => created.filter((n) => n.level === lvl && n.orgId === orgId);
    assert.strictEqual(byLevel('VALUE_STREAM').length, 1, 'one value stream created');
    assert.strictEqual(byLevel('PROCESS').length, 6, 'six processes created');
    assert.strictEqual(byLevel('ACTIVITY').length, 30, 'all thirty activities created — none dropped');

    // Each process actually has activities parented under it (not just
    // a raw count that could hide an orphaned distribution).
    const procs = byLevel('PROCESS');
    for (const proc of procs) {
      const kids = created.filter((n) => n.level === 'ACTIVITY' && n.parentId === proc.id);
      assert.ok(kids.length > 0, `process "${proc.name}" has child activities`);
    }
  });

  it('POST /apply-governance-template is idempotent — refuses a second apply for the same company', async () => {
    const res = await request(port, 'POST', '/process-catalog/apply-governance-template', { orgId });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.match(res.body.message || '', /already exist/i);
  });
});
