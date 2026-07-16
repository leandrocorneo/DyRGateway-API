import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DockerControlClient,
  OrchestrationError,
  default as OrchestrationService,
} from '../../../src/modules/orchestration/orchestration.service';
import {
  DockerContainerSummary,
  getContainerIdentity,
} from '../../../src/monitoring/core/container';
import { composeProjectGroupId } from '../../../src/modules/orchestration/orchestration.types';

const policy = { protectedProjects: ['dyrgatewayapi', 'dyrgateway'], protectedContainerNames: ['next-app'] };

const summary = (overrides: Partial<DockerContainerSummary> = {}): DockerContainerSummary => ({
  Id: 'external-instance',
  Names: ['/external-service'],
  Image: 'redis:7-alpine',
  Created: 100,
  State: 'exited',
  Labels: {},
  ...overrides,
});

const serviceFor = (
  client: DockerControlClient,
  options: { stopTimeoutSeconds?: number; groupActionConcurrency?: number; persistState?: (id: string, state: any) => Promise<void> } = {},
) => new OrchestrationService({
  client,
  policy,
  stopTimeoutSeconds: options.stopTimeoutSeconds ?? 10,
  groupActionConcurrency: options.groupActionConcurrency ?? 2,
  persistState: options.persistState || (async () => undefined),
  now: () => new Date('2026-07-15T12:00:00.000Z'),
});

test('starts the canonical live instance resolved from the logical UUID', async () => {
  const container = summary();
  const id = getContainerIdentity(container).id;
  const calls: string[] = [];
  let inspection = 0;
  const client: DockerControlClient = {
    listContainers: async () => [container],
    inspectContainer: async () => {
      inspection += 1;
      return inspection === 1
        ? { Id: container.Id, State: { Status: 'exited' } }
        : { Id: container.Id, State: { Status: 'running', StartedAt: '2026-07-15T11:59:00.000Z' } };
    },
    startContainer: async (instanceId) => { calls.push('start:' + instanceId); return true; },
    stopContainer: async () => { throw new Error('unexpected stop'); },
  };

  const result = await serviceFor(client).start(id);

  assert.deepEqual(calls, ['start:external-instance']);
  assert.equal(result.action, 'start');
  assert.equal(result.changed, true);
  assert.equal(result.container.previousState, 'exited');
  assert.equal(result.container.state, 'running');
  assert.equal(result.orchestration.canStop, true);
});

test('stops a running container gracefully with the configured timeout', async () => {
  const container = summary({ State: 'running' });
  const id = getContainerIdentity(container).id;
  const timeouts: number[] = [];
  let inspection = 0;
  const client: DockerControlClient = {
    listContainers: async () => [container],
    inspectContainer: async () => {
      inspection += 1;
      return inspection === 1
        ? { Id: container.Id, State: { Status: 'running' } }
        : { Id: container.Id, State: { Status: 'exited' } };
    },
    startContainer: async () => { throw new Error('unexpected start'); },
    stopContainer: async (_instanceId, timeoutSeconds) => { timeouts.push(timeoutSeconds); return true; },
  };

  const result = await serviceFor(client, { stopTimeoutSeconds: 10 }).stop(id);

  assert.deepEqual(timeouts, [10]);
  assert.equal(result.changed, true);
  assert.equal(result.container.state, 'exited');
  assert.equal(result.orchestration.canStart, true);
});

test('keeps start and stop idempotent in the desired state', async () => {
  const running = summary({ State: 'running' });
  const exited = summary();
  let actions = 0;
  const clientFor = (container: DockerContainerSummary): DockerControlClient => ({
    listContainers: async () => [container],
    inspectContainer: async () => ({ Id: container.Id, State: { Status: container.State } }),
    startContainer: async () => { actions += 1; return true; },
    stopContainer: async () => { actions += 1; return true; },
  });

  const started = await serviceFor(clientFor(running)).start(getContainerIdentity(running).id);
  const stopped = await serviceFor(clientFor(exited)).stop(getContainerIdentity(exited).id);

  assert.equal(started.changed, false);
  assert.equal(stopped.changed, false);
  assert.equal(actions, 0);
});

