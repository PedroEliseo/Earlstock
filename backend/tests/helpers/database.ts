import type { Pool } from 'pg';
import { createPool } from '../../src/db/pool.js';

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

/**
 * Runs the suite only when a test database is configured. When skipped, the suite body is not
 * executed at all: `describe.skip` would still run it to collect tests, creating pools on the way.
 */
export function describeWithDatabase(name: string, suite: () => void): void {
  if (testDatabaseUrl) {
    describe(name, suite);
  } else {
    describe.skip(name, () => {
      it.skip('requires TEST_DATABASE_URL', () => undefined);
    });
  }
}

/** A pool on the isolated test database (validated and migrated by tests/setup/global-setup.ts). */
export function createTestPool(): Pool {
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is not set');
  return createPool({ DATABASE_URL: testDatabaseUrl, DATABASE_POOL_MAX: 2 });
}

/**
 * Deletes all rows. Re-checks, on the server itself, that the connected database is a *_test one:
 * the global setup validates TEST_DATABASE_URL, but it is skipped when Jest runs with another config
 * (IDE runners, `--globalSetup` overrides), and this is the operation that destroys data.
 */
export async function truncateAll(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ name: string }>('SELECT current_database() AS name');
  const name = rows[0]?.name ?? '';
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to truncate "${name}": tests may only modify a *_test database.`);
  }
  await pool.query('TRUNCATE daily_prices, data_imports, stocks RESTART IDENTITY');
}

/** A pool whose connections are always refused (nothing listens on port 1), for tests that must not reach a DB. */
export function createUnreachablePool(): Pool {
  return createPool({
    DATABASE_URL: 'postgres://user:pass@127.0.0.1:1/unreachable',
    DATABASE_POOL_MAX: 1,
  });
}
