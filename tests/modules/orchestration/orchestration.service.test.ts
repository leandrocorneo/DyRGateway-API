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
  options: { stopTimeoutSeconds?: number; persistState?: (id: string, state: any) => Promise<void> } = {},
) => new OrchestrationService({
  client,
  policy,
  stopTimeoutSeconds: options.stopTimeoutSeconds ?? 10,
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
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const client: DockerControlClient = {
    listContainers: async () => { await pending; return [container]; },
    inspectContainer: async () => ({ Id: container.Id, State: { Status: 'exited' } }),
    startContainer: async () => false,
    stopContainer: async () => false,
  };
  const service = serviceFor(client);
  const first = service.start(id);

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
