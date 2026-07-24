import { FastifyInstance, FastifyPluginOptions, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import OrchestrationService, { ComposeProjectOperationInput, OrchestrationError } from './orchestration.service';

type ResourceParams = { id: string };
type OrchestrationRouteService = Partial<Pick<OrchestrationService,
  | 'start'
  | 'stop'
  | 'restart'
  | 'startGroup'
  | 'stopGroup'
  | 'restartGroup'
  | 'rebuildGroup'
  | 'redeployGroup'
  | 'listComposeProjects'
  | 'createComposeProject'
  | 'updateComposeProject'
  | 'deleteComposeProject'
>>;
type OrchestrationRouteOptions = FastifyPluginOptions & { service?: OrchestrationRouteService };

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

  const saveProject = async (operation: () => Promise<unknown>, reply: FastifyReply) => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.status(404).send({ message: 'Compose project operation not found' });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send({ message: 'Compose project already configured' });
      }
      return reply.status(400).send({ message: (error as Error).message });
    }
  };

  fastify.post<{ Params: ResourceParams }>('/monitoring/containers/:id/start', auth, (request, reply) =>
    execute(() => service.start!(request.params.id), request.body, reply));
  fastify.post<{ Params: ResourceParams }>('/monitoring/containers/:id/stop', auth, (request, reply) =>
    execute(() => service.stop!(request.params.id), request.body, reply));
  fastify.post<{ Params: ResourceParams }>('/monitoring/containers/:id/restart', auth, (request, reply) =>
    execute(() => service.restart!(request.params.id), request.body, reply));

  fastify.post<{ Params: ResourceParams }>('/monitoring/container-groups/:id/start', auth, (request, reply) =>
    execute(() => service.startGroup!(request.params.id), request.body, reply));
  fastify.post<{ Params: ResourceParams }>('/monitoring/container-groups/:id/stop', auth, (request, reply) =>
    execute(() => service.stopGroup!(request.params.id), request.body, reply));
  fastify.post<{ Params: ResourceParams }>('/monitoring/container-groups/:id/restart', auth, (request, reply) =>
    execute(() => service.restartGroup!(request.params.id), request.body, reply));
  fastify.post<{ Params: ResourceParams }>('/monitoring/container-groups/:id/rebuild', auth, (request, reply) =>
    execute(() => service.rebuildGroup!(request.params.id), request.body, reply));
  fastify.post<{ Params: ResourceParams }>('/monitoring/container-groups/:id/redeploy', auth, (request, reply) =>
    execute(() => service.redeployGroup!(request.params.id), request.body, reply));

  fastify.get('/monitoring/compose-projects', auth, async () => service.listComposeProjects!());
  fastify.post<{ Body: ComposeProjectOperationInput }>('/monitoring/compose-projects', auth, async (request, reply) =>
    saveProject(async () => {
      const project = await service.createComposeProject!(request.body);
      return reply.status(201).send(project);
    }, reply));
  fastify.put<{ Params: ResourceParams; Body: Partial<ComposeProjectOperationInput> }>('/monitoring/compose-projects/:id', auth, async (request, reply) =>
    saveProject(() => service.updateComposeProject!(request.params.id, request.body), reply));
  fastify.delete<{ Params: ResourceParams }>('/monitoring/compose-projects/:id', auth, async (request, reply) =>
    saveProject(async () => {
      await service.deleteComposeProject!(request.params.id);
      return reply.status(204).send();
    }, reply));
}