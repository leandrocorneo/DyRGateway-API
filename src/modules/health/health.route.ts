import { FastifyInstance } from 'fastify';
import { prisma } from '../../database/prisma';
import { redis } from '../../cache/redis';

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async (request, reply) => {
    let dbStatus = 'ok';
    let redisStatus = 'ok';

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      dbStatus = 'error';
    }

    try {
      await redis.ping();
    } catch (e) {
      redisStatus = 'error';
    }

    const isHealthy = dbStatus === 'ok' && redisStatus === 'ok';
    const status = isHealthy ? 200 : 503;

    return reply.status(status).send({
      server: 'ok',
      database: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    });
  });
}