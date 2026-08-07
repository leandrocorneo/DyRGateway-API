import { FastifyPluginAsync } from 'fastify';
import ServiceTypesService from './service-types.service';

const serviceTypeRoutes: FastifyPluginAsync = async (fastify) => {
  const serviceTypesService = new ServiceTypesService();

  fastify.get(
    '/service-types',
    { preHandler: [fastify.authenticate] },
    async (_request, reply) => {
      const serviceTypes = await serviceTypesService.listServiceTypes();
      return reply.send(serviceTypes);
    }
  );
};

export default serviceTypeRoutes;
