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
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',

  // AI
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

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

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
} as const;

export default config;
