/**
 * Application errors. They carry no HTTP details; the central error handler
 * (shared/http/error-handlers.ts) maps them to status codes and machine-readable error codes.
 */
export class NotFoundError extends Error {
  override readonly name = 'NotFoundError';
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

/** No active dataset snapshot exists yet (nothing has been imported and activated). */
export class DatasetNotLoadedError extends Error {
  override readonly name = 'DatasetNotLoadedError';

  constructor() {
    super('No dataset is loaded yet');
  }
}

/** Context attached to database errors for logs only (never sent to clients). */
export interface DatabaseErrorContext {
  query: string;
  durationMs: number;
}

interface DatabaseErrorOptions {
  cause: unknown;
  context: DatabaseErrorContext;
}

/** The database cannot be reached or is not accepting work right now. Retrying later may succeed. */
export class DatabaseUnavailableError extends Error {
  override readonly name = 'DatabaseUnavailableError';
  readonly context: DatabaseErrorContext;

  constructor({ cause, context }: DatabaseErrorOptions) {
    super('The database is temporarily unavailable', { cause });
    this.context = context;
  }
}

/** A query exceeded the statement timeout. Retrying the same request is not expected to help. */
export class DatabaseTimeoutError extends Error {
  override readonly name = 'DatabaseTimeoutError';
  readonly context: DatabaseErrorContext;

  constructor({ cause, context }: DatabaseErrorOptions) {
    super('The database query took too long', { cause });
    this.context = context;
  }
}

/** Any other database failure. Internal: the original error is kept as `cause` for logs only. */
export class DatabaseQueryError extends Error {
  override readonly name = 'DatabaseQueryError';
  readonly context: DatabaseErrorContext;

  constructor({ cause, context }: DatabaseErrorOptions) {
    super('A database query failed', { cause });
    this.context = context;
  }
}
