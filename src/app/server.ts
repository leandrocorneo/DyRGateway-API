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
import monitoringRoutes from '../modules/monitoring/monitoring.route';
import orchestrationRoutes from '../modules/orchestration/orchestration.route';
import { registerAuthGuard } from '../modules/auth/auth.guard';
import { registerApiMetrics } from '../monitoring/fastify';
import { flushApplicationMetrics, startMetricsFlushLoop } from '../monitoring/persistence/flush';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';

const app = Fastify({ logger: true });

app.register(cors, { origin: config.corsOrigin, credentials: true });
app.register(cookie);
app.register(jwt, { secret: config.jwtSecret });
registerAuthGuard(app);
registerApiMetrics(app);

app.register(healthRoutes, { prefix: '/api' });
app.register(domainRoutes, { prefix: '/api' });
app.register(servicesRoutes, { prefix: '/api' });
app.register(applicationsRoutes, { prefix: '/api' });
app.register(gatewayRoutes, { prefix: '/api' });
app.register(userRoutes, { prefix: '/api' });
app.register(authRoutes, { prefix: '/api' });
app.register(monitoringRoutes, { prefix: '/api' });
app.register(orchestrationRoutes, { prefix: '/api' });
app.register(gatewayProxyRoutes);
registerGatewayWebSocketProxy(app);

let metricsTimer: NodeJS.Timeout | undefined;
const gracefulShutdown = async (_signal: string) => {
  if (metricsTimer) clearInterval(metricsTimer);
  await flushApplicationMetrics(true).catch(() => undefined);
  await app.close();
  await disconnectDatabase();
  await disconnectRedis();
  process.exit(0);
};

['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => void gracefulShutdown(signal)));

const start = async () => {
  try {
    await connectDatabase();
    await connectRedis();
    await app.listen({ port: config.port, host: '0.0.0.0' });
    metricsTimer = startMetricsFlushLoop();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
