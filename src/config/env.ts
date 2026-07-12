import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  jwtSecret: process.env.JWT_SECRET || 'defaultsecret',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:9100',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/dyr_gateway',
  monitoring: {
    intervalSeconds: parseInt(process.env.METRICS_INTERVAL_SECONDS || '30', 10),
    retentionDays: parseInt(process.env.METRICS_RETENTION_DAYS || '15', 10),
    proxyTimeoutMs: parseInt(process.env.PROXY_TIMEOUT_MS || '30000', 10),
    slowDatabaseMs: parseInt(process.env.SLOW_DATABASE_MS || '500', 10),
    slowRedisMs: parseInt(process.env.SLOW_REDIS_MS || '100', 10),
    slowUpstreamMs: parseInt(process.env.SLOW_UPSTREAM_MS || '1000', 10),
  },
};
