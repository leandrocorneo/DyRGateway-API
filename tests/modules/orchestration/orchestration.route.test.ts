import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import orchestrationRoutes from '../../../src/modules/orchestration/orchestration.route';
import { OrchestrationError } from '../../../src/modules/orchestration/orchestration.service';

const id = '00000000-0000-0000-0000-000000000001';
const response = {
  action: 'start' as const,
  changed: true,
  completedAt: '2026-07-15T12:00:00.000Z',
  container: {
    id,
    name: 'external',
    instanceId: 'instance',
    previousState: 'exited',
    state: 'running',
    health: null,
  },
  orchestration: {
    protected: false,
    canStart: false,
    canStop: true,
    reason: 'already-running' as const,
  },
};

const buildApp = async (authenticated: boolean, service: any) => {
  const app = Fastify();
  app.decorate('authenticate', async (_request: unknown, reply: any) => {
    if (!authenticated) return reply.status(401).send({ message: 'Unauthorized' });
  });
  await app.register(orchestrationRoutes, { service });
  return app;
};

test('protects orchestration endpoints with authentication', async () => {
  const app = await buildApp(false, { start: async () => response, stop: async () => response });
  const result = await app.inject({ method: 'POST', url: '/monitoring/containers/' + id + '/start' });
  assert.equal(result.statusCode, 401);
  await app.close();
});

test('returns the action contract and rejects request bodies', async () => {
  const app = await buildApp(true, { start: async () => response, stop: async () => response });
  const result = await app.inject({ method: 'POST', url: '/monitoring/containers/' + id + '/start' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().container.state, 'running');

  const withBody = await app.inject({
    method: 'POST',
    url: '/monitoring/containers/' + id + '/stop',
    payload: { timeout: 1 },
  });
  assert.equal(withBody.statusCode, 400);
  await app.close();
});

test('maps orchestration failures without exposing Docker responses', async () => {
  const cases = [
    new OrchestrationError(403, 'CONTAINER_PROTECTED', 'protected'),
    new OrchestrationError(404, 'CONTAINER_NOT_FOUND', 'removed'),
    new OrchestrationError(409, 'ACTION_IN_PROGRESS', 'busy'),
    new OrchestrationError(502, 'DOCKER_DAEMON_ERROR', 'unavailable'),
    new OrchestrationError(504, 'DOCKER_ACTION_TIMEOUT', 'timeout'),
  ];

  for (const error of cases) {
    const app = await buildApp(true, {
      start: async () => { throw error; },
      stop: async () => { throw error; },
    });
    const result = await app.inject({ method: 'POST', url: '/monitoring/containers/' + id + '/start' });
    assert.equal(result.statusCode, error.statusCode);
    assert.equal(result.json().code, error.code);
    await app.close();
  }
});

test('returns the group action contract without accepting a request body', async () => {
  const groupResponse = {
    action: 'start', changed: true, partial: false, completedAt: response.completedAt,
    group: {
      id, project: 'external-project',
      summary: { total: 1, running: 1, stopped: 0, healthy: 0, unhealthy: 0, unknown: 1 },
      orchestration: response.orchestration,
    },
    results: [{
      containerId: id, name: 'external', instanceId: 'instance', previousState: 'exited',
      state: 'running', health: null, status: 'changed', orchestration: response.orchestration, error: null,
    }],
  };
  const app = await buildApp(true, {
    start: async () => response,
    stop: async () => response,
    startGroup: async () => groupResponse,
    stopGroup: async () => groupResponse,
  });
  const result = await app.inject({ method: 'POST', url: '/monitoring/container-groups/' + id + '/start' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().group.project, 'external-project');
  assert.equal(result.json().results[0].status, 'changed');
  const withBody = await app.inject({
    method: 'POST', url: '/monitoring/container-groups/' + id + '/stop', payload: { force: true },
  });
  assert.equal(withBody.statusCode, 400);
  await app.close();
});
