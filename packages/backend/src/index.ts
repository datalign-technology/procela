import dotenv from 'dotenv';
import path from 'path';

// Load .env from two places, in precedence order (last one loaded
// wins, per dotenv's override:true). Priority: backend workspace
// override → monorepo root default. `__dirname` at runtime is
// `packages/backend/src` under tsx watch, `packages/backend/dist`
// after a production build — the resolved paths point at the same
// file either way.
//
// Previous incarnation used `../..` and `../../../..` which
// resolve to `packages/` and one level ABOVE the repo root
// respectively — neither is where any `.env` file actually lives,
// so environment variables silently fell through to whatever the
// shell exported. That's exactly the ghost-key symptom we chased
// while diagnosing the AI probe failing after key rotation.
const REPO_ROOT_ENV = path.resolve(__dirname, '..', '..', '..', '.env');
const BACKEND_ENV = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: REPO_ROOT_ENV, override: true });
dotenv.config({ path: BACKEND_ENV, override: true });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import config from './config';
import logger from './lib/logger';
import { startAutoSave, flushStores } from './lib/persistence';
import { hasDatabase } from './db/prisma';
import { errorHandler } from './middleware/errorHandler';
import { authenticateToken } from './middleware/auth';
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import { initAuthProviders } from './services/auth-providers';
import { initOrgScope } from './lib/org-scope';
import scimRouter from './routes/scim';
import aiRouter from './routes/ai';
import { enforceAiBudget } from './middleware/ai-budget';
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
import exportsRouter from './routes/exports';
import digestRouter from './routes/digest';
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
import adminRouter from './routes/admin';
import controlTowerRouter from './routes/control-tower';
import governanceProgramRouter from './routes/governance-program';
import governanceCalendarRouter from './routes/governance-calendar';
import decisionRightsRouter from './routes/decision-rights';
import sopsRouter from './routes/sops';
import businessGlossaryRouter from './routes/business-glossary';
import operationsManualsRouter from './routes/operations-manuals';
import skillsRouter from './routes/skills';
import dataModelRouter from './routes/data-model';
import reportsRouter from './routes/reports';
import agentExecutionsRouter from './routes/agent-executions';
import agentSchedulesRouter from './routes/agent-schedules';

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
// ── CORS ──
// Production-safe allowlist driven by APP_URL + CORS_ALLOWED_ORIGINS
// env. Defaults to permissive in dev (no APP_URL configured) so
// localhost workflows aren't broken. Adds explicit credentials: true
// because the frontend sends Authorization headers.
const corsOrigins: string[] = [];
if (config.appUrl) corsOrigins.push(config.appUrl.replace(/\/$/, ''));
if (process.env.CORS_ALLOWED_ORIGINS) {
  for (const o of process.env.CORS_ALLOWED_ORIGINS.split(',')) {
    const t = o.trim().replace(/\/$/, '');
    if (t) corsOrigins.push(t);
  }
}
app.use(cors({
  origin: corsOrigins.length === 0
    ? true                       // dev fallback — echo the request origin
    : (origin, cb) => {
        // Server-to-server / curl requests have no Origin header — let
        // them through; CORS is a browser-side guard, not an auth
        // guard, and authenticateToken still runs.
        if (!origin) return cb(null, true);
        cb(null, corsOrigins.includes(origin.replace(/\/$/, '')));
      },
  credentials: true,
}));

