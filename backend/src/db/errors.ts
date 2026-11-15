import { DatabaseError } from 'pg';
import {
  type DatabaseErrorContext,
  DatabaseQueryError,
  DatabaseTimeoutError,
  DatabaseUnavailableError,
} from '../shared/errors.js';

/**
 * Translates node-postgres errors into application errors, so nothing above the database layer
 * ever sees a `pg` type. See https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

/** SQLSTATEs meaning the server is unreachable, shutting down or out of connections. */
const UNAVAILABLE_SQLSTATES = new Set([
  '53300', // too_many_connections
  '57P01', // admin_shutdown (connection terminated by administrator)
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (starting up / shutting down)
]);
const QUERY_CANCELED = '57014';

/** Socket-level failures reported by Node. */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

/**
 * node-postgres reports these without a code, only with a message: pool checkout timeout,
 * connect timeout and a dropped connection.
 */
const UNAVAILABLE_MESSAGES = [
  /timeout exceeded when trying to connect/i,
  /connection terminated/i,
  /connection timeout/i,
];

/*
 * Errors are recognised by their properties, not with `instanceof`: socket errors are created by
 * Node internals and driver errors by node-postgres, possibly in another JavaScript realm (as under
 * Jest's VM modules), where `instanceof Error` / `instanceof DatabaseError` is false.
 */
function propertyOf(err: unknown, key: string): unknown {
  return typeof err === 'object' && err !== null && key in err
    ? (err as Record<string, unknown>)[key]
    : undefined;
}

function stringProperty(err: unknown, key: string): string | undefined {
  const value = propertyOf(err, key);
  return typeof value === 'string' ? value : undefined;
}

/** A PostgreSQL server error: five-character SQLSTATE plus a severity. */
export function sqlstateOf(err: unknown): string | undefined {
  const code = stringProperty(err, 'code');
  if (err instanceof DatabaseError) return code;
  return code && /^[0-9A-Z]{5}$/.test(code) && stringProperty(err, 'severity') ? code : undefined;
}

function isUnavailable(err: unknown): boolean {
  const sqlstate = sqlstateOf(err);
  if (sqlstate) return sqlstate.startsWith('08') || UNAVAILABLE_SQLSTATES.has(sqlstate);
  const inner = propertyOf(err, 'errors');
  if (Array.isArray(inner)) return inner.some(isUnavailable); // AggregateError (multiple addresses)
  const code = stringProperty(err, 'code');
  if (code && NETWORK_ERROR_CODES.has(code)) return true;
  const message = stringProperty(err, 'message') ?? '';
  return UNAVAILABLE_MESSAGES.some((pattern) => pattern.test(message));
}

/**
 * 57014 (query_canceled) covers several causes; only a statement timeout is a timeout. An explicit
 * cancellation (pg_cancel_backend, client cancel) is NOT database unavailability: it falls through
 * to a generic internal error.
 */
function isStatementTimeout(err: unknown): boolean {
  return (
    sqlstateOf(err) === QUERY_CANCELED &&
    /statement timeout/i.test(stringProperty(err, 'message') ?? '')
  );
}

/** A PostgreSQL server error (it has a SQLSTATE) or a failure to reach or keep the connection. */
export function isDatabaseFailure(err: unknown): boolean {
  return sqlstateOf(err) !== undefined || isUnavailable(err);
}

export function classifyDatabaseError(
  err: unknown,
  context: DatabaseErrorContext,
): DatabaseUnavailableError | DatabaseTimeoutError | DatabaseQueryError {
  if (isStatementTimeout(err)) return new DatabaseTimeoutError({ cause: err, context });
  if (isUnavailable(err)) return new DatabaseUnavailableError({ cause: err, context });
  return new DatabaseQueryError({ cause: err, context });
}
