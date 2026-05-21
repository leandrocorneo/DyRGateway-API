import Redis from 'ioredis';
import { config } from '../config/env';

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  lazyConnect: true,
});

export const connectRedis = async () => {
  try {
    await redis.connect();
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    process.exit(1);
  }
};

export const disconnectRedis = async () => {
  await redis.quit();
};