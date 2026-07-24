import tls from 'node:tls';
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import { describeContainerOrchestration } from '../orchestration/orchestration.types';
import { RoutingError, UpdateRoutingPreferenceDTO } from './routing.types';

const TLS_BASE_DOMAIN = 'bellaflor.site';
const TLS_TIMEOUT_MS = 3000;

type Port = {
  containerPort: number;
  protocol: string;
  hostIp: string | null;
  hostPort: number | null;
  published: boolean;
};

type ContainerSummary = {
  id: string;
  name: string;
  image: string;
  compose: { project: string; service: string | null; containerNumber: number | null } | null;
  state: string;
  health: string | null;
  ports: Port[];
  orchestration: ReturnType<typeof describeContainerOrchestration>;
};

const asPorts = (value: unknown): Port[] => Array.isArray(value) ? value.filter((item) => item && typeof item === 'object').map((item: any) => ({
  containerPort: Number(item.containerPort),
  protocol: String(item.protocol || 'tcp'),
  hostIp: item.hostIp || null,
  hostPort: item.hostPort === null || item.hostPort === undefined ? null : Number(item.hostPort),
  published: Boolean(item.published),
})).filter((item) => Number.isInteger(item.containerPort)) : [];

const containerSummary = (container: any): ContainerSummary => ({
  id: container.id,
  name: container.name,
  image: container.image,
  compose: container.composeProject ? {
    project: container.composeProject,
    service: container.composeService,
    containerNumber: container.composeContainerNumber,
  } : null,
  state: container.state,
  health: container.health,
  ports: asPorts(container.ports),
  orchestration: describeContainerOrchestration({
    name: container.name,
    state: container.state,
    composeProject: container.composeProject,
  }, {
    protectedProjects: config.docker.protectedProjects,
    protectedContainerNames: config.docker.protectedContainerNames,
  }),
});

const normalize = (value: string | null | undefined) => (value || '').trim().toLowerCase();

const hostCandidates = (container: ContainerSummary) => {
  const names = new Set<string>([container.name]);
  if (container.compose?.service) names.add(container.compose.service);
  if (container.compose?.project && container.compose.service) {
    names.add(`${container.compose.project}-${container.compose.service}`);
    names.add(`${container.compose.project}_${container.compose.service}`);
    names.add(`${container.compose.service}.${container.compose.project}`);
  }
  return [...names].map(normalize).filter(Boolean);
};

const scoreContainer = (container: ContainerSummary, targetHost: string, targetPort: number) => {
  const host = normalize(targetHost);
  const candidates = hostCandidates(container);
  const hostScore = candidates.includes(host) ? 5 : candidates.some((candidate) => host.includes(candidate) || candidate.includes(host)) ? 2 : 0;
  const portScore = container.ports.some((port) => port.containerPort === targetPort) ? 4
    : container.ports.some((port) => port.hostPort === targetPort) ? 2
      : 0;
  const stateScore = container.state === 'running' ? 1 : 0;
  const score = hostScore + portScore + stateScore;
  return score >= 5 ? score : 0;
};

const suggestContainer = (containers: ContainerSummary[], targetHost: string, targetPort: number) => containers
  .map((container) => ({ container, score: scoreContainer(container, targetHost, targetPort) }))
  .filter((item) => item.score > 0)
  .sort((left, right) => right.score - left.score || left.container.name.localeCompare(right.container.name))[0]?.container || null;

const shouldCheckTls = (host: string) => {
  const normalized = normalize(host);
  return normalized === TLS_BASE_DOMAIN || normalized.endsWith('.' + TLS_BASE_DOMAIN);
};

const checkTls = (host: string) => new Promise<{ status: string; checkedAt: string; issuer: string | null; validTo: string | null; error: string | null }>((resolve) => {
  const checkedAt = new Date().toISOString();
  if (!shouldCheckTls(host)) {
    resolve({ status: 'not-applicable', checkedAt, issuer: null, validTo: null, error: null });
    return;
  }

  const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: TLS_TIMEOUT_MS });
  const finish = (value: { status: string; issuer: string | null; validTo: string | null; error: string | null }) => {
    socket.destroy();
    resolve({ checkedAt, ...value });
  };

  socket.once('secureConnect', () => {
    const cert = socket.getPeerCertificate();
    const validToDate = cert.valid_to ? new Date(cert.valid_to) : null;
    const validTo = validToDate && Number.isFinite(validToDate.getTime()) ? validToDate.toISOString() : null;
    const expired = validToDate ? validToDate.getTime() <= Date.now() : false;
    const issuer = typeof cert.issuer === 'object' ? [cert.issuer.O, cert.issuer.CN].filter(Boolean).join(' / ') || null : null;
    finish({
      status: expired ? 'expired' : socket.authorized ? 'valid' : 'invalid',
      issuer,
      validTo,
      error: socket.authorizationError ? String(socket.authorizationError) : null,
    });
  });
  socket.once('timeout', () => finish({ status: 'unavailable', issuer: null, validTo: null, error: 'TLS check timed out' }));
  socket.once('error', (error) => finish({ status: 'unavailable', issuer: null, validTo: null, error: error.message }));
});

