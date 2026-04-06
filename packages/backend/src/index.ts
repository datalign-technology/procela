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
import { errorHandler } from './middleware/errorHandler';
import healthRouter from './routes/health';
import aiRouter from './routes/ai';
import processCatalogRouter from './routes/process-catalog';
import systemsRouter from './routes/systems';

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

// Placeholder route groups -- implementations will be added in future modules
app.use('/api/v1/auth', (_req, res) => {
  res.json({ message: 'Auth routes - not yet implemented' });
});
app.use('/api/v1/organizations', (_req, res) => {
  res.json({ message: 'Organization routes - not yet implemented' });
});
app.use('/api/v1/process-catalog', processCatalogRouter);
app.use('/api/v1/data-assets', (_req, res) => {
  res.json({ message: 'Data asset routes - not yet implemented' });
});
app.use('/api/v1/systems', systemsRouter);
app.use('/api/v1/mappings', (_req, res) => {
  res.json({ message: 'Mapping routes - not yet implemented' });
});
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
  console.log(`[Procela] Server running on port ${PORT} (${config.nodeEnv})`);
});

export default app;
