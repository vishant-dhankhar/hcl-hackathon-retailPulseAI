import type { Request, Response } from 'express';
import * as service from '../services/shopping.service.js';
import * as support from '../services/support.service.js';
export async function getCart(req: Request, res: Response) {
  const result = await service.getCart(req.actor);
  res.json(result);
}
export async function updateCart(req: Request, res: Response) {
  const result = await service.updateCart(req.actor, req.body, String(req.params.productId));
  res.json(result);
}
export async function getQuote(req: Request, res: Response) {
  const result = await service.getQuote(req.actor, req.body);
  res.json(result);
}
export async function checkout(req: Request, res: Response) {
  const result = await service.checkout(req.actor, req.body, req.headers['idempotency-key']);
  res.status(201).json(result);
}
export async function listOrders(req: Request, res: Response) {
  const result = await service.listOrders(req.actor);
  res.json(result);
}
export async function updateOrderStatus(req: Request, res: Response) {
  const result = await service.updateOrderStatus(req.actor, req.body, String(req.params.id));
  res.json(result);
}
export async function listTickets(req: Request, res: Response) {
  const result = await support.listTickets(req.actor, req.query);
  res.json(result);
}
export async function createTicket(req: Request, res: Response) {
  const result = await support.createTicket(req.actor, req.body);
  res.status(201).json(result);
}
export async function updateTicket(req: Request, res: Response) {
  res.json(await support.updateTicket(req.actor, String(req.params.id), req.body));
}
export async function replyToTicket(req: Request, res: Response) {
  res.status(201).json(await support.replyToTicket(req.actor, String(req.params.id), req.body));
}
