import { disconnectDatabase } from '../database/prisma';
import { DockerMetricCollectionItem, MonitoredContainerInput, collectDockerMetrics } from './collectors/docker';
import { InfrastructureCollector } from './collectors/infrastructure';
import { markMissingMonitoredContainers, upsertMonitoredContainer } from './persistence/containers';
import { MetricsSpool } from './persistence/spool';
import { deleteExpiredMetrics, refreshMetricRollups, writeInfrastructureSample } from './persistence/repository';

type Sample = {
  sampleKey: string;
  component: string;
  status: string;
  sampledAt: string;
  metrics: unknown;
  monitoredContainerId?: string | null;
  containerInstanceId?: string | null;
  container?: MonitoredContainerInput;
};

const intervalSeconds = Number(process.env.METRICS_INTERVAL_SECONDS || 30);
const retentionDays = Number(process.env.METRICS_RETENTION_DAYS || 15);
const spool = new MetricsSpool<Sample>((process.env.METRICS_SPOOL_PATH || '/var/lib/dyr-metrics') + '/worker.jsonl');
const collector = new InfrastructureCollector();
let running = true;
let lastRetention = 0;

const makeSample = (item: { component: string; status: string; metrics: unknown }, sampledAt: Date): Sample => ({
  sampleKey: item.component + '|' + sampledAt.toISOString(),
  component: item.component,
  status: item.status,
  sampledAt: sampledAt.toISOString(),
  metrics: item.metrics,
});

const makeContainerSample = (item: DockerMetricCollectionItem, sampledAt: Date): Sample => {
  const component = 'container:' + item.container.id;
  return {
    sampleKey: component + '|' + sampledAt.toISOString(),
    component,
    status: item.status,
    sampledAt: sampledAt.toISOString(),
    metrics: item.metrics,
    monitoredContainerId: item.container.id,
    containerInstanceId: item.instanceId,
    container: item.container,
  };
};

const persist = async (sample: Sample) => {
  if (sample.container) await upsertMonitoredContainer(sample.container);
  await writeInfrastructureSample(sample);
};

const collect = async () => {
  const sampledAt = new Date(Math.floor(Date.now() / (intervalSeconds * 1000)) * intervalSeconds * 1000);
  const basePromise = Promise.all([collector.collectApi(), collector.collectRedis(), collector.collectDatabase()]);
  const dockerPromise = collectDockerMetrics();
  const base = await basePromise;
  let dockerResult: Awaited<ReturnType<typeof collectDockerMetrics>> | null = null;
  let dockerFailure: Sample | null = null;
  try {
    dockerResult = await dockerPromise;
  } catch {
    dockerFailure = makeSample({ component: 'docker', status: 'unknown', metrics: { collectionError: true } }, sampledAt);
  }

  const samples = [
    ...base.map((item) => makeSample(item, sampledAt)),
    ...(dockerResult?.containers.map((item) => makeContainerSample(item, sampledAt)) || []),
    ...(dockerFailure ? [dockerFailure] : []),
  ];

  try {
    await spool.replay(persist);
    for (const sample of samples) await persist(sample);
    if (dockerResult) await markMissingMonitoredContainers(dockerResult.observedAt);
  } catch {
    await spool.append(samples);
  }

  try { await refreshMetricRollups(sampledAt); } catch {}

  if (Date.now() - lastRetention > 86400000) {
    try { await deleteExpiredMetrics(retentionDays); lastRetention = Date.now(); } catch {}
  }
};

const shutdown = async () => {
  running = false;
  await collector.disconnect();
  await disconnectDatabase();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

const run = async () => {
  while (running) {
    const started = Date.now();
    await collect().catch((error) => console.error('Metrics collection failed', error));
    const elapsed = Date.now() - started;
    if (elapsed > intervalSeconds * 1000) {
      console.warn(`Metrics collection overrun: ${elapsed}ms for a ${intervalSeconds}s interval`);
    }
    const delay = Math.max(1000, intervalSeconds * 1000 - elapsed);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
};

void run();
