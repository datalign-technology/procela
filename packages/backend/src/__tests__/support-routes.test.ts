// HTTP tests for routes/support — the in-app "Report a problem" surface.
// Verifies auth is required, the message is validated, and every accepted
// report lands a SUPPORT_REPORT entry on the audit trail (the durable
// record). Email delivery is not exercised here — SUPPORT_EMAIL is unset
// in tests, so the route takes its audit-only path and reports
// delivered:false.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'net';

import config from '../config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const supportRouter = require('../routes/support').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { auditLogs } = require('../services/audit.service');

const MARKER = 'SUPPORT-TEST-MARKER';

function request(
  port: number, method: string, path: string,
  opts: { body?: unknown; bearer?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (opts.body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(data!));
    }
    if (opts.bearer) headers['Authorization'] = `Bearer ${opts.bearer}`;
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, body: chunks ? JSON.parse(chunks) : null }); }
        catch { resolve({ status: res.statusCode || 0, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function mintJwt(): string {
  return jwt.sign(
    { sub: 'support-tester', email: 'support-tester@example.test', role: 'VIEWER', type: 'access' },
    config.jwtSecret, { expiresIn: '1h' },
  );
}

function supportEntries(): any[] {
  return auditLogs.filter(
    (e: any) => e.entityType === 'Support' && typeof e.after?.message === 'string' && e.after.message.includes(MARKER),
  );
}

describe('support routes', () => {
  let server: http.Server;
  let port: number;
  let bearer: string;

  before(async () => {
    bearer = mintJwt();
    const app = express();
    app.use(express.json());
    app.use('/support', supportRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    // Remove the audit entries this suite appended so the shared
    // module-level array is left as we found it.
    for (let i = auditLogs.length - 1; i >= 0; i--) {
      const e = auditLogs[i];
      if (e.entityType === 'Support' && typeof e.after?.message === 'string' && e.after.message.includes(MARKER)) {
        auditLogs.splice(i, 1);
      }
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(port, 'POST', '/support', { body: { message: `${MARKER} no auth` } });
    assert.strictEqual(res.status, 401);
  });

  it('rejects an empty message with 400', async () => {
    const res = await request(port, 'POST', '/support', { body: { message: '   ' }, bearer });
    assert.strictEqual(res.status, 400);
  });

  it('accepts a report, returns 202 delivered:false (no SUPPORT_EMAIL), and writes an audit entry', async () => {
    const before = supportEntries().length;
    const res = await request(port, 'POST', '/support', {
      body: {
        message: `${MARKER} the export button throws on the Data Assets page`,
        category: 'Bug',
        context: { route: '/data-assets', appVersion: '0.1.0' },
      },
      bearer,
    });
    assert.strictEqual(res.status, 202);
    assert.strictEqual(res.body.data.delivered, false);

    const entries = supportEntries();
    assert.strictEqual(entries.length, before + 1, 'one new SUPPORT_REPORT audit entry');
    const entry = entries[entries.length - 1];
    assert.strictEqual(entry.action, 'SUPPORT_REPORT');
    assert.strictEqual(entry.after.category, 'Bug');
    assert.strictEqual(entry.after.context.route, '/data-assets');
    assert.strictEqual(entry.after.reporterEmail, 'support-tester@example.test');
  });

  it('defaults an unknown category to Bug and bounds oversized context', async () => {
    const bigContext: Record<string, string> = {};
    for (let i = 0; i < 30; i++) bigContext[`k${i}`] = 'x'.repeat(2000);
    const res = await request(port, 'POST', '/support', {
      body: { message: `${MARKER} feedback text`, category: 'NotAReal', context: bigContext },
      bearer,
    });
    assert.strictEqual(res.status, 202);
    const entry = supportEntries().pop();
    assert.strictEqual(entry.after.category, 'Bug', 'unknown category falls back to Bug');
    assert.ok(Object.keys(entry.after.context).length <= 12, 'context key count is bounded');
    assert.ok(entry.after.context.k0.length <= 500, 'context value length is bounded');
  });
});
