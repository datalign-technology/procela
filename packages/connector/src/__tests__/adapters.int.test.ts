// Adapter INTEGRATION tests — the real SQL, against real databases.
//
// The rest of the connector suite exercises the *pure* discovery
// helpers (assetName / rowToAsset / attachColumns / …) with no driver
// and no network. That leaves one thing unproven: whether the actual
// catalog + information_schema queries in postgres.ts / mysql.ts run
// against a live engine and map real introspection output onto the
// ReportedAsset shape. This file closes that gap (checklist #25).
//
// It is gated behind env vars, exactly like the backend's
// live-db.test.ts is gated behind DATABASE_URL: with no
// CONNECTOR_TEST_PG_URL / CONNECTOR_TEST_MYSQL_URL set, each block
// registers a single skipped placeholder, so the ordinary
// `Connector tests` CI job (which has no databases) stays green and
// fast. The `Connector integration (live DBs)` job sets the URLs and
// the real assertions run against ephemeral Postgres + MySQL service
// containers.
//
// The tests seed their own schema/tables, so the containers only need
// to exist empty — no init scripts, and re-runs are idempotent.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { Client } from 'pg';
import mysql from 'mysql2/promise';

import { scanPostgres } from '../postgres';
import { scanMysql } from '../mysql';
import type { ReportedAsset } from '../types';

const PG_URL = process.env.CONNECTOR_TEST_PG_URL;
const MYSQL_URL = process.env.CONNECTOR_TEST_MYSQL_URL;
const MYSQL_DB = process.env.CONNECTOR_TEST_MYSQL_DB || 'procela_it';

function byName(assets: ReportedAsset[], name: string): ReportedAsset {
  const a = assets.find((x) => x.name === name);
  assert.ok(a, `expected an asset named "${name}"; got: ${assets.map((x) => x.name).join(', ')}`);
  return a!;
}

// ── Postgres ─────────────────────────────────────────────────────────────
if (PG_URL) {
  describe('scanPostgres — live Postgres', () => {
    const SCHEMA = 'it_scan';

    before(async () => {
      const c = new Client({ connectionString: PG_URL });
      await c.connect();
      try {
        await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
        await c.query(`CREATE SCHEMA ${SCHEMA}`);
        await c.query(`
          CREATE TABLE ${SCHEMA}.customers (
            id         serial PRIMARY KEY,
            email      varchar(255) NOT NULL,
            note       text
          )`);
        await c.query(
          `INSERT INTO ${SCHEMA}.customers (email, note) VALUES ($1,$2),($3,$4),($5,$6)`,
          ['a@example.com', 'first', 'b@example.com', null, 'c@example.com', 'third'],
        );
        await c.query(`
          CREATE TABLE ${SCHEMA}.orders (
            id           serial PRIMARY KEY,
            customer_id  integer NOT NULL,
            total        numeric(10,2)
          )`);
        await c.query(`INSERT INTO ${SCHEMA}.orders (customer_id, total) VALUES (1, 9.99), (2, 19.99)`);
        await c.query(`CREATE VIEW ${SCHEMA}.active_customers AS SELECT id, email FROM ${SCHEMA}.customers`);
        // ANALYZE populates pg_stat_user_tables.n_live_tup, which the
        // adapter reads as the (approximate) row count.
        await c.query(`ANALYZE ${SCHEMA}.customers`);
        await c.query(`ANALYZE ${SCHEMA}.orders`);
      } finally {
        await c.end();
      }
    });

    after(async () => {
      const c = new Client({ connectionString: PG_URL });
      await c.connect();
      try {
        await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      } finally {
        await c.end();
      }
    });

    it('discovers tables with real column types, nullability and ordinals', async () => {
      const assets = await scanPostgres({ type: 'postgres', name: 'it-pg', connectionString: PG_URL!, schemas: [SCHEMA] });

      const customers = byName(assets, `${SCHEMA}.customers`);
      // rowCount comes from pg_stat_user_tables.n_live_tup, which the
      // adapter documents as *approximate* — Postgres can report an
      // inflated estimate right after ANALYZE-following-inserts (e.g. 6
      // for 3 real rows). Assert a live signal, not an exact count.
      assert.ok((customers.rowCount ?? 0) >= 1, 'a non-zero row-count estimate');
      assert.ok(customers.columns && customers.columns.length === 3, 'three columns');

      const cols = Object.fromEntries((customers.columns || []).map((c) => [c.name, c]));
      assert.strictEqual(cols.id.dataType, 'integer');
      assert.strictEqual(cols.id.nullable, false);
      assert.strictEqual(cols.id.ordinal, 1);
      assert.strictEqual(cols.email.dataType, 'character varying');
      assert.strictEqual(cols.email.nullable, false);
      assert.strictEqual(cols.note.dataType, 'text');
      assert.strictEqual(cols.note.nullable, true, 'note is a nullable column');

      const orders = byName(assets, `${SCHEMA}.orders`);
      assert.ok((orders.rowCount ?? 0) >= 1, 'a non-zero row-count estimate');
      const orderCols = Object.fromEntries((orders.columns || []).map((c) => [c.name, c]));
      assert.strictEqual(orderCols.total.dataType, 'numeric');
    });

    it('reports a view (kind=view), distinct from base tables', async () => {
      const assets = await scanPostgres({ type: 'postgres', name: 'it-pg', connectionString: PG_URL!, schemas: [SCHEMA] });
      const view = byName(assets, `${SCHEMA}.active_customers`);
      // No table comment → the adapter's fallback description names the
      // engine + object kind, which is where "view" surfaces.
      assert.match(view.description || '', /view/i);
      assert.ok(view.columns && view.columns.length === 2, 'the view exposes its two columns');
    });

    it('honours the schema allowlist — nothing outside it_scan leaks in', async () => {
      const assets = await scanPostgres({ type: 'postgres', name: 'it-pg', connectionString: PG_URL!, schemas: [SCHEMA] });
      assert.ok(assets.length >= 3, 'the three seeded objects');
      assert.ok(assets.every((a) => a.name.startsWith(`${SCHEMA}.`)), 'every asset is inside the requested schema');
    });
  });
} else {
  describe('scanPostgres — live Postgres', () => {
    it('skipped — set CONNECTOR_TEST_PG_URL to run', { skip: true }, () => {});
  });
}