export default class RoutingService {
  async overview() {
    const [domains, containers, preferences] = await Promise.all([
      prisma.domain.findMany({
        orderBy: { host: 'asc' },
        include: {
          application: {
            include: { services: { orderBy: { createdAt: 'asc' } } },
          },
        },
      }),
      prisma.monitoredContainer.findMany({ where: { present: true }, orderBy: [{ composeProject: 'asc' }, { composeService: 'asc' }, { name: 'asc' }] }),
      prisma.routingContainerPreference.findMany(),
    ]);
    const containerItems = containers.map(containerSummary);
    const containerById = new Map(containerItems.map((container) => [container.id, container]));
    const preferenceByService = new Map(preferences.map((preference) => [preference.serviceId, preference.containerId]));
    const tlsByHost = new Map((await Promise.all(domains.map(async (domain) => [domain.host, await checkTls(domain.host)] as const))));

    const entries: any[] = domains.flatMap((domain): any[] => {
      const services = domain.application.services;
      if (!services.length) {
        return [{
          domain: { id: domain.id, host: domain.host, createdAt: domain.createdAt.toISOString() },
          application: { id: domain.application.id, name: domain.application.name, slug: domain.application.slug, active: domain.application.active },
          service: null,
          target: null,
          tls: tlsByHost.get(domain.host)!,
          suggestedContainer: null,
          selectedContainer: null,
          preference: null,
          matchSource: 'none',
        }];
      }
      return services.map((service) => {
        const suggested = suggestContainer(containerItems, service.targetHost, service.targetPort);
        const preferredId = preferenceByService.get(service.id) || null;
        const selected = preferredId ? containerById.get(preferredId) || null : null;
        return {
          domain: { id: domain.id, host: domain.host, createdAt: domain.createdAt.toISOString() },
          application: { id: domain.application.id, name: domain.application.name, slug: domain.application.slug, active: domain.application.active },
          service: {
            id: service.id,
            path: service.path,
            targetHost: service.targetHost,
            targetPort: service.targetPort,
            active: service.active,
          },
          target: { host: service.targetHost, port: service.targetPort },
          tls: tlsByHost.get(domain.host)!,
          suggestedContainer: suggested,
          selectedContainer: selected,
          preference: preferredId ? { serviceId: service.id, containerId: preferredId, valid: Boolean(selected) } : null,
          matchSource: selected ? 'preference' : suggested ? 'suggestion' : 'none',
        };
      });
    });

    return {
      meta: { generatedAt: new Date().toISOString(), tlsBaseDomain: TLS_BASE_DOMAIN },
      summary: {
        domains: domains.length,
        routes: entries.filter((entry) => entry.service).length,
        tlsValid: entries.filter((entry) => entry.tls.status === 'valid').length,
        tlsProblems: entries.filter((entry) => ['invalid', 'expired', 'unavailable'].includes(entry.tls.status)).length,
        suggested: entries.filter((entry) => entry.suggestedContainer).length,
        selected: entries.filter((entry) => entry.selectedContainer).length,
      },
      containers: containerItems,
      entries,
    };
  }

  async updatePreference(serviceId: string, data: UpdateRoutingPreferenceDTO) {
    if (!serviceId) throw new RoutingError(400, 'serviceId is required');
    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new RoutingError(404, 'Service not found');

    if (!data || !('containerId' in data)) throw new RoutingError(400, 'containerId is required');
    const containerId = typeof data.containerId === 'string' ? data.containerId.trim() : null;
    if (!containerId) {
      await prisma.routingContainerPreference.deleteMany({ where: { serviceId } });
      return { serviceId, containerId: null, cleared: true };
    }

    const container = await prisma.monitoredContainer.findFirst({ where: { id: containerId, present: true } });
    if (!container) throw new RoutingError(404, 'Container not found');
    const preference = await prisma.routingContainerPreference.upsert({
      where: { serviceId },
      create: { serviceId, containerId },
      update: { containerId },
    });
    return preference;
  }
}