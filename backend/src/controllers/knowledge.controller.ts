import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from '../services/knowledge.service.js';
export async function list(req: Request, res: Response) {
  res.json(await service.listDocuments());
}
export async function upload(req: Request, res: Response) {
  // Multipart metadata is a JSON string because files and structured fields share the same request.
  let metadata: unknown;
  try {
    metadata = JSON.parse(req.body.metadata || '{}');
  } catch {
    metadata = {};
  }
  const document = await service.upload(req.actor, metadata, req.file);
  // Vercel has no persistent worker. Finish this bounded ingestion within the request.
  if (process.env.VERCEL) await service.processOneDocument(document.id);
  res.status(202).json(document);
}
export async function activate(req: Request, res: Response) {
  const { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
  res.json(await service.activate(req.actor, String(req.params.id), active));
}
export async function source(req: Request, res: Response) {
  res.json(await service.source(req.actor, String(req.params.id)));
}
export async function reindex(req: Request, res: Response) {
  const result = await service.reindex(req.actor, String(req.params.id));
  if (process.env.VERCEL) await service.processOneDocument(String(req.params.id));
  res.status(202).json(result);
}
