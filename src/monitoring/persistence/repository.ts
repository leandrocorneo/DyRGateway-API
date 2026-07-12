import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { HistogramSnapshot, mergeHistograms } from '../core/histogram';

export type ApiBucketRecord = {
  bucketKey: string; bucketStart: Date; method: string; route: string;
  applicationId: string | null; serviceId: string | null; requestCount: number;
  status2xx: number; status4xx: number; status5xx: number; timeoutCount: number;
  errorCount: number; concurrentMax: number; latencyHistogram: HistogramSnapshot;
  ttfbHistogram: HistogramSnapshot;
};

export type DependencyBucketRecord = {
  bucketKey: string; bucketStart: Date; dependency: string; operation: string;
  callCount: number; errorCount: number; slowCount: number; latencyHistogram: HistogramSnapshot;
};

const json = (value: unknown) => value as Prisma.InputJsonValue;

export const writeApiBucket = async (item: ApiBucketRecord) => {
  const data = {
    bucketStart: new Date(item.bucketStart), method: item.method, route: item.route,
    applicationId: item.applicationId, serviceId: item.serviceId,
    requestCount: item.requestCount, status2xx: item.status2xx, status4xx: item.status4xx,
    status5xx: item.status5xx, timeoutCount: item.timeoutCount, errorCount: item.errorCount,
    concurrentMax: item.concurrentMax, latencyHistogram: json(item.latencyHistogram),
    ttfbHistogram: json(item.ttfbHistogram),
  };
  await prisma.apiMetricBucket.upsert({ where: { bucketKey: item.bucketKey }, create: { bucketKey: item.bucketKey, ...data }, update: data });
};

export const writeDependencyBucket = async (item: DependencyBucketRecord) => {
  const data = {
    bucketStart: new Date(item.bucketStart), dependency: item.dependency, operation: item.operation,
    callCount: item.callCount, errorCount: item.errorCount, slowCount: item.slowCount,
    latencyHistogram: json(item.latencyHistogram),
  };
  await prisma.dependencyMetricBucket.upsert({ where: { bucketKey: item.bucketKey }, create: { bucketKey: item.bucketKey, ...data }, update: data });
};

export const writeInfrastructureSample = async (item: { sampleKey: string; component: string; status: string; sampledAt: Date | string; metrics: unknown }) => {
  const data = { component: item.component, status: item.status, sampledAt: new Date(item.sampledAt), metrics: json(item.metrics) };
  await prisma.infrastructureMetricSample.upsert({ where: { sampleKey: item.sampleKey }, create: { sampleKey: item.sampleKey, ...data }, update: data });
};

export const deleteExpiredMetrics = async (retentionDays: number) => {
  const before = new Date(Date.now() - retentionDays * 86400000);
  await prisma.$transaction([
    prisma.infrastructureMetricSample.deleteMany({ where: { sampledAt: { lt: before } } }),
    prisma.apiMetricBucket.deleteMany({ where: { bucketStart: { lt: before } } }),
    prisma.dependencyMetricBucket.deleteMany({ where: { bucketStart: { lt: before } } }),
    prisma.metricRollup.deleteMany({ where: { bucketStart: { lt: before } } }),
  ]);
};


const rollupStart = (date: Date, seconds: number) =>
  new Date(Math.floor(date.getTime() / (seconds * 1000)) * seconds * 1000);

