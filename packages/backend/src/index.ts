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

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = config.port;

app.listen(PORT, () => {
  logger.info({ port: PORT, env: config.nodeEnv }, 'Procela server started');
});

export default app;
