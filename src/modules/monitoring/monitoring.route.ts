import { FastifyInstance } from 'fastify';
import MonitoringService from './monitoring.service';
import { ContainerCatalogQuery, ContainerHistoryQuery, MonitoringQueryError } from './monitoring.types';

type RangeQuery = { range?: string };
type ContainerParams = { id: string };

export default async function monitoringRoutes(fastify: FastifyInstance) {
  const service = new MonitoringService();
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get<{ Querystring: RangeQuery }>('/monitoring/overview', auth, async (request) => service.overview(request.query.range));
  fastify.get<{ Querystring: RangeQuery }>('/monitoring/api', auth, async (request) => service.api(request.query.range));
  fastify.get<{ Querystring: RangeQuery }>('/monitoring/api/endpoints', auth, async (request) => {
    const result = await service.api(request.query.range);
    return { meta: result.meta, current: result.current, summary: result.summary, series: [], breakdown: result.breakdown };
  });
  fastify.get<{ Querystring: RangeQuery }>('/monitoring/redis', auth, async (request) => {
    const [infra, dependencies] = await Promise.all([service.infrastructure('redis', request.query.range), service.dependencies('redis', request.query.range)]);
    return { ...infra, summary: { infrastructure: infra.summary, commands: dependencies.summary }, breakdown: dependencies.breakdown };
  });
  fastify.get<{ Querystring: RangeQuery }>('/monitoring/database', auth, async (request) => {
    const [infra, dependencies] = await Promise.all([service.infrastructure('database', request.query.range), service.dependencies('database', request.query.range)]);
    return { ...infra, summary: { infrastructure: infra.summary, queries: dependencies.summary }, breakdown: dependencies.breakdown };
  });
  fastify.get<{ Querystring: ContainerCatalogQuery }>('/monitoring/containers', auth, async (request, reply) => {
    try {
      return await service.containers(request.query);
    } catch (error) {
      if (error instanceof MonitoringQueryError) return reply.status(400).send({ message: error.message });
      throw error;
    }
  });
  fastify.get<{ Params: ContainerParams; Querystring: ContainerHistoryQuery }>('/monitoring/containers/:id', auth, async (request, reply) => {
    try {
      const result = await service.containerHistory(request.params.id, request.query);
      if (!result) return reply.status(404).send({ message: 'Monitored container not found' });
      return result;
    } catch (error) {
      if (error instanceof MonitoringQueryError) return reply.status(400).send({ message: error.message });
      throw error;
    }
  });
}
