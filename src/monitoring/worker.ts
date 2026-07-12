import { disconnectDatabase } from '../database/prisma';
import { collectDockerMetrics } from './collectors/docker';
import { InfrastructureCollector } from './collectors/infrastructure';
import { MetricsSpool } from './persistence/spool';
import { deleteExpiredMetrics, refreshMetricRollups, writeInfrastructureSample } from './persistence/repository';

type Sample = { sampleKey: string; component: string; status: string; sampledAt: string; metrics: unknown };

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

const persist = async (sample: Sample) => writeInfrastructureSample(sample);

const collect = async () => {
  const sampledAt = new Date(Math.floor(Date.now() / (intervalSeconds * 1000)) * intervalSeconds * 1000);
  const base = await Promise.all([collector.collectApi(), collector.collectRedis(), collector.collectDatabase()]);
  let containers: Array<{ component: string; status: string; metrics: unknown }> = [];
  try { containers = await collectDockerMetrics(); } catch {
    containers = [{ component: 'container:collector', status: 'unknown', metrics: { collectionError: true } }];
  }
  const samples = [...base, ...containers].map((item) => makeSample(item, sampledAt));
  try {
    await spool.replay(persist);
    for (const sample of samples) await persist(sample);
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
    const delay = Math.max(1000, intervalSeconds * 1000 - (Date.now() - started));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
};

void run();
