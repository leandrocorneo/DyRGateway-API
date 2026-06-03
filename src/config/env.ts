import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  jwtSecret: process.env.JWT_SECRET || 'defaultsecret',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:9100',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/dyr_gateway',
};