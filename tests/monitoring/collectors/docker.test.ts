import test from 'node:test';
import assert from 'node:assert/strict';
import { DockerContainerSummary } from '../../../src/monitoring/core/container';
import { DockerJsonClient, collectDockerMetrics } from '../../../src/monitoring/collectors/docker';

const running: DockerContainerSummary = {
  Id: '1'.repeat(64), Names: ['/running'], Image: 'app:latest', Created: 100, State: 'running', SizeRw: 512,
  Labels: { 'com.docker.compose.project': 'sample', 'com.docker.compose.service': 'app', 'com.docker.compose.container-number': '1' },
};
const stopped: DockerContainerSummary = {
  Id: '2'.repeat(64), Names: ['/stopped'], Image: 'worker:latest', Created: 90, State: 'exited', SizeRw: 128, Labels: {},
};

const inspect = (state: string) => ({
  Created: '2026-07-15T09:00:00.000Z', RestartCount: 2,
  State: {
    Status: state,
    Running: state === 'running',
    StartedAt: '2026-07-15T09:00:00.000Z',
    FinishedAt: state === 'running' ? '0001-01-01T00:00:00Z' : '2026-07-15T09:05:00.000Z',
    Health: state === 'running' ? { Status: 'healthy' } : undefined,
  },
  Mounts: [{ Type: 'volume', Name: 'data', Destination: '/data' }],
});

const stats = {
  cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 1000, online_cpus: 1 },
  precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 500 },
  memory_stats: { usage: 1000, limit: 2000, stats: { inactive_file: 100 } },
  pids_stats: { current: 4 },
  networks: { eth0: { rx_bytes: 10, tx_bytes: 20 } },
  blkio_stats: { io_service_bytes_recursive: [{ op: 'read', value: 30 }, { op: 'write', value: 40 }] },
};

test('collects running and stopped containers without requesting stopped stats', async () => {
  const requests: string[] = [];
  const client: DockerJsonClient = async <T>(path: string) => {
    requests.push(path);
    if (path === '/containers/json?all=1&size=1') return [running, stopped] as T;
    if (path === '/system/df?type=volume') throw new Error('storage unavailable');
    if (path === `/containers/${running.Id}/json`) return inspect('running') as T;
    if (path === `/containers/${stopped.Id}/json`) return inspect('exited') as T;
    if (path === `/containers/${running.Id}/stats?stream=false`) return stats as T;
    throw new Error('unexpected request ' + path);
  };

  const result = await collectDockerMetrics(client);
  assert.equal(result.containers.length, 2);
  const runningMetric = result.containers.find((item) => item.instanceId === running.Id)!;
  const stoppedMetric = result.containers.find((item) => item.instanceId === stopped.Id)!;
  assert.equal(runningMetric.status, 'healthy');
  assert.equal(runningMetric.metrics.memoryUsedBytes, 900);
  assert.equal(runningMetric.metrics.writableLayerBytes, null);
  assert.equal(stoppedMetric.status, 'down');
  assert.equal(stoppedMetric.metrics.cpuPercent, null);
  assert.equal(stoppedMetric.metrics.uptimeSeconds, 300);
  assert.equal(requests.includes(`/containers/${stopped.Id}/stats?stream=false`), false);
});

test('isolates a stats failure to the affected container', async () => {
  const client: DockerJsonClient = async <T>(path: string) => {
    if (path === '/containers/json?all=1&size=1') return [running] as T;
    if (path === '/system/df?type=volume') return { Volumes: [] } as T;
    if (path.endsWith('/json')) return inspect('running') as T;
    if (path.endsWith('/stats?stream=false')) throw new Error('stats timeout');
    throw new Error('unexpected request');
  };
  const [item] = (await collectDockerMetrics(client)).containers;
  assert.equal(item.status, 'healthy');
  assert.equal(item.metrics.cpuPercent, null);
  assert.equal(item.metrics.collectionError, true);
});
