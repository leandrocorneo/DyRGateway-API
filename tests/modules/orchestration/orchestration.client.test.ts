import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OrchestrationError,
  createDockerControlClient,
} from '../../../src/modules/orchestration/orchestration.service';

test('sends only the allowed Docker start and graceful stop requests', async () => {
  const requests: Array<{ url: string; method: string | undefined }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method });
    return new Response(null, { status: 204 });
  };
  const client = createDockerControlClient('http://docker-proxy:2375', 'http://docker-control-proxy:2375', 15000, fetcher);

  await client.startContainer('instance/id');
  await client.stopContainer('instance/id', 10);

  assert.deepEqual(requests, [
    { url: 'http://docker-control-proxy:2375/containers/instance%2Fid/start', method: 'POST' },
    { url: 'http://docker-control-proxy:2375/containers/instance%2Fid/stop?t=10', method: 'POST' },
  ]);
});


test('keeps list and inspect traffic on the read-only proxy', async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('/containers/json?all=1&size=1')) {
      return Response.json([]);
    }
    return Response.json({ Id: 'instance', State: { Status: 'running' } });
  };
  const client = createDockerControlClient('http://docker-proxy:2375', 'http://docker-control-proxy:2375', 15000, fetcher);

  await client.listContainers();
  await client.inspectContainer('instance');

  assert.deepEqual(requests, [
    'http://docker-proxy:2375/containers/json?all=1&size=1',
    'http://docker-proxy:2375/containers/instance/json',
  ]);
});
test('maps Docker not found, conflict and daemon failures', async () => {
  for (const [status, expected] of [[404, 404], [409, 409], [403, 502], [500, 502]] as const) {
    const fetcher: typeof fetch = async () => new Response(null, { status });
    const client = createDockerControlClient('http://docker-proxy:2375', 'http://docker-control-proxy:2375', 15000, fetcher);
    await assert.rejects(
      client.startContainer('instance'),
      (error: OrchestrationError) => error.statusCode === expected,
    );
  }
});

test('maps an aborted Docker request to an operation timeout', async () => {
  const fetcher: typeof fetch = async () => {
    const error = new Error('timed out');
    error.name = 'TimeoutError';
    throw error;
  };
  const client = createDockerControlClient('http://docker-proxy:2375', 'http://docker-control-proxy:2375', 15000, fetcher);

  await assert.rejects(
    client.listContainers(),
    (error: OrchestrationError) => error.statusCode === 504 && error.code === 'DOCKER_ACTION_TIMEOUT',
  );
});
