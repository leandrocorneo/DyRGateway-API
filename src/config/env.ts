import dotenv from 'dotenv';

dotenv.config();

const csv = (value: string | undefined, fallback: string) =>
  (value || fallback).split(',').map((item) => item.trim()).filter(Boolean);

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
  docker: {
    proxyUrl: process.env.DOCKER_PROXY_URL || 'http://docker-proxy:2375',
    controlProxyUrl: process.env.DOCKER_CONTROL_PROXY_URL || 'http://docker-control-proxy:2375',
    actionTimeoutMs: parseInt(process.env.DOCKER_ACTION_TIMEOUT_MS || '15000', 10),
    stopTimeoutSeconds: parseInt(process.env.DOCKER_STOP_TIMEOUT_SECONDS || '10', 10),
    groupActionConcurrency: parseInt(process.env.DOCKER_GROUP_ACTION_CONCURRENCY || '6', 10),
    protectedProjects: csv(process.env.DOCKER_PROTECTED_PROJECTS, 'dyrgatewayapi,dyrgateway'),
    protectedContainerNames: csv(
      process.env.DOCKER_PROTECTED_CONTAINERS,
      'DyRGateway,DyRGateway-Metrics,DyRGateway-DockerProxy,DyRGateway-DockerControlProxy,DyRGateway-Postgres,DyRGateway-Redis,next-app',
    ),
  },
};
