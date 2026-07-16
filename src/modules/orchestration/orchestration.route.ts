import { FastifyInstance, FastifyPluginOptions, FastifyReply } from 'fastify';
import OrchestrationService, { OrchestrationError } from './orchestration.service';

type ResourceParams = { id: string };
type OrchestrationRouteOptions = FastifyPluginOptions & {
  service?: Pick<OrchestrationService, 'start' | 'stop' | 'startGroup' | 'stopGroup'>;
};

export default async function orchestrationRoutes(fastify: FastifyInstance, options: OrchestrationRouteOptions) {
  const service = options.service || new OrchestrationService();
  const auth = { preHandler: [fastify.authenticate] };

  const execute = async (
    operation: () => Promise<unknown>,
    body: unknown,
    reply: FastifyReply,
  ) => {
    if (body !== undefined) return reply.status(400).send({ message: 'Request body is not supported' });
    try {
      return await operation();
    } catch (error) {
      if (error instanceof OrchestrationError) {
        return reply.status(error.statusCode).send({ code: error.code, message: error.message });
      }
      throw error;
    }
  };

  fastify.post<{ Params: ResourceParams }>('/monitoring/containers/:id/start', auth, (request, reply) =>
    execute(() => service.start(request.params.id), request.body, reply));
  fastify.post<{ Params: ResourceParams }>('/monitoring/containers/:id/stop', auth, (request, reply) =>
    execute(() => service.stop(request.params.id), request.body, reply));
  fastify.post<{ Params: ResourceParams }>('/monitoring/container-groups/:id/start', auth, (request, reply) =>
    execute(() => service.startGroup(request.params.id), request.body, reply));
  fastify.post<{ Params: ResourceParams }>('/monitoring/container-groups/:id/stop', auth, (request, reply) =>
    execute(() => service.stopGroup(request.params.id), request.body, reply));
}
