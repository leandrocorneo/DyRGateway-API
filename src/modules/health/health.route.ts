import { FastifyInstance } from 'fastify';
import HealthService from './health.service';

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async (request, reply) => {
    const service = new HealthService();
    const { dbStatus, redisStatus, status } = await service.checkHealth();

    return reply.status(status).send({
      server: 'ok',
      database: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    });
  });
}