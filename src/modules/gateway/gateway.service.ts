import GatewayResolverService from './resolver/resolver.service';
import GatewayProxyService from './proxy/proxy.service';
import { ProxyHttpRequest, ProxyWebSocketRequest } from './proxy/proxy.types';

export default class GatewayService {
  private readonly resolver: GatewayResolverService;
  private readonly proxy: GatewayProxyService;

  constructor(
    resolver = new GatewayResolverService(),
    proxy = new GatewayProxyService()
  ) {
    this.resolver = resolver;
    this.proxy = proxy;
  }

  async resolveHost(host: string) {
    if (!host?.trim()) {
      throw new Error('host is required');
    }

    return this.resolver.resolveHost(host);
  }

  async resolveTarget(host: string, path = '/', serviceType = 'http') {
    if (!host?.trim()) {
      throw new Error('host is required');
    }

    return this.resolver.resolveTarget(host, path, serviceType);
  }

  async forwardRequest(request: ProxyHttpRequest) {
    return this.proxy.forwardRequest(request);
  }

  async forwardWebSocket(request: ProxyWebSocketRequest) {
    return this.proxy.forwardWebSocket(request);
  }
}
