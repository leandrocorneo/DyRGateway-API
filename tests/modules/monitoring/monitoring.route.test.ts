import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import monitoringRoutes from '../../../src/modules/monitoring/monitoring.route';

const buildApp = async (authenticated: boolean) => {
  const app = Fastify();
  app.decorate('authenticate', async (_request: unknown, reply: any) => {
    if (!authenticated) return reply.status(401).send({ message: 'Unauthorized' });
  });
  await app.register(monitoringRoutes);
  return app;
};

test('protects the container catalog with authentication', async () => {
  const app = await buildApp(false);
  const response = await app.inject({ method: 'GET', url: '/monitoring/containers' });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('returns a paginated catalog grouped by Compose project', async () => {
  const app = await buildApp(true);
  const invalid = await app.inject({ method: 'GET', url: '/monitoring/container-groups?take=51' });
  assert.equal(invalid.statusCode, 400);
  const response = await app.inject({ method: 'GET', url: '/monitoring/container-groups?state=all&take=10' });
  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.meta.filters.state, 'all');
  assert.equal(payload.meta.pagination.take, 10);
  assert.equal(Array.isArray(payload.items), true);
  assert.equal(typeof payload.summary.projects, 'number');
  const compose = payload.items.find((item: any) => item.kind === 'compose');
  if (compose) {
    assert.equal(Array.isArray(compose.containers), true);
    assert.equal(typeof compose.orchestration.protected, 'boolean');
    assert.equal(compose.summary.total, compose.containers.length);
  }
  const running = await app.inject({ method: 'GET', url: '/monitoring/container-groups?state=running' });
  assert.equal(running.json().items.every((item: any) => item.kind === 'compose'
    ? item.summary.running > 0
    : item.container.state === 'running'), true);
  const stopped = await app.inject({ method: 'GET', url: '/monitoring/container-groups?state=stopped' });
  assert.equal(stopped.json().items.every((item: any) => item.kind === 'compose'
    ? item.summary.stopped > 0
    : item.container.state !== 'running'), true);
  await app.close();
});

test('validates catalog pagination and returns its contract', async () => {
  const app = await buildApp(true);
  const invalid = await app.inject({ method: 'GET', url: '/monitoring/containers?take=101' });
  assert.equal(invalid.statusCode, 400);
  const legacy = await app.inject({ method: 'GET', url: '/monitoring/containers?container=api' });
  assert.equal(legacy.statusCode, 400);
  const response = await app.inject({ method: 'GET', url: '/monitoring/containers?state=all&take=10' });
  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(Array.isArray(payload.items), true);
  assert.equal(payload.meta.pagination.take, 10);
  assert.equal(typeof payload.summary.running, 'number');
  const running = await app.inject({ method: 'GET', url: '/monitoring/containers' });
  assert.equal(running.json().items.every((item: any) => item.state === 'running'), true);
  const stopped = await app.inject({ method: 'GET', url: '/monitoring/containers?state=stopped' });
  assert.equal(stopped.json().items.every((item: any) => item.state !== 'running'), true);
  if (payload.items[0]) {
    assert.equal(typeof payload.items[0].orchestration.protected, 'boolean');
    assert.equal(typeof payload.items[0].orchestration.canStart, 'boolean');
    assert.equal(typeof payload.items[0].orchestration.canStop, 'boolean');
    const detail = await app.inject({ method: 'GET', url: `/monitoring/containers/${payload.items[0].id}?take=1` });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().meta.pagination.take, 1);
    assert.equal(Array.isArray(detail.json().series), true);
    const rolled = await app.inject({ method: 'GET', url: `/monitoring/containers/${payload.items[0].id}?range=24h&take=1` });
    assert.equal(rolled.statusCode, 200);
    assert.equal(rolled.json().meta.stepSeconds, 300);
  }
  await app.close();
});

test('keeps global containers out of the monitoring overview', async () => {
  const app = await buildApp(true);
  const response = await app.inject({ method: 'GET', url: '/monitoring/overview?range=15m' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().breakdown.every((item: any) => !item.component.startsWith('container:')), true);
  await app.close();
});

test('returns 404 for an unknown monitored container', async () => {
  const app = await buildApp(true);
  const response = await app.inject({ method: 'GET', url: '/monitoring/containers/00000000-0000-0000-0000-000000000000' });
  assert.equal(response.statusCode, 404);
  await app.close();
});
