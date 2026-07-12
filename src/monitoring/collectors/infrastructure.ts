import Redis from 'ioredis';
import { prisma } from '../../database/prisma';

const parseInfo = (raw: string) => Object.fromEntries(raw.split('\n').filter((line) => line && !line.startsWith('#')).map((line) => {
  const separator = line.indexOf(':');
  return [line.slice(0, separator), line.slice(separator + 1).trim()];
}));

const numeric = (data: Record<string, string>, key: string) => Number(data[key] || 0);

export class InfrastructureCollector {
  private readonly redis = new Redis({
    host: process.env.REDIS_HOST || 'redis',
    port: Number(process.env.REDIS_PORT || 6379),
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  private previousDatabase: Record<string, number> | null = null;
  private previousRedis: Record<string, number> | null = null;
  private readonly intervalSeconds = Number(process.env.METRICS_INTERVAL_SECONDS || 30);

  async collectApi() {
    const started = performance.now();
    try {
      const response = await fetch(process.env.API_PROBE_URL || 'http://gateway:9000/api/health/live', { signal: AbortSignal.timeout(3000) });
      return { component: 'api', status: response.ok ? 'up' : 'down', metrics: { latencyMs: performance.now() - started, statusCode: response.status } };
    } catch {
      return { component: 'api', status: 'down', metrics: { latencyMs: performance.now() - started, statusCode: null } };
    }
  }

  async collectRedis() {
    const started = performance.now();
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      const [memoryRaw, statsRaw, clientsRaw, latencyRaw] = await Promise.all([
        this.redis.info('memory'), this.redis.info('stats'), this.redis.info('clients'), this.redis.info('latencystats'),
      ]);
      const data = { ...parseInfo(memoryRaw), ...parseInfo(statsRaw), ...parseInfo(clientsRaw), ...parseInfo(latencyRaw) };
      const current = {
        hits: numeric(data, 'keyspace_hits'), misses: numeric(data, 'keyspace_misses'),
        evictions: numeric(data, 'evicted_keys'), commands: numeric(data, 'total_commands_processed'),
      };
      const delta = (key: keyof typeof current) => this.previousRedis && current[key] >= this.previousRedis[key] ? current[key] - this.previousRedis[key] : 0;
      const hitDelta = delta('hits'); const missDelta = delta('misses');
      this.previousRedis = current;
      return {
        component: 'redis', status: 'up', metrics: {
          latencyMs: performance.now() - started,
          memoryUsedBytes: numeric(data, 'used_memory'),
          memoryRssBytes: numeric(data, 'used_memory_rss'),
          memoryLimitBytes: numeric(data, 'maxmemory') || null,
          memoryPercent: numeric(data, 'maxmemory') ? numeric(data, 'used_memory') / numeric(data, 'maxmemory') * 100 : null,
          hits: current.hits, misses: current.misses,
          hitRate: hitDelta + missDelta ? hitDelta / (hitDelta + missDelta) : null,
          evictions: current.evictions, evictionsPerSecond: delta('evictions') / this.intervalSeconds,
          connectedClients: numeric(data, 'connected_clients'), blockedClients: numeric(data, 'blocked_clients'),
          operationsPerSecond: numeric(data, 'instantaneous_ops_per_sec'),
          commandsPerSecond: delta('commands') / this.intervalSeconds,
          rejectedConnections: numeric(data, 'rejected_connections'),
          totalErrorReplies: numeric(data, 'total_error_replies'),
        },
      };
    } catch {
      return { component: 'redis', status: 'down', metrics: { latencyMs: performance.now() - started } };
    }
  }

  async collectDatabase() {
    const started = performance.now();
    try {
      const [stats] = await prisma.$queryRawUnsafe<any[]>(`
        SELECT numbackends, xact_commit, xact_rollback, blks_read, blks_hit, deadlocks,
               blk_read_time, blk_write_time, pg_database_size(current_database()) AS database_size
        FROM pg_stat_database WHERE datname = current_database()`);
      const [settings] = await prisma.$queryRawUnsafe<any[]>(`SELECT current_setting('max_connections')::int AS max_connections`);
      let statementCalls = 0;
      let slowQueries: unknown[] = [];
      try {
        const [totals] = await prisma.$queryRawUnsafe<any[]>(`SELECT COALESCE(SUM(calls), 0)::bigint AS calls FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())`);
        statementCalls = Number(totals?.calls || 0);
        slowQueries = await prisma.$queryRawUnsafe<any[]>(`
          SELECT queryid::text AS "queryId", calls::bigint AS calls, mean_exec_time AS "meanMs",
                 max_exec_time AS "maxMs", total_exec_time AS "totalMs"
          FROM pg_stat_statements
          WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND mean_exec_time >= ${Number(process.env.SLOW_DATABASE_MS || 500)}
          ORDER BY total_exec_time DESC LIMIT 10`);
      } catch {}
      const current = {
        transactions: Number(stats.xact_commit || 0) + Number(stats.xact_rollback || 0),
        statementCalls, deadlocks: Number(stats.deadlocks || 0),
      };
      const delta = (key: keyof typeof current) => this.previousDatabase && current[key] >= this.previousDatabase[key] ? current[key] - this.previousDatabase[key] : 0;
      const hit = Number(stats.blks_hit || 0); const read = Number(stats.blks_read || 0);
      const metrics = {
        latencyMs: performance.now() - started,
        queriesPerSecond: delta('statementCalls') / this.intervalSeconds,
        transactionsPerSecond: delta('transactions') / this.intervalSeconds,
        connectionsUsed: Number(stats.numbackends || 0),
        connectionsMax: Number(settings.max_connections || 0),
        connectionPercent: Number(settings.max_connections) ? Number(stats.numbackends) / Number(settings.max_connections) * 100 : null,
        deadlocks: current.deadlocks, deadlocksDelta: delta('deadlocks'),
        cacheHitRate: hit + read ? hit / (hit + read) : null,
        databaseSizeBytes: Number(stats.database_size || 0),
        blockReadTimeMs: Number(stats.blk_read_time || 0),
        blockWriteTimeMs: Number(stats.blk_write_time || 0),
        slowQueries,
        replicaLag: null,
      };
      this.previousDatabase = current;
      return { component: 'database', status: 'up', metrics };
    } catch {
      return { component: 'database', status: 'down', metrics: { latencyMs: performance.now() - started, replicaLag: null } };
    }
  }

  async disconnect() {
    if (this.redis.status === 'ready') await this.redis.quit();
  }
}
