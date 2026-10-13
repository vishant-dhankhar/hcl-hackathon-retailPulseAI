import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/env.js';
import { HttpError } from '../errors/HttpError.js';
export function cookieGuard(req: Request, _res: Response, next: NextFunction) {
  if (req.headers.origin !== config.APP_ORIGIN || req.headers['x-requested-with'] !== 'RetailPulse')
    return next(new HttpError(403, 'FORBIDDEN', 'Invalid session request origin.'));
  next();
}
