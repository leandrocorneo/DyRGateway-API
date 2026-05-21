import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import ApplicationsService from './applications.service';
import { CreateApplicationDTO, ApplicationByIdParams } from './applications.types';
import { PaginationOptions } from '../../shared/types';

const applicationRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new ApplicationsService();

  fastify.get('/applications', async (request, reply) => {
    const applications = await service.listApplications(request.query as PaginationOptions);
    return reply.send(applications);
  });

  fastify.get(
    '/applications/:id',
    async (
      request: FastifyRequest<{ Params: ApplicationByIdParams }>,
      reply: FastifyReply
    ) => {
      const application = await service.findById(request.params.id);
      if (!application) {
        return reply.status(404).send({ message: 'Application not found' });
      }
      return reply.send(application);
    }
  );

  fastify.post(
    '/applications',
    async (
      request: FastifyRequest<{ Body: CreateApplicationDTO }>,
      reply: FastifyReply
    ) => {
      try {
        const application = await service.createApplication(request.body);
        return reply.status(201).send(application);
      } catch (error) {
        return reply.status(400).send({ message: (error as Error).message });
      }
    }
  );

  fastify.delete(
    '/applications/:id',
    async (
      request: FastifyRequest<{ Params: ApplicationByIdParams }>,
      reply: FastifyReply
    ) => {
      try {
        await service.deleteApplication(request.params.id);
        return reply.status(204).send();
      } catch (error) {
        return reply.status(400).send({ message: (error as Error).message });
      }
    }
  );
};

export default applicationRoutes;
