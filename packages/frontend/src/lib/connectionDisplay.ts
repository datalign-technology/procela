// ──────────────────────────────────────────────────────────────────────────
// connectionDisplay — shared types + display helpers for Data Connections.
//
// Extracted from ConnectionsPage so the read-only ConnectionDetailModal can
// render the exact same badges, config summary and relative timestamps the
// list does, without the page↔component importing each other (which would be
// a circular dependency on the runtime helpers below).
// ──────────────────────────────────────────────────────────────────────────

export interface ConnectionProfile {
  id: string;
  orgId: string;
  /** All systems this connection serves (many-to-many). Populated by
   *  the backend from the connectionSystemLinks join table. */
  systemIds?: string[];
  name: string;
  connectionType: string;
  config: Record<string, any> & {
    // LOCAL file storage fields populated by the upload endpoint
    localFilePath?: string;
    originalFileName?: string;
    fileSize?: number;
    rowCount?: number;
    columns?: string[];
    lastUploadedAt?: string;
  };
  credentials: Record<string, any>;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'UNTESTED';
  lastTestedAt: string | null;
  lastTestResult: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SystemEntity {
  id: string;
  name: string;
  description: string;
  systemType: string;
}

export const STATUS_BADGES: Record<string, { bg: string; color: string }> = {
  CONNECTED: { bg: '#d1f0eb', color: '#0f4f46' },
  DISCONNECTED: { bg: '#f1f5f9', color: '#64748b' },
  ERROR: { bg: '#fce7f3', color: '#9d174d' },
  UNTESTED: { bg: '#fef3c7', color: '#92400e' },
};

export const TYPE_BADGES: Record<string, { bg: string; color: string }> = {
  DATABASE: { bg: '#dbeafe', color: '#1e40af' },
  FILE_STORAGE: { bg: '#fef3c7', color: '#92400e' },
  API: { bg: '#d1f0eb', color: '#0f4f46' },
  DATA_WAREHOUSE: { bg: '#ede9fe', color: '#5b21b6' },
  SPREADSHEET: { bg: '#f1f5f9', color: '#64748b' },
};

export const TYPE_LABELS: Record<string, string> = {
  DATABASE: 'Database',
  FILE_STORAGE: 'File Storage',
  API: 'API',
  DATA_WAREHOUSE: 'Data Warehouse',
  SPREADSHEET: 'Spreadsheet',
};

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function configSummary(conn: ConnectionProfile): string {
  const c = conn.config;
  if (conn.connectionType === 'DATABASE') {
    const parts = [c.host, c.port ? `:${c.port}` : '', c.database ? `/${c.database}` : ''];
    return parts.join('') || '--';
  }
  if (conn.connectionType === 'FILE_STORAGE') {
    if (c.storageType === 'LOCAL') {
      return c.originalFileName
        ? `LOCAL://${c.originalFileName} (${formatBytes(c.fileSize)})`
        : 'LOCAL (no file uploaded)';
    }
    return c.bucket ? `${c.storageType || ''}://${c.bucket}${c.path ? '/' + c.path : ''}` : '--';
  }
  if (conn.connectionType === 'API') return c.baseUrl || '--';
  if (conn.connectionType === 'DATA_WAREHOUSE') {
    return c.account ? `${c.warehouseType || ''}://${c.account}${c.warehouse ? '/' + c.warehouse : ''}` : '--';
  }
  if (conn.connectionType === 'SPREADSHEET') return c.documentUrl || '--';
  return '--';
}

export function timeAgo(iso: string | null): string {
  if (!iso) return '--';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
