/**
 * Application errors thrown by services and validation. They carry no HTTP details;
 * the central error handler (shared/http/error-handlers.ts) maps them to status codes.
 */
export class NotFoundError extends Error {
  override readonly name = 'NotFoundError';
}

export class ConflictError extends Error {
  override readonly name = 'ConflictError';
}

/** A usage quota is used up. `retryAfterSeconds` tells clients when to try again. */
export class QuotaExceededError extends Error {
  override readonly name = 'QuotaExceededError';

  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message);
  }
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ValidationError extends Error {
  override readonly name = 'ValidationError';

  constructor(readonly issues: ValidationIssue[]) {
    super('Request validation failed');
  }
}