test('rejects protected, removed and unsupported containers', async () => {
  const protectedContainer = summary({
    Labels: {
      'com.docker.compose.project': 'dyrgatewayapi',
      'com.docker.compose.service': 'gateway',
      'com.docker.compose.container-number': '1',
    },
    State: 'running',
  });
  const paused = summary({ State: 'paused' });
  const clientFor = (containers: DockerContainerSummary[]): DockerControlClient => ({
    listContainers: async () => containers,
    inspectContainer: async (instanceId) => {
      const item = containers.find((container) => container.Id === instanceId)!;
      return { Id: item.Id, State: { Status: item.State } };
    },
    startContainer: async () => true,
    stopContainer: async () => true,
  });

  await assert.rejects(
    serviceFor(clientFor([protectedContainer])).stop(getContainerIdentity(protectedContainer).id),
    (error: OrchestrationError) => error.statusCode === 403 && error.code === 'CONTAINER_PROTECTED',
  );
  await assert.rejects(
    serviceFor(clientFor([])).start(getContainerIdentity(paused).id),
    (error: OrchestrationError) => error.statusCode === 404 && error.code === 'CONTAINER_NOT_FOUND',
  );
  await assert.rejects(
    serviceFor(clientFor([paused])).start(getContainerIdentity(paused).id),
    (error: OrchestrationError) => error.statusCode === 409 && error.code === 'UNSUPPORTED_CONTAINER_STATE',
  );
});

test('rejects concurrent actions for the same logical container', async () => {
  const container = summary();
  const id = getContainerIdentity(container).id;
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const inspectionStarted = new Promise<void>((resolve) => { started = resolve; });
  const client: DockerControlClient = {
    listContainers: async () => [container],
    inspectContainer: async () => { started?.(); await pending; return { Id: container.Id, State: { Status: 'exited' } }; },
    startContainer: async () => false,
    stopContainer: async () => false,
  };
  const service = serviceFor(client);
  const first = service.start(id);
  await inspectionStarted;

  await assert.rejects(
    service.stop(id),
    (error: OrchestrationError) => error.statusCode === 409 && error.code === 'ACTION_IN_PROGRESS',
  );
  release?.();
  await first;
});
test('does not fail a completed Docker action when persistence is unavailable', async () => {
  const container = summary();
  const id = getContainerIdentity(container).id;
  let inspection = 0;
  const client: DockerControlClient = {
    listContainers: async () => [container],
    inspectContainer: async () => {
      inspection += 1;
      return { Id: container.Id, State: { Status: inspection === 1 ? 'exited' : 'running' } };
    },
    startContainer: async () => true,
    stopContainer: async () => true,
  };

  const result = await serviceFor(client, {
    persistState: async () => { throw new Error('database unavailable'); },
  }).start(id);

  assert.equal(result.changed, true);
  assert.equal(result.container.state, 'running');
});

const composeSummary = (project: string, service: string, state: string, id: string) => summary({
  Id: id,
  Names: [`/${project}-${service}-1`],
  State: state,
  Labels: {
    'com.docker.compose.project': project,
    'com.docker.compose.service': service,
    'com.docker.compose.container-number': '1',
  },
});

test('starts every existing stopped container in a Compose project', async () => {
  const app = composeSummary('external-project', 'app', 'exited', 'app-instance');
  const database = composeSummary('external-project', 'database', 'created', 'database-instance');
  const states = new Map([[app.Id, app.State], [database.Id, database.State]]);
  const client: DockerControlClient = {
    listContainers: async () => [app, database],
    inspectContainer: async (id) => ({ Id: id, State: { Status: states.get(id) } }),
    startContainer: async (id) => { states.set(id, 'running'); return true; },
    stopContainer: async () => true,
  };

  const result = await serviceFor(client).startGroup(composeProjectGroupId('external-project'));

  assert.equal(result.changed, true);
  assert.equal(result.partial, false);
  assert.equal(result.group.summary.running, 2);
  assert.equal(result.results.every((item) => item.status === 'changed'), true);
});

