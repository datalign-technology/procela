import dotenv from 'dotenv';
import path from 'path';

// Try multiple locations for .env: backend dir, then monorepo root
dotenv.config({ path: path.resolve(__dirname, '../..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../..', '.env') });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import config from './config';
import logger from './lib/logger';
import { startAutoSave, flushStores } from './lib/persistence';
import { errorHandler } from './middleware/errorHandler';
import { authenticateToken } from './middleware/auth';
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import aiRouter from './routes/ai';
import processCatalogRouter from './routes/process-catalog';
import systemsRouter from './routes/systems';
import dataAssetsRouter from './routes/data-assets';
import organizationsRouter from './routes/organizations';
import peopleRouter from './routes/people';
import agentsRouter from './routes/agents';
import mappingsRouter from './routes/mappings';
import dashboardRouter from './routes/dashboard';
import chatRouter from './routes/chat';
import auditRouter from './routes/audit';
import searchRouter from './routes/search';
import governanceGroupsRouter from './routes/governance-groups';
import damaRolesRouter from './routes/dama-roles';
import dataDomainsRouter from './routes/data-domains';
import docsRouter from './routes/docs';
import tagsRouter from './routes/tags';
import commentsRouter from './routes/comments';
import notificationsRouter from './routes/notifications';
import trendsRouter from './routes/trends';
import maturityTrendsRouter from './routes/maturity-trends';
import backupRouter from './routes/backup';
import dataLineageRouter from './routes/data-lineage';
import dataQualityRouter from './routes/data-quality';
import connectionsRouter from './routes/connections';
import enterpriseViewRouter from './routes/enterprise-view';
import gapDetectionRouter from './routes/gap-detection';
import attachmentsRouter from './routes/attachments';
import brandingRouter from './routes/branding';
import syncConnectionsRouter from './routes/sync-connections';
import governancePoliciesRouter from './routes/governance-policies';
import governanceControlsRouter from './routes/governance-controls';
import governanceTasksRouter from './routes/governance-tasks';
import governanceIssuesRouter from './routes/governance-issues';
import controlTowerRouter from './routes/control-tower';

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(helmet());
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(compression());
// Default JSON body limit is 100kb — too small for branding logos uploaded
// as data: URLs. Raise to 2MB so customers can inline a reasonable PNG.
app.use(express.json({ limit: '2mb' }));

