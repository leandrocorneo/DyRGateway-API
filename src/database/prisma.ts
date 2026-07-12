import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { metricsRegistry } from '../monitoring/core/registry';

export const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
    { level: 'info', emit: 'stdout' },
    { level: 'warn', emit: 'stdout' },
    { level: 'error', emit: 'stdout' },
  ],
});

const normalizeQuery = (query: string) => {
  const operation = query.trim().split(/\s+/)[0]?.toUpperCase() || 'QUERY';
  const relation = query.match(/(?:FROM|INTO|UPDATE|JOIN)\s+"?(?:public"?\.)?"?([a-zA-Z0-9_]+)/i)?.[1] || 'unknown';
  const fingerprint = createHash('sha256').update(query.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);
  return operation + ':' + relation + ':' + fingerprint;
};

prisma.$on('query', (event) => {
  metricsRegistry.recordDependency(
    'database',
    normalizeQuery(event.query),
    event.duration,
    false,
    Number(process.env.SLOW_DATABASE_MS || 500)
  );
});

export const connectDatabase = async () => {
  try { await prisma.$connect(); }
  catch (error) { console.error('Failed to connect to PostgreSQL:', error); process.exit(1); }
};

export const disconnectDatabase = async () => { await prisma.$disconnect(); };
