import { createHash } from 'node:crypto';

export type DockerContainerSummary = {
  Id: string;
  Names: string[];
  Image: string;
  Created: number;
  State: string;
  Labels: Record<string, string>;
  SizeRw?: number;
};

export type ContainerIdentity = {
  id: string;
  identityKey: string;
  identitySource: 'compose' | 'name';
  name: string;
  composeProject: string | null;
  composeService: string | null;
  composeContainerNumber: number | null;
};

const normalizedName = (container: DockerContainerSummary) =>
  (container.Names?.[0] || container.Id.slice(0, 12)).replace(/^\//, '').trim();

export const containerTargetId = (identityKey: string) => {
  const hash = createHash('sha256').update('dyrgateway-container:' + identityKey).digest('hex').slice(0, 32).split('');
  hash[12] = '5';
  hash[16] = ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8).join('')}-${hash.slice(8, 12).join('')}-${hash.slice(12, 16).join('')}-${hash.slice(16, 20).join('')}-${hash.slice(20).join('')}`;
};

export const getContainerIdentity = (container: DockerContainerSummary): ContainerIdentity => {
  const name = normalizedName(container);
  const project = container.Labels?.['com.docker.compose.project']?.trim() || null;
  const service = container.Labels?.['com.docker.compose.service']?.trim() || null;
  const rawNumber = container.Labels?.['com.docker.compose.container-number'];
  const number = rawNumber && Number.isInteger(Number(rawNumber)) ? Number(rawNumber) : null;
  const hasComposeIdentity = Boolean(project && service && number !== null);
  const identityKey = hasComposeIdentity
    ? `compose:${project!.toLowerCase()}:${service!.toLowerCase()}:${number}`
    : `name:${name.toLowerCase()}`;

  return {
    id: containerTargetId(identityKey),
    identityKey,
    identitySource: hasComposeIdentity ? 'compose' : 'name',
    name,
    composeProject: hasComposeIdentity ? project : null,
    composeService: hasComposeIdentity ? service : null,
    composeContainerNumber: hasComposeIdentity ? number : null,
  };
};

export const selectCanonicalContainers = (containers: DockerContainerSummary[]) => {
  const selected = new Map<string, DockerContainerSummary>();
  for (const container of containers) {
    const key = getContainerIdentity(container).identityKey;
    const current = selected.get(key);
    if (!current) {
      selected.set(key, container);
      continue;
    }
    const runningDelta = Number(container.State === 'running') - Number(current.State === 'running');
    if (runningDelta > 0 || (runningDelta === 0 && (container.Created > current.Created || (container.Created === current.Created && container.Id > current.Id)))) {
      selected.set(key, container);
    }
  }
  return [...selected.values()];
};

export const normalizeContainerStatus = (state: string | null | undefined, health: string | null | undefined) => {
  if (state !== 'running') return 'down';
  if (health === 'healthy' || health === 'unhealthy' || health === 'starting') return health;
  return 'up';
};

export const dockerCpuPercent = (stats: any): number | null => {
  if (!stats) return null;
  const cpuDelta = Number(stats.cpu_stats?.cpu_usage?.total_usage) - Number(stats.precpu_stats?.cpu_usage?.total_usage);
  const systemDelta = Number(stats.cpu_stats?.system_cpu_usage) - Number(stats.precpu_stats?.system_cpu_usage);
  const cpuCount = Number(stats.cpu_stats?.online_cpus || stats.cpu_stats?.cpu_usage?.percpu_usage?.length || 1);
  if (!Number.isFinite(cpuDelta) || !Number.isFinite(systemDelta) || systemDelta <= 0 || cpuDelta < 0) return null;
  return (cpuDelta / systemDelta) * cpuCount * 100;
};

export const parseDockerDate = (value: unknown): Date | null => {
  if (!value || typeof value !== 'string' || value.startsWith('0001-01-01')) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

export const calculateUptimeSeconds = (startedAt: Date | null, finishedAt: Date | null, running: boolean, now = new Date()) => {
  if (!startedAt) return null;
  const end = running ? now : finishedAt;
  if (!end || end < startedAt) return null;
  return Math.max(0, (end.getTime() - startedAt.getTime()) / 1000);
};

export const mapWithConcurrency = async <T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) => {
  if (items.length === 0) return [] as R[];
  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: limit }, run));
  return results;
};
