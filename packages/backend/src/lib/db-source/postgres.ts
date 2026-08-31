// PostgreSQL live source driver. Opens a fresh connection, runs the
// prepared SELECT, normalizes rows, closes. Errors propagate so runSync
// records the run as failed (fail-loud — no silent fallback).

import { Client } from 'pg';
import type { DbSourceRequest, SourceRow } from './types';
import { normalizeRow } from './sql';

const CONNECT_TIMEOUT_MS = 10_000;

export async function fetchPostgresRows(req: DbSourceRequest, sql: string): Promise<SourceRow[]> {
  const client = new Client({
    host: req.host,
    port: req.port ?? 5432,
    database: req.database,
    user: req.username,
    password: req.password,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    // Statement/idle caps keep a wedged source from hanging a run forever.
    statement_timeout: 30_000,
    query_timeout: 30_000,
  });
  await client.connect();
  try {
    const res = await client.query(sql, req.params ?? []);
    return res.rows.map((r) => normalizeRow(r as Record<string, unknown>));
  } finally {
    await client.end();
  }
}
