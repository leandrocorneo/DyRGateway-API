import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import GatewayService from '../gateway.service';

const gatewayProxyRoutes: FastifyPluginAsync = async (fastify) => {
  const gatewayService = new GatewayService();

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const requestPath = request.url.split('?')[0] || '/';
    if (requestPath.startsWith('/api')) {
      return reply.status(404).send({ message: 'Route not found' });
    }

    const host = request.headers.host;
    if (!host) {
      return reply.status(400).send({ message: 'host header is required' });
    }

    const target = await gatewayService.resolveTarget(host, request.url);
    if (!target) {
      return reply.status(404).send({ message: 'No target found for provided host/path' });
    }

    reply.hijack();

    try {
      await gatewayService.forwardRequest({
        request: request.raw,
        response: reply.raw,
        target,
      });
    } catch (error) {
      fastify.log.error({ err: error, host, path: request.url }, 'HTTP proxy failed');

      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 502;
        reply.raw.setHeader('content-type', 'application/json; charset=utf-8');
        reply.raw.end(JSON.stringify({ message: 'Failed to proxy request' }));
        return;
      }

      reply.raw.destroy(error as Error);
    }
  };

  fastify.all('/', handler);
  fastify.all('/*', handler);
};

export default gatewayProxyRoutes;
