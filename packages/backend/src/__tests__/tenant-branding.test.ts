// Per-tenant login branding — the second half of the SSO
// white-labeling story. Cover:
//
//   1. PUT /organizations/:id accepts / rejects the branding fields
//      (tenantSlug format, uniqueness, primaryColor hex).
//   2. GET /branding/tenant/:slug returns the customer's branding
//      when the slug matches, defaults when it doesn't.
//   3. Slug resolution fallbacks — path → query → Host subdomain.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const organizationsRouter = require('../routes/organizations').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const brandingRouter = require('../routes/branding').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { organizations } = require('../routes/organizations');

function request(port: number, method: string, path: string, body?: unknown, host?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path,
        headers: {
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data!) } : {}),
          ...(host ? { host } : {}),
        },
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

describe('tenant branding — sign-in white-labeling', () => {
  let server: http.Server;
  let port: number;
  const PREFIX = 'test-brand-';
  const orgIdA = PREFIX + 'org-a';
  const orgIdB = PREFIX + 'org-b';

  before(async () => {
    const now = new Date().toISOString();
    if (!organizations.find((o: any) => o.id === orgIdA)) {
      organizations.push({
        id: orgIdA, name: 'Test Org A', type: 'company', parentId: null,
        createdAt: now, updatedAt: now,
      });
    }
    if (!organizations.find((o: any) => o.id === orgIdB)) {
      organizations.push({
        id: orgIdB, name: 'Test Org B', type: 'company', parentId: null,
        createdAt: now, updatedAt: now,
      });
    }
    const app = express();
    app.use(express.json());
    // Fake auth — populate req.user so the /organizations PUT path
    // passes the access check.
    app.use((req: any, _res, next) => {
      req.user = { sub: 'test-super', role: 'SUPER_ADMIN' };
      next();
    });
    app.use('/organizations', organizationsRouter);
    app.use('/branding', brandingRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    // Clear branding between tests so slug-uniqueness checks work.
    for (const o of organizations) {
      if (!o.id?.startsWith(PREFIX)) continue;
      o.tenantSlug = undefined;
      o.brandDisplayName = undefined;
      o.brandGlyph = undefined;
      o.ssoButtonLabel = undefined;
      o.brandPrimaryColor = undefined;
    }
  });

  describe('PUT /organizations/:id — branding fields', () => {
    it('accepts a full branding blob', async () => {
      const res = await request(port, 'PUT', `/organizations/${orgIdA}`, {
        tenantSlug: 'tidewater',
        brandDisplayName: 'Tidewater Utilities',
        brandGlyph: '⚡',
        ssoButtonLabel: 'Sign in with Tidewater SSO',
        brandPrimaryColor: '#0f4f46',
      });
      assert.strictEqual(res.status, 200);
      const org = organizations.find((o: any) => o.id === orgIdA);
      assert.strictEqual(org.tenantSlug, 'tidewater');
      assert.strictEqual(org.brandDisplayName, 'Tidewater Utilities');
      assert.strictEqual(org.brandGlyph, '⚡');
      assert.strictEqual(org.brandPrimaryColor, '#0f4f46');
    });

    it('rejects an invalid tenantSlug format', async () => {
      const res = await request(port, 'PUT', `/organizations/${orgIdA}`, { tenantSlug: 'Bad Slug!' });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /tenantSlug must be/);
    });

    it('rejects an invalid brandPrimaryColor', async () => {
      const res = await request(port, 'PUT', `/organizations/${orgIdA}`, { brandPrimaryColor: 'red' });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /#RRGGBB/);
    });

    it('rejects a slug already used by another org', async () => {
      await request(port, 'PUT', `/organizations/${orgIdA}`, { tenantSlug: 'shared' });
      const res = await request(port, 'PUT', `/organizations/${orgIdB}`, { tenantSlug: 'shared' });
      assert.strictEqual(res.status, 409);
    });

    it('clears fields when set to empty string', async () => {
      await request(port, 'PUT', `/organizations/${orgIdA}`, { tenantSlug: 'clearme', brandPrimaryColor: '#123456' });
      const res = await request(port, 'PUT', `/organizations/${orgIdA}`, { tenantSlug: '', brandPrimaryColor: '' });
      assert.strictEqual(res.status, 200);
      const org = organizations.find((o: any) => o.id === orgIdA);
      assert.strictEqual(org.tenantSlug, undefined);
      assert.strictEqual(org.brandPrimaryColor, undefined);
    });
  });

  describe('GET /branding/tenant/:slug', () => {
    it('returns the tenant branding when the slug matches', async () => {
      await request(port, 'PUT', `/organizations/${orgIdA}`, {
        tenantSlug: 'tidewater',
        brandDisplayName: 'Tidewater Utilities',
        brandGlyph: '⚡',
        ssoButtonLabel: 'Sign in with Tidewater SSO',
        brandPrimaryColor: '#0f4f46',
      });
      const res = await request(port, 'GET', '/branding/tenant/tidewater');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.isTenantBrand, true);
      assert.strictEqual(res.body.data.displayName, 'Tidewater Utilities');
      assert.strictEqual(res.body.data.glyph, '⚡');
      assert.strictEqual(res.body.data.ssoButtonLabel, 'Sign in with Tidewater SSO');
      assert.strictEqual(res.body.data.primaryColor, '#0f4f46');
    });

    it('returns the platform default when the slug is unknown', async () => {
      const res = await request(port, 'GET', '/branding/tenant/no-such-tenant');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.isTenantBrand, false);
      assert.strictEqual(res.body.data.displayName, 'Procela');
    });

    it('resolves the slug from the Host header subdomain', async () => {
      await request(port, 'PUT', `/organizations/${orgIdA}`, {
        tenantSlug: 'acme',
        brandDisplayName: 'Acme Corp',
      });
      const res = await request(port, 'GET', '/branding/tenant', undefined, 'acme.procela.io');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.isTenantBrand, true);
      assert.strictEqual(res.body.data.displayName, 'Acme Corp');
    });

    it('resolves the slug from the ?tenant= query param', async () => {
      await request(port, 'PUT', `/organizations/${orgIdA}`, {
        tenantSlug: 'querytenant',
        brandDisplayName: 'Query Corp',
      });
      const res = await request(port, 'GET', '/branding/tenant?tenant=querytenant');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.displayName, 'Query Corp');
    });
  });
});
