/**
 * Mock Connector Service
 *
 * Simulates connecting to external data sources and discovering assets.
 * In production this would use real drivers (pg, mysql2, @azure/storage-blob, etc.).
 */

export interface ConnectorResult {
  success: boolean;
  message: string;
  latencyMs: number;
  details?: {
    version?: string;
    tableCount?: number;
    assets?: Array<{ name: string; type: string; rowCount?: number; lastModified?: string }>;
  };
}

export interface ConnectionProfileLike {
  connectionType: string;
  config: {
    dbType?: string;
    host?: string;
    port?: number;
    database?: string;
    schema?: string;
    storageType?: string;
    bucket?: string;
    path?: string;
    baseUrl?: string;
    authType?: string;
    warehouseType?: string;
    account?: string;
    warehouse?: string;
    spreadsheetType?: string;
    documentUrl?: string;
  };
  credentials?: {
    username?: string;
    password?: string;
    apiKey?: string;
    token?: string;
  };
}

export async function testConnection(profile: ConnectionProfileLike): Promise<ConnectorResult> {
  // Simulate connection test with 200-800ms delay
  await new Promise((r) => setTimeout(r, 200 + Math.random() * 600));

  const hasEndpoint =
    profile.config.host ||
    profile.config.baseUrl ||
    profile.config.bucket ||
    profile.config.documentUrl ||
    profile.config.account;

  if (!hasEndpoint) {
    return { success: false, message: 'No connection endpoint configured', latencyMs: 0 };
  }

  // Simulate occasional failures (10% chance)
  if (Math.random() < 0.1) {
    return { success: false, message: 'Connection timed out', latencyMs: 5000 };
  }

  const target =
    profile.config.host ||
    profile.config.baseUrl ||
    profile.config.bucket ||
    profile.config.account ||
    profile.config.documentUrl;

  const versionMap: Record<string, string> = {
    POSTGRESQL: 'PostgreSQL 16.2',
    MYSQL: 'MySQL 8.0.36',
    SQLSERVER: 'SQL Server 2022',
    ORACLE: 'Oracle 23c',
    MONGODB: 'MongoDB 7.0',
  };

  return {
    success: true,
    message: `Successfully connected to ${target}`,
    latencyMs: Math.round(200 + Math.random() * 600),
    details: {
      version:
        profile.connectionType === 'DATABASE' && profile.config.dbType
          ? versionMap[profile.config.dbType] || 'Unknown'
          : undefined,
    },
  };
}

export async function discoverAssets(profile: ConnectionProfileLike): Promise<ConnectorResult> {
  // Simulate discovery with delay
  await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));

  const hasEndpoint =
    profile.config.host ||
    profile.config.baseUrl ||
    profile.config.bucket ||
    profile.config.documentUrl ||
    profile.config.account;

  if (!hasEndpoint) {
    return { success: false, message: 'No connection endpoint configured', latencyMs: 0 };
  }

  // Generate mock discovered assets based on connection type
  const mockAssets: Array<{ name: string; type: string; rowCount?: number; lastModified?: string }> = [];
  const now = new Date().toISOString();

  if (profile.connectionType === 'DATABASE') {
    mockAssets.push(
      { name: 'customers', type: 'TABLE', rowCount: 45230, lastModified: now },
      { name: 'orders', type: 'TABLE', rowCount: 128450, lastModified: now },
      { name: 'products', type: 'TABLE', rowCount: 3200, lastModified: now },
      { name: 'customer_view', type: 'VIEW', rowCount: 45230 },
    );
  } else if (profile.connectionType === 'FILE_STORAGE') {
    mockAssets.push(
      { name: 'reports/monthly_sales.csv', type: 'FILE', lastModified: now },
      { name: 'exports/customer_data.parquet', type: 'FILE', lastModified: now },
      { name: 'raw/transactions_2024.json', type: 'FILE', lastModified: now },
    );
  } else if (profile.connectionType === 'API') {
    mockAssets.push(
      { name: '/api/customers', type: 'ENDPOINT' },
      { name: '/api/orders', type: 'ENDPOINT' },
      { name: '/api/products', type: 'ENDPOINT' },
    );
  } else if (profile.connectionType === 'DATA_WAREHOUSE') {
    mockAssets.push(
      { name: 'analytics.fact_sales', type: 'TABLE', rowCount: 2450000, lastModified: now },
      { name: 'analytics.dim_customer', type: 'TABLE', rowCount: 89200, lastModified: now },
      { name: 'staging.raw_events', type: 'TABLE', rowCount: 15000000, lastModified: now },
      { name: 'reporting.monthly_kpi', type: 'VIEW', rowCount: 360 },
    );
  } else if (profile.connectionType === 'SPREADSHEET') {
    mockAssets.push(
      { name: 'Sheet1 - Revenue Tracker', type: 'SHEET', rowCount: 1200 },
      { name: 'Sheet2 - Cost Breakdown', type: 'SHEET', rowCount: 340 },
    );
  }

  return {
    success: true,
    message: `Discovered ${mockAssets.length} assets`,
    latencyMs: Math.round(500 + Math.random() * 1000),
    details: { tableCount: mockAssets.length, assets: mockAssets },
  };
}
