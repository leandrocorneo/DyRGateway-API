import { prisma } from '../../../database/prisma';
import {
  ResolvedHost,
  ResolvedTarget,
  ResolvedService,
} from './resolver.types';

export default class GatewayResolverService {
  async resolveHost(rawHost: string): Promise<ResolvedHost> {
    const host = this.normalizeHost(rawHost);
    if (!host) {
      return null;
    }

    const domain = await prisma.domain.findUnique({
      where: { host },
      include: {
        application: {
          select: {
            id: true,
            name: true,
            slug: true,
            active: true,
            services: {
              where: { active: true },
              select: {
                id: true,
                applicationId: true,
                type: true,
                path: true,
                targetHost: true,
                targetPort: true,
                active: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    if (!domain || !domain.application.active) {
      return null;
    }

    return {
      host: domain.host,
      domainId: domain.id,
      application: {
        id: domain.application.id,
        name: domain.application.name,
        slug: domain.application.slug,
        active: domain.application.active,
      },
      services: domain.application.services,
    };
  }

  async resolveTarget(rawHost: string, rawPath = '/'): Promise<ResolvedTarget> {
    const resolvedHost = await this.resolveHost(rawHost);
    if (!resolvedHost) {
      return null;
    }

    const path = this.normalizePath(rawPath);
    const service = this.selectService(resolvedHost.services, path);

    if (!service) {
      return null;
    }

    return {
      host: resolvedHost.host,
      path,
      domainId: resolvedHost.domainId,
      application: resolvedHost.application,
      service,
    };
  }

  private selectService(services: ResolvedService[], requestPath: string) {
    if (services.length === 0) {
      return null;
    }

    const normalizedPath = this.normalizePath(requestPath);
    const normalizedServices = services
      .filter((service) => service.type.toLowerCase() === 'http')
      .map((service) => ({
        ...service,
        path: this.normalizePath(service.path),
      }));

    const exactMatch = normalizedServices.find(
      (service) => service.path === normalizedPath
    );
    if (exactMatch) {
      return exactMatch;
    }

    const rootService = normalizedServices.find((service) => service.path === '/');
    if (rootService) {
      return rootService;
    }

    return normalizedServices[0] ?? null;
  }

  private normalizeHost(host: string) {
    const trimmedHost = host.trim().toLowerCase();
    if (!trimmedHost) {
      return '';
    }

    return trimmedHost.split(':')[0];
  }

  private normalizePath(path: string) {
    const trimmedPath = path.trim();
    if (!trimmedPath) {
      return '/';
    }

    const withoutQueryString = trimmedPath.split('?')[0];
    return withoutQueryString.startsWith('/')
      ? withoutQueryString
      : `/${withoutQueryString}`;
  }
}
