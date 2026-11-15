import { metrics, ValueType } from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';
import {
  DatabaseTimeoutError,
  DatabaseUnavailableError,
  DatasetNotLoadedError,
  NotFoundError,
  ValidationError,
  type ValidationIssue,
} from '../errors.js';
import { logger as defaultLogger, type Logger, serializeError } from '../logger.js';

/** Machine-readable error codes; part of the API contract. */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'DATASET_NOT_LOADED'
  | 'DATABASE_UNAVAILABLE'
  | 'DATABASE_TIMEOUT'
  | 'INTERNAL';

interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: ValidationIssue[];
}

interface ErrorResponse {
  status: number;
  body: ErrorBody;
  /** Seconds; set only where retrying the same request later is expected to succeed. */
  retryAfterSeconds?: number;
}

/** A short outage (restart, failover, exhausted pool) usually clears within seconds. */
const DATABASE_RETRY_AFTER_SECONDS = 5;

export function notFoundHandler(req: Request, res: Response): void {
  res
    .status(404)
    .json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
}

/**
 * Central error handler: the single place where errors become HTTP responses, so every endpoint
 * returns `{ error: { code, message, details? } }`. Responses never contain SQL, parameters,
 * credentials or PostgreSQL details; the original error (with its cause chain) is logged instead.
 * Express identifies error middleware by its 4-argument signature, so `_next` must stay.
 */
export function createErrorHandler(logger: Logger = defaultLogger) {
  // HTTP metrics show the status code only, and three different causes answer 503; this counter
  // says which one. Its only attribute is the error code, a closed set (no route, path or ticker).
  // A no-op without the telemetry preload.
  const serverErrors = metrics.getMeter('earlstock').createCounter('earlstock.api.server_errors', {
    description: 'Server-side (5xx) API error responses, by error code.',
    unit: '{response}',
    valueType: ValueType.INT,
  });

  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const { status, body, retryAfterSeconds } = toErrorResponse(err);
    if (status >= 500) {
      serverErrors.add(1, { 'error.type': body.code });
      const fields = {
        code: body.code,
        status,
        method: req.method,
        route: routeTemplate(req),
        error: serializeError(err),
      };
      // An empty dataset is an expected operational state, not a fault.
      if (body.code === 'DATASET_NOT_LOADED') logger.warn('request failed', fields);
      else logger.error('request failed', fields);
    }
    if (retryAfterSeconds !== undefined) res.set('Retry-After', String(retryAfterSeconds));
    res.status(status).json({ error: body });
  };
}

function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof ValidationError) {
    return {
      status: 400,
      body: { code: 'VALIDATION_FAILED', message: err.message, details: err.issues },
    };
  }
  if (err instanceof NotFoundError) {
    return { status: 404, body: { code: 'NOT_FOUND', message: err.message } };
  }
  if (err instanceof DatasetNotLoadedError) {
    return { status: 503, body: { code: 'DATASET_NOT_LOADED', message: err.message } };
  }
  if (err instanceof DatabaseUnavailableError) {
    return {
      status: 503,
      body: { code: 'DATABASE_UNAVAILABLE', message: err.message },
      retryAfterSeconds: DATABASE_RETRY_AFTER_SECONDS,
    };
  }
  if (err instanceof DatabaseTimeoutError) {
    // No Retry-After: the same query is likely to time out again.
    return { status: 503, body: { code: 'DATABASE_TIMEOUT', message: err.message } };
  }
  // Client errors raised by Express itself, e.g. a malformed percent-encoded path. The original
  // message may echo the input, so a generic one is returned.
  const clientStatus = clientErrorStatus(err);
  if (clientStatus !== undefined) {
    return { status: clientStatus, body: { code: 'BAD_REQUEST', message: 'Malformed request' } };
  }
  // DatabaseQueryError (any other database failure) and anything unexpected: never expose details.
  return { status: 500, body: { code: 'INTERNAL', message: 'Internal Server Error' } };
}

/**
 * The matched route's template for logs (e.g. `/:ticker`, relative to its router; the router's mount
 * path is no longer known here), or `unmatched`. Never the request's own path or URL: they carry user
 * input such as tickers and search text.
 */
function routeTemplate(req: Request): string {
  const route: unknown = req.route;
  if (typeof route === 'object' && route !== null && 'path' in route) {
    if (typeof route.path === 'string') return route.path;
  }
  return 'unmatched';
}

/** A 4xx `status` set by Express or its router (duck-typed: such errors may come from another realm). */
function clientErrorStatus(err: unknown): number | undefined {
  const status =
    typeof err === 'object' && err !== null && 'status' in err ? err.status : undefined;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}
