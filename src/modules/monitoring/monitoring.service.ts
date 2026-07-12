import { prisma } from '../../database/prisma';
import { HistogramSnapshot, createHistogram, histogramSummary, mergeHistograms } from '../../monitoring/core/histogram';

const RANGES: Record<string, number> = {
  '15m': 15 * 60, '1h': 60 * 60, '6h': 6 * 60 * 60,
  '24h': 24 * 60 * 60, '7d': 7 * 24 * 60 * 60, '15d': 15 * 24 * 60 * 60,
};

const parseHistogram = (value: unknown): HistogramSnapshot => {
  if (!value || typeof value !== 'object') return createHistogram();
  return value as HistogramSnapshot;
};

const chooseStep = (seconds: number) => {
  if (seconds <= 3600) return 30;
  if (seconds <= 21600) return 60;
  if (seconds <= 86400) return 300;
  if (seconds <= 604800) return 1800;
  return 3600;
};

const floorTime = (date: Date, step: number) =>
  new Date(Math.floor(date.getTime() / (step * 1000)) * step * 1000).toISOString();

export default class MonitoringService {
  parseRange(raw?: string) {
    const range = raw && RANGES[raw] ? raw : '1h';
    const seconds = RANGES[range];
    return { range, seconds, from: new Date(Date.now() - seconds * 1000), to: new Date(), stepSeconds: chooseStep(seconds) };
  }

  private meta(window: ReturnType<MonitoringService['parseRange']>, partial: boolean) {
    return {
      range: window.range, from: window.from.toISOString(), to: window.to.toISOString(),
      stepSeconds: window.stepSeconds, partial,
      capabilities: { replicaLag: 'unsupported', hostDowntime: 'unknown', percentiles: 'supported' },
    };
  }

