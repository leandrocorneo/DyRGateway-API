import {
  DockerContainerSummary,
  calculateUptimeSeconds,
  dockerCpuPercent,
  getContainerIdentity,
  mapWithConcurrency,
  normalizeContainerStatus,
  parseDockerDate,
  selectCanonicalContainers,
} from '../core/container';

export type MonitoredContainerInput = {
  id: string;
  identityKey: string;
  identitySource: string;
  name: string;
  image: string;
  composeProject: string | null;
  composeService: string | null;
  composeContainerNumber: number | null;
  currentContainerId: string;
  state: string;
  health: string | null;
  mounts: Array<{ name: string; destination: string }>;
  containerCreatedAt: string | null;
  instanceStartedAt: string | null;
  observedAt: string;
};

export type DockerMetricCollectionItem = {
  container: MonitoredContainerInput;
  status: string;
  instanceId: string;
  metrics: Record<string, unknown>;
};

export type DockerCollectionResult = {
  observedAt: string;
  containers: DockerMetricCollectionItem[];
};

export type DockerJsonClient = <T>(path: string) => Promise<T>;

const dockerUrl = process.env.DOCKER_PROXY_URL || 'http://docker-proxy:2375';
const rawTimeoutMs = Number(process.env.DOCKER_METRICS_TIMEOUT_MS || 3000);
const rawConcurrency = Number(process.env.DOCKER_METRICS_CONCURRENCY || 6);
const requestTimeoutMs = Number.isFinite(rawTimeoutMs) ? Math.max(250, rawTimeoutMs) : 3000;
const configuredConcurrency = Number.isFinite(rawConcurrency) ? Math.max(1, Math.min(20, Math.floor(rawConcurrency))) : 6;

const getJson: DockerJsonClient = async <T>(path: string): Promise<T> => {
  const response = await fetch(dockerUrl + path, { signal: AbortSignal.timeout(requestTimeoutMs) });
  if (!response.ok) throw new Error('Docker API ' + response.status);
  return response.json() as Promise<T>;
};

const sumNetwork = (networks: Record<string, { rx_bytes?: number; tx_bytes?: number }> | undefined, field: 'rx_bytes' | 'tx_bytes') =>
  Object.values(networks || {}).reduce((sum, item) => sum + Number(item[field] || 0), 0);

const sumBlockIo = (entries: Array<{ op?: string; value?: number }> | undefined, operation: string) =>
  (entries || []).filter((item) => item.op?.toLowerCase() === operation).reduce((sum, item) => sum + Number(item.value || 0), 0);

const collectContainer = async (
  summary: DockerContainerSummary,
  observedAt: Date,
  volumeSizes: Map<string, number> | null,
  client: DockerJsonClient,
): Promise<DockerMetricCollectionItem> => {
  const identity = getContainerIdentity(summary);
  let inspect: any = null;
  let inspectFailed = false;
  try {
    inspect = await client<any>('/containers/' + summary.Id + '/json');
  } catch {
    inspectFailed = true;
  }

  const state = String(inspect?.State?.Status || summary.State || 'unknown').toLowerCase();
  const running = state === 'running';
  let stats: any = null;
  let statsFailed = false;
  if (running) {
    try {
      stats = await client<any>('/containers/' + summary.Id + '/stats?stream=false');
    } catch {
      statsFailed = true;
    }
  }

  const health = typeof inspect?.State?.Health?.Status === 'string' ? inspect.State.Health.Status : null;
  const startedAt = parseDockerDate(inspect?.State?.StartedAt);
  const finishedAt = parseDockerDate(inspect?.State?.FinishedAt);
  const volumeMounts = (inspect?.Mounts || [])
    .filter((mount: any) => mount.Type === 'volume' && typeof mount.Name === 'string')
    .map((mount: any) => ({ name: mount.Name, destination: String(mount.Destination || '') }));
  const memoryUsage = stats?.memory_stats
    ? Math.max(0, Number(stats.memory_stats.usage || 0) - Number(stats.memory_stats.stats?.inactive_file || 0))
    : null;
  const memoryLimit = stats?.memory_stats?.limit ? Number(stats.memory_stats.limit) : null;
  const storageAvailable = volumeSizes !== null;
  const containerCreatedAt = summary.Created
    ? new Date(summary.Created * 1000)
    : parseDockerDate(inspect?.Created);

  return {
    container: {
      ...identity,
      image: summary.Image || String(inspect?.Config?.Image || 'unknown'),
      currentContainerId: summary.Id,
      state,
      health,
      mounts: volumeMounts,
      containerCreatedAt: containerCreatedAt?.toISOString() || null,
      instanceStartedAt: startedAt?.toISOString() || null,
      observedAt: observedAt.toISOString(),
    },
    status: normalizeContainerStatus(state, health),
    instanceId: summary.Id,
    metrics: {
      uptimeSeconds: calculateUptimeSeconds(startedAt, finishedAt, running, observedAt),
      restartCount: inspect ? Number(inspect.RestartCount || 0) : null,
      cpuPercent: dockerCpuPercent(stats),
      memoryUsedBytes: memoryUsage,
      memoryLimitBytes: memoryLimit,
      memoryPercent: memoryUsage !== null && memoryLimit ? memoryUsage / memoryLimit * 100 : null,
      pids: stats ? Number(stats.pids_stats?.current || 0) : null,
      networkRxBytes: stats ? sumNetwork(stats.networks, 'rx_bytes') : null,
      networkTxBytes: stats ? sumNetwork(stats.networks, 'tx_bytes') : null,
      blockReadBytes: stats ? sumBlockIo(stats.blkio_stats?.io_service_bytes_recursive, 'read') : null,
      blockWriteBytes: stats ? sumBlockIo(stats.blkio_stats?.io_service_bytes_recursive, 'write') : null,
      writableLayerBytes: storageAvailable && summary.SizeRw !== undefined ? Number(summary.SizeRw) : null,
      volumes: volumeMounts.map((mount: { name: string; destination: string }) => ({
        name: mount.name,
        usedBytes: volumeSizes?.get(mount.name) ?? null,
      })),
      collectionError: inspectFailed || statsFailed,
      storageCollectionError: !storageAvailable,
    },
  };
};

export const collectDockerMetrics = async (client: DockerJsonClient = getJson): Promise<DockerCollectionResult> => {
  const observedAt = new Date();
  const listed = await client<DockerContainerSummary[]>('/containers/json?all=1&size=1');
  let volumeSizes: Map<string, number> | null = null;
  try {
    const disk = await client<{ Volumes?: Array<{ Name: string; UsageData?: { Size?: number } }> }>('/system/df?type=volume');
    volumeSizes = new Map((disk.Volumes || []).map((item) => [item.Name, Number(item.UsageData?.Size || 0)]));
  } catch {}

  const canonical = selectCanonicalContainers(listed);
  const containers = await mapWithConcurrency(canonical, configuredConcurrency, (container) =>
    collectContainer(container, observedAt, volumeSizes, client));
  return { observedAt: observedAt.toISOString(), containers };
};
