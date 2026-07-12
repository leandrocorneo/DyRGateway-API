import { FastifyInstance } from 'fastify';
import HealthService from './health.service';

export default async function healthRoutes(fastify: FastifyInstance) {
  const service = new HealthService();

  fastify.get('/health/live', async (_request, reply) =>
    reply.send({ server: 'ok', timestamp: new Date().toISOString(), uptimeSeconds: process.uptime() }));

  fastify.get('/health/ready', { preHandler: [fastify.authenticate] }, async (_request, reply) => {
    const health = await service.checkHealth();
    return reply.status(health.status).send({
      server: 'ok', database: health.dbStatus, redis: health.redisStatus,
      databaseLatencyMs: health.databaseLatencyMs, redisLatencyMs: health.redisLatencyMs,
      timestamp: new Date().toISOString(),
    });
  });

  fastify.get('/health', { preHandler: [fastify.authenticate] }, async (_request, reply) => {
    const health = await service.checkHealth();
    return reply.status(health.status).send({
      server: 'ok', database: health.dbStatus, redis: health.redisStatus,
      timestamp: new Date().toISOString(), uptimeSeconds: health.uptimeSeconds,
      databaseLatencyMs: health.databaseLatencyMs, redisLatencyMs: health.redisLatencyMs,
    });
  });
}
