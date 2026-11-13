import type { NextFunction, Request, Response } from 'express';
import { isPgError, PgErrorCode } from '../../db/errors.js';
import {
  ConflictError,
  NotFoundError,
  QuotaExceededError,
  ValidationError,
  type ValidationIssue,
} from '../errors.js';

interface ErrorBody {
  message: string;
  details?: ValidationIssue[];
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { message: `Route ${req.method} ${req.path} not found` } });
}

/**
 * Central error handler: the single place where errors become HTTP responses, so every
 * endpoint returns the same `{ error: { message, details? } }` shape.
 * Express identifies error middleware by its 4-argument signature, so `_next` must stay.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const [status, body] = toErrorResponse(err);
  if (status >= 500) console.error(err);
  if (err instanceof QuotaExceededError) res.set('Retry-After', String(err.retryAfterSeconds));
  res.status(status).json({ error: body });
}

function toErrorResponse(err: unknown): [number, ErrorBody] {
  if (err instanceof ValidationError) return [400, { message: err.message, details: err.issues }];
  if (err instanceof NotFoundError) return [404, { message: err.message }];
  if (err instanceof ConflictError) return [409, { message: err.message }];
  if (err instanceof QuotaExceededError) return [429, { message: err.message }];

  // Fallback for constraint violations a service did not translate into a domain error.
  // The raw PostgreSQL message is never sent: it can leak schema details and key values.
  if (isPgError(err, PgErrorCode.UniqueViolation)) {
    return [409, { message: 'Resource already exists' }];
  }
  if (isPgError(err, PgErrorCode.ForeignKeyViolation)) {
    return [409, { message: 'Operation conflicts with related resources' }];
  }

  // Client errors raised by Express middleware, e.g. malformed JSON (400) or payload too large (413).
  if (isExposedClientError(err)) return [err.status, { message: err.message }];

  return [500, { message: 'Internal Server Error' }];
}

function isExposedClientError(err: unknown): err is { status: number; message: string } {
  return (
    err instanceof Error &&
    'expose' in err &&
    err.expose === true &&
    'status' in err &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500
  );
}
