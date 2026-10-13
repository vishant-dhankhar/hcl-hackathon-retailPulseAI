import type { Request, Response } from 'express';
import * as service from '../services/auth.service.js';
import { credentials, registration, profileInput } from '../validators/auth.schemas.js';
function sendSession(
  result: Awaited<ReturnType<typeof service.login>>,
  res: Response,
  status = 200,
) {
  const { refreshToken, expiresAt, ...body } = result;
  res
    .cookie('rp_refresh', refreshToken, {
      ...service.cookieOptions,
      maxAge: expiresAt.getTime() - Date.now(),
    })
    .status(status)
    .json(body);
}
export async function register(req: Request, res: Response) {
  sendSession(await service.register(registration.parse(req.body)), res, 201);
}
export async function login(req: Request, res: Response) {
  sendSession(await service.login(credentials.parse(req.body)), res);
}
export async function refresh(req: Request, res: Response) {
  sendSession(await service.refresh(req.cookies.rp_refresh), res);
}
export async function logout(req: Request, res: Response) {
  await service.logout(req.cookies.rp_refresh);
  res.clearCookie('rp_refresh', service.cookieOptions).status(204).end();
}
export async function me(req: Request, res: Response) {
  res.json({ ...(await service.me(req.actor.id)), storeIds: req.actor.storeIds });
}
export async function updateProfile(req: Request, res: Response) {
  res.json(await service.updateProfile(req.actor.id, profileInput.parse(req.body)));
}
