import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate } from '../middleware/authenticate.js';
import * as controller from '../controllers/assistant.controller.js';
export const assistantRoutes = Router();
const aiLimit = rateLimit({ windowMs: 60_000, limit: 15 });
assistantRoutes.use(authenticate);
assistantRoutes.post('/chat', aiLimit, controller.conversation);
assistantRoutes.post('/chat/actions/prepare', controller.prepare);
assistantRoutes.post('/chat/actions/confirm', controller.confirm);
// Opening action shortcuts does not consume the budget for model requests.
assistantRoutes.post('/ask', aiLimit, controller.ask);
assistantRoutes.get('/actions', controller.actions);
assistantRoutes.post('/recommend', aiLimit, controller.recommendations);