// ── MySQL ────────────────────────────────────────────────────────────────
if (MYSQL_URL) {
  describe('scanMysql — live MySQL', () => {
    before(async () => {
      const conn = await mysql.createConnection(MYSQL_URL!);
      try {
        await conn.query('DROP VIEW IF EXISTS active_customers');
        await conn.query('DROP TABLE IF EXISTS orders');
        await conn.query('DROP TABLE IF EXISTS customers');
        await conn.query(`
          CREATE TABLE customers (
            id     INT PRIMARY KEY AUTO_INCREMENT,
            email  VARCHAR(255) NOT NULL,
            note   TEXT
          )`);
        await conn.query(`INSERT INTO customers (email, note) VALUES ('a@example.com','first'),('b@example.com',NULL),('c@example.com','third')`);
        await conn.query(`
          CREATE TABLE orders (
            id           INT PRIMARY KEY AUTO_INCREMENT,
            customer_id  INT NOT NULL,
            total        DECIMAL(10,2)
          )`);
        await conn.query(`INSERT INTO orders (customer_id, total) VALUES (1, 9.99), (2, 19.99)`);
        await conn.query('CREATE VIEW active_customers AS SELECT id, email FROM customers');
        // Refresh the InnoDB row-count estimate the adapter reads from
        // information_schema.tables.TABLE_ROWS.
        await conn.query('ANALYZE TABLE customers');
        await conn.query('ANALYZE TABLE orders');
      } finally {
        await conn.end();
      }
    });

    after(async () => {
      const conn = await mysql.createConnection(MYSQL_URL!);
      try {
        await conn.query('DROP VIEW IF EXISTS active_customers');
        await conn.query('DROP TABLE IF EXISTS orders');
        await conn.query('DROP TABLE IF EXISTS customers');
      } finally {
        await conn.end();
      }
    });

    it('discovers tables with real column types, nullability and ordinals', async () => {
      const assets = await scanMysql({ type: 'mysql', name: 'it-mysql', connectionString: MYSQL_URL!, schemas: [MYSQL_DB] });

      const customers = byName(assets, `${MYSQL_DB}.customers`);
      // TABLE_ROWS is an InnoDB estimate; after ANALYZE it is reliable
      // for a tiny table but we assert leniently to avoid engine flake.
      assert.ok((customers.rowCount ?? 0) >= 1, 'a non-zero row-count estimate');
      assert.ok(customers.columns && customers.columns.length === 3, 'three columns');

      const cols = Object.fromEntries((customers.columns || []).map((c) => [c.name, c]));
      assert.strictEqual(cols.id.dataType, 'int');
      assert.strictEqual(cols.id.nullable, false);
      assert.strictEqual(cols.id.ordinal, 1);
      assert.strictEqual(cols.email.dataType, 'varchar');
      assert.strictEqual(cols.email.nullable, false);
      assert.strictEqual(cols.note.dataType, 'text');
      assert.strictEqual(cols.note.nullable, true, 'note is a nullable column');

      const orders = byName(assets, `${MYSQL_DB}.orders`);
      const orderCols = Object.fromEntries((orders.columns || []).map((c) => [c.name, c]));
      assert.strictEqual(orderCols.total.dataType, 'decimal');
    });

    it('reports a view (kind=view), distinct from base tables', async () => {
      const assets = await scanMysql({ type: 'mysql', name: 'it-mysql', connectionString: MYSQL_URL!, schemas: [MYSQL_DB] });
      const view = byName(assets, `${MYSQL_DB}.active_customers`);
      assert.match(view.description || '', /view/i);
      assert.ok(view.columns && view.columns.length === 2, 'the view exposes its two columns');
    });

    it('skips MySQL system schemas when scanning without an allowlist', async () => {
      const assets = await scanMysql({ type: 'mysql', name: 'it-mysql', connectionString: MYSQL_URL! });
      assert.ok(
        assets.every((a) => !/^(mysql|sys|information_schema|performance_schema)\./.test(a.name)),
        'no system-schema objects surface as assets',
      );
    });
  });
} else {
  describe('scanMysql — live MySQL', () => {
    it('skipped — set CONNECTOR_TEST_MYSQL_URL to run', { skip: true }, () => {});
  });
}
