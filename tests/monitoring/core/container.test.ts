import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DockerContainerSummary,
  calculateUptimeSeconds,
  dockerCpuPercent,
  getContainerIdentity,
  mapWithConcurrency,
  normalizeContainerStatus,
  normalizeDockerPorts,
  selectCanonicalContainers,
} from '../../../src/monitoring/core/container';

const summary = (overrides: Partial<DockerContainerSummary> = {}): DockerContainerSummary => ({
  Id: 'a'.repeat(64),
  Names: ['/gateway-1'],
  Image: 'gateway:latest',
  Created: 100,
  State: 'running',
  Labels: {
    'com.docker.compose.project': 'platform',
    'com.docker.compose.service': 'gateway',
    'com.docker.compose.container-number': '1',
  },
  ...overrides,
});

test('keeps compose identity stable across container recreation', () => {
  const first = getContainerIdentity(summary());
  const recreated = getContainerIdentity(summary({ Id: 'b'.repeat(64), Created: 200 }));
  assert.equal(first.identityKey, 'compose:platform:gateway:1');
  assert.equal(first.id, recreated.id);
  assert.equal(first.identitySource, 'compose');
});

test('falls back to normalized container name outside compose', () => {
  const identity = getContainerIdentity(summary({ Names: ['/Standalone-App'], Labels: {} }));
  assert.equal(identity.identityKey, 'name:standalone-app');
  assert.equal(identity.identitySource, 'name');
  assert.equal(identity.composeProject, null);
});

test('selects the running and newest compose replacement', () => {
  const stopped = summary({ Id: 'a'.repeat(64), State: 'exited', Created: 300 });
  const oldRunning = summary({ Id: 'b'.repeat(64), State: 'running', Created: 100 });
  const newRunning = summary({ Id: 'c'.repeat(64), State: 'running', Created: 200 });
  assert.deepEqual(selectCanonicalContainers([stopped, oldRunning, newRunning]).map((item) => item.Id), [newRunning.Id]);
});

test('calculates Docker CPU and rejects unusable deltas', () => {
  const stats = {
    cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 1000, online_cpus: 2 },
    precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 500 },
  };
  assert.equal(dockerCpuPercent(stats), 40);
  assert.equal(dockerCpuPercent({ cpu_stats: {}, precpu_stats: {} }), null);
});

test('normalizes health without treating stopped containers as healthy', () => {
  assert.equal(normalizeContainerStatus('running', 'healthy'), 'healthy');
  assert.equal(normalizeContainerStatus('running', null), 'up');
  assert.equal(normalizeContainerStatus('exited', 'healthy'), 'down');
});

test('calculates stopped uptime from the finish timestamp', () => {
  const started = new Date('2026-07-15T10:00:00.000Z');
  const finished = new Date('2026-07-15T10:02:00.000Z');
  assert.equal(calculateUptimeSeconds(started, finished, false), 120);
  assert.equal(calculateUptimeSeconds(null, finished, false), null);
});

test('bounds asynchronous work to the configured concurrency', async () => {
  let active = 0;
  let maximum = 0;
  const results = await mapWithConcurrency([...Array(12).keys()], 3, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });
  assert.equal(maximum, 3);
  assert.deepEqual(results, [...Array(12).keys()].map((value) => value * 2));
});


test('normalizes Docker published and private ports', () => {
  assert.deepEqual(normalizeDockerPorts([
    { IP: '0.0.0.0', PrivatePort: 3000, PublicPort: 9101, Type: 'tcp' },
    { PrivatePort: 8080, Type: 'udp' },
  ]), [
    { containerPort: 3000, protocol: 'tcp', hostIp: '0.0.0.0', hostPort: 9101, published: true },
    { containerPort: 8080, protocol: 'udp', hostIp: null, hostPort: null, published: false },
  ]);
});
