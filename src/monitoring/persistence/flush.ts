import { metricsRegistry } from '../core/registry';
import { MetricsSpool } from './spool';
import { ApiBucketRecord, DependencyBucketRecord, writeApiBucket, writeDependencyBucket } from './repository';

type SpoolItem =
  | { type: 'api'; data: ApiBucketRecord }
  | { type: 'dependency'; data: DependencyBucketRecord };

const spool = new MetricsSpool<SpoolItem>((process.env.METRICS_SPOOL_PATH || '/var/lib/dyr-metrics') + '/api.jsonl');

const persist = async (item: SpoolItem) => {
  if (item.type === 'api') await writeApiBucket(item.data);
  else await writeDependencyBucket(item.data);
};

export const flushApplicationMetrics = async (includeCurrent = false) => {
  const drained = metricsRegistry.drain(includeCurrent);
  const items: SpoolItem[] = [
    ...drained.api.map((data) => ({ type: 'api' as const, data })),
    ...drained.dependencies.map((data) => ({ type: 'dependency' as const, data })),
  ];
  try {
    await spool.replay(persist);
    for (const item of items) await persist(item);
  } catch {
    await spool.append(items);
  }
};

export const startMetricsFlushLoop = () => {
  const intervalMs = Number(process.env.METRICS_INTERVAL_SECONDS || 30) * 1000;
  const timer = setInterval(() => { void flushApplicationMetrics(); }, intervalMs);
  timer.unref();
  return timer;
};
