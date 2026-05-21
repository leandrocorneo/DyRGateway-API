import httpProxy from 'http-proxy';
import { IncomingMessage } from 'http';
import { ProxyHttpRequest } from './proxy.types';

export default class GatewayProxyService {
  private readonly proxy: httpProxy;

  constructor() {
    this.proxy = httpProxy.createProxyServer({
      changeOrigin: false,
      xfwd: false,
      secure: false,
      ws: true,
    });

    this.proxy.on('proxyRes', (proxyRes, request) => {
      const locationHeader = proxyRes.headers.location;
      if (!locationHeader || Array.isArray(locationHeader)) {
        return;
      }

      const protocol = this.getRequestProtocol(request);
      if (protocol !== 'https') {
        return;
      }

      try {
        const locationUrl = new URL(locationHeader);

        // Avoid redirects like https://example.com:80/...
        if (locationUrl.protocol === 'https:' && locationUrl.port === '80') {
          locationUrl.port = '';
          proxyRes.headers.location = locationUrl.toString();
        }
      } catch {
        // Ignore relative locations or non-URL values.
      }
    });
  }

  async forwardRequest({ request, response, target }: ProxyHttpRequest) {
    const targetUrl = `http://${target.service.targetHost}:${target.service.targetPort}`;
    const protocol = this.getRequestProtocol(request);
    const hostHeader = this.getHostHeader(request);
    const hostWithoutPort = this.getHostWithoutPort(hostHeader);

    const forwardedPortFromHeader = this.getLastHeaderValue(request.headers['x-forwarded-port']);
    const forwardedPort =
      forwardedPortFromHeader ||
      (protocol === 'https' ? '443' : '80');

    return new Promise<void>((resolve, reject) => {
      const handleFinish = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        response.removeListener('finish', handleFinish);
        response.removeListener('close', handleFinish);
      };

      response.once('finish', handleFinish);
      response.once('close', handleFinish);

      this.proxy.web(
        request,
        response,
        {
          target: targetUrl,
          autoRewrite: true,
          protocolRewrite: protocol,
          hostRewrite: hostWithoutPort || undefined,
          headers: {
            host: hostWithoutPort || hostHeader,
            'x-forwarded-host': hostWithoutPort || hostHeader,
            'x-forwarded-proto': protocol,
            'x-forwarded-port': forwardedPort,
          },
        },
        (error: Error) => {
          cleanup();
          reject(error);
        }
      );
    });
  }

  private getRequestProtocol(request: IncomingMessage) {
    const headerValue = this.getLastHeaderValue(request.headers['x-forwarded-proto']);
    if (headerValue === 'https' || headerValue === 'http') {
      return headerValue;
    }

    return 'encrypted' in request.socket ? 'https' : 'http';
  }

  private getHostHeader(request: IncomingMessage) {
    const hostHeader = request.headers.host;
    if (!hostHeader) {
      return '';
    }

    return hostHeader.trim();
  }

  private getHostWithoutPort(hostHeader: string) {
    return hostHeader.replace(/:\d+$/, '');
  }

  private getLastHeaderValue(value?: string | string[]) {
    if (!value) {
      return '';
    }

    const rawValue = Array.isArray(value) ? value[value.length - 1] : value;
    return rawValue.split(',').map((item) => item.trim()).filter(Boolean).pop() || '';
  }
}