export const refreshMetricRollups = async (now = new Date()) => {
  const intervals = [{ name: '5m', seconds: 300 }, { name: '1h', seconds: 3600 }];
  for (const interval of intervals) {
    const start = rollupStart(now, interval.seconds);
    const [apiRows, dependencyRows, infrastructureRows] = await Promise.all([
      prisma.apiMetricBucket.findMany({ where: { bucketStart: { gte: start, lt: now } } }),
      prisma.dependencyMetricBucket.findMany({ where: { bucketStart: { gte: start, lt: now } } }),
      prisma.infrastructureMetricSample.findMany({ where: { sampledAt: { gte: start, lt: now } }, orderBy: { sampledAt: 'asc' } }),
    ]);

    const apiGroups = new Map<string, typeof apiRows>();
    for (const row of apiRows) {
      const dimension = [row.method, row.route, row.applicationId || '', row.serviceId || ''].join('|');
      const group = apiGroups.get(dimension) || []; group.push(row); apiGroups.set(dimension, group);
    }
    for (const [dimension, rows] of apiGroups) {
      const histogram = mergeHistograms(rows.map((row) => row.latencyHistogram as unknown as HistogramSnapshot));
      await prisma.metricRollup.upsert({
        where: { rollupKey: interval.name + '|api|' + dimension + '|' + start.toISOString() },
        create: {
          rollupKey: interval.name + '|api|' + dimension + '|' + start.toISOString(),
          interval: interval.name, source: 'api', dimension, bucketStart: start,
          metrics: json({
            requestCount: rows.reduce((sum, row) => sum + row.requestCount, 0),
            status2xx: rows.reduce((sum, row) => sum + row.status2xx, 0),
            status4xx: rows.reduce((sum, row) => sum + row.status4xx, 0),
            status5xx: rows.reduce((sum, row) => sum + row.status5xx, 0),
            timeoutCount: rows.reduce((sum, row) => sum + row.timeoutCount, 0),
            errorCount: rows.reduce((sum, row) => sum + row.errorCount, 0),
            concurrentMax: rows.reduce((max, row) => Math.max(max, row.concurrentMax), 0),
            latencyHistogram: histogram,
          }),
        },
        update: {
          metrics: json({
            requestCount: rows.reduce((sum, row) => sum + row.requestCount, 0),
            status2xx: rows.reduce((sum, row) => sum + row.status2xx, 0),
            status4xx: rows.reduce((sum, row) => sum + row.status4xx, 0),
            status5xx: rows.reduce((sum, row) => sum + row.status5xx, 0),
            timeoutCount: rows.reduce((sum, row) => sum + row.timeoutCount, 0),
            errorCount: rows.reduce((sum, row) => sum + row.errorCount, 0),
            concurrentMax: rows.reduce((max, row) => Math.max(max, row.concurrentMax), 0),
            latencyHistogram: histogram,
          }),
        },
      });
    }

    const dependencyGroups = new Map<string, typeof dependencyRows>();
    for (const row of dependencyRows) {
      const dimension = row.dependency + '|' + row.operation;
      const group = dependencyGroups.get(dimension) || []; group.push(row); dependencyGroups.set(dimension, group);
    }
    for (const [dimension, rows] of dependencyGroups) {
      await prisma.metricRollup.upsert({
        where: { rollupKey: interval.name + '|dependency|' + dimension + '|' + start.toISOString() },
        create: {
          rollupKey: interval.name + '|dependency|' + dimension + '|' + start.toISOString(),
          interval: interval.name, source: 'dependency', dimension, bucketStart: start,
          metrics: json({
            callCount: rows.reduce((sum, row) => sum + row.callCount, 0),
            errorCount: rows.reduce((sum, row) => sum + row.errorCount, 0),
            slowCount: rows.reduce((sum, row) => sum + row.slowCount, 0),
            latencyHistogram: mergeHistograms(rows.map((row) => row.latencyHistogram as unknown as HistogramSnapshot)),
          }),
        },
        update: {
          metrics: json({
            callCount: rows.reduce((sum, row) => sum + row.callCount, 0),
            errorCount: rows.reduce((sum, row) => sum + row.errorCount, 0),
            slowCount: rows.reduce((sum, row) => sum + row.slowCount, 0),
            latencyHistogram: mergeHistograms(rows.map((row) => row.latencyHistogram as unknown as HistogramSnapshot)),
          }),
        },
      });
    }

    const latest = new Map<string, typeof infrastructureRows[number]>();
    for (const row of infrastructureRows) latest.set(row.component, row);
    for (const [dimension, row] of latest) {
      await prisma.metricRollup.upsert({
        where: { rollupKey: interval.name + '|infrastructure|' + dimension + '|' + start.toISOString() },
        create: {
          rollupKey: interval.name + '|infrastructure|' + dimension + '|' + start.toISOString(),
          interval: interval.name, source: 'infrastructure', dimension, bucketStart: start, metrics: json(row.metrics),
        },
        update: { metrics: json(row.metrics) },
      });
    }
  }
};
