// Route tests for POST /connections/:id/sample — the column source-key
// preview. Covers the branches that need no live database: a missing
// connection, missing table/column, and a connection with no live SQL source
// (FILE_STORAGE). The SQL that would run against a real database is unit-
// tested separately in db-source-sql.test.ts (buildColumnSampleSql), so these
// tests deliberately never open a socket.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const connectionsRouter = require('../routes/connections').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connections } = require('../routes/connections');

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data!) } : {} },
      (res) => {
        let chunks = '';
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => { try { resolve({ status: res.statusCode || 0, body: chunks ? JSON.parse(chunks) : null }); } catch { resolve({ status: res.statusCode || 0, body: chunks }); } });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('POST /connections/:id/sample', () => {
  let server: http.Server;
  let port: number;
  const fileConnId = 'test-conn-sample-file';
  const dbConnId = 'test-conn-sample-db';

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/connections', connectionsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    const now = new Date().toISOString();
    connections.push({
      id: fileConnId, orgId: 'test-org', systemId: '',
      name: 'Sample CSV', connectionType: 'FILE_STORAGE',
      config: { storageType: 'LOCAL', originalFileName: 'x.csv' },
      credentials: {}, status: 'UNTESTED', lastTestedAt: null, lastTestResult: null,
      createdAt: now, updatedAt: now,
    });
    connections.push({
      id: dbConnId, orgId: 'test-org', systemId: '',
      name: 'Sample Postgres', connectionType: 'DATABASE',
      config: { dbType: 'POSTGRESQL', host: 'db.example.com', database: 'oms' },
      credentials: { username: 'u', password: 'p' }, status: 'UNTESTED', lastTestedAt: null, lastTestResult: null,
      createdAt: now, updatedAt: now,
    });
  });

  after(async () => {
    for (const cid of [fileConnId, dbConnId]) {
      const i = connections.findIndex((c: any) => c.id === cid);
      if (i !== -1) connections.splice(i, 1);
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('404s for an unknown connection', async () => {
    const res = await request(port, 'POST', '/connections/no-such-conn/sample', { table: 't', column: 'c' });
    assert.strictEqual(res.status, 404);
  });

  it('400s when table or column is missing', async () => {
    let res = await request(port, 'POST', `/connections/${dbConnId}/sample`, { column: 'Incident_ID' });
    assert.strictEqual(res.status, 400);
    res = await request(port, 'POST', `/connections/${dbConnId}/sample`, { table: 'incidents' });
    assert.strictEqual(res.status, 400);
  });

  it('422s for a connection with no live SQL source (FILE_STORAGE)', async () => {
    const res = await request(port, 'POST', `/connections/${fileConnId}/sample`, { table: 'x.csv', column: 'email' });
    assert.strictEqual(res.status, 422);
    assert.match(res.body.error, /direct-connect databases/i);
  });
});