// ── Helmet (security headers) ──
// Default Helmet covers most of OWASP's recommended response headers;
// the explicit config here pins the ones reviewers ask about so an
// audit doesn't have to chase "what version was installed when?"
// HSTS only meaningful behind HTTPS (production); turned off in dev
// so a self-signed local server doesn't hand out a long-lived header
// the browser will then enforce.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // The frontend bundles itself; no third-party scripts. Style
      // 'unsafe-inline' is needed because Vite/React inline some
      // critical CSS on first paint — re-evaluate once we move to
      // CSS modules / a strict-nonce setup. img-src 'self' data:
      // covers the QR codes the MFA enrollment endpoint returns as
      // data URLs.
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"], // matches frameguard below
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
    },
  },
  hsts: config.nodeEnv === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: false }
    : false,
  frameguard: { action: 'deny' },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Cross-origin policies — keep loose for now since the dev proxy
  // serves the frontend from a different origin in development;
  // production behind one origin should set these stricter via env.
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
}));
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(compression());
// Default JSON body limit is 100kb — too small for branding logos uploaded
// as data: URLs. Raise to 2MB so customers can inline a reasonable PNG.
app.use(express.json({ limit: '2mb' }));
// SAML's ACS endpoint receives application/x-www-form-urlencoded
// posts from IdPs — the SAMLResponse field is base64-encoded XML in
// the body. Register the urlencoded parser globally; the limit
// matches the JSON parser so neither is the bottleneck.
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

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
app.use('/api/v1/ai', authenticateToken, enforceAiBudget, aiRouter);
app.use('/api/v1/chat', authenticateToken, enforceAiBudget, chatRouter);
app.use('/api/v1/audit', authenticateToken, auditRouter);
// Connectors router handles its own auth — admin endpoints take a
// user JWT, agent endpoints take a connector token (pct_…) — so it
// mounts without the global authenticateToken middleware.
app.use('/api/v1/connectors', connectorsRouter);
app.use('/api/v1/exports', authenticateToken, exportsRouter);
app.use('/api/v1/digest', authenticateToken, digestRouter);
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
app.use('/api/v1/admin', authenticateToken, adminRouter);
app.use('/api/v1/control-tower', authenticateToken, controlTowerRouter);
app.use('/api/v1/governance-program', authenticateToken, governanceProgramRouter);
app.use('/api/v1/governance-calendar', authenticateToken, governanceCalendarRouter);
app.use('/api/v1/decision-rights', authenticateToken, decisionRightsRouter);
app.use('/api/v1/sops', authenticateToken, sopsRouter);
app.use('/api/v1/business-glossary', authenticateToken, businessGlossaryRouter);
app.use('/api/v1/operations-manuals', authenticateToken, operationsManualsRouter);
app.use('/api/v1/skills', authenticateToken, skillsRouter);
app.use('/api/v1/data-model', authenticateToken, dataModelRouter);
app.use('/api/v1/reports', authenticateToken, reportsRouter);
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
import { initBranding } from './routes/branding';
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
import { connectors, connectorEvents, scanForOfflineConnectors } from './routes/connectors';
import { startScheduler, stopScheduler } from './services/scheduler.service';

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

// Persistence mode. When DATABASE_URL is set, the repositories route
// reads and writes to Postgres and the module-level JSON arrays are no
// longer the source of truth — they hold only stale boot-state. The
// JSON autosave timer must NOT run in that mode: it would periodically
// (every 10s) overwrite `.procela-data/*.json` with those stale/empty
// arrays, silently destroying any JSON backup on disk. So the timer —
// and the shutdown flush below — are gated on JSON mode only. Direct
// per-handler `saveStore` calls are retired as each subsystem migrates
// to its repository (see docs/POSTGRES_CUTOVER_PLAN.md).
const persistenceMode = hasDatabase() ? 'postgres' : 'json';
logger.info({ persistenceMode }, 'Persistence mode resolved');
const autoSaveHandle = hasDatabase() ? null : startAutoSave(stores);

// Offline-connector scan. Walks the connector store every 5 min
// and flips any row whose last heartbeat is older than the OFFLINE
// threshold (4h) into status=OFFLINE, writing one notification per
// transition. The scan itself is cheap (in-memory loop); 5 min
// gives admins reasonably prompt notice without spamming on minute
// boundaries. Disabled in tests by NODE_ENV=test so the suite
// doesn't fight a background timer.
const OFFLINE_SCAN_INTERVAL_MS = 5 * 60 * 1000;
const offlineScanHandle = config.nodeEnv === 'test'
  ? null
  : setInterval(() => {
      void (async () => {
      try {
        const { transitioned } = await scanForOfflineConnectors();
        if (transitioned > 0) {
          logger.info({ transitioned }, 'Offline-connector scan flipped silent rows');
        }
      } catch (err) {
        logger.error({ err }, 'Offline-connector scan threw');
      }
      })();
    }, OFFLINE_SCAN_INTERVAL_MS);
offlineScanHandle?.unref();

// Overdue-task sweep + weekly digest. See services/scheduler.service.ts
// — 1h tick, disabled in tests (NODE_ENV=test) and via
// PROCELA_DISABLE_SCHEDULER=1.
startScheduler();

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = config.port;

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, env: config.nodeEnv }, 'Procela server started');
  warnOnMissingProdConfig();
  pingAiModel().catch(() => { /* logged inside */ });
  // Hydrate persisted auth config + OIDC providers into the in-memory
  // auth state so the sync read API serves them (PR 3c). Env-bootstrapped
  // providers already loaded at module import; this augments/overrides.
  initAuthProviders().catch((err) => logger.error({ err }, 'initAuthProviders failed'));
  // Hydrate the org-scope cache from the repo so visibility filtering is
  // correct in Postgres mode (PR 4). No-op in JSON mode.
  initOrgScope().catch((err) => logger.error({ err }, 'initOrgScope failed'));
  // Hydrate branding config from persistence (PR 7).
  initBranding().catch((err) => logger.error({ err }, 'initBranding failed'));
});

