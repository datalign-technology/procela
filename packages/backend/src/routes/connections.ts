import { Router, Request, Response, raw } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';
import { loadStore, saveStore } from '../lib/persistence';
import { filterByOrgScope } from '../lib/org-scope';
import { testConnection, discoverAssets } from '../services/connector.service';
import { analyzeLocalFile, deleteLocalFileDir, getUploadsDir } from '../lib/local-file-connector';
import logger from '../lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectionProfile {
  id: string;
  orgId: string;
  /** @deprecated Retired. A connection links to zero or more systems
   *  via the `connectionSystemLinks` join table (`systemIds` on the
   *  public shape). This single field is no longer written or read —
   *  it only persists on pre-migration rows so the one-time backfill
   *  below can seed the join table from it. Do not add new readers. */
  systemId?: string;
  name: string;
  connectionType: 'DATABASE' | 'FILE_STORAGE' | 'API' | 'DATA_WAREHOUSE' | 'SPREADSHEET';

  config: {
    // Database
    dbType?: 'POSTGRESQL' | 'MYSQL' | 'SQLSERVER' | 'ORACLE' | 'MONGODB';
    host?: string;
    port?: number;
    database?: string;
    schema?: string;

    // File Storage
    storageType?: 'S3' | 'AZURE_BLOB' | 'GCS' | 'SFTP' | 'LOCAL';
    bucket?: string;
    path?: string;

    // LOCAL file uploads (populated by the /upload endpoint)
    localFilePath?: string;       // absolute path on disk
    originalFileName?: string;
    fileSize?: number;
    rowCount?: number;
    columns?: string[];
    lastUploadedAt?: string;

    // API
    baseUrl?: string;
    authType?: 'NONE' | 'API_KEY' | 'OAUTH2' | 'BASIC';

    // Data Warehouse
    warehouseType?: 'SNOWFLAKE' | 'BIGQUERY' | 'REDSHIFT' | 'DATABRICKS';
    account?: string;
    warehouse?: string;

    // Spreadsheet
    spreadsheetType?: 'SHAREPOINT' | 'GOOGLE_SHEETS';
    documentUrl?: string;
  };

  credentials: {
    username?: string;
    password?: string;
    apiKey?: string;
    token?: string;
  };

  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'UNTESTED';
  lastTestedAt: string | null;
  lastTestResult: string | null;

  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONNECTION_TYPES = ['DATABASE', 'FILE_STORAGE', 'API', 'DATA_WAREHOUSE', 'SPREADSHEET'];
const DB_TYPES = ['POSTGRESQL', 'MYSQL', 'SQLSERVER', 'ORACLE', 'MONGODB'];
const STORAGE_TYPES = ['S3', 'AZURE_BLOB', 'GCS', 'SFTP', 'LOCAL'];
const AUTH_TYPES = ['NONE', 'API_KEY', 'OAUTH2', 'BASIC'];
const WAREHOUSE_TYPES = ['SNOWFLAKE', 'BIGQUERY', 'REDSHIFT', 'DATABRICKS'];

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

export const connections: ConnectionProfile[] = loadStore<ConnectionProfile>('connections');
const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

// ── Connection ↔ System join table ────────────────────────────────────────
//
// In real enterprises a connection (a Postgres host, an SFTP server, an
// API gateway) often serves many systems — and a system may aggregate
// several connections. The legacy `systemId` field on ConnectionProfile
// could only express one link, so we capture the relationship in a
// dedicated join table. The legacy field is kept on the row for
// backward-compat reads but is no longer authoritative; `systemIds` on
// the public response is the source of truth.

export interface ConnectionSystemLink {
  id: string;
  orgId: string;
  connectionId: string;
  systemId: string;
  createdAt: string;
}

export const connectionSystemLinks: ConnectionSystemLink[] =
  loadStore<ConnectionSystemLink>('connectionSystemLinks');

// One-time migration: seed link rows from the legacy single systemId
// per connection. Idempotent — only inserts a row if no link already
// exists for the (connectionId, systemId) pair.
let linksMigrated = false;
for (const c of connections) {
  if (c.systemId && c.systemId.trim()) {
    const exists = connectionSystemLinks.some(
      (l) => l.connectionId === c.id && l.systemId === c.systemId,
    );
    if (!exists) {
      connectionSystemLinks.push({
        id: uuid(),
        orgId: c.orgId,
        connectionId: c.id,
        systemId: c.systemId,
        createdAt: c.createdAt || new Date().toISOString(),
      });
      linksMigrated = true;
    }
  }
}
if (linksMigrated) saveStore('connectionSystemLinks', connectionSystemLinks);

