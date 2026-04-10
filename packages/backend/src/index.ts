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
import { startAutoSave } from './lib/persistence';
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

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(helmet());
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(compression());
app.use(express.json());

// ---------------------------------------------------------------------------
// Routes — Public (no auth required)
// ---------------------------------------------------------------------------
app.use('/api/v1/health', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/docs', docsRouter);

// ---------------------------------------------------------------------------
// Routes — Protected (require valid access token)
// ---------------------------------------------------------------------------
app.use('/api/v1/organizations', authenticateToken, organizationsRouter);
app.use('/api/v1/people', authenticateToken, peopleRouter);
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

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Auto-save persistence
// ---------------------------------------------------------------------------
import { processNodes, flowRelationships, processVersions } from './routes/process-catalog';
import { systems } from './routes/systems';
import { dataAssets } from './routes/data-assets';
import { organizations } from './routes/organizations';
import { people } from './routes/people';
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

startAutoSave({
  processNodes: () => processNodes,
  flowRelationships: () => flowRelationships,
  processVersions: () => processVersions,
  systems: () => systems,
  dataAssets: () => dataAssets,
  organizations: () => organizations,
  people: () => people,
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
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = config.port;

app.listen(PORT, () => {
  logger.info({ port: PORT, env: config.nodeEnv }, 'Procela server started');
});

export default app;