// Startup AI probe. Fires one cheap 1-token /messages call to
// verify the currently-resolved model is actually reachable by the
// configured API key. Would have caught the past three model-ID
// drifts (claude-sonnet-4-6, claude-sonnet-5,
// claude-3-7-sonnet-latest) at boot instead of at first user
// click.
//
// Default is fire-and-forget with a loud logger.error on failure so
// operators see the problem in Kibana / CloudWatch / stdout without
// crashing the container (a broken AI key shouldn't take down the
// non-AI parts of the app). Set FAIL_FAST_ON_AI_PROBE=1 to promote
// the failure into a hard exit — useful in a health-check-gated
// deployment where you'd rather roll back than serve traffic with a
// dead AI backend. Enabled by default in production when the API
// key is configured.
import { getConfiguredModel } from './services/ai.service';
// Known-good Anthropic model IDs surfaced in the error message so an
// operator hitting an invalid-model error has an immediately-runnable
// fix to try. Kept short + current — bump alongside real model
// releases, or override in-app via Settings → AI. See the model-drift
// history in the pingAiModel comment above.
const SUGGESTED_MODEL_IDS = [
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-haiku-4-5-20251001',
] as const;
async function pingAiModel(): Promise<void> {
  const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    logger.info('AI: API key not configured — skipping startup model probe');
    return;
  }
  const model = getConfiguredModel();
  const failFast = process.env.FAIL_FAST_ON_AI_PROBE === '1'
    || (config.nodeEnv === 'production' && process.env.FAIL_FAST_ON_AI_PROBE !== '0');
  const bail = (msg: string, ctx: Record<string, unknown>): void => {
    if (failFast) {
      logger.error({ ...ctx, tryOneOf: SUGGESTED_MODEL_IDS }, `${msg} — exiting (set FAIL_FAST_ON_AI_PROBE=0 to skip)`);
      process.exit(1);
    }
    logger.error({ ...ctx, tryOneOf: SUGGESTED_MODEL_IDS }, `${msg} — set ANTHROPIC_MODEL to a supported id or configure via Settings → AI`);
  };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
    });
    if (res.ok) {
      logger.info({ model }, 'AI: startup probe succeeded');
      return;
    }
    const text = await res.text().catch(() => '');
    bail('AI: startup probe failed', { model, status: res.status, response: text.slice(0, 300) });
  } catch (err) {
    bail('AI: startup probe threw (network error)', { err, model });
  }
}

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
  // JWT signing: RS256 (private + public PEM) is preferred; HS256 is
  // acceptable for a single-node install but the shared secret must
  // not be the dev default. Warn on either the dev-default secret or
  // on HS256 in production without an explicit acknowledgement.
  const hasRsa = !!process.env.JWT_PRIVATE_KEY && !!process.env.JWT_PUBLIC_KEY;
  if (!hasRsa) {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-in-production') {
      missing.push({ name: 'JWT_SECRET', impact: 'sessions are signed with the development default — anyone with the source can forge tokens' });
    } else {
      missing.push({ name: 'JWT_PRIVATE_KEY / JWT_PUBLIC_KEY', impact: 'signing with HS256 (symmetric secret). Anyone with the secret can forge tokens; downstream services cannot verify without sharing it. Set both RSA PEMs to sign with RS256 and publish a JWKS at /api/v1/auth/jwks.json' });
    }
  }
  if (!config.anthropicApiKey) {
    missing.push({ name: 'ANTHROPIC_API_KEY', impact: 'AI features (template generation, suggestions, assistant) will fail when invoked' });
  }
  if (!process.env.MFA_ENCRYPTION_KEY) {
    missing.push({ name: 'MFA_ENCRYPTION_KEY', impact: 'TOTP secrets are stored in plaintext on the Person record — a database leak exposes every enrolled user\'s second factor' });
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
  if (autoSaveHandle) clearInterval(autoSaveHandle);
  if (offlineScanHandle) clearInterval(offlineScanHandle);
  stopScheduler();
  // Only flush JSON stores in JSON mode. In Postgres mode the arrays are
  // stale boot-state and flushing them would clobber the JSON files.
  if (!hasDatabase()) flushStores(stores);
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
