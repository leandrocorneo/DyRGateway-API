import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import ApplicationsService from './applications.service';
import { CreateApplicationDTO, ApplicationByIdParams, UpdateApplicationDTO } from './applications.types';
import { PaginationOptions } from '../../shared/types';

const applicationRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new ApplicationsService();

  fastify.get('/applications', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const applications = await service.listApplications(request.query as PaginationOptions);
    return reply.send(applications);
  });

  fastify.get<{ Params: ApplicationByIdParams }>(
    '/applications/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const application = await service.findById(request.params.id);
      if (!application) {
        return reply.status(404).send({ message: 'Application not found' });
      }
      return reply.send(application);
    }
  );

  fastify.post<{ Body: CreateApplicationDTO }>(
    '/applications',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const application = await service.createApplication(request.body);
        return reply.status(201).send(application);
      } catch (error) {
        return reply.status(400).send({ message: (error as Error).message });
      }
    }
  );

  fastify.put<{ Params: ApplicationByIdParams; Body: UpdateApplicationDTO }>(
    '/applications/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const application = await service.updateApplication(request.params.id, request.body);
        return reply.send(application);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          return reply.status(404).send({ message: 'Application not found' });
        }

        return reply.status(400).send({ message: (error as Error).message });
      }
    }
  );

  fastify.delete<{ Params: ApplicationByIdParams }>(
    '/applications/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
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
