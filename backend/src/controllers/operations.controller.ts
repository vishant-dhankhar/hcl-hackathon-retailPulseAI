import type { Request, Response } from 'express';
import * as service from '../services/operations.service.js';
export async function getInventory(req: Request, res: Response) {
  const result = await service.getInventory(req.actor, req.query);
  res.json(result);
}
export async function createReplenishment(req: Request, res: Response) {
  const result = await service.createReplenishment(req.actor, req.body);
  res.status(201).json(result);
}
export async function updateReplenishment(req: Request, res: Response) {
  const result = await service.updateReplenishment(req.actor, req.body, String(req.params.id));
  res.json(result);
}
export async function listAudit(req: Request, res: Response) {
  const result = await service.listAudit(req.actor);
  res.json(result);
}
export async function listUsers(req: Request, res: Response) {
  const result = await service.listUsers();
  res.json(result);
}
export async function updateUser(req: Request, res: Response) {
  const result = await service.updateUser(req.actor, req.body, String(req.params.id));
  res.json(result);
}
export async function listLocations(req: Request, res: Response) {
  res.json(await service.listLocations());
}
