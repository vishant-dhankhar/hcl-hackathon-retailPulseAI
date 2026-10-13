import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { config } from './config/env.js';
import { db } from './config/database.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRoutes } from './routes/auth.routes.js';
import { catalogueRoutes } from './routes/catalogue.routes.js';
import { shoppingRoutes } from './routes/shopping.routes.js';
import { operationsRoutes } from './routes/operations.routes.js';
import { knowledgeRoutes } from './routes/knowledge.routes.js';
import { assistantRoutes } from './routes/assistant.routes.js';
import { chatKey, embeddingKey } from './services/ai.service.js';
export const app = express();
app.disable('x-powered-by');
// Vercel terminates HTTPS and forwards requests through its trusted edge proxy.
if (process.env.VERCEL) app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.APP_ORIGIN, credentials: true }));
app.use((_req, res, next) => {
  res.locals.requestId = randomUUID();
  res.setHeader('x-request-id', res.locals.requestId);
  next();
});
app.use(express.json({ limit: '100kb' }), cookieParser());
app.use(
  '/api',
  rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }),
);
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'retailpulse-api' }));
app.get('/api/ready', async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({
      status: 'ready',
      aiConfigured: Boolean(chatKey()),
      embeddingsConfigured: Boolean(embeddingKey()),
    });
  } catch {
    res.status(503).json({ status: 'database-unavailable' });
  }
});
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1', catalogueRoutes);
app.use('/api/v1', shoppingRoutes);
app.use('/api/v1/operations', operationsRoutes);
app.use('/api/v1/knowledge', knowledgeRoutes);
app.use('/api/v1/assistant', assistantRoutes);
app.use((_req, res) =>
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Endpoint not found.', requestId: res.locals.requestId },
  }),
);
app.use(errorHandler);
export default app;
