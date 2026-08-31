// SQL Server live source driver. mssql pools per connection config; we
// open a dedicated pool, run the query, and close it so a run doesn't leak
// connections. Errors propagate (fail-loud).

import sql from 'mssql';
import type { DbSourceRequest, SourceRow } from './types';
import { normalizeRow } from './sql';

const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

export async function fetchSqlServerRows(req: DbSourceRequest, query: string): Promise<SourceRow[]> {
  const pool = new sql.ConnectionPool({
    server: req.host,
    port: req.port ?? 1433,
    database: req.database,
    user: req.username,
    password: req.password,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
    pool: { max: 2, min: 0, idleTimeoutMillis: 30_000 },
    options: {
      // Encrypt by default; trust self-signed so an internal/on-prem cert
      // doesn't block a prototype connection. A hardened deployment would
      // pin the CA instead.
      encrypt: true,
      trustServerCertificate: true,
    },
  });
  await pool.connect();
  try {
    const request = pool.request();
    (req.params ?? []).forEach((v, i) => request.input(`p${i}`, v));
    const res = await request.query(query);
    return (res.recordset ?? []).map((r) => normalizeRow(r as Record<string, unknown>));
  } finally {
    await pool.close();
  }
}
