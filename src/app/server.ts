import Fastify from 'fastify';
import { config } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../database/prisma';
import { connectRedis, disconnectRedis } from '../cache/redis';
import healthRoutes from '../modules/health/health.route';

const app = Fastify({
  logger: true,
});

app.register(healthRoutes, {
  prefix: '/api',
});

const gracefulShutdown = async (signal: string) => {
  await app.close();
  await disconnectDatabase();
  await disconnectRedis();
  process.exit(0);
};

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => gracefulShutdown(signal));
});

const start = async () => {
  try {
    await connectDatabase();
    await connectRedis();

    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();