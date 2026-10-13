import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../errors/HttpError.js';
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = res.locals.requestId;
  if (err instanceof ZodError)
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        requestId,
      },
    });
  if (err instanceof HttpError)
    return res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, requestId } });
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
    return res
      .status(409)
      .json({ error: { code: 'CONFLICT', message: 'This record already exists.', requestId } });
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large')
    return res.status(413).json({
      error: {
        code: 'REQUEST_TOO_LARGE',
        message: 'This request is too large. Shorten the text and try again.',
        requestId,
      },
    });
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    ['LIMIT_UNEXPECTED_FILE', 'LIMIT_FILE_COUNT', 'LIMIT_FIELD_VALUE', 'LIMIT_PART_COUNT'].includes(
      String(err.code),
    )
  )
    return res.status(400).json({
      error: {
        code: 'INVALID_UPLOAD',
        message: 'Upload one supported document with valid metadata.',
        requestId,
      },
    });
  if (err && typeof err === 'object' && 'code' in err && err.code === 'LIMIT_FILE_SIZE')
    return res.status(400).json({
      error: {
        code: 'FILE_TOO_LARGE',
        message: 'Documents must be smaller than 4 MB.',
        requestId,
      },
    });
  if (err instanceof SyntaxError && 'status' in err && err.status === 400)
    return res
      .status(400)
      .json({ error: { code: 'INVALID_JSON', message: 'Invalid JSON body.', requestId } });
  console.error(
    JSON.stringify({
      requestId,
      path: req.path,
      error: err instanceof Error ? err.name : 'UnknownError',
    }),
  );
  return res.status(500).json({
    error: {
      code: 'SERVER_ERROR',
      message: 'Something went wrong. Please try again.',
      requestId,
    },
  });
}
