import Redis from 'ioredis';
import { config } from '../config/env';
import { metricsRegistry } from '../monitoring/core/registry';

export const redis = new Redis({ host: config.redis.host, port: config.redis.port, lazyConnect: true });

const originalSendCommand = redis.sendCommand.bind(redis);
redis.sendCommand = ((command: any, stream?: any) => {
  const started = performance.now();
  const operation = String(command?.name || 'command').toUpperCase();
  const result = originalSendCommand(command, stream) as Promise<unknown>;
  result.then(
    () => metricsRegistry.recordDependency('redis', operation, performance.now() - started, false, config.monitoring.slowRedisMs),
    () => metricsRegistry.recordDependency('redis', operation, performance.now() - started, true, config.monitoring.slowRedisMs)
  );
  return result;
}) as typeof redis.sendCommand;

export const connectRedis = async () => {
  try { await redis.connect(); }
  catch (error) { console.error('Failed to connect to Redis:', error); process.exit(1); }
};

export const disconnectRedis = async () => { await redis.quit(); };
