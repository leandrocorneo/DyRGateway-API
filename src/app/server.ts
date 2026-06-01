import Fastify from 'fastify';
import { config } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../database/prisma';
import { connectRedis, disconnectRedis } from '../cache/redis';
import healthRoutes from '../modules/health/health.route';
import domainRoutes from '../modules/domains/domains.route';
import servicesRoutes from '../modules/services/services.route';
import applicationsRoutes from '../modules/applications/applications.route';
import gatewayRoutes from '../modules/gateway/gateway.route';
import gatewayProxyRoutes from '../modules/gateway/proxy/proxy.route';
import { registerGatewayWebSocketProxy } from '../modules/gateway/proxy/websocket.route';
import userRoutes from '../modules/users/user.routes';
import authRoutes from '../modules/auth/auth.routes';
import { registerAuthGuard } from '../modules/auth/auth.guard';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';

const app = Fastify({
  logger: true,
});


app.register(cookie);

app.register(jwt, {
  secret: process.env.JWT_SECRET || 'defaultsecret',
});

registerAuthGuard(app);

app.register(healthRoutes, {
  prefix: '/api',
});

app.register(domainRoutes, {
  prefix: '/api',
});

app.register(servicesRoutes, {
  prefix: '/api',
});

app.register(applicationsRoutes, {
  prefix: '/api',
});

app.register(gatewayRoutes, {
  prefix: '/api',
});

app.register(userRoutes, {
  prefix: '/api',
});

app.register(authRoutes, {
  prefix: '/api',
});

app.register(gatewayProxyRoutes);
registerGatewayWebSocketProxy(app);

const gracefulShutdown = async (signal: string) => {
  await app.close();
  await disconnectDatabase();
  await disconnectRedis();
  process.exit(0);
};

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => gracefulShutdown(signal));
});

const start = async () => {
  try {
    await connectDatabase();
    await connectRedis();

    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
