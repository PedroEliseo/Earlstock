import { Pool } from 'pg';
import type { DatabaseEnv } from '../config/database.js';

/**
 * Creates the application's single PostgreSQL connection pool.
 * Connections are opened lazily on first query, so creating the pool never blocks startup.
 */
export function createPool(config: DatabaseEnv): Pool {
  const pool = new Pool({
    connectionString: config.MARKET_DATA_DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    // Fail fast instead of waiting indefinitely when the database is unreachable or the pool is exhausted.
    connectionTimeoutMillis: 5_000,
  });

  // Idle clients can error (e.g. the server restarts). The pool discards them itself, but without
  // a listener Node treats the 'error' event as unhandled and crashes the process.
  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
  });

  return pool;
}
