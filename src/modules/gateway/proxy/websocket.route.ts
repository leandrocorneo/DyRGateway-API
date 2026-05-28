import { FastifyInstance } from 'fastify';
import { Duplex } from 'stream';
import GatewayService from '../gateway.service';

const closeUpgradeConnection = (
  socket: Duplex,
  statusCode: number,
  message: string
) => {
  const body = JSON.stringify({ message });
  socket.end(
    `HTTP/1.1 ${statusCode} ${message}\r\n` +
    'Connection: close\r\n' +
    'Content-Type: application/json; charset=utf-8\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    '\r\n' +
    body
  );
};

export const registerGatewayWebSocketProxy = (fastify: FastifyInstance) => {
  const gatewayService = new GatewayService();

  fastify.server.on('upgrade', async (request, socket, head) => {
    const requestPath = request.url?.split('?')[0] || '/';
    if (requestPath.startsWith('/api')) {
      closeUpgradeConnection(socket, 404, 'Route not found');
      return;
    }

    const host = request.headers.host;
    if (!host) {
      closeUpgradeConnection(socket, 400, 'host header is required');
      return;
    }

    try {
      const target = await gatewayService.resolveTarget(host, request.url || '/', 'websocket');
      if (!target) {
        closeUpgradeConnection(socket, 404, 'No websocket target found for provided host/path');
        return;
      }

      await gatewayService.forwardWebSocket({
        request,
        socket,
        head,
        target,
      });
    } catch (error) {
      fastify.log.error({ err: error, host, path: request.url }, 'WebSocket proxy failed');
      socket.destroy(error as Error);
    }
  });
};
