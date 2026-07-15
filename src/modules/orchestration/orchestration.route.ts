import { FastifyInstance, FastifyPluginOptions, FastifyReply } from 'fastify';
import OrchestrationService, { OrchestrationError } from './orchestration.service';

type ContainerParams = { id: string };
type OrchestrationRouteOptions = FastifyPluginOptions & { service?: Pick<OrchestrationService, 'start' | 'stop'> };

export default async function orchestrationRoutes(fastify: FastifyInstance, options: OrchestrationRouteOptions) {
  const service = options.service || new OrchestrationService();
  const auth = { preHandler: [fastify.authenticate] };

  const execute = async (
    action: 'start' | 'stop',
    request: { params: ContainerParams; body?: unknown },
    reply: FastifyReply,
  ) => {
    if (request.body !== undefined) return reply.status(400).send({ message: 'Request body is not supported' });
    try {
      return await service[action](request.params.id);
    } catch (error) {
      if (error instanceof OrchestrationError) {
        return reply.status(error.statusCode).send({ code: error.code, message: error.message });
      }
      throw error;
    }
  };

  fastify.post<{ Params: ContainerParams }>('/monitoring/containers/:id/start', auth, (request, reply) =>
    execute('start', request, reply));
  fastify.post<{ Params: ContainerParams }>('/monitoring/containers/:id/stop', auth, (request, reply) =>
    execute('stop', request, reply));
}
