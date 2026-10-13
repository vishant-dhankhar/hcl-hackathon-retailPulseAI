import type { Request, Response } from 'express';
import * as service from '../services/catalogue.service.js';
export async function listStores(req: Request, res: Response) {
  const result = await service.listStores();
  res.json(result);
}
export async function listProducts(req: Request, res: Response) {
  const result = await service.listProducts(req.query);
  res.json(result);
}
export async function getProduct(req: Request, res: Response) {
  const result = await service.getProduct(String(req.params.id));
  res.json(result);
}
