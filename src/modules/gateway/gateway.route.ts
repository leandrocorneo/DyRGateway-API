import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import GatewayService from './gateway.service';

type ResolveGatewayQuery = {
  host?: string;
  path?: string;
};

type ResolveHostParams = {
  host: string;
};

const gatewayRoutes: FastifyPluginAsync = async (fastify) => {
  const gatewayService = new GatewayService();

  fastify.get(
    '/gateway/resolve-host/:host',
    async (
      request: FastifyRequest<{ Params: ResolveHostParams }>,
      reply: FastifyReply
    ) => {
      try {
        const resolvedHost = await gatewayService.resolveHost(request.params.host);

        if (!resolvedHost) {
          return reply.status(404).send({ message: 'Host not mapped to an active application' });
        }

        return reply.send(resolvedHost);
      } catch (error) {
        return reply.status(400).send({ message: (error as Error).message });
      }
    }
  );

  fastify.get(
    '/gateway/resolve',
    async (
      request: FastifyRequest<{ Querystring: ResolveGatewayQuery }>,
      reply: FastifyReply
    ) => {
      try {
        const hostFromHeader = request.headers.host || '';
        const host = request.query.host || hostFromHeader;
        const path = request.query.path || '/';

        const target = await gatewayService.resolveTarget(host, path);

        if (!target) {
          return reply.status(404).send({ message: 'No target found for provided host/path' });
        }

        return reply.send(target);
      } catch (error) {
        return reply.status(400).send({ message: (error as Error).message });
      }
    }
  );
};

export default gatewayRoutes;
