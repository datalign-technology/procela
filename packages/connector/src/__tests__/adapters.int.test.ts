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
// CONNECTOR_TEST_PG_URL / _MYSQL_URL / _MSSQL_URL / _ORACLE_URL set,
// each block registers a single skipped placeholder, so the ordinary
// `Connector tests` CI job (which has no databases) stays green and
// fast. The live-DB CI jobs set the URLs and the real assertions run
// against ephemeral service containers — Postgres + MySQL in one job,
// SQL Server and Oracle each in their own (each heavy engine gets a
// dedicated runner so one DB's memory footprint can't starve another).
//
// The tests seed their own schema/tables, so the containers only need
// to exist empty — no init scripts, and re-runs are idempotent.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { Client } from 'pg';
import mysql from 'mysql2/promise';
import mssql from 'mssql';
import oracledb from 'oracledb';

import { scanPostgres } from '../postgres';
import { scanMysql } from '../mysql';
import { scanSqlServer, buildMssqlConfig } from '../sqlserver';
import { scanOracle, parseOracleConnectionString } from '../oracle';
import type { ReportedAsset } from '../types';

const PG_URL = process.env.CONNECTOR_TEST_PG_URL;
const MYSQL_URL = process.env.CONNECTOR_TEST_MYSQL_URL;
const MYSQL_DB = process.env.CONNECTOR_TEST_MYSQL_DB || 'procela_it';
const MSSQL_URL = process.env.CONNECTOR_TEST_MSSQL_URL;
const ORACLE_URL = process.env.CONNECTOR_TEST_ORACLE_URL;

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

// ── SQL Server ─────────────────────────────────────────────────────────────
// Seeds into a dedicated `it_scan` schema of whatever database the URL
// points at (the container's default `master` is fine — the schema is
// dropped in `after`). CREATE SCHEMA / CREATE VIEW must each be the first
// statement in their batch, which they are: every `q()` is its own batch.
if (MSSQL_URL) {
  describe('scanSqlServer — live SQL Server', () => {
    const SCHEMA = 'it_scan';
    let pool: mssql.ConnectionPool;
    const q = (sql: string) => pool.request().query(sql);

    before(async () => {
      // Same URL-form → config conversion the adapter uses.
      pool = await new mssql.ConnectionPool(buildMssqlConfig(MSSQL_URL!)).connect();
      // Idempotent clean slate: drop children before the schema.
      await q(`IF OBJECT_ID('${SCHEMA}.active_customers','V') IS NOT NULL DROP VIEW ${SCHEMA}.active_customers`);
      await q(`IF OBJECT_ID('${SCHEMA}.orders','U') IS NOT NULL DROP TABLE ${SCHEMA}.orders`);
      await q(`IF OBJECT_ID('${SCHEMA}.customers','U') IS NOT NULL DROP TABLE ${SCHEMA}.customers`);
      await q(`IF SCHEMA_ID('${SCHEMA}') IS NOT NULL DROP SCHEMA ${SCHEMA}`);
      await q(`CREATE SCHEMA ${SCHEMA}`);
      await q(`CREATE TABLE ${SCHEMA}.customers (
        id     INT IDENTITY(1,1) PRIMARY KEY,
        email  NVARCHAR(255) NOT NULL,
        note   NVARCHAR(MAX) NULL
      )`);
      await q(`INSERT INTO ${SCHEMA}.customers (email, note)
        VALUES ('a@example.com','first'),('b@example.com',NULL),('c@example.com','third')`);
      await q(`CREATE TABLE ${SCHEMA}.orders (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        customer_id  INT NOT NULL,
        total        DECIMAL(10,2) NULL
      )`);
      await q(`INSERT INTO ${SCHEMA}.orders (customer_id, total) VALUES (1, 9.99), (2, 19.99)`);
      await q(`CREATE VIEW ${SCHEMA}.active_customers AS SELECT id, email FROM ${SCHEMA}.customers`);
    });

    after(async () => {
      try {
        await q(`IF OBJECT_ID('${SCHEMA}.active_customers','V') IS NOT NULL DROP VIEW ${SCHEMA}.active_customers`);
        await q(`IF OBJECT_ID('${SCHEMA}.orders','U') IS NOT NULL DROP TABLE ${SCHEMA}.orders`);
        await q(`IF OBJECT_ID('${SCHEMA}.customers','U') IS NOT NULL DROP TABLE ${SCHEMA}.customers`);
        await q(`IF SCHEMA_ID('${SCHEMA}') IS NOT NULL DROP SCHEMA ${SCHEMA}`);
      } finally {
        await pool.close();
      }
    });

    it('discovers tables with real column types, nullability and ordinals', async () => {
      const assets = await scanSqlServer({ type: 'sqlserver', name: 'it-mssql', connectionString: MSSQL_URL!, schemas: [SCHEMA] });

      const customers = byName(assets, `${SCHEMA}.customers`);
      // row_count comes from sys.dm_db_partition_stats — updated on DML,
      // no ANALYZE needed, but still an estimate; assert a live signal.
      assert.ok((customers.rowCount ?? 0) >= 1, 'a non-zero row-count estimate');
      assert.ok(customers.columns && customers.columns.length === 3, 'three columns');

      const cols = Object.fromEntries((customers.columns || []).map((c) => [c.name, c]));
      assert.strictEqual(cols.id.dataType, 'int');
      assert.strictEqual(cols.id.nullable, false);
      assert.strictEqual(cols.id.ordinal, 1);
      assert.strictEqual(cols.email.dataType, 'nvarchar');
      assert.strictEqual(cols.email.nullable, false);
      assert.strictEqual(cols.note.dataType, 'nvarchar');
      assert.strictEqual(cols.note.nullable, true, 'note is a nullable column');

      const orders = byName(assets, `${SCHEMA}.orders`);
      const orderCols = Object.fromEntries((orders.columns || []).map((c) => [c.name, c]));
      assert.strictEqual(orderCols.total.dataType, 'decimal');
    });

    it('reports a view (kind=view), distinct from base tables', async () => {
      const assets = await scanSqlServer({ type: 'sqlserver', name: 'it-mssql', connectionString: MSSQL_URL!, schemas: [SCHEMA] });
      const view = byName(assets, `${SCHEMA}.active_customers`);
      assert.match(view.description || '', /view/i);
      assert.ok(view.columns && view.columns.length === 2, 'the view exposes its two columns');
    });

    it('honours the schema allowlist — nothing outside it_scan leaks in', async () => {
      const assets = await scanSqlServer({ type: 'sqlserver', name: 'it-mssql', connectionString: MSSQL_URL!, schemas: [SCHEMA] });
      assert.ok(assets.length >= 3, 'the three seeded objects');
      assert.ok(assets.every((a) => a.name.startsWith(`${SCHEMA}.`)), 'every asset is inside the requested schema');
    });
  });
} else {
  describe('scanSqlServer — live SQL Server', () => {
    it('skipped — set CONNECTOR_TEST_MSSQL_URL to run', { skip: true }, () => {});
  });
}

// ── Oracle ─────────────────────────────────────────────────────────────────
// Oracle folds unquoted identifiers to UPPER CASE, so every seeded name
// (owner, table, column) comes back uppercase — the assertions match. The
// setup connects as a privileged user (system) and seeds into a dedicated
// PROCELA_IT schema, which `after` drops whole. num_rows is populated via
// DBMS_STATS so the adapter's optimizer-stats row count has a value.
if (ORACLE_URL) {
  describe('scanOracle — live Oracle', () => {
    const OWNER = 'PROCELA_IT';
    let conn: oracledb.Connection;
    const exec = (sql: string) => conn.execute(sql, {}, { autoCommit: true });

    before(async () => {
      conn = await oracledb.getConnection(parseOracleConnectionString(ORACLE_URL!));
      // Drop the schema if a prior run left it (ORA-01918 = user absent).
      await conn.execute(`BEGIN
        EXECUTE IMMEDIATE 'DROP USER ${OWNER} CASCADE';
      EXCEPTION WHEN OTHERS THEN
        IF SQLCODE != -1918 THEN RAISE; END IF;
      END;`);
      await exec(`CREATE USER ${OWNER} IDENTIFIED BY "Procela_IT_1"`);
      await exec(`GRANT CONNECT, RESOURCE TO ${OWNER}`);
      await exec(`ALTER USER ${OWNER} QUOTA UNLIMITED ON USERS`);
      await exec(`CREATE TABLE ${OWNER}.customers (
        id     NUMBER PRIMARY KEY,
        email  VARCHAR2(255) NOT NULL,
        note   VARCHAR2(4000)
      )`);
      // Oracle < 23c has no multi-row VALUES; insert one row at a time.
      await exec(`INSERT INTO ${OWNER}.customers (id, email, note) VALUES (1, 'a@example.com', 'first')`);
      await exec(`INSERT INTO ${OWNER}.customers (id, email, note) VALUES (2, 'b@example.com', NULL)`);
      await exec(`INSERT INTO ${OWNER}.customers (id, email, note) VALUES (3, 'c@example.com', 'third')`);
      await exec(`CREATE TABLE ${OWNER}.orders (
        id           NUMBER PRIMARY KEY,
        customer_id  NUMBER NOT NULL,
        total        NUMBER(10,2)
      )`);
      await exec(`INSERT INTO ${OWNER}.orders (id, customer_id, total) VALUES (1, 1, 9.99)`);
      await exec(`INSERT INTO ${OWNER}.orders (id, customer_id, total) VALUES (2, 2, 19.99)`);
      await exec(`CREATE VIEW ${OWNER}.active_customers AS SELECT id, email FROM ${OWNER}.customers`);
      // num_rows in all_tables is the optimizer-stats estimate the adapter
      // reads; gather it so it isn't NULL → 0.
      await exec(`BEGIN DBMS_STATS.GATHER_TABLE_STATS('${OWNER}', 'CUSTOMERS'); END;`);
      await exec(`BEGIN DBMS_STATS.GATHER_TABLE_STATS('${OWNER}', 'ORDERS'); END;`);
    });

    after(async () => {
      try {
        await exec(`DROP USER ${OWNER} CASCADE`);
      } finally {
        await conn.close();
      }
    });

    it('discovers tables with real column types, nullability and ordinals', async () => {
      const assets = await scanOracle({ type: 'oracle', name: 'it-oracle', connectionString: ORACLE_URL!, schemas: [OWNER] });

      const customers = byName(assets, `${OWNER}.CUSTOMERS`);
      assert.ok((customers.rowCount ?? 0) >= 1, 'a non-zero row-count estimate');
      assert.ok(customers.columns && customers.columns.length === 3, 'three columns');

      const cols = Object.fromEntries((customers.columns || []).map((c) => [c.name, c]));
      assert.strictEqual(cols.ID.dataType, 'NUMBER');
      assert.strictEqual(cols.ID.nullable, false);
      assert.strictEqual(cols.ID.ordinal, 1);
      assert.strictEqual(cols.EMAIL.dataType, 'VARCHAR2');
      assert.strictEqual(cols.EMAIL.nullable, false);
      assert.strictEqual(cols.NOTE.dataType, 'VARCHAR2');
      assert.strictEqual(cols.NOTE.nullable, true, 'note is a nullable column');

      const orders = byName(assets, `${OWNER}.ORDERS`);
      const orderCols = Object.fromEntries((orders.columns || []).map((c) => [c.name, c]));
      assert.strictEqual(orderCols.TOTAL.dataType, 'NUMBER');
    });

    it('reports a view (kind=view), distinct from base tables', async () => {
      const assets = await scanOracle({ type: 'oracle', name: 'it-oracle', connectionString: ORACLE_URL!, schemas: [OWNER] });
      const view = byName(assets, `${OWNER}.ACTIVE_CUSTOMERS`);
      assert.match(view.description || '', /view/i);
      assert.ok(view.columns && view.columns.length === 2, 'the view exposes its two columns');
    });

    it('honours the owner allowlist — nothing outside PROCELA_IT leaks in', async () => {
      const assets = await scanOracle({ type: 'oracle', name: 'it-oracle', connectionString: ORACLE_URL!, schemas: [OWNER] });
      assert.ok(assets.length >= 3, 'the three seeded objects');
      assert.ok(assets.every((a) => a.name.startsWith(`${OWNER}.`)), 'every asset is inside the requested owner');
    });
  });
} else {
  describe('scanOracle — live Oracle', () => {
    it('skipped — set CONNECTOR_TEST_ORACLE_URL to run', { skip: true }, () => {});
  });
}
