import { Pool } from 'pg';
import type { DatabaseEnv } from '../config/database.js';
import { logger as defaultLogger, type Logger, serializeError } from '../shared/logger.js';

type PoolSettings = Pick<DatabaseEnv, 'MARKET_DATA_DATABASE_URL' | 'DATABASE_POOL_MAX'> &
  Partial<Pick<DatabaseEnv, 'DATABASE_STATEMENT_TIMEOUT_MS'>>;

/**
 * Creates the API's PostgreSQL connection pool (read-only API role). Its limits apply to this pool
 * only. Connections are opened lazily on first query, so creating the pool never blocks startup.
 */
export function createPool(config: PoolSettings, logger: Logger = defaultLogger): Pool {
  const pool = new Pool({
    connectionString: config.MARKET_DATA_DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    // Fail fast instead of waiting indefinitely when the database is unreachable or the pool is exhausted.
    connectionTimeoutMillis: 5_000,
    // Bound the time a request can spend in the database, and never leave a transaction idle.
    statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS ?? 5_000,
    idle_in_transaction_session_timeout: 10_000,
    // No JIT compilation: API queries are short index lookups, but the planner can overestimate
    // them (e.g. the stock list's per-stock MIN/MAX probes are estimated at millions of cost units),
    // which triggers LLVM compilation costing far more than the query itself (measured on the stock
    // list: about 66 ms of JIT for 2 ms of execution).
    options: '-c jit=off',
    // Identifies these sessions in pg_stat_activity and server logs.
    application_name: 'earlstock-api',
  });

  // Idle clients can error (e.g. the server restarts). The pool discards them itself, but without
  // a listener Node treats the 'error' event as unhandled and crashes the process.
  pool.on('error', (err) => {
    logger.error('unexpected error on idle database connection', {
      error: serializeError(err),
      pool: poolStats(pool),
    });
  });

  return pool;
}

export interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
}

/** Connection counts for logs and, later, metrics. Not exposed in HTTP responses. */
export function poolStats(pool: Pool): PoolStats {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}