// ---------------------------------------------------------------------------
// Routes — Public (no auth required)
// ---------------------------------------------------------------------------
app.use('/api/v1/health', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/docs', docsRouter);
// Branding is partially public: the GET is reachable without auth so the
// login screen can apply the customer's theme. The PUT/POST handlers
// inside the router enforce `authenticateToken` themselves.
app.use('/api/v1/branding', brandingRouter);

// ---------------------------------------------------------------------------
// Routes — Protected (require valid access token)
// ---------------------------------------------------------------------------
app.use('/api/v1/organizations', authenticateToken, organizationsRouter);
app.use('/api/v1/people', authenticateToken, peopleRouter);
app.use('/api/v1/agents', authenticateToken, agentsRouter);
app.use('/api/v1/process-catalog', authenticateToken, processCatalogRouter);
app.use('/api/v1/data-assets', authenticateToken, dataAssetsRouter);
app.use('/api/v1/systems', authenticateToken, systemsRouter);
app.use('/api/v1/mappings', authenticateToken, mappingsRouter);
app.use('/api/v1/dashboard', authenticateToken, dashboardRouter);
app.use('/api/v1/ai', authenticateToken, aiRouter);
app.use('/api/v1/chat', authenticateToken, chatRouter);
app.use('/api/v1/audit', authenticateToken, auditRouter);
app.use('/api/v1/search', authenticateToken, searchRouter);
app.use('/api/v1/governance-groups', authenticateToken, governanceGroupsRouter);
app.use('/api/v1/dama-roles', authenticateToken, damaRolesRouter);
app.use('/api/v1/data-domains', authenticateToken, dataDomainsRouter);
app.use('/api/v1/tags', authenticateToken, tagsRouter);
app.use('/api/v1/comments', authenticateToken, commentsRouter);
app.use('/api/v1/notifications', authenticateToken, notificationsRouter);
app.use('/api/v1/trends', authenticateToken, trendsRouter);
app.use('/api/v1/maturity-trends', authenticateToken, maturityTrendsRouter);
app.use('/api/v1/backup', authenticateToken, backupRouter);
app.use('/api/v1/data-lineage', authenticateToken, dataLineageRouter);
app.use('/api/v1/data-quality', authenticateToken, dataQualityRouter);
app.use('/api/v1/connections', authenticateToken, connectionsRouter);
app.use('/api/v1/enterprise-view', authenticateToken, enterpriseViewRouter);
app.use('/api/v1/gap-detection', authenticateToken, gapDetectionRouter);
app.use('/api/v1/attachments', authenticateToken, attachmentsRouter);
app.use('/api/v1/sync-connections', authenticateToken, syncConnectionsRouter);
app.use('/api/v1/governance-policies', authenticateToken, governancePoliciesRouter);
app.use('/api/v1/governance-controls', authenticateToken, governanceControlsRouter);
app.use('/api/v1/governance-tasks', authenticateToken, governanceTasksRouter);
app.use('/api/v1/governance-issues', authenticateToken, governanceIssuesRouter);
app.use('/api/v1/control-tower', authenticateToken, controlTowerRouter);

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Auto-save persistence
// ---------------------------------------------------------------------------
import { processNodes, flowRelationships, processVersions } from './routes/process-catalog';
import { systems } from './routes/systems';
import { dataAssets, dataAssetBindings, dataAssetColumns } from './routes/data-assets';
import { organizations } from './routes/organizations';
import { people } from './routes/people';
import { agents } from './routes/agents';
import { mappings } from './routes/mappings';
import { governanceGroups } from './routes/governance-groups';
import { damaRoles } from './routes/dama-roles';
import { dataDomains } from './routes/data-domains';
import { auditLogs } from './services/audit.service';
import { tags } from './routes/tags';
import { comments } from './routes/comments';
import { notifications } from './routes/notifications';
import { maturitySnapshots } from './routes/maturity-trends';
import { dataLineageLinks } from './routes/data-lineage';
import { dataQualityRules } from './routes/data-quality';
import { connections } from './routes/connections';
import { brandingStoreArray } from './routes/branding';
import { attachments } from './routes/attachments';
import { syncConnections } from './routes/sync-connections';
import { governancePolicies } from './routes/governance-policies';
import { governanceControls } from './routes/governance-controls';
import { governanceTasks } from './routes/governance-tasks';
import { governanceIssues } from './routes/governance-issues';

const stores = {
  processNodes: () => processNodes,
  flowRelationships: () => flowRelationships,
  processVersions: () => processVersions,
  systems: () => systems,
  dataAssets: () => dataAssets,
  dataAssetBindings: () => dataAssetBindings,
  dataAssetColumns: () => dataAssetColumns,
  organizations: () => organizations,
  people: () => people,
  agents: () => agents,
  mappings: () => mappings,
  governanceGroups: () => governanceGroups,
  damaRoles: () => damaRoles,
  dataDomains: () => dataDomains,
  auditLogs: () => auditLogs,
  tags: () => tags,
  comments: () => comments,
  notifications: () => notifications,
  maturitySnapshots: () => maturitySnapshots,
  dataLineageLinks: () => dataLineageLinks,
  dataQualityRules: () => dataQualityRules,
  connections: () => connections,
  syncConnections: () => syncConnections,
  branding: () => brandingStoreArray,
  attachments: () => attachments,
  governancePolicies: () => governancePolicies,
  governanceControls: () => governanceControls,
  governanceTasks: () => governanceTasks,
  governanceIssues: () => governanceIssues,
};
const autoSaveHandle = startAutoSave(stores);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = config.port;

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, env: config.nodeEnv }, 'Procela server started');
});

// Friendly handler for the most common dev-time crash: a previous
// instance still has the port. The default Node error here is a
// stack trace that buries the actionable bit ("port 3001 is taken"),
// so we replace it with a one-line hint and exit non-zero.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(
      { port: PORT },
      `Port ${PORT} is already in use. Another Procela instance is probably running.\n` +
      `  - Quick fix:  npx kill-port ${PORT}\n` +
      `  - Or:         taskkill /F /IM node.exe   (Windows)\n` +
      `                lsof -ti :${PORT} | xargs kill -9   (macOS / Linux)\n` +
      `  - Or set a different port:  PORT=3002 npm run dev`,
    );
    process.exit(1);
  }
  logger.error({ err }, 'HTTP server error');
  process.exit(1);
});

// Graceful shutdown — close the HTTP server, stop the autosave timer,
// and run one final flush so the latest in-memory state hits disk
// before exit. Triggered by Ctrl+C (SIGINT) or `kill <pid>` (SIGTERM)
// and by the nodemon-like restart that tsx --watch does internally.
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  clearInterval(autoSaveHandle);
  flushStores(stores);
  server.close((err) => {
    if (err) logger.error({ err }, 'Error closing HTTP server');
    process.exit(err ? 1 : 0);
  });
  // Hard exit if close() hangs (e.g. a long-poll never finishes).
  setTimeout(() => {
    logger.warn('Force-exiting after 5s shutdown timeout');
    process.exit(1);
  }, 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;
