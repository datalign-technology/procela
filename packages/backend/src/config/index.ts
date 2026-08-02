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
  // emailed. Unset ⇒ reports are still recorded to the audit trail,
  // just not emailed (same audit-only fallback as password reset).
  supportEmail: process.env.SUPPORT_EMAIL || '',

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
} as const;

export default config;
