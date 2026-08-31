// Live-Postgres integration test for real schema introspection. NO-OP when
// DATABASE_URL is unset (same guard as live-db.test.ts). CI's live-DB job has
// `prisma db push`-ed the schema, so introspecting the very database under
// test is a real end-to-end exercise of the direct-connect discovery path.

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { hasDatabase } from '../db/prisma';
import { discoverDbSchema } from '../lib/db-source/introspect';
import type { DbSourceRequest } from '../lib/db-source';

function requestFromEnv(): DbSourceRequest {
  const u = new URL(process.env.DATABASE_URL as string);
  return {
    dbType: 'POSTGRESQL',
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    schema: 'public',
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

const SKIP = !hasDatabase();
const suite = SKIP
  ? (name: string, _fn: () => unknown) => describe.skip(name, () => { /* no-op */ })
  : describe;

suite('live introspection (direct-connect discovery)', () => {
  it('discovers the Procela schema with real tables + columns', async () => {
    const assets = await discoverDbSchema(requestFromEnv());
    // The pushed schema has dozens of tables.
    assert.ok(assets.length > 5, `expected many tables, got ${assets.length}`);

    // Known mapped tables should appear, each with its columns.
    const orgs = assets.find((a) => a.name === 'organizations');
    assert.ok(orgs, 'expected the organizations table to be discovered');
    assert.ok(orgs!.columns.includes('id'), 'organizations should expose its id column');
    assert.ok(orgs!.columns.includes('name'), 'organizations should expose its name column');

    const domains = assets.find((a) => a.name === 'data_domains');
    assert.ok(domains, 'expected the data_domains table to be discovered');
    assert.ok(domains!.columns.length > 0, 'data_domains should have columns');

    // Every discovered asset is a real object with a type tag.
    for (const a of assets) assert.ok(a.type === 'TABLE' || a.type === 'VIEW');
  });
});
