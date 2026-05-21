import { redis } from "../../cache/redis";
import { prisma } from "../../database/prisma";

export default class HealthService {

  async checkHealth() {
    let dbStatus = "ok";
    let redisStatus = "ok";

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      dbStatus = "error";
    }

    try {
      await redis.ping();
    } catch (e) {
      redisStatus = "error";
    }

    const isHealthy = dbStatus === "ok" && redisStatus === "ok";
    const status = isHealthy ? 200 : 503;

    return { dbStatus, redisStatus, status };
  }
  
}