test('stops running containers and leaves stopped containers unchanged', async () => {
  const app = composeSummary('external-project', 'app', 'running', 'app-instance');
  const database = composeSummary('external-project', 'database', 'exited', 'database-instance');
  const states = new Map([[app.Id, app.State], [database.Id, database.State]]);
  let stopCalls = 0;
  const client: DockerControlClient = {
    listContainers: async () => [app, database],
    inspectContainer: async (id) => ({ Id: id, State: { Status: states.get(id) } }),
    startContainer: async () => true,
    stopContainer: async (id) => {
      stopCalls += 1;
      states.set(id, 'exited');
      return true;
    },
  };

  const result = await serviceFor(client).stopGroup(composeProjectGroupId('external-project'));

  assert.equal(result.changed, true);
  assert.equal(result.partial, false);
  assert.equal(result.group.summary.stopped, 2);
  assert.equal(stopCalls, 1);
  assert.equal(result.results.find((item) => item.name.includes('app'))?.status, 'changed');
  assert.equal(result.results.find((item) => item.name.includes('database'))?.status, 'unchanged');
});
test('continues a group action and reports unsupported containers as partial failures', async () => {
  const app = composeSummary('external-project', 'app', 'exited', 'app-instance');
  const paused = composeSummary('external-project', 'worker', 'paused', 'worker-instance');
  const states = new Map([[app.Id, app.State], [paused.Id, paused.State]]);
  const client: DockerControlClient = {
    listContainers: async () => [app, paused],
    inspectContainer: async (id) => ({ Id: id, State: { Status: states.get(id) } }),
    startContainer: async (id) => { states.set(id, 'running'); return true; },
    stopContainer: async () => true,
  };

  const result = await serviceFor(client).startGroup(composeProjectGroupId('external-project'));

  assert.equal(result.changed, true);
  assert.equal(result.partial, true);
  assert.equal(result.results.find((item) => item.name.includes('app'))?.status, 'changed');
  assert.equal(result.results.find((item) => item.name.includes('worker'))?.error?.code, 'UNSUPPORTED_CONTAINER_STATE');
});

test('protects the entire Compose project before changing any child', async () => {
  const gateway = composeSummary('dyrgatewayapi', 'gateway', 'running', 'gateway-instance');
  let actions = 0;
  const client: DockerControlClient = {
    listContainers: async () => [gateway],
    inspectContainer: async () => ({ Id: gateway.Id, State: { Status: 'running' } }),
    startContainer: async () => { actions += 1; return true; },
    stopContainer: async () => { actions += 1; return true; },
  };

  await assert.rejects(
    serviceFor(client).stopGroup(composeProjectGroupId('dyrgatewayapi')),
    (error: OrchestrationError) => error.statusCode === 403 && error.code === 'CONTAINER_PROTECTED',
  );
  assert.equal(actions, 0);
});

test('blocks individual actions while the Compose project is being operated', async () => {
  const app = composeSummary('external-project', 'app', 'exited', 'app-instance');
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const inspectionStarted = new Promise<void>((resolve) => { started = resolve; });
  const client: DockerControlClient = {
    listContainers: async () => [app],
    inspectContainer: async () => { started?.(); await pending; return { Id: app.Id, State: { Status: 'exited' } }; },
    startContainer: async () => false,
    stopContainer: async () => false,
  };
  const service = serviceFor(client, { groupActionConcurrency: 1 });
  const groupAction = service.startGroup(composeProjectGroupId('external-project'));
  await inspectionStarted;

  await assert.rejects(
    service.start(getContainerIdentity(app).id),
    (error: OrchestrationError) => error.statusCode === 409 && error.code === 'ACTION_IN_PROGRESS',
  );
  release?.();
  await groupAction;
});

test('blocks project actions while a child container is being operated', async () => {
  const app = composeSummary('external-project', 'app', 'exited', 'app-instance');
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const inspectionStarted = new Promise<void>((resolve) => { started = resolve; });
  const client: DockerControlClient = {
    listContainers: async () => [app],
    inspectContainer: async () => { started?.(); await pending; return { Id: app.Id, State: { Status: 'exited' } }; },
    startContainer: async () => false,
    stopContainer: async () => false,
  };
  const service = serviceFor(client, { groupActionConcurrency: 1 });
  const childAction = service.start(getContainerIdentity(app).id);
  await inspectionStarted;

  await assert.rejects(
    service.startGroup(composeProjectGroupId('external-project')),
    (error: OrchestrationError) => error.statusCode === 409 && error.code === 'ACTION_IN_PROGRESS',
  );
  release?.();
  await childAction;
});
