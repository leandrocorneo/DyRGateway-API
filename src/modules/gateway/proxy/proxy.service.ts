import httpProxy from 'http-proxy';
import { IncomingMessage } from 'http';
import { PassThrough } from 'stream';
import { ProxyHttpRequest, ProxyWebSocketRequest } from './proxy.types';

export default class GatewayProxyService {
  private readonly proxy: httpProxy;
  private readonly timeoutMs = Number(process.env.PROXY_TIMEOUT_MS || 30000);

  constructor() {
    this.proxy = httpProxy.createProxyServer({ changeOrigin: false, xfwd: false, secure: false, ws: true });
    this.proxy.on('proxyRes', (proxyRes, request) => {
      const locationHeader = proxyRes.headers.location;
      if (!locationHeader || Array.isArray(locationHeader) || this.getRequestProtocol(request) !== 'https') return;
      try {
        const locationUrl = new URL(locationHeader);
        if (locationUrl.protocol === 'https:' && locationUrl.port === '80') {
          locationUrl.port = '';
          proxyRes.headers.location = locationUrl.toString();
        }
      } catch {}
    });
  }

  async forwardRequest({ request, response, target, body, onProxyResponse }: ProxyHttpRequest) {
    const targetUrl = `http://${target.service.targetHost}:${target.service.targetPort}`;
    const protocol = this.getRequestProtocol(request);
    const hostHeader = this.getHostHeader(request);
    const hostWithoutPort = this.getHostWithoutPort(hostHeader);
    const forwardedPort = this.getLastHeaderValue(request.headers['x-forwarded-port']) || (protocol === 'https' ? '443' : '80');

    return new Promise<void>((resolve, reject) => {
      const handleFinish = () => { cleanup(); resolve(); };
      const handleProxyResponse = (proxyResponse: IncomingMessage, proxyRequest: IncomingMessage) => {
        if (proxyRequest === request) onProxyResponse?.(proxyResponse.statusCode || 502);
      };
      const cleanup = () => {
        response.removeListener('finish', handleFinish);
        response.removeListener('close', handleFinish);
        this.proxy.removeListener('proxyRes', handleProxyResponse as any);
      };
      response.once('finish', handleFinish);
      response.once('close', handleFinish);
      this.proxy.on('proxyRes', handleProxyResponse);
      const bufferStream = body ? this.createBufferStream(body) : undefined;
      this.proxy.web(request, response, {
        target: targetUrl, autoRewrite: true, protocolRewrite: protocol,
        hostRewrite: hostWithoutPort || undefined, buffer: bufferStream,
        timeout: this.timeoutMs, proxyTimeout: this.timeoutMs,
        headers: {
          host: hostWithoutPort || hostHeader,
          'x-forwarded-host': hostWithoutPort || hostHeader,
          'x-forwarded-proto': protocol, 'x-forwarded-port': forwardedPort,
        },
      }, (error: Error) => { cleanup(); reject(error); });
    });
  }

  async forwardWebSocket({ request, socket, head, target }: ProxyWebSocketRequest) {
    const targetUrl = `ws://${target.service.targetHost}:${target.service.targetPort}`;
    const protocol = this.getRequestProtocol(request);
    const hostHeader = this.getHostHeader(request);
    const hostWithoutPort = this.getHostWithoutPort(hostHeader);
    const forwardedPort = this.getLastHeaderValue(request.headers['x-forwarded-port']) || (protocol === 'https' ? '443' : '80');
    return new Promise<void>((resolve, reject) => {
      const handleClose = () => { cleanup(); resolve(); };
      const cleanup = () => { socket.removeListener('close', handleClose); };
      socket.once('close', handleClose);
      this.proxy.ws(request, socket, head, { target: targetUrl, timeout: this.timeoutMs, proxyTimeout: this.timeoutMs,
        headers: { host: hostWithoutPort || hostHeader, 'x-forwarded-host': hostWithoutPort || hostHeader, 'x-forwarded-proto': protocol, 'x-forwarded-port': forwardedPort },
      }, (error: Error) => { cleanup(); reject(error); });
    });
  }

  private getRequestProtocol(request: IncomingMessage) {
    const value = this.getLastHeaderValue(request.headers['x-forwarded-proto']);
    if (value === 'https' || value === 'http') return value;
    return 'encrypted' in request.socket ? 'https' : 'http';
  }
  private getHostHeader(request: IncomingMessage) { return request.headers.host?.trim() || ''; }
  private getHostWithoutPort(hostHeader: string) { return hostHeader.replace(/:\d+$/, ''); }
  private getLastHeaderValue(value?: string | string[]) {
    if (!value) return '';
    const rawValue = Array.isArray(value) ? value[value.length - 1] : value;
    return rawValue.split(',').map((item) => item.trim()).filter(Boolean).pop() || '';
  }
  private createBufferStream(body: Buffer) { const stream = new PassThrough(); stream.end(body); return stream; }
}
