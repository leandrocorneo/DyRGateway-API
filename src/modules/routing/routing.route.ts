import { FastifyInstance } from 'fastify';
import RoutingService from './routing.service';
import { RoutingError, RoutingPreferenceParams, UpdateRoutingPreferenceDTO } from './routing.types';

type RoutingRouteOptions = { service?: Pick<RoutingService, 'overview' | 'updatePreference'> };

export default async function routingRoutes(fastify: FastifyInstance, options: RoutingRouteOptions = {}) {
  const service = options.service || new RoutingService();
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get('/routing/overview', auth, async () => service.overview());
  fastify.put<{ Params: RoutingPreferenceParams; Body: UpdateRoutingPreferenceDTO }>('/routing/preferences/:serviceId', auth, async (request, reply) => {
    try {
      return await service.updatePreference(request.params.serviceId, request.body);
    } catch (error) {
      if (error instanceof RoutingError) return reply.status(error.statusCode).send({ message: error.message });
      throw error;
    }
  });
}