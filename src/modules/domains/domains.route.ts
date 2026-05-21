import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import DomainService from './domain.service';
import { PaginationOptions } from '../../shared/types';
import { CreateDomainDTO, DomainByHostParams, DomainByIdParams } from './domains.types';

const domainRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new DomainService();

  fastify.get('/domains', async (request, reply) => {
    const domains = await service.listDomains(request.query as PaginationOptions);
    return reply.send(domains);
    }
  );

  fastify.get(
    '/domains/host/:host',
    async (
      request: FastifyRequest<{ Params: DomainByHostParams }>,
      reply: FastifyReply
    ) => {
      const domain = await service.findByHost(request.params.host);

      if (!domain) {
        return reply.status(404).send({ message: 'Domain not found' });
      }

      return reply.send(domain);
    }
  );

  fastify.post(
    '/domains',
    async (
      request: FastifyRequest<{ Body: CreateDomainDTO }>,
      reply: FastifyReply
    ) => {
      try {
        const domain = await service.createDomain(request.body);
        return reply.status(201).send(domain);
      } catch (error) {
        return reply.status(400).send({ message: (error as Error).message });
      }
    }
  );

  fastify.delete(
    '/domains/:id',
    async (
      request: FastifyRequest<{ Params: DomainByIdParams }>,
      reply: FastifyReply
    ) => {
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