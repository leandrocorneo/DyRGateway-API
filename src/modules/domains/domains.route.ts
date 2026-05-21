import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import DomainService from './domain.service';

type CreateDomainBody = {
  host: string;
  applicationId: string;
};

type DomainByHostParams = {
  host: string;
};

type DomainByIdParams = {
  id: string;
};

const domainRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new DomainService();

  fastify.get('/domains', async (request, reply) => {
    const domains = await service.listDomains(request.query as paginationOptions);
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
      request: FastifyRequest<{ Body: CreateDomainBody }>,
      reply: FastifyReply
    ) => {
      try {
        const { host, applicationId } = request.body;
        const domain = await service.createDomain(host, applicationId);
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