import { createHistogram, HistogramSnapshot, observeHistogram } from './histogram';

export type ApiMetricInput = {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  ttfbMs?: number;
  timeout?: boolean;
  error?: boolean;
  applicationId?: string | null;
  serviceId?: string | null;
  concurrent?: number;
};

type ApiBucket = {
  bucketStart: Date;
  method: string;
  route: string;
  applicationId: string | null;
  serviceId: string | null;
  requestCount: number;
  status2xx: number;
  status4xx: number;
  status5xx: number;
  timeoutCount: number;
  errorCount: number;
  concurrentMax: number;
  latencyHistogram: HistogramSnapshot;
  ttfbHistogram: HistogramSnapshot;
};

type DependencyBucket = {
  bucketStart: Date;
  dependency: string;
  operation: string;
  callCount: number;
  errorCount: number;
  slowCount: number;
  latencyHistogram: HistogramSnapshot;
};

const floorDate = (date: Date, seconds: number) =>
  new Date(Math.floor(date.getTime() / (seconds * 1000)) * seconds * 1000);

class MetricsRegistry {
  private apiBuckets = new Map<string, ApiBucket>();
  private dependencyBuckets = new Map<string, DependencyBucket>();
  private inFlight = 0;
  private readonly intervalSeconds = Number(process.env.METRICS_INTERVAL_SECONDS || 30);

  beginRequest() {
    this.inFlight += 1;
    let finished = false;
    return {
      concurrent: this.inFlight,
      finish: () => {
        if (finished) return;
        finished = true;
        this.inFlight = Math.max(0, this.inFlight - 1);
      },
    };
  }

  recordApi(input: ApiMetricInput) {
    const bucketStart = floorDate(new Date(), this.intervalSeconds);
    const applicationId = input.applicationId || null;
    const serviceId = input.serviceId || null;
    const key = [bucketStart.toISOString(), input.method, input.route, applicationId || '', serviceId || ''].join('|');
    let bucket = this.apiBuckets.get(key);
    if (!bucket) {
      bucket = {
        bucketStart, method: input.method, route: input.route, applicationId, serviceId,
        requestCount: 0, status2xx: 0, status4xx: 0, status5xx: 0,
        timeoutCount: 0, errorCount: 0, concurrentMax: 0,
        latencyHistogram: createHistogram(), ttfbHistogram: createHistogram(),
      };
      this.apiBuckets.set(key, bucket);
    }
    bucket.requestCount += 1;
    if (input.statusCode >= 200 && input.statusCode < 300) bucket.status2xx += 1;
    else if (input.statusCode >= 400 && input.statusCode < 500) bucket.status4xx += 1;
    else if (input.statusCode >= 500) bucket.status5xx += 1;
    if (input.timeout) bucket.timeoutCount += 1;
    if (input.error || input.statusCode >= 500) bucket.errorCount += 1;
    bucket.concurrentMax = Math.max(bucket.concurrentMax, input.concurrent || this.inFlight);
    observeHistogram(bucket.latencyHistogram, input.durationMs);
    if (input.ttfbMs !== undefined) observeHistogram(bucket.ttfbHistogram, input.ttfbMs);
  }

  recordDependency(dependency: string, operation: string, durationMs: number, error: boolean, slowMs: number) {
    const bucketStart = floorDate(new Date(), this.intervalSeconds);
    const safeOperation = operation.slice(0, 120);
    const key = [bucketStart.toISOString(), dependency, safeOperation].join('|');
    let bucket = this.dependencyBuckets.get(key);
    if (!bucket) {
      bucket = {
        bucketStart, dependency, operation: safeOperation, callCount: 0,
        errorCount: 0, slowCount: 0, latencyHistogram: createHistogram(),
      };
      this.dependencyBuckets.set(key, bucket);
    }
    bucket.callCount += 1;
    if (error) bucket.errorCount += 1;
    if (durationMs >= slowMs) bucket.slowCount += 1;
    observeHistogram(bucket.latencyHistogram, durationMs);
  }

  drain(includeCurrent = false) {
    const currentBucket = floorDate(new Date(), this.intervalSeconds).getTime();
    const api = [...this.apiBuckets.entries()]
      .filter(([, value]) => includeCurrent || value.bucketStart.getTime() < currentBucket)
      .map(([bucketKey, value]) => ({ bucketKey, ...value }));
    const dependencies = [...this.dependencyBuckets.entries()]
      .filter(([, value]) => includeCurrent || value.bucketStart.getTime() < currentBucket)
      .map(([bucketKey, value]) => ({ bucketKey, ...value }));
    api.forEach((item) => this.apiBuckets.delete(item.bucketKey));
    dependencies.forEach((item) => this.dependencyBuckets.delete(item.bucketKey));
    return { api, dependencies };
  }

  restore(data: ReturnType<MetricsRegistry['drain']>) {
    for (const item of data.api) {
      const { bucketKey, ...bucket } = item;
      this.apiBuckets.set(bucketKey, bucket);
    }
    for (const item of data.dependencies) {
      const { bucketKey, ...bucket } = item;
      this.dependencyBuckets.set(bucketKey, bucket);
    }
  }
}

export const metricsRegistry = new MetricsRegistry();
