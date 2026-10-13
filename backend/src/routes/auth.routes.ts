import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate } from '../middleware/authenticate.js';
import { cookieGuard } from '../middleware/cookieGuard.js';
import * as controller from '../controllers/auth.controller.js';
export const authRoutes = Router();
authRoutes.use(
  rateLimit({ windowMs: 15 * 60_000, limit: 80, standardHeaders: 'draft-8', legacyHeaders: false }),
);
authRoutes.post('/register', controller.register);
authRoutes.post('/login', controller.login);
authRoutes.post('/refresh', cookieGuard, controller.refresh);
authRoutes.post('/logout', cookieGuard, controller.logout);
authRoutes.get('/me', authenticate, controller.me);
authRoutes.patch('/me', authenticate, controller.updateProfile);
