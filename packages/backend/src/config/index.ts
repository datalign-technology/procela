import dotenv from 'dotenv';
import path from 'path';

// Try multiple locations for .env: backend dir, then monorepo root
dotenv.config({ path: path.resolve(__dirname, '../..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../..', '.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/procela',

  // Auth
  authProvider: process.env.AUTH_PROVIDER || 'dev',
  cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID || '',
  cognitoClientId: process.env.COGNITO_CLIENT_ID || '',
  cognitoRegion: process.env.COGNITO_REGION || 'us-east-1',
  // JWT signing configuration. Two modes:
  //   HS256 (symmetric) — set JWT_SECRET; simple, single-node friendly,
  //     but anyone with the secret can forge tokens (dev + tests).
  //   RS256 (asymmetric) — set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY as
  //     PEM strings; downstream verifiers only need the public key,
  //     which is also published at /api/v1/auth/jwks.json for
  //     external services (an edge proxy, a data-lake token gate,
  //     etc.) to fetch. Production installs SHOULD use RS256.
  // The algorithm resolves to RS256 when both PEMs are set, else
  // HS256. Explicit JWT_ALGORITHM=HS256 forces HS256 even when the
  // PEMs are present (useful during a rotation).
  jwtAlgorithm: process.env.JWT_ALGORITHM || '',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtPrivateKey: process.env.JWT_PRIVATE_KEY || '',
  jwtPublicKey: process.env.JWT_PUBLIC_KEY || '',
  // JWKS key id — surfaced in the JWT header and in the JWKS
  // response so consumers can pick the right key across rotations.
  jwtKid: process.env.JWT_KID || 'procela-1',

  // AI
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  // Master switch for every AI integration feature (industry template
  // generation, data-domain + asset suggestions, the sensitivity
  // classifier, the AI assistant, and governance AI agents). Defaults
  // ON; set AI_FEATURES_ENABLED=false to turn them off entirely —
  // the backend refuses the AI endpoints and the frontend hides their
  // UI. For deployments (on-prem / FedRAMP) that must not call an
  // external model, this is the single knob.
  aiFeaturesEnabled: process.env.AI_FEATURES_ENABLED !== 'false',
  // Anthropic model used for every server-side Claude call (process
  // template generation, data-domain suggestions, asset suggestions,
  // governance activity runs, chat). Override with ANTHROPIC_MODEL
  // env or Settings → AI (in-app admin override; wins over env).
  // Default is Claude 5-family Sonnet — the current best cost /
  // capability trade for most Procela calls. Bump in step with new
  // releases. The value ships to the Anthropic SDK verbatim, so a
  // typo here shows up as an invalid-model error on first call;
  // the boot-time probe in index.ts catches this at startup, and
  // FAIL_FAST_ON_AI_PROBE=1 promotes it to a hard exit for
  // deployment-gated rollouts. Supported ids as of this release:
  //   claude-sonnet-5, claude-opus-4-8, claude-haiku-4-5-20251001
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',

  // Storage
  storageProvider: process.env.STORAGE_PROVIDER || 'local',
  s3Bucket: process.env.S3_BUCKET || '',
  s3Region: process.env.S3_REGION || 'us-east-1',

  // Redis — empty string means "not configured". Rate limiter falls
  // back to in-memory when empty. The previous default of
  // redis://localhost:6379 hid the misconfiguration: production
  // would try (and fail) to connect to a localhost Redis that doesn't
  // exist, then silently downgrade. Empty + boot-time warning makes
  // the state explicit.
  redisUrl: process.env.REDIS_URL || '',

  // Mail — production deployments must set these for password reset
  // emails to be delivered. When any are missing, /auth/password/forgot
  // falls back to logging the token to the audit trail (dev path).
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpSecure: process.env.SMTP_SECURE === 'true',
  mailFrom: process.env.MAIL_FROM || '',
  appUrl: process.env.APP_URL || '',

  // Support inbox — where in-app "Report a problem" submissions are
  // emailed. Defaults to Procela's own support inbox; override with
  // SUPPORT_EMAIL to route to a customer-managed inbox. Delivery still
  // requires SMTP to be configured — without it, reports are recorded to
  // the audit trail only (same audit-only fallback as password reset).
  // Strip a trailing inline comment defensively: this value is used verbatim
  // as the email recipient, so an env line like `SUPPORT_EMAIL=addr # note`
  // that slips past .env parsing must not poison the To address.
  supportEmail: (process.env.SUPPORT_EMAIL || 'support@procela.ai').replace(/\s+#.*$/, '').trim(),

  // First-run bootstrap — how the very first Super Admin and the primary
  // organization come into existence on a clean database. Everything here is
  // a no-op unless BOOTSTRAP_SUPER_ADMIN_EMAIL is set, and it's applied
  // idempotently at boot, so it's safe to leave configured across restarts.
  bootstrapSuperAdminEmail: (process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || '').trim().toLowerCase(),
  bootstrapSuperAdminName: process.env.BOOTSTRAP_SUPER_ADMIN_NAME || 'Platform Administrator',
  bootstrapOrgName: process.env.BOOTSTRAP_ORG_NAME || 'Procela',
  bootstrapOrgIndustry: process.env.BOOTSTRAP_ORG_INDUSTRY || '',

  // SSO provisioning — where federated (OIDC / SCIM) users land the first
  // time they appear. Default org is the primary org (the bootstrap org);
  // SSO_DOMAIN_ORG_MAP is optional JSON routing specific email domains to
  // specific orgs (and optionally a role), e.g.
  //   {"acme.com":"<orgId>","beta.io":{"orgId":"<orgId>","role":"CONTRIBUTOR"}}
  // SSO_DEFAULT_ROLE applies when the IdP emits no known role claim.
  ssoDefaultOrgId: process.env.SSO_DEFAULT_ORG_ID || '',
  ssoDefaultRole: (process.env.SSO_DEFAULT_ROLE || 'VIEWER').toUpperCase(),
  ssoDomainOrgMap: process.env.SSO_DOMAIN_ORG_MAP || '',

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
} as const;

export default config;
