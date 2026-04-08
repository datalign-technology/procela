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

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
} as const;

export default config;
