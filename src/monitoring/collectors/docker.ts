type DockerContainer = {
  Id: string;
  Names: string[];
  Labels: Record<string, string>;
  SizeRw?: number;
};

const dockerUrl = process.env.DOCKER_PROXY_URL || 'http://docker-proxy:2375';

const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(dockerUrl + path, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Docker API ' + response.status);
  return response.json() as Promise<T>;
};

const sumNetwork = (networks: Record<string, { rx_bytes?: number; tx_bytes?: number }> | undefined, field: 'rx_bytes' | 'tx_bytes') =>
  Object.values(networks || {}).reduce((sum, item) => sum + Number(item[field] || 0), 0);

const sumBlockIo = (entries: Array<{ op?: string; value?: number }> | undefined, operation: string) =>
  (entries || []).filter((item) => item.op?.toLowerCase() === operation).reduce((sum, item) => sum + Number(item.value || 0), 0);

export const collectDockerMetrics = async () => {
  const filters = encodeURIComponent(JSON.stringify({ label: ['com.dyrgateway.component'] }));
  const containers = await getJson<DockerContainer[]>('/containers/json?all=1&size=1&filters=' + filters);
  const disk = await getJson<{ Volumes?: Array<{ Name: string; UsageData?: { Size?: number } }> }>('/system/df?type=volume');
  const volumeSizes = new Map((disk.Volumes || []).map((item) => [item.Name, Number(item.UsageData?.Size || 0)]));

  return Promise.all(containers.map(async (container) => {
    const component = container.Labels['com.dyrgateway.component'];
    const [stats, inspect] = await Promise.all([
      getJson<any>('/containers/' + container.Id + '/stats?stream=false'),
      getJson<any>('/containers/' + container.Id + '/json'),
    ]);
    const cpuDelta = Number(stats.cpu_stats?.cpu_usage?.total_usage || 0) - Number(stats.precpu_stats?.cpu_usage?.total_usage || 0);
    const systemDelta = Number(stats.cpu_stats?.system_cpu_usage || 0) - Number(stats.precpu_stats?.system_cpu_usage || 0);
    const cpuCount = Number(stats.cpu_stats?.online_cpus || stats.cpu_stats?.cpu_usage?.percpu_usage?.length || 1);
    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;
    const memoryUsage = Math.max(0, Number(stats.memory_stats?.usage || 0) - Number(stats.memory_stats?.stats?.inactive_file || 0));
    const volumes = (inspect.Mounts || []).filter((mount: any) => mount.Type === 'volume').map((mount: any) => ({
      name: mount.Name,
      destination: mount.Destination,
      usedBytes: volumeSizes.get(mount.Name) ?? null,
    }));
    return {
      component: 'container:' + component,
      status: inspect.State?.Running ? (inspect.State?.Health?.Status || 'up') : 'down',
      metrics: {
        containerId: container.Id.slice(0, 12),
        name: (container.Names?.[0] || '').replace(/^\//, ''),
        uptimeSeconds: inspect.State?.Running ? Math.max(0, (Date.now() - new Date(inspect.State.StartedAt).getTime()) / 1000) : 0,
        restartCount: Number(inspect.RestartCount || 0),
        cpuPercent,
        memoryUsedBytes: memoryUsage,
        memoryLimitBytes: Number(stats.memory_stats?.limit || 0) || null,
        memoryPercent: stats.memory_stats?.limit ? (memoryUsage / stats.memory_stats.limit) * 100 : null,
        pids: Number(stats.pids_stats?.current || 0),
        networkRxBytes: sumNetwork(stats.networks, 'rx_bytes'),
        networkTxBytes: sumNetwork(stats.networks, 'tx_bytes'),
        blockReadBytes: sumBlockIo(stats.blkio_stats?.io_service_bytes_recursive, 'read'),
        blockWriteBytes: sumBlockIo(stats.blkio_stats?.io_service_bytes_recursive, 'write'),
        writableLayerBytes: Number(container.SizeRw || 0),
        volumes,
      },
    };
  }));
};
