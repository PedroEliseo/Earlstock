import { Pool } from 'pg';
import { createPool } from '../../src/db/pool.js';
import { testDatabaseUrls } from '../setup/global-setup.js';

const urls = testDatabaseUrls();

/**
 * Runs the suite only when a test database is configured. When skipped, the suite body is not
 * executed at all: `describe.skip` would still run it to collect tests, creating pools on the way.
 */
export function describeWithDatabase(name: string, suite: () => void): void {
  if (urls) {
    describe(name, suite);
  } else {
    describe.skip(name, () => {
      it.skip('requires TEST_DATABASE_URL', () => undefined);
    });
  }
}

function requireUrls() {
  if (!urls) throw new Error('TEST_DATABASE_URL is not set');
  return urls;
}

/**
 * The pool the APPLICATION uses in tests: the read-only API role on the test database, created
 * exactly as production creates it. Tests therefore run with production privileges.
 */
export function createTestPool(): Pool {
  return createPool({ MARKET_DATA_DATABASE_URL: requireUrls().api, DATABASE_POOL_MAX: 2 });
}

/**
 * A pool as the migration (schema-owner) role on the test database, for inserting fixtures and
 * cleaning up: test data is written the way the importer will write it, never through the API role.
 */
export function createFixturePool(): Pool {
  const pool = new Pool({ connectionString: requireUrls().migration, max: 2 });
  pool.on('error', (err) => {
    console.error('Unexpected error on idle fixture client', err);
  });
  return pool;
}

/**
 * Deletes all rows. Re-checks, on the server itself, that the connected database is a *_test one:
 * the global setup validates the URLs, but it is skipped when Jest runs with another config (IDE
 * runners, `--globalSetup` overrides), and this is the operation that destroys data.
 * Pass a fixture pool: the API role cannot TRUNCATE.
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
    MARKET_DATA_DATABASE_URL: 'postgres://user:pass@127.0.0.1:1/unreachable',
    DATABASE_POOL_MAX: 1,
  });
}
