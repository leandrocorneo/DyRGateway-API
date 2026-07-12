import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import GatewayService from '../gateway.service';
import { metricsRegistry } from '../../../monitoring/core/registry';

const gatewayProxyRoutes: FastifyPluginAsync = async (fastify) => {
  const gatewayService = new GatewayService();
  const parseAsBuffer = (_request: FastifyRequest, body: Buffer, done: (error: Error | null, value: Buffer) => void) => done(null, body);
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, parseAsBuffer);
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'buffer' }, parseAsBuffer);
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, parseAsBuffer);

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const startedAt = performance.now();
    const active = metricsRegistry.beginRequest();
    const finishMetric = (statusCode: number, route: string, options: { timeout?: boolean; error?: boolean; ttfbMs?: number; applicationId?: string; serviceId?: string } = {}) => {
      active.finish();
      const durationMs = performance.now() - startedAt;
      metricsRegistry.recordApi({ method: request.method, route, statusCode, durationMs, concurrent: active.concurrent, ...options });
      return durationMs;
    };

    const requestPath = request.url.split('?')[0] || '/';
    if (requestPath.startsWith('/api')) {
      finishMetric(404, 'gateway:reserved-api-path');
      return reply.status(404).send({ message: 'Route not found' });
    }
    const host = request.headers.host;
    if (!host) {
      finishMetric(400, 'gateway:missing-host');
      return reply.status(400).send({ message: 'host header is required' });
    }

    const target = await gatewayService.resolveTarget(host, request.url);
    if (!target) {
      finishMetric(404, 'gateway:unresolved');
      return reply.status(404).send({ message: 'No target found for provided host/path' });
    }

    reply.hijack();
    let ttfbMs: number | undefined;
    try {
      await gatewayService.forwardRequest({
        request: request.raw, response: reply.raw, target, body: request.body as Buffer | undefined,
        onProxyResponse: () => { ttfbMs = performance.now() - startedAt; },
      });
      const durationMs = finishMetric(reply.raw.statusCode || 200, 'gateway:' + target.service.path, {
        ttfbMs, applicationId: target.application.id, serviceId: target.service.id,
      });
      metricsRegistry.recordDependency('upstream', target.service.id, durationMs, false, Number(process.env.SLOW_UPSTREAM_MS || 1000));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code || '';
      const timeout = code === 'ETIMEDOUT' || /timeout/i.test((error as Error).message);
      const statusCode = timeout ? 504 : 502;
      const durationMs = finishMetric(statusCode, 'gateway:' + target.service.path, {
        timeout, error: true, ttfbMs, applicationId: target.application.id, serviceId: target.service.id,
      });
      metricsRegistry.recordDependency('upstream', target.service.id, durationMs, true, Number(process.env.SLOW_UPSTREAM_MS || 1000));
      fastify.log.error({ err: error, host, serviceId: target.service.id }, 'HTTP proxy failed');
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = statusCode;
        reply.raw.setHeader('content-type', 'application/json; charset=utf-8');
        reply.raw.end(JSON.stringify({ message: timeout ? 'Upstream request timed out' : 'Failed to proxy request' }));
      } else {
        reply.raw.destroy(error as Error);
      }
    }
  };

  fastify.route({ method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], url: '/', handler });
  fastify.route({ method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], url: '/*', handler });
};

export default gatewayProxyRoutes;
