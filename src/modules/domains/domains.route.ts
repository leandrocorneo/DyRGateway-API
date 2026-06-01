import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import DomainService from './domain.service';
import { PaginationOptions } from '../../shared/types';
import { CreateDomainDTO, DomainByHostParams, DomainByIdParams, UpdateDomainDTO } from './domains.types';

const domainRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new DomainService();

  fastify.get('/domains', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const domains = await service.listDomains(request.query as PaginationOptions);
    return reply.send(domains);
    }
  );

  fastify.get<{ Params: DomainByHostParams }>(
    '/domains/host/:host',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const domain = await service.findByHost(request.params.host);

      if (!domain) {
        return reply.status(404).send({ message: 'Domain not found' });
      }

      return reply.send(domain);
    }
  );

  fastify.post<{ Body: CreateDomainDTO }>(
    '/domains',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const domain = await service.createDomain(request.body);
        return reply.status(201).send(domain);
      } catch (error) {
        return reply.status(400).send({ message: (error as Error).message });
      }
    }
  );

  fastify.put<{ Params: DomainByIdParams; Body: UpdateDomainDTO }>(
    '/domains/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const domain = await service.updateDomain(request.params.id, request.body);
        return reply.send(domain);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          return reply.status(404).send({ message: 'Domain not found' });
        }

        return reply.status(400).send({ message: (error as Error).message });
      }
    }
  );

  fastify.delete<{ Params: DomainByIdParams }>(
    '/domains/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const domain = await service.deleteDomain(request.params.id);
        return reply.send(domain);
      } catch (error) {
        return reply.status(404).send({ message: (error as Error).message });
      }
    }
  );
};

export default domainRoutes;