  async api(rawRange?: string) {
    const window = this.parseRange(rawRange);
    const rows = await prisma.apiMetricBucket.findMany({ where: { bucketStart: { gte: window.from } }, orderBy: { bucketStart: 'asc' } });
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = floorTime(row.bucketStart, window.stepSeconds);
      const group = groups.get(key) || [];
      group.push(row); groups.set(key, group);
    }
    const summarize = (items: typeof rows) => {
      const requestCount = items.reduce((sum, item) => sum + item.requestCount, 0);
      const status2xx = items.reduce((sum, item) => sum + item.status2xx, 0);
      const status4xx = items.reduce((sum, item) => sum + item.status4xx, 0);
      const status5xx = items.reduce((sum, item) => sum + item.status5xx, 0);
      const timeoutCount = items.reduce((sum, item) => sum + item.timeoutCount, 0);
      const errorCount = items.reduce((sum, item) => sum + item.errorCount, 0);
      const histogram = mergeHistograms(items.map((item) => parseHistogram(item.latencyHistogram)));
      const ttfb = mergeHistograms(items.map((item) => parseHistogram(item.ttfbHistogram)));
      return {
        requestCount, status2xx, status4xx, status5xx, timeoutCount, errorCount,
        errorRate: requestCount ? (status5xx + timeoutCount) / requestCount : 0,
        clientErrorRate: requestCount ? status4xx / requestCount : 0,
        concurrentMax: items.reduce((max, item) => Math.max(max, item.concurrentMax), 0),
        latency: histogramSummary(histogram), ttfb: histogramSummary(ttfb),
      };
    };
    const total = summarize(rows);
    const series = [...groups.entries()].map(([timestamp, items]) => ({
      timestamp, rps: items.reduce((sum, item) => sum + item.requestCount, 0) / window.stepSeconds,
      ...summarize(items),
    }));
    const endpointGroups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.method + ' ' + row.route;
      const group = endpointGroups.get(key) || [];
      group.push(row); endpointGroups.set(key, group);
    }
    const breakdown = [...endpointGroups.entries()].map(([endpoint, items]) => ({ endpoint, ...summarize(items) }))
      .sort((a, b) => b.requestCount - a.requestCount).slice(0, 50);
    return {
      meta: this.meta(window, rows.length === 0), current: series.at(-1) || null,
      summary: { ...total, averageRps: total.requestCount / window.seconds },
      series, breakdown,
    };
  }

  async infrastructure(component: string | null, rawRange?: string) {
    const window = this.parseRange(rawRange);
    const rows = await prisma.infrastructureMetricSample.findMany({
      where: { sampledAt: { gte: window.from }, ...(component ? { component: { startsWith: component } } : {}) },
      orderBy: { sampledAt: 'asc' },
    });
    const latest = new Map<string, typeof rows[number]>();
    for (const row of rows) latest.set(row.component, row);
    const seriesGroups = new Map<string, { timestamp: string; components: Record<string, unknown> }>();
    for (const row of rows) {
      const timestamp = floorTime(row.sampledAt, window.stepSeconds);
      const point = seriesGroups.get(timestamp) || { timestamp, components: {} };
      point.components[row.component] = { status: row.status, ...(row.metrics as object) };
      seriesGroups.set(timestamp, point);
    }
    const breakdown = [...latest.values()].map((row) => ({ component: row.component, status: row.status, sampledAt: row.sampledAt.toISOString(), ...(row.metrics as object) }));
    return {
      meta: this.meta(window, rows.length === 0),
      current: breakdown.length === 1 ? breakdown[0] : Object.fromEntries(breakdown.map((item) => [item.component, item])),
      summary: { samples: rows.length, components: breakdown.length },
      series: [...seriesGroups.values()].slice(-720), breakdown,
    };
  }

  async dependencies(dependency: string, rawRange?: string) {
    const window = this.parseRange(rawRange);
    const rows = await prisma.dependencyMetricBucket.findMany({ where: { dependency, bucketStart: { gte: window.from } }, orderBy: { bucketStart: 'asc' } });
    const histogram = mergeHistograms(rows.map((row) => parseHistogram(row.latencyHistogram)));
    const calls = rows.reduce((sum, row) => sum + row.callCount, 0);
    const errors = rows.reduce((sum, row) => sum + row.errorCount, 0);
    const slow = rows.reduce((sum, row) => sum + row.slowCount, 0);
    const byOperation = new Map<string, typeof rows>();
    for (const row of rows) { const group = byOperation.get(row.operation) || []; group.push(row); byOperation.set(row.operation, group); }
    const breakdown = [...byOperation.entries()].map(([operation, items]) => ({
      operation,
      calls: items.reduce((sum, item) => sum + item.callCount, 0),
      errors: items.reduce((sum, item) => sum + item.errorCount, 0),
      slow: items.reduce((sum, item) => sum + item.slowCount, 0),
      latency: histogramSummary(mergeHistograms(items.map((item) => parseHistogram(item.latencyHistogram)))),
    })).sort((a, b) => b.slow - a.slow).slice(0, 50);
    const seriesGroups = new Map<string, typeof rows>();
    for (const row of rows) {
      const timestamp = floorTime(row.bucketStart, window.stepSeconds);
      const group = seriesGroups.get(timestamp) || []; group.push(row); seriesGroups.set(timestamp, group);
    }
    const series = [...seriesGroups.entries()].map(([timestamp, items]) => {
      const pointCalls = items.reduce((sum, item) => sum + item.callCount, 0);
      const pointErrors = items.reduce((sum, item) => sum + item.errorCount, 0);
      return {
        timestamp, calls: pointCalls, errors: pointErrors,
        slow: items.reduce((sum, item) => sum + item.slowCount, 0),
        errorRate: pointCalls ? pointErrors / pointCalls : 0,
        latency: histogramSummary(mergeHistograms(items.map((item) => parseHistogram(item.latencyHistogram)))),
      };
    });
    return {
      meta: this.meta(window, rows.length === 0), current: series.at(-1) || null,
      summary: { calls, errors, slow, errorRate: calls ? errors / calls : 0, latency: histogramSummary(histogram), replicaLag: dependency === 'database' ? null : undefined },
      series, breakdown,
    };
  }

  async overview(rawRange?: string) {
    const [api, infrastructure] = await Promise.all([this.api(rawRange), this.infrastructure(null, rawRange)]);
    return {
      meta: api.meta,
      current: { api: api.current, infrastructure: infrastructure.current },
      summary: { api: api.summary, infrastructure: infrastructure.summary },
      series: api.series,
      breakdown: infrastructure.breakdown,
    };
  }
}
