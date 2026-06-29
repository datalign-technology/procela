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
import scimRouter from './routes/scim';
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
import connectorsRouter from './routes/connectors';
import tagsRouter from './routes/tags';
import commentsRouter from './routes/comments';
import notificationsRouter from './routes/notifications';
import savedViewsRouter from './routes/saved-views';
import dbtCloudConnectionsRouter from './routes/dbt-cloud-connections';
import trendsRouter from './routes/trends';
import maturityTrendsRouter from './routes/maturity-trends';
import backupRouter from './routes/backup';
import dataLineageRouter from './routes/data-lineage';
import dataQualityRouter from './routes/data-quality';
import connectionsRouter from './routes/connections';
import enterpriseViewRouter from './routes/enterprise-view';
import analysisRouter from './routes/analysis';
import analysisReportsRouter from './routes/analysis-reports';
import gapDetectionRouter from './routes/gap-detection';
import attachmentsRouter from './routes/attachments';
import brandingRouter from './routes/branding';
import syncConnectionsRouter from './routes/sync-connections';
import governancePoliciesRouter from './routes/governance-policies';
import governanceControlsRouter from './routes/governance-controls';
import governanceTasksRouter from './routes/governance-tasks';
import governanceIssuesRouter from './routes/governance-issues';
import controlTowerRouter from './routes/control-tower';
import governanceProgramRouter from './routes/governance-program';
import governanceCalendarRouter from './routes/governance-calendar';
import decisionRightsRouter from './routes/decision-rights';
import sopsRouter from './routes/sops';
import businessGlossaryRouter from './routes/business-glossary';
import operationsManualsRouter from './routes/operations-manuals';
import skillsRouter from './routes/skills';
import agentExecutionsRouter from './routes/agent-executions';
import agentSchedulesRouter from './routes/agent-schedules';

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
// SCIM 2.0 lives at /scim/v2 per spec convention (not under /api/v1).
// Bearer-token auth is enforced inside the router — no Express-level
// authenticateToken middleware because SCIM uses its own static token
// rather than Procela's user-issued JWTs.
app.use('/scim/v2', scimRouter);
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
// Connectors router handles its own auth — admin endpoints take a
// user JWT, agent endpoints take a connector token (pct_…) — so it
// mounts without the global authenticateToken middleware.
app.use('/api/v1/connectors', connectorsRouter);
app.use('/api/v1/search', authenticateToken, searchRouter);
app.use('/api/v1/governance-groups', authenticateToken, governanceGroupsRouter);
app.use('/api/v1/dama-roles', authenticateToken, damaRolesRouter);
app.use('/api/v1/data-domains', authenticateToken, dataDomainsRouter);
app.use('/api/v1/tags', authenticateToken, tagsRouter);
app.use('/api/v1/comments', authenticateToken, commentsRouter);
app.use('/api/v1/notifications', authenticateToken, notificationsRouter);
app.use('/api/v1/saved-views', authenticateToken, savedViewsRouter);
app.use('/api/v1/dbt-cloud-connections', authenticateToken, dbtCloudConnectionsRouter);
app.use('/api/v1/trends', authenticateToken, trendsRouter);
app.use('/api/v1/maturity-trends', authenticateToken, maturityTrendsRouter);
app.use('/api/v1/backup', authenticateToken, backupRouter);
app.use('/api/v1/data-lineage', authenticateToken, dataLineageRouter);
app.use('/api/v1/data-quality', authenticateToken, dataQualityRouter);
app.use('/api/v1/connections', authenticateToken, connectionsRouter);
app.use('/api/v1/enterprise-view', authenticateToken, enterpriseViewRouter);
app.use('/api/v1/analysis', authenticateToken, analysisRouter);
app.use('/api/v1/analysis-reports', authenticateToken, analysisReportsRouter);
app.use('/api/v1/gap-detection', authenticateToken, gapDetectionRouter);
app.use('/api/v1/attachments', authenticateToken, attachmentsRouter);
app.use('/api/v1/sync-connections', authenticateToken, syncConnectionsRouter);
app.use('/api/v1/governance-policies', authenticateToken, governancePoliciesRouter);
app.use('/api/v1/governance-controls', authenticateToken, governanceControlsRouter);
app.use('/api/v1/governance-tasks', authenticateToken, governanceTasksRouter);
app.use('/api/v1/governance-issues', authenticateToken, governanceIssuesRouter);
app.use('/api/v1/control-tower', authenticateToken, controlTowerRouter);
app.use('/api/v1/governance-program', authenticateToken, governanceProgramRouter);
app.use('/api/v1/governance-calendar', authenticateToken, governanceCalendarRouter);
app.use('/api/v1/decision-rights', authenticateToken, decisionRightsRouter);
app.use('/api/v1/sops', authenticateToken, sopsRouter);
app.use('/api/v1/business-glossary', authenticateToken, businessGlossaryRouter);
app.use('/api/v1/operations-manuals', authenticateToken, operationsManualsRouter);
app.use('/api/v1/skills', authenticateToken, skillsRouter);
app.use('/api/v1/agent-executions', authenticateToken, agentExecutionsRouter);
app.use('/api/v1/agent-schedules', authenticateToken, agentSchedulesRouter);

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
import { governancePrograms } from './routes/governance-program';
import { calendarEvents } from './routes/governance-calendar';
import { decisionRights } from './routes/decision-rights';
import { sops } from './routes/sops';
import { glossaryTerms } from './routes/business-glossary';
import { operationsManuals } from './routes/operations-manuals';
import { skills } from './routes/skills';
import { agentExecutions } from './routes/agent-executions';
import { connectors, connectorEvents } from './routes/connectors';

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
  governancePrograms: () => governancePrograms,
  calendarEvents: () => calendarEvents,
  decisionRights: () => decisionRights,
  sops: () => sops,
  glossaryTerms: () => glossaryTerms,
  operationsManuals: () => operationsManuals,
  skills: () => skills,
  agentExecutions: () => agentExecutions,
  connectors: () => connectors,
  connectorEvents: () => connectorEvents,
};
// One-time data migrations. Each one is responsible for its own
// flag-file gating so they only run once per environment, and for
// catching its own errors so the server still starts even if a
// migration is buggy.
import { runGovernanceDocsMigration } from './migrations/2026-05-governance-docs';
import { runResponsibleRoleCdoMigration } from './migrations/2026-05-responsible-role-cdo';
runGovernanceDocsMigration();
runResponsibleRoleCdoMigration();

