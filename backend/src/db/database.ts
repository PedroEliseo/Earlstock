import type { Pool, QueryResultRow } from 'pg';
import { logger as defaultLogger, type Logger } from '../shared/logger.js';
import { classifyDatabaseError } from './errors.js';

/**
 * The only way repositories reach PostgreSQL. Every query has a stable name, used for timing,
 * logs and (later) metrics and traces; failures are translated into application errors, so no
 * `pg` type or error escapes the database layer. SQL text and parameters are never logged.
 */
export interface Database {
  query<Row extends QueryResultRow>(name: string, text: string, values?: unknown[]): Promise<Row[]>;
}

export interface DatabaseOptions {
  logger?: Logger;
  /** Queries at or above this duration are logged as slow. */
  slowQueryMs?: number;
}

export function createDatabase(
  pool: Pool,
  { logger = defaultLogger, slowQueryMs = 200 }: DatabaseOptions = {},
): Database {
  return {
    async query<Row extends QueryResultRow>(name: string, text: string, values: unknown[] = []) {
      const started = performance.now();
      try {
        const result = await pool.query<Row>(text, values);
        const durationMs = Math.round(performance.now() - started);
        if (durationMs >= slowQueryMs) {
          logger.warn('slow database query', {
            query: name,
            durationMs,
            rowCount: result.rowCount,
          });
        }
        return result.rows;
      } catch (err) {
        throw classifyDatabaseError(err, {
          query: name,
          durationMs: Math.round(performance.now() - started),
        });
      }
    },
  };
}
