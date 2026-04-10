import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';
import { loadStore, saveStore } from '../lib/persistence';
import { testConnection, discoverAssets } from '../services/connector.service';
import logger from '../lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectionProfile {
  id: string;
  orgId: string;
  systemId: string;
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

/** Return a copy of the profile with masked credentials */
function toPublic(profile: ConnectionProfile): Omit<ConnectionProfile, 'credentials'> & { credentials: ConnectionProfile['credentials'] } {
  return { ...profile, credentials: maskCredentials(profile.credentials) };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

/** DELETE /api/v1/connections/all — delete all connection profiles */
router.delete('/all', (_req: Request, res: Response) => {
  const count = connections.length;
  connections.splice(0, connections.length);
  saveStore('connections', connections);
  auditService.log(DEV_ORG_ID, null, 'ConnectionProfile', '*', 'DELETE_ALL', null, { count });
  logger.info({ count }, 'Deleted all connection profiles');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/connections — list all (supports ?orgId= and ?systemId= filters) */
router.get('/', (req: Request, res: Response) => {
  const { orgId, systemId } = req.query;
  let filtered = connections;
  if (orgId) filtered = filtered.filter((c) => c.orgId === orgId);
  if (systemId) filtered = filtered.filter((c) => c.systemId === systemId);
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
  const { name, systemId, connectionType, config, credentials, orgId } = req.body;

  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (!connectionType || !CONNECTION_TYPES.includes(connectionType)) {
    res.status(400).json({ success: false, error: `connectionType must be one of: ${CONNECTION_TYPES.join(', ')}` });
    return;
  }

  const now = new Date().toISOString();
  const conn: ConnectionProfile = {
    id: uuid(),
    orgId: orgId || DEV_ORG_ID,
    systemId: systemId || '',
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
  auditService.log(conn.orgId, null, 'ConnectionProfile', conn.id, 'CREATE', null, toPublic(conn));
  logger.info({ id: conn.id, name: conn.name, type: conn.connectionType }, 'Created connection profile');
  res.status(201).json({ success: true, data: toPublic(conn) });
});

/** PUT /api/v1/connections/:id — update connection profile */
router.put('/:id', (req: Request, res: Response) => {
  const conn = connections.find((c) => c.id === req.params.id);
  if (!conn) { res.status(404).json({ success: false, error: 'Connection profile not found' }); return; }

  const before = toPublic({ ...conn });
  const { name, systemId, connectionType, config, credentials } = req.body;

  if (name !== undefined) conn.name = name;
  if (systemId !== undefined) conn.systemId = systemId;
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
  res.status(204).send();
});

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
    logger.error({ err, id: conn.id }, 'Connection test failed');
    res.status(500).json({ success: false, error: 'Connection test failed' });
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

export default router;
