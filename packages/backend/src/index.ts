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
// Routes
// ---------------------------------------------------------------------------
app.use('/api/v1/health', healthRouter);

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/organizations', organizationsRouter);
app.use('/api/v1/people', peopleRouter);
app.use('/api/v1/process-catalog', processCatalogRouter);
app.use('/api/v1/data-assets', dataAssetsRouter);
app.use('/api/v1/systems', systemsRouter);
app.use('/api/v1/mappings', mappingsRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/ai', aiRouter);

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