const autoSaveHandle = startAutoSave(stores);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = config.port;

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, env: config.nodeEnv }, 'Procela server started');
  warnOnMissingProdConfig();
});

// Production-config readiness check. Runs once at boot, after the
// server starts listening, so a misconfigured prod env surfaces in
// the very first log lines rather than silently degrading the first
// time a user hits an affected route. Each missing var falls back to
// a safe-but-degraded default (in-memory rate limiter, audit-log
// reset tokens, dev JWT secret) — none crash the process, so the
// signal MUST be in the log.
function warnOnMissingProdConfig(): void {
  if (config.nodeEnv !== 'production') return;
  const missing: Array<{ name: string; impact: string }> = [];
  if (!config.redisUrl) {
    missing.push({ name: 'REDIS_URL', impact: 'rate limiter falls back to per-instance in-memory counters (multi-instance brute-force protection is broken)' });
  }
  if (!config.smtpHost || !config.smtpUser || !config.smtpPass || !config.mailFrom || !config.appUrl) {
    missing.push({ name: 'SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_FROM / APP_URL', impact: 'password-reset emails fall back to logging the token in the audit feed (not delivered to the user)' });
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-in-production') {
    missing.push({ name: 'JWT_SECRET', impact: 'sessions are signed with the development default — anyone with the source can forge tokens' });
  }
  if (!config.anthropicApiKey) {
    missing.push({ name: 'ANTHROPIC_API_KEY', impact: 'AI features (template generation, suggestions, assistant) will fail when invoked' });
  }
  if (missing.length === 0) {
    logger.info('Production config: all expected env vars are set');
    return;
  }
  for (const m of missing) {
    logger.warn({ envVar: m.name, impact: m.impact }, 'Production config: missing env var');
  }
}

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
