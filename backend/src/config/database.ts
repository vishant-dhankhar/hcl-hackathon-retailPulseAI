import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { config } from './env.js';
// Reuse one bounded pool. Neon pooled URL is for runtime; migrations use DIRECT_URL.
export const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: config.DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 15_000,
  }),
});
