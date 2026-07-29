// SQL Server source adapter. Discovers tables and views in the
// configured schemas, pulls approximate row counts (via
// sys.partitions/sys.dm_db_partition_stats — exact-count COUNT(*)
// on big tables is too expensive for a routine scan), and the last
// user-write timestamp as a freshness proxy.
//
// Returns a flat list of ReportedAsset rows the connector ships to
// Procela's /connectors/report endpoint. No data values cross the
// wire — only catalog metadata.

import mssql from 'mssql';
import type { SqlServerSource, ReportedAsset } from './types';
import { rowToAsset, type RawCatalogRow } from './discovery';

// System schemas we never want to surface. INFORMATION_SCHEMA is
// SQL Server's SQL-standard views layer; the sys.* metadata lives
// in the `sys` schema; guest / db_* are permission-scaffolding.
const SYSTEM_SCHEMAS = new Set([
  'sys', 'INFORMATION_SCHEMA', 'guest',
  'db_owner', 'db_accessadmin', 'db_securityadmin', 'db_ddladmin',
  'db_backupoperator', 'db_datareader', 'db_datawriter',
  'db_denydatareader', 'db_denydatawriter',
]);

/** Scan one SQL Server source. Opens a fresh pool for the target
 *  database, runs one catalog query (unions tables + views), then
 *  closes. Errors propagate so the caller can write the SCAN_FAILED
 *  event. */
export async function scanSqlServer(source: SqlServerSource): Promise<ReportedAsset[]> {
  const pool = await mssql.connect(source.connectionString);
  try {
    // Build the schema filter. If the operator provided a list, use
    // it; otherwise skip only the system schemas. Doing the filter
    // in SQL rather than in JS keeps the row count low over the wire.
    const request = pool.request();
    let schemaClause: string;
    if (source.schemas && source.schemas.length > 0) {
      // Parameterise each schema — SQL Server doesn't have a native
      // array binding, so name each one.
      const names = source.schemas.map((s, i) => {
        request.input(`schema_${i}`, mssql.NVarChar, s);
        return `@schema_${i}`;
      });
      schemaClause = `s.name IN (${names.join(', ')})`;
    } else {
      // NOT IN system schemas + skip anything owned by dbo that
      // starts with 'sys' as a belt-and-braces guard.
      const names = Array.from(SYSTEM_SCHEMAS).map((s, i) => {
        request.input(`sysSchema_${i}`, mssql.NVarChar, s);
        return `@sysSchema_${i}`;
      });
      schemaClause = `s.name NOT IN (${names.join(', ')})`;
    }

    // Union tables and views. For each object we grab:
    //   - schema.name identity
    //   - object kind (r=regular table, v=view — matched to how the
    //     Postgres adapter labels them for description consistency)
    //   - approximate row count from sys.dm_db_partition_stats
    //     (heap or clustered rows only — filter index_id IN (0, 1)
    //     to avoid double-counting non-clustered indexes)
    //   - last_user_update from sys.dm_db_index_usage_stats — when
    //     any user process last wrote to the table. Resets on
    //     server restart but is the closest analogue to Postgres's
    //     last_vacuum/last_analyze combo
    //   - MS_Description extended property for the table description
    const sql = `
      WITH obj AS (
        SELECT t.object_id, s.name AS schema_name, t.name AS name, 'r' AS kind
        FROM sys.tables t
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE ${schemaClause}
        UNION ALL
        SELECT v.object_id, s.name AS schema_name, v.name AS name, 'v' AS kind
        FROM sys.views v
        JOIN sys.schemas s ON s.schema_id = v.schema_id
        WHERE ${schemaClause.replace(/s\.name/g, 's.name')}
      )
      SELECT
        obj.schema_name                                             AS [schema],
        obj.name                                                    AS [name],
        obj.kind                                                    AS kind,
        COALESCE(
          (SELECT SUM(row_count)
             FROM sys.dm_db_partition_stats ps
            WHERE ps.object_id = obj.object_id
              AND ps.index_id IN (0, 1)),
          0
        )                                                           AS row_count,
        (SELECT MAX(last_user_update)
           FROM sys.dm_db_index_usage_stats us
          WHERE us.object_id = obj.object_id
            AND us.database_id = DB_ID())                           AS last_activity,
        CAST(
          (SELECT TOP 1 CAST(ep.value AS NVARCHAR(MAX))
             FROM sys.extended_properties ep
            WHERE ep.major_id = obj.object_id
              AND ep.minor_id = 0
              AND ep.name = 'MS_Description'
              AND ep.class = 1)
          AS NVARCHAR(MAX)
        )                                                           AS description
      FROM obj
      ORDER BY obj.schema_name, obj.name
    `;

    const res = await request.query(sql);

    // Shared "schema.table" identity + freshness + description
    // fallback — see ./discovery. last_user_update is NULL until the
    // DMV records a write since the last restart; freshnessSignal
    // maps that (and epoch) to "no signal".
    return res.recordset.map((r: RawCatalogRow): ReportedAsset =>
      rowToAsset(r, 'SQL Server', source.systemId));
  } finally {
    await pool.close();
  }
}