export function systemIdsForConnection(connectionId: string): string[] {
  return connectionSystemLinks.filter((l) => l.connectionId === connectionId).map((l) => l.systemId);
}

export function connectionsForSystem(systemId: string): string[] {
  return connectionSystemLinks.filter((l) => l.systemId === systemId).map((l) => l.connectionId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mask sensitive credential fields: show first 4 chars + *** */
function maskCredentials(creds: ConnectionProfile['credentials']): ConnectionProfile['credentials'] {
  const masked: ConnectionProfile['credentials'] = {};
  if (creds.username !== undefined) masked.username = creds.username;
  if (creds.password !== undefined) {
    masked.password = creds.password.length > 4 ? creds.password.slice(0, 4) + '***' : '***';
  }
  if (creds.apiKey !== undefined) {
    masked.apiKey = creds.apiKey.length > 4 ? creds.apiKey.slice(0, 4) + '***' : '***';
  }
  if (creds.token !== undefined) {
    masked.token = creds.token.length > 4 ? creds.token.slice(0, 4) + '***' : '***';
  }
  return masked;
}

/** Return a copy of the profile with masked credentials. The public
 *  shape adds `systemIds` (resolved from the join table) so callers
 *  don't need a second round-trip to discover the connection's system
 *  links. The legacy single `systemId` is preserved for backward
 *  compatibility but `systemIds` is the source of truth. */
function toPublic(profile: ConnectionProfile) {
  const systemIds = systemIdsForConnection(profile.id);
  // `systemId` is intentionally NOT emitted — `systemIds` (from the
  // join table) is the sole source of truth. Strip any legacy value
  // off pre-migration rows so it can't be read by accident.
  const { systemId: _legacy, ...rest } = profile;
  return {
    ...rest,
    systemIds,
    credentials: maskCredentials(profile.credentials),
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

/** DELETE /api/v1/connections/all — delete all connection profiles */
router.delete('/all', (_req: Request, res: Response) => {
  const count = connections.length;
  const removedIds = connections.map((c) => c.id);
  connections.splice(0, connections.length);
  saveStore('connections', connections);
  // Cascade: drop every system link too.
  const removedLinks = connectionSystemLinks.length;
  connectionSystemLinks.splice(0, connectionSystemLinks.length);
  saveStore('connectionSystemLinks', connectionSystemLinks);
  auditService.log(DEV_ORG_ID, null, 'ConnectionProfile', '*', 'DELETE_ALL', null, { count, removedLinks });
  // Clean up every connection's upload dir alongside its profile.
  for (const id of removedIds) deleteLocalFileDir(id);
  // Cascade: any bindings pointing at deleted connections are now orphans.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { purgeBindingsForConnection } = require('./data-assets') as typeof import('./data-assets');
  let removedBindings = 0;
  for (const id of removedIds) removedBindings += purgeBindingsForConnection(id);
  logger.info({ count, removedBindings, removedLinks }, 'Deleted all connection profiles');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/connections — list all (supports ?orgId= and ?systemId= filters) */
router.get('/', (req: Request, res: Response) => {
  const { orgId, systemId } = req.query;
  let filtered = connections;
  if (orgId) filtered = filterByOrgScope(filtered, orgId as string);
  if (systemId) {
    const linkedIds = new Set(connectionsForSystem(systemId as string));
    filtered = filtered.filter((c) => linkedIds.has(c.id));
  }
  res.json({
    success: true,
    data: filtered.map(toPublic),
    connectionTypes: CONNECTION_TYPES,
    dbTypes: DB_TYPES,
    storageTypes: STORAGE_TYPES,
    authTypes: AUTH_TYPES,
    warehouseTypes: WAREHOUSE_TYPES,
  });
});

/** GET /api/v1/connections/:id — single profile (masked credentials) */
router.get('/:id', (req: Request, res: Response) => {
  const conn = connections.find((c) => c.id === req.params.id);
  if (!conn) { res.status(404).json({ success: false, error: 'Connection profile not found' }); return; }
  res.json({ success: true, data: toPublic(conn) });
});

/** POST /api/v1/connections — create connection profile */
router.post('/', (req: Request, res: Response) => {
  const { name, systemId, systemIds, connectionType, config, credentials, orgId } = req.body;

  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (!connectionType || !CONNECTION_TYPES.includes(connectionType)) {
    res.status(400).json({ success: false, error: `connectionType must be one of: ${CONNECTION_TYPES.join(', ')}` });
    return;
  }

  // Accept either the legacy single systemId or the new systemIds[]; the
  // first link in the array also gets mirrored into the legacy column for
  // back-compat reads. Empty/missing means "unassigned" — that's allowed
  // and surfaces as a coverage gap rather than a validation error.
  const requestedSystemIds: string[] = Array.isArray(systemIds)
    ? systemIds.filter((s) => typeof s === 'string' && s.trim())
    : (typeof systemId === 'string' && systemId.trim() ? [systemId] : []);

  const now = new Date().toISOString();
  const conn: ConnectionProfile = {
    id: uuid(),
    orgId: orgId || DEV_ORG_ID,
    name,
    connectionType,
    config: config || {},
    credentials: credentials || {},
    status: 'UNTESTED',
    lastTestedAt: null,
    lastTestResult: null,
    createdAt: now,
    updatedAt: now,
  };

  connections.push(conn);
  saveStore('connections', connections);
  // Persist the full set of system links via the join table.
  for (const sid of requestedSystemIds) {
    connectionSystemLinks.push({
      id: uuid(), orgId: conn.orgId, connectionId: conn.id, systemId: sid, createdAt: now,
    });
  }
  if (requestedSystemIds.length > 0) saveStore('connectionSystemLinks', connectionSystemLinks);

  auditService.log(conn.orgId, null, 'ConnectionProfile', conn.id, 'CREATE', null, toPublic(conn));
  logger.info({ id: conn.id, name: conn.name, type: conn.connectionType, systemIds: requestedSystemIds }, 'Created connection profile');
  res.status(201).json({ success: true, data: toPublic(conn) });
});

/** PUT /api/v1/connections/:id — update connection profile */
router.put('/:id', (req: Request, res: Response) => {
  const conn = connections.find((c) => c.id === req.params.id);
  if (!conn) { res.status(404).json({ success: false, error: 'Connection profile not found' }); return; }

  const before = toPublic({ ...conn });
  const { name, systemId, systemIds, connectionType, config, credentials } = req.body;

  if (name !== undefined) conn.name = name;
  // Two ways to update the system links:
  //  - systemIds[] replaces the full set (preferred)
  //  - legacy systemId sets a single link (kept for older callers and the
  //    System "Connect" picker, which still adds-or-moves one at a time)
  let linksChanged = false;
  if (Array.isArray(systemIds)) {
    const next = systemIds.filter((s) => typeof s === 'string' && s.trim());
    // Drop existing links for this connection in place; reinsert the new set.
    for (let i = connectionSystemLinks.length - 1; i >= 0; i--) {
      if (connectionSystemLinks[i].connectionId === conn.id) connectionSystemLinks.splice(i, 1);
    }
    const now = new Date().toISOString();
    for (const sid of next) {
      connectionSystemLinks.push({ id: uuid(), orgId: conn.orgId, connectionId: conn.id, systemId: sid, createdAt: now });
    }
    linksChanged = true;
  } else if (systemId !== undefined) {
    // Legacy single-system semantics: empty string means "unlink all";
    // otherwise replace any existing single link with this one. To match
    // historical behavior the picker uses, this REPLACES rather than ADDS.
    for (let i = connectionSystemLinks.length - 1; i >= 0; i--) {
      if (connectionSystemLinks[i].connectionId === conn.id) connectionSystemLinks.splice(i, 1);
    }
    if (systemId) {
      connectionSystemLinks.push({
        id: uuid(), orgId: conn.orgId, connectionId: conn.id, systemId, createdAt: new Date().toISOString(),
      });
    }
    linksChanged = true;
  }
  if (linksChanged) saveStore('connectionSystemLinks', connectionSystemLinks);

  if (connectionType !== undefined && CONNECTION_TYPES.includes(connectionType)) {
    conn.connectionType = connectionType as ConnectionProfile['connectionType'];
  }
  if (config !== undefined) conn.config = { ...conn.config, ...config };

  // Merge credentials carefully: keep existing secrets if masked/empty values sent
  if (credentials !== undefined) {
    if (credentials.username !== undefined) conn.credentials.username = credentials.username;
    if (credentials.password !== undefined && credentials.password !== '' && !credentials.password.endsWith('***')) {
      conn.credentials.password = credentials.password;
    }
    if (credentials.apiKey !== undefined && credentials.apiKey !== '' && !credentials.apiKey.endsWith('***')) {
      conn.credentials.apiKey = credentials.apiKey;
    }
    if (credentials.token !== undefined && credentials.token !== '' && !credentials.token.endsWith('***')) {
      conn.credentials.token = credentials.token;
    }
  }

  conn.updatedAt = new Date().toISOString();
  saveStore('connections', connections);
  auditService.log(conn.orgId, null, 'ConnectionProfile', conn.id, 'UPDATE', before, toPublic(conn));
  res.json({ success: true, data: toPublic(conn) });
});

/** DELETE /api/v1/connections/:id — delete */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = connections.findIndex((c) => c.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Connection profile not found' }); return; }
  const removed = connections[idx];
  auditService.log(removed.orgId, null, 'ConnectionProfile', removed.id, 'DELETE', toPublic(removed), null);
  connections.splice(idx, 1);
  saveStore('connections', connections);
  // Cascade: drop any system links for the deleted connection.
  let removedLinks = 0;
  for (let i = connectionSystemLinks.length - 1; i >= 0; i--) {
    if (connectionSystemLinks[i].connectionId === removed.id) {
      connectionSystemLinks.splice(i, 1);
      removedLinks++;
    }
  }
  if (removedLinks > 0) saveStore('connectionSystemLinks', connectionSystemLinks);
  // Clean up any locally-uploaded file for this connection.
  deleteLocalFileDir(removed.id);
  // Cascade: any DataAssetBindings pointing at this connection become
  // orphaned — unlink them so the asset falls back to "not linked".
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { purgeBindingsForConnection } = require('./data-assets') as typeof import('./data-assets');
  const removedBindings = purgeBindingsForConnection(removed.id);
  if (removedBindings > 0 || removedLinks > 0) {
    logger.info({ connectionId: removed.id, removedBindings, removedLinks }, 'Cascaded cleanup for deleted connection');
  }
  res.status(204).send();
});

/**
 * POST /api/v1/connections/test — test a connection config without persisting.
 *
 * Body: { id?, connectionType, config, credentials }
 *
 * If `id` is provided and matches a saved profile, masked/empty credential
 * fields are replaced with the saved values (so users can test edits without
 * re-entering secrets). Nothing is written to the store.
 */
router.post('/test', async (req: Request, res: Response) => {
  const { id, connectionType, config, credentials } = req.body || {};

  if (!connectionType || !CONNECTION_TYPES.includes(connectionType)) {
    res.status(400).json({ success: false, error: `connectionType must be one of: ${CONNECTION_TYPES.join(', ')}` });
    return;
  }

  const mergedCreds: ConnectionProfile['credentials'] = { ...(credentials || {}) };
  if (id) {
    const saved = connections.find((c) => c.id === id);
    if (saved) {
      const isMasked = (v: unknown) => typeof v === 'string' && (v === '' || v.endsWith('***'));
      if (isMasked(mergedCreds.password)) mergedCreds.password = saved.credentials.password;
      if (isMasked(mergedCreds.apiKey)) mergedCreds.apiKey = saved.credentials.apiKey;
      if (isMasked(mergedCreds.token)) mergedCreds.token = saved.credentials.token;
      if (mergedCreds.username === undefined) mergedCreds.username = saved.credentials.username;
    }
  }

  try {
    const result = await testConnection({
      connectionType,
      config: config || {},
      credentials: mergedCreds,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Ad-hoc connection test failed');
    res.status(500).json({ success: false, error: 'Connection test failed' });
  }
});

/**
 * POST /api/v1/connections/test-file?filename=foo.csv
 *
 * Test a LOCAL file-storage connection against an in-flight upload —
 * before the connection has been created, so the user can validate the
 * file without a Save→Test→Save round-trip. Body is the raw file bytes.
 * The file is written to the OS tmp dir, parsed by analyzeLocalFile, and
 * deleted in `finally` whether or not the test succeeds. Nothing
 * persists.
 */
router.post(
  '/test-file',
  raw({ type: '*/*', limit: '50mb' }),
  async (req: Request, res: Response) => {
    const rawName = typeof req.query.filename === 'string' ? req.query.filename : '';
    const safeName = path.basename(rawName).replace(/[^\w.\-]+/g, '_');
    if (!safeName) {
      res.status(400).json({ success: false, error: 'filename query parameter is required' });
      return;
    }
    const body = req.body;
    if (!body || !(body instanceof Buffer) || body.length === 0) {
      res.status(400).json({ success: false, error: 'Empty upload body' });
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'procela-test-'));
    const tmpPath = path.join(tmpDir, safeName);
    const start = Date.now();
    try {
      fs.writeFileSync(tmpPath, body);
      const analysis = analyzeLocalFile(tmpPath);
      res.json({
        success: true,
        data: {
          success: true,
          message: `Parsed ${safeName} — ${analysis.rowCount} row(s), ${analysis.columns.length} column(s)`,
          latencyMs: Date.now() - start,
          rowCount: analysis.rowCount,
          columns: analysis.columns,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Parse failed';
      res.json({
        success: true,
        data: { success: false, message, latencyMs: Date.now() - start },
      });
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  },
);

/** POST /api/v1/connections/:id/test — test connection */
router.post('/:id/test', async (req: Request, res: Response) => {
  const conn = connections.find((c) => c.id === req.params.id);
  if (!conn) { res.status(404).json({ success: false, error: 'Connection profile not found' }); return; }

  try {
    const result = await testConnection(conn);
    conn.lastTestedAt = new Date().toISOString();
    conn.lastTestResult = result.message;
    conn.status = result.success ? 'CONNECTED' : 'ERROR';
    conn.updatedAt = conn.lastTestedAt;
    saveStore('connections', connections);
    auditService.log(conn.orgId, null, 'ConnectionProfile', conn.id, 'TEST', null, {
      success: result.success,
      message: result.message,
      latencyMs: result.latencyMs,
    });
    res.json({ success: true, data: { ...result, profile: toPublic(conn) } });
  } catch (err) {
    conn.status = 'ERROR';
    conn.lastTestedAt = new Date().toISOString();
    conn.lastTestResult = err instanceof Error ? err.message : 'Unknown error';
    conn.updatedAt = conn.lastTestedAt;
    saveStore('connections', connections);
    logger.error({ err, id: conn.id, connectionType: conn.connectionType, storageType: conn.config?.storageType }, 'Connection test threw');
    // Return the real reason so the UI can show it instead of a
    // generic "Connection test failed" toast that hides what broke.
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Connection test failed',
    });
  }
});

/** POST /api/v1/connections/:id/discover — discover available assets */
router.post('/:id/discover', async (req: Request, res: Response) => {
  const conn = connections.find((c) => c.id === req.params.id);
  if (!conn) { res.status(404).json({ success: false, error: 'Connection profile not found' }); return; }

  try {
    const result = await discoverAssets(conn);
    auditService.log(conn.orgId, null, 'ConnectionProfile', conn.id, 'DISCOVER', null, {
      success: result.success,
      assetCount: result.details?.tableCount,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err, id: conn.id }, 'Asset discovery failed');
    res.status(500).json({ success: false, error: 'Asset discovery failed' });
  }
});

/**
 * POST /api/v1/connections/:id/upload?filename=foo.csv
 *
 * Accepts the raw bytes of a local file for FILE_STORAGE/LOCAL connections.
 * The file is stored under `.procela-data/uploads/<connId>/<filename>`, parsed
 * to extract row count + column names, and the connection's config is updated
 * with the resulting metadata. Only one file is stored per connection — an
 * existing upload is replaced.
 */
router.post(
  '/:id/upload',
  raw({ type: '*/*', limit: '50mb' }),
  async (req: Request, res: Response) => {
    const conn = connections.find((c) => c.id === req.params.id);
    if (!conn) { res.status(404).json({ success: false, error: 'Connection profile not found' }); return; }

    if (conn.connectionType !== 'FILE_STORAGE' || conn.config.storageType !== 'LOCAL') {
      res.status(400).json({ success: false, error: 'File upload only supported for FILE_STORAGE connections with storageType=LOCAL' });
      return;
    }

    const rawName = typeof req.query.filename === 'string' ? req.query.filename : '';
    const safeName = path.basename(rawName).replace(/[^\w.\-]+/g, '_');
    if (!safeName) {
      res.status(400).json({ success: false, error: 'filename query parameter is required' });
      return;
    }

    const body = req.body;
    if (!body || !(body instanceof Buffer) || body.length === 0) {
      res.status(400).json({ success: false, error: 'Empty upload body' });
      return;
    }

    // One file per connection — clear any prior upload first.
    deleteLocalFileDir(conn.id);
    const connDir = getUploadsDir(conn.id);
    fs.mkdirSync(connDir, { recursive: true });
    const absPath = path.join(connDir, safeName);
    fs.writeFileSync(absPath, body);

    let rowCount: number | undefined;
    let columns: string[] | undefined;
    let parseError: string | undefined;
    try {
      const analysis = analyzeLocalFile(absPath);
      rowCount = analysis.rowCount;
      columns = analysis.columns;
    } catch (err) {
      parseError = err instanceof Error ? err.message : 'Parse failed';
    }

    conn.config.localFilePath = absPath;
    conn.config.originalFileName = safeName;
    conn.config.fileSize = body.length;
    conn.config.rowCount = rowCount;
    conn.config.columns = columns;
    conn.config.lastUploadedAt = new Date().toISOString();
    // Clear cloud-storage fields that don't apply to a local upload.
    delete conn.config.bucket;
    delete conn.config.path;

    // For a LOCAL file connection a successful parse during upload IS
    // the connection test — what /test would re-run is the same
    // analyzeLocalFile call. Record CONNECTED so the user doesn't have
    // to click Test a second time after Save just to flip the badge.
    if (parseError) {
      conn.status = 'ERROR';
      conn.lastTestResult = `Upload stored but parse failed: ${parseError}`;
    } else {
      conn.status = 'CONNECTED';
      conn.lastTestResult = `Read ${safeName}: ${(rowCount ?? 0).toLocaleString()} rows × ${(columns?.length ?? 0)} column${columns?.length === 1 ? '' : 's'}`;
    }
    conn.lastTestedAt = conn.config.lastUploadedAt;
    conn.updatedAt = conn.config.lastUploadedAt;
    saveStore('connections', connections);

    auditService.log(conn.orgId, null, 'ConnectionProfile', conn.id, 'UPLOAD', null, {
      fileName: safeName,
      fileSize: body.length,
      rowCount,
      columns: columns?.length,
      parseError,
    });
    logger.info({ id: conn.id, file: safeName, size: body.length, rowCount, parseError }, 'Uploaded connection file');

    res.json({
      success: true,
      data: {
        profile: toPublic(conn),
        parseError: parseError || null,
      },
    });
  },
);

/**
 * POST /api/v1/connections/:id/systems
 * body: { systemId }
 *
 * Link an additional system to this connection without disturbing the
 * connection's other links — used by the System "+ Connect" picker so
 * attaching a connection to a second system doesn't unlink it from the
 * first. Idempotent: re-posting an existing link returns the link row
 * with a 200 instead of duplicating.
 */
router.post('/:id/systems', (req: Request, res: Response) => {
  const conn = connections.find((c) => c.id === req.params.id);
  if (!conn) { res.status(404).json({ success: false, error: 'Connection profile not found' }); return; }
  const { systemId } = req.body || {};
  if (typeof systemId !== 'string' || !systemId.trim()) {
    res.status(400).json({ success: false, error: 'systemId is required' });
    return;
  }
  const existing = connectionSystemLinks.find((l) => l.connectionId === conn.id && l.systemId === systemId);
  if (existing) {
    res.json({ success: true, data: existing, alreadyLinked: true });
    return;
  }
  const link: ConnectionSystemLink = {
    id: uuid(), orgId: conn.orgId, connectionId: conn.id, systemId,
    createdAt: new Date().toISOString(),
  };
  connectionSystemLinks.push(link);
  saveStore('connectionSystemLinks', connectionSystemLinks);
  auditService.log(conn.orgId, null, 'ConnectionProfile', conn.id, 'LINK_SYSTEM', null, { systemId });
  res.status(201).json({ success: true, data: link });
});

/** DELETE /api/v1/connections/:id/systems/:systemId — remove a single link */
router.delete('/:id/systems/:systemId', (req: Request, res: Response) => {
  const conn = connections.find((c) => c.id === req.params.id);
  if (!conn) { res.status(404).json({ success: false, error: 'Connection profile not found' }); return; }
  const { systemId } = req.params;
  const idx = connectionSystemLinks.findIndex((l) => l.connectionId === conn.id && l.systemId === systemId);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Link not found' }); return; }
  connectionSystemLinks.splice(idx, 1);
  saveStore('connectionSystemLinks', connectionSystemLinks);
  auditService.log(conn.orgId, null, 'ConnectionProfile', conn.id, 'UNLINK_SYSTEM', { systemId }, null);
  res.status(204).send();
});

/** GET /api/v1/connections/:id/systems — the system links for this connection */
router.get('/:id/systems', (req: Request, res: Response) => {
  const conn = connections.find((c) => c.id === req.params.id);
  if (!conn) { res.status(404).json({ success: false, error: 'Connection profile not found' }); return; }
  res.json({
    success: true,
    data: connectionSystemLinks.filter((l) => l.connectionId === conn.id),
  });
});

export default router;
