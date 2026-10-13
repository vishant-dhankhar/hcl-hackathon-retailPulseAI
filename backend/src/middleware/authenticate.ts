import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../config/database.js';
import { config } from '../config/env.js';
import { assert, HttpError } from '../errors/HttpError.js';
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const bearer = req.headers.authorization;
    assert(
      bearer && bearer.startsWith('Bearer '),
      401,
      'AUTH_REQUIRED',
      'Please sign in to continue.',
    );
    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(bearer.slice(7), config.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'retailpulse',
        audience: 'retailpulse-api',
      }) as jwt.JwtPayload;
    } catch {
      throw new HttpError(401, 'AUTH_REQUIRED', 'Your session has expired. Please sign in again.');
    }
    assert(
      typeof decoded.sub === 'string' && typeof decoded.sid === 'string',
      401,
      'AUTH_REQUIRED',
      'Invalid session.',
    );
    // Read current permissions from Postgres so disabling an account or changing its role takes effect immediately.
    const session = await db.authSession.findUnique({
      where: { id: decoded.sid },
      include: { user: { include: { assignments: true } } },
    });
    assert(
      session &&
        session.userId === decoded.sub &&
        !session.revokedAt &&
        session.expiresAt > new Date() &&
        session.user.active,
      401,
      'AUTH_REQUIRED',
      'This session is no longer active.',
    );
    const u = session.user;
    req.actor = {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      tier: u.tier,
      storeIds: u.assignments.map((a) => a.locationId),
      sessionId: session.id,
    };
    next();
  } catch (e) {
    next(e);
  }
}
