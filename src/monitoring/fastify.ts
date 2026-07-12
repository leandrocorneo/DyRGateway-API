import { FastifyInstance, FastifyRequest } from 'fastify';
import { metricsRegistry } from './core/registry';

type RequestState = {
  startedAt: number;
  concurrent: number;
  finish: () => void;
};

const states = new WeakMap<FastifyRequest, RequestState>();

export const registerApiMetrics = (fastify: FastifyInstance) => {
  fastify.addHook('onRequest', async (request) => {
    const route = request.routeOptions?.url;
    if (route === '/' || route === '/*') return;
    const requestMetric = metricsRegistry.beginRequest();
    states.set(request, { startedAt: performance.now(), ...requestMetric });
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const state = states.get(request);
    if (!state) return;
    state.finish();
    const route = request.routeOptions?.url || 'unmatched';
    if (route === '/' || route === '/*') return;
    metricsRegistry.recordApi({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs: performance.now() - state.startedAt,
      error: reply.statusCode >= 500,
      concurrent: state.concurrent,
    });
    states.delete(request);
  });

  fastify.addHook('onError', async (request) => {
    const state = states.get(request);
    if (!state) return;
    state.finish();
  });
};
