// Agent-push row sync. The backend defines AGENT-mode syncs; this module
// pulls the ones due for this connector, runs each query against the matching
// LOCAL source (inside the customer network), and pushes the resulting rows
// back to Procela over outbound HTTPS. Row values only ever flow outbound.
//
// Kept decoupled from index.ts (log + secret resolvers are injected) so it
// unit-tests without booting the agent, and so there's no import cycle.

import { Client } from 'pg';
import mysql from 'mysql2/promise';
import mssql from 'mssql';
import oracledb from 'oracledb';
import type { ConnectorConfig, Source, AgentSyncJob } from './types';
import { getSyncJobs, pushSyncRows } from './api';
import { resolveSourceSecrets, type SecretResolvers } from './secrets';
import { withRetry } from './retry';
import { buildSelectSql, normalizeRow, type SyncEngine } from './sync-query';
import { buildMssqlConfig } from './sqlserver';
import { parseOracleConnectionString } from './oracle';

type LogFn = (msg: string, extra?: Record<string, unknown>) => void;

const SOURCE_TYPE_TO_ENGINE: Partial<Record<Source['type'], SyncEngine>> = {
  postgres: 'POSTGRESQL',
  mysql: 'MYSQL',
  sqlserver: 'SQLSERVER',
  oracle: 'ORACLE',
};

const ENGINE_TO_SOURCE_TYPE: Record<SyncEngine, Source['type']> = {
  POSTGRESQL: 'postgres',
  MYSQL: 'mysql',
  SQLSERVER: 'sqlserver',
  ORACLE: 'oracle',
};

/**
 * Pick the configured source a job runs against: by explicit `sourceName`
 * when set, otherwise the first source whose engine matches the job's
 * `dbType`. Returns null when nothing matches (the caller logs + skips).
 */
export function selectSourceForJob(sources: Source[], job: AgentSyncJob): Source | null {
  if (job.sourceName) {
    return sources.find((s) => s.name === job.sourceName) ?? null;
  }
  if (job.dbType) {
    const wanted = ENGINE_TO_SOURCE_TYPE[job.dbType];
    return sources.find((s) => s.type === wanted) ?? null;
  }
  return null;
}

/**
 * Run one job's SELECT against a (secret-resolved) source and return the rows
 * as string maps. Opens a fresh connection and closes it in a finally.
 */
export async function fetchJobRows(source: Source, job: AgentSyncJob): Promise<Record<string, string>[]> {
  const engine = SOURCE_TYPE_TO_ENGINE[source.type];
  if (!engine) {
    throw new Error(`source "${source.name}" (${source.type}) can't run an agent sync`);
  }
  const sql = buildSelectSql(engine, {
    schema: job.schema,
    table: job.table,
    query: job.query,
    limit: job.limit,
  });

  if (source.type === 'postgres') {
    const client = new Client({ connectionString: source.connectionString });
    await client.connect();
    try {
      const res = await client.query(sql);
      return res.rows.map((r) => normalizeRow(r as Record<string, unknown>));
    } finally {
      await client.end();
    }
  }
  if (source.type === 'mysql') {
    const conn = await mysql.createConnection(source.connectionString);
    try {
      const [rows] = await conn.query(sql);
      return Array.isArray(rows) ? (rows as Record<string, unknown>[]).map(normalizeRow) : [];
    } finally {
      await conn.end();
    }
  }
  if (source.type === 'oracle') {
    const { user, password, connectString } = parseOracleConnectionString(source.connectionString);
    const conn = await oracledb.getConnection({ user, password, connectString });
    try {
      const res = await conn.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return ((res.rows ?? []) as Record<string, unknown>[]).map(normalizeRow);
    } finally {
      await conn.close();
    }
  }
  if (source.type !== 'sqlserver') {
    // Unreachable — SOURCE_TYPE_TO_ENGINE already gated dbt/oracle above — but
    // this narrows the union for TypeScript and is a defensive backstop.
    throw new Error(`source "${source.name}" (${source.type}) can't run an agent sync`);
  }
  const pool = new mssql.ConnectionPool(buildMssqlConfig(source.connectionString));
  await pool.connect();
  try {
    const res = await pool.request().query(sql);
    return (res.recordset ?? []).map((r) => normalizeRow(r as Record<string, unknown>));
  } finally {
    await pool.close();
  }
}

/**
 * One agent-push cycle: fetch the due jobs, run + push each. A single failing
 * job is logged and skipped so it never blocks the others. The push (not the
 * local query) is retried on a transient network blip, mirroring runScan.
 */
export async function runSyncJobs(cfg: ConnectorConfig, log: LogFn, resolvers: SecretResolvers): Promise<void> {
  let resp;
  try {
    resp = await getSyncJobs(cfg);
  } catch (err: any) {
    log('sync-jobs fetch failed — will retry next cycle', { error: err?.message || String(err) });
    return;
  }
  if (!resp.success || !resp.data) {
    if (resp.error) log('sync-jobs rejected', { error: resp.error });
    return;
  }
  const jobs = resp.data;
  if (jobs.length === 0) return;
  log('running due sync jobs', { count: jobs.length });

  for (const job of jobs) {
    try {
      const rawSource = selectSourceForJob(cfg.sources, job);
      if (!rawSource) {
        log('sync job has no matching source — skipping', { job: job.name, sourceName: job.sourceName, dbType: job.dbType });
        continue;
      }
      const source = resolveSourceSecrets(rawSource, resolvers);
      const rows = await fetchJobRows(source, job);
      const res = await withRetry(() => pushSyncRows(cfg, job.id, rows), {
        maxAttempts: 5,
        onRetry: (attempt, err) =>
          log('sync push failed, retrying', { job: job.name, attempt, error: (err as { message?: string })?.message || String(err) }),
      });
      if (!res.success) {
        log('sync push rejected', { job: job.name, error: res.error || 'unknown' });
      } else {
        log('sync push accepted', { job: job.name, rows: rows.length, ...res.data });
      }
    } catch (err: any) {
      log('sync job failed', { job: job.name, error: err?.message || String(err) });
    }
  }
}
