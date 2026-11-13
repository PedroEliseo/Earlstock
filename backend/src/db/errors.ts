import { DatabaseError } from 'pg';

/** SQLSTATE codes we act on. See https://www.postgresql.org/docs/current/errcodes-appendix.html */
export const PgErrorCode = {
  UniqueViolation: '23505',
  ForeignKeyViolation: '23503',
} as const;

export type PgErrorCode = (typeof PgErrorCode)[keyof typeof PgErrorCode];

export function isPgError(err: unknown, code: PgErrorCode): err is DatabaseError {
  return err instanceof DatabaseError && err.code === code;
}
