import { redis } from '../../../cache/redis';
import { prisma } from '../../../database/prisma';
import {
  ResolvedHost,
  ResolvedTarget,
  ResolvedService,
} from './resolver.types';

export default class GatewayResolverService {
  private readonly cachePrefix = 'gateway:resolver';
  private readonly cacheTtlSeconds = 300;

  async resolveHost(rawHost: string): Promise<ResolvedHost> {
    const host = this.normalizeHost(rawHost);
    if (!host) {
      return null;
    }

    const cachedHost = await this.getCached<ResolvedHost>(this.getHostCacheKey(host));
    if (cachedHost !== undefined) {
      return cachedHost;
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
                serviceTypeId: true,
                serviceType: {
                  select: {
                    id: true,
                    description: true,
                  },
                },
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

    const resolvedHost = domain && domain.application.active ? {
      host: domain.host,
      domainId: domain.id,
      application: {
        id: domain.application.id,
        name: domain.application.name,
        slug: domain.application.slug,
        active: domain.application.active,
      },
      services: domain.application.services,
    } : null;

    await this.setCached(this.getHostCacheKey(host), resolvedHost);
    return resolvedHost;
  }

  async resolveTarget(rawHost: string, rawPath = '/', serviceType = 'http'): Promise<ResolvedTarget> {
    const path = this.normalizePath(rawPath);
    const host = this.normalizeHost(rawHost);
    const normalizedServiceType = this.normalizeServiceType(serviceType);
    if (!host) {
      return null;
    }

    const cachedTarget = await this.getCached<ResolvedTarget>(
      this.getTargetCacheKey(host, path, normalizedServiceType)
    );
    if (cachedTarget !== undefined) {
      return cachedTarget;
    }

    const resolvedHost = await this.resolveHost(host);
    if (!resolvedHost) {
      await this.setCached(this.getTargetCacheKey(host, path, normalizedServiceType), null);
      return null;
    }

    const service = this.selectService(resolvedHost.services, path, normalizedServiceType);

    if (!service) {
      await this.setCached(this.getTargetCacheKey(host, path, normalizedServiceType), null);
      return null;
    }

    const resolvedTarget = {
      host: resolvedHost.host,
      path,
      domainId: resolvedHost.domainId,
      application: resolvedHost.application,
      service,
    };

    await this.setCached(this.getTargetCacheKey(host, path, normalizedServiceType), resolvedTarget);
    return resolvedTarget;
  }

  private selectService(services: ResolvedService[], requestPath: string, serviceType: string) {
    if (services.length === 0) {
      return null;
    }

    const normalizedPath = this.normalizePath(requestPath);
    const normalizedServices = services
      .filter((service) => this.normalizeServiceType(service.serviceType?.description) === serviceType)
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

  private normalizeServiceType(serviceType?: string) {
    return serviceType?.trim().toLowerCase() || 'http';
  }

  private getHostCacheKey(host: string) {
    return `${this.cachePrefix}:host:${host}`;
  }

  private getTargetCacheKey(host: string, path: string, serviceType: string) {
    return `${this.cachePrefix}:target:${serviceType}:${host}:${path}`;
  }

  private async getCached<T>(key: string): Promise<T | null | undefined> {
    try {
      const rawValue = await redis.get(key);
      if (rawValue === null) {
        return undefined;
      }

      return JSON.parse(rawValue) as T | null;
    } catch {
      return undefined;
    }
  }

  private async setCached<T>(key: string, value: T | null) {
    try {
      await redis.setex(key, this.cacheTtlSeconds, JSON.stringify(value));
    } catch {
      // Cache failures should not block routing.
    }
  }
}
