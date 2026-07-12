import { redis } from '../../cache/redis';
import { prisma } from '../../database/prisma';

export default class HealthService {
  async checkHealth() {
    let dbStatus = 'ok'; let redisStatus = 'ok';
    const dbStarted = performance.now();
    try { await prisma.$queryRaw`SELECT 1`; } catch { dbStatus = 'error'; }
    const databaseLatencyMs = performance.now() - dbStarted;
    const redisStarted = performance.now();
    try { await redis.ping(); } catch { redisStatus = 'error'; }
    const redisLatencyMs = performance.now() - redisStarted;
    const isHealthy = dbStatus === 'ok' && redisStatus === 'ok';
    return {
      dbStatus, redisStatus, status: isHealthy ? 200 : 503,
      databaseLatencyMs, redisLatencyMs, uptimeSeconds: process.uptime(),
    };
  }
}
