import { FastifyInstance } from 'fastify';
import MonitoringService from './monitoring.service';

type Query = { range?: string; container?: string };

export default async function monitoringRoutes(fastify: FastifyInstance) {
  const service = new MonitoringService();
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get<{ Querystring: Query }>('/monitoring/overview', auth, async (request) => service.overview(request.query.range));
  fastify.get<{ Querystring: Query }>('/monitoring/api', auth, async (request) => service.api(request.query.range));
  fastify.get<{ Querystring: Query }>('/monitoring/api/endpoints', auth, async (request) => {
    const result = await service.api(request.query.range);
    return { meta: result.meta, current: result.current, summary: result.summary, series: [], breakdown: result.breakdown };
  });
  fastify.get<{ Querystring: Query }>('/monitoring/redis', auth, async (request) => {
    const [infra, dependencies] = await Promise.all([service.infrastructure('redis', request.query.range), service.dependencies('redis', request.query.range)]);
    return { ...infra, summary: { infrastructure: infra.summary, commands: dependencies.summary }, breakdown: dependencies.breakdown };
  });
  fastify.get<{ Querystring: Query }>('/monitoring/database', auth, async (request) => {
    const [infra, dependencies] = await Promise.all([service.infrastructure('database', request.query.range), service.dependencies('database', request.query.range)]);
    return { ...infra, summary: { infrastructure: infra.summary, queries: dependencies.summary }, breakdown: dependencies.breakdown };
  });
  fastify.get<{ Querystring: Query }>('/monitoring/containers', auth, async (request) =>
    service.infrastructure(request.query.container ? 'container:' + request.query.container : 'container:', request.query.range));
}
