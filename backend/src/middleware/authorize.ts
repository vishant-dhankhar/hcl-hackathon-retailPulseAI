import type { Request, Response, NextFunction } from 'express';
import type { Role } from '../generated/prisma/enums.js';
import { assert, HttpError } from '../errors/HttpError.js';
export type Actor = Request['actor'];
export const roles =
  (...allowed: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!allowed.includes(req.actor.role))
      return next(new HttpError(403, 'FORBIDDEN', 'You do not have permission for this action.'));
    next();
  };
export function storeAccess(actor: Actor, locationId: string) {
  assert(
    actor.role === 'ADMIN' ||
      (actor.role === 'STORE_MANAGER' && actor.storeIds.includes(locationId)),
    403,
    'FORBIDDEN',
    'This location is outside your assigned stores.',
  );
}
