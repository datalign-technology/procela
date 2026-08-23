// MySQL live source driver. Uses mysql2's promise API — one connection,
// one query, closed in a finally. Errors propagate (fail-loud).

import mysql from 'mysql2/promise';
import type { DbSourceRequest, SourceRow } from './types';
import { normalizeRow } from './sql';

const CONNECT_TIMEOUT_MS = 10_000;

export async function fetchMysqlRows(req: DbSourceRequest, sql: string): Promise<SourceRow[]> {
  const conn = await mysql.createConnection({
    host: req.host,
    port: req.port ?? 3306,
    database: req.database,
    user: req.username,
    password: req.password,
    connectTimeout: CONNECT_TIMEOUT_MS,
    // Return every column as a plain value keyed by name; rowsAsArray off is
    // the default, so a query yields Record<string, unknown>[].
    dateStrings: true,
  });
  try {
    const [rows] = await conn.query(sql);
    if (!Array.isArray(rows)) return [];
    return (rows as Record<string, unknown>[]).map(normalizeRow);
  } finally {
    await conn.end();
  }
}
