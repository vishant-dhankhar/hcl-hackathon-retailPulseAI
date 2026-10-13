import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import { db } from '../config/database.js';
import { config } from '../config/env.js';
import { assert, HttpError } from '../errors/HttpError.js';
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const cookieOptions = {
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/v1/auth',
  maxAge: 7 * 86400_000,
};
export const publicUser = (u: {
  id: string;
  name: string;
  email: string;
  role: string;
  tier: string;
  preferences?: unknown;
  assignments?: { location: { id: string; name: string; city: string } }[];
}) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  tier: u.tier,
  preferences: u.preferences,
  managedLocations: u.role === 'STORE_MANAGER' ? (u.assignments || []).map((a) => a.location) : [],
});
function token(userId: string, sid: string) {
  return jwt.sign({ sid }, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: 'retailpulse',
    audience: 'retailpulse-api',
    expiresIn: '15m',
  });
}
async function createSession(user: Parameters<typeof publicUser>[0]) {
  const refreshToken = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + cookieOptions.maxAge);
  const session = await db.authSession.create({
    data: {
      userId: user.id,
      expiresAt,
      tokens: { create: { hash: hash(refreshToken), expiresAt } },
    },
  });
  return {
    refreshToken,
    expiresAt,
    accessToken: token(user.id, session.id),
    user: publicUser(user),
  };
}
export async function register(input: { email: string; name: string; password: string }) {
  const user = await db.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
    },
  });
  return createSession(user);
}
export async function login(input: { email: string; password: string }) {
  const user = await db.user.findUnique({
    where: { email: input.email },
    include: {
      assignments: { include: { location: { select: { id: true, name: true, city: true } } } },
    },
  });
  assert(
    user && user.active && (await argon2.verify(user.passwordHash, input.password)),
    401,
    'INVALID_CREDENTIALS',
    'Email or password is incorrect.',
  );
  return createSession(user);
}
export async function refresh(raw: unknown) {
  assert(typeof raw === 'string', 401, 'AUTH_REQUIRED', 'Please sign in.');
  const existing = await db.refreshToken.findUnique({
    where: { hash: hash(raw) },
    include: {
      session: {
        include: {
          user: {
            include: {
              assignments: {
                include: { location: { select: { id: true, name: true, city: true } } },
              },
            },
          },
        },
      },
    },
  });
  assert(
    existing &&
      !existing.session.revokedAt &&
      existing.expiresAt > new Date() &&
      existing.session.user.active,
    401,
    'AUTH_REQUIRED',
    'Please sign in again.',
  );
  if (existing.consumed) {
    await db.authSession.update({
      where: { id: existing.sessionId },
      data: { revokedAt: new Date() },
    });
    throw new HttpError(
      401,
      'AUTH_REQUIRED',
      'Session token reuse detected. Please sign in again.',
    );
  }
  const refreshToken = randomBytes(48).toString('base64url');
  await db.$transaction(async (tx) => {
    const consumed = await tx.refreshToken.updateMany({
      where: { id: existing.id, consumed: false },
      data: { consumed: true },
    });
    assert(consumed.count === 1, 401, 'AUTH_REQUIRED', 'Session was already refreshed.');
    await tx.refreshToken.create({
      data: {
        hash: hash(refreshToken),
        sessionId: existing.sessionId,
        expiresAt: existing.session.expiresAt,
      },
    });
  });
  return {
    refreshToken,
    expiresAt: existing.session.expiresAt,
    accessToken: token(existing.session.userId, existing.sessionId),
    user: publicUser(existing.session.user),
  };
}
export async function logout(raw: unknown) {
  if (typeof raw !== 'string') return;
  const t = await db.refreshToken.findUnique({ where: { hash: hash(raw) } });
  if (t)
    await db.authSession.update({ where: { id: t.sessionId }, data: { revokedAt: new Date() } });
}
export async function me(id: string) {
  return publicUser(
    await db.user.findUniqueOrThrow({
      where: { id },
      include: {
        assignments: { include: { location: { select: { id: true, name: true, city: true } } } },
      },
    }),
  );
}
export async function updateProfile(
  id: string,
  data: {
    name?: string;
    preferences?: { categories?: string[]; budget?: number; storeId?: string };
  },
) {
  if (data.preferences?.storeId)
    assert(
      await db.location.findUnique({ where: { id: data.preferences.storeId, warehouse: false } }),
      400,
      'INVALID_STORE',
      'Select an existing store.',
    );
  return publicUser(
    await db.user.update({
      where: { id },
      data,
      include: {
        assignments: { include: { location: { select: { id: true, name: true, city: true } } } },
      },
    }),
  );
}
