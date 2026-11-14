/**
 * Every failure the API layer can produce. Components never show `message` fields from the server:
 * they render `describeError()`, which maps a failure to fixed, user-facing text.
 */

/** Error codes documented by the backend (`{error: {code, message, details?}}`). */
export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'DATASET_NOT_LOADED',
  'DATABASE_UNAVAILABLE',
  'DATABASE_TIMEOUT',
  'BAD_REQUEST',
  'INTERNAL',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** The server answered with a non-2xx status. `code` is UNKNOWN if the body was not the documented shape. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'UNKNOWN',
    /** The server's message: for logs and debugging only, never rendered. */
    readonly serverMessage: string | null,
  ) {
    super(`API request failed with HTTP ${status} (${code})`);
  }
}

/** The request never produced an HTTP response (offline, proxy down, connection reset). */
export class NetworkError extends Error {
  override readonly name = 'NetworkError';
}

/** A 2xx response that does not match the expected contract (schema drift, missing header). */
export class ResponseFormatError extends Error {
  override readonly name = 'ResponseFormatError';
}

/** The dataset kept changing between the requests of one operation; nothing was combined. */
export class SnapshotMismatchError extends Error {
  override readonly name = 'SnapshotMismatchError';
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export interface ErrorDescription {
  title: string;
  description: string;
  /** Whether trying again can help (shows a retry action). */
  retryable: boolean;
}

/** Fixed, user-facing text for any failure. Never includes server-provided text. */
export function describeError(error: unknown): ErrorDescription {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'NOT_FOUND':
        return {
          title: 'Not found',
          description: 'The requested item is not in the current dataset.',
          retryable: false,
        };
      case 'DATASET_NOT_LOADED':
        return {
          title: 'No dataset loaded',
          description:
            'The database has no active historical dataset yet. Import one with the EarlStock importer, then try again.',
          retryable: true,
        };
      case 'DATABASE_UNAVAILABLE':
      case 'DATABASE_TIMEOUT':
        return {
          title: 'Service temporarily unavailable',
          description: 'The data service is not responding right now. Please try again shortly.',
          retryable: true,
        };
      case 'VALIDATION_FAILED':
      case 'BAD_REQUEST':
        return {
          title: 'Invalid request',
          description: 'The request parameters were not accepted. Check the address and try again.',
          retryable: false,
        };
      case 'INTERNAL':
      case 'UNKNOWN':
        return {
          title: 'Something went wrong',
          description: 'The server could not complete the request.',
          retryable: true,
        };
    }
  }
  if (error instanceof NetworkError) {
    return {
      title: 'Cannot reach the server',
      description: 'Check that the EarlStock API is running and your connection is available.',
      retryable: true,
    };
  }
  if (error instanceof SnapshotMismatchError) {
    return {
      title: 'The dataset is being updated',
      description: 'The data changed while it was loading, so nothing was combined. Try again.',
      retryable: true,
    };
  }
  if (error instanceof ResponseFormatError) {
    return {
      title: 'Unexpected response',
      description:
        'The server answered in an unexpected format. This is likely a version mismatch.',
      retryable: false,
    };
  }
  return {
    title: 'Something went wrong',
    description: 'An unexpected error occurred.',
    retryable: true,
  };
}

/** Errors for which retrying the same request cannot help (used by the query retry policy). */
export function isPermanentError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return ['NOT_FOUND', 'VALIDATION_FAILED', 'BAD_REQUEST', 'DATASET_NOT_LOADED'].includes(
      error.code,
    );
  }
  return error instanceof ResponseFormatError || error instanceof SnapshotMismatchError;
}
