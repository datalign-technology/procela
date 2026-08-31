// Oracle live source driver. Uses oracledb in thin mode (pure JS — no Oracle
// Instant Client needed), the same mode the on-prem connector's discovery
// adapter uses. Opens a connection, runs the prepared SELECT, normalizes rows,
// closes. Errors propagate (fail-loud).
//
// Note on column case: Oracle returns column names UPPER-cased for unquoted
// columns, so a `SELECT *` yields keys like SYS_NAME. A sync's fieldMapping
// source columns must match that case — the /preview endpoint surfaces the
// real keys so the mapping can be built against them.

import oracledb from 'oracledb';
import type { DbSourceRequest, SourceRow } from './types';
import { normalizeRow } from './sql';

export async function fetchOracleRows(req: DbSourceRequest, sql: string): Promise<SourceRow[]> {
  // `database` carries the Oracle service name (or SID); connectString is the
  // easy-connect form host:port/service.
  const connectString = `${req.host}:${req.port ?? 1521}/${req.database}`;
  const conn = await oracledb.getConnection({
    user: req.username,
    password: req.password,
    connectString,
  });
  try {
    const res = await conn.execute(sql, (req.params ?? []) as oracledb.BindParameters, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return ((res.rows ?? []) as Record<string, unknown>[]).map(normalizeRow);
  } finally {
    await conn.close();
  }
}
