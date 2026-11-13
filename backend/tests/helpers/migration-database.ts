import path from 'node:path';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import {
  assertSafeTestDatabase,
  type DatabaseTarget,
  dropTestDatabase,
  recreateTestDatabase,
} from '../setup/global-setup.js';

/**
 * A second, disposable database for migration tests, so migrations can be run up and down to any
 * point without disturbing the shared test database. Its URL is TEST_DATABASE_URL with the database
 * renamed (earlstock_test -> earlstock_migrations_test), and it passes the same fail-closed checks:
 * it must end in "_test" and its name must differ from both DATABASE_URL's and TEST_DATABASE_URL's.
 */
export function migrationDatabase(): { url: string; target: DatabaseTarget } {
  const testUrl = process.env['TEST_DATABASE_URL'];
  if (!testUrl) throw new Error('TEST_DATABASE_URL is not set');
  const url = new URL(testUrl);
  const testName = decodeURIComponent(url.pathname.slice(1));
  url.pathname = `/${testName.replace(/_test$/, '_migrations_test')}`;
  const target = assertSafeTestDatabase(url.toString(), {
    DATABASE_URL: process.env['DATABASE_URL'],
    TEST_DATABASE_URL: testUrl,
  });
  return { url: url.toString(), target };
}

export async function recreateMigrationDatabase(): Promise<string> {
  const { url, target } = migrationDatabase();
  await recreateTestDatabase(url, target);
  return url;
}

export async function dropMigrationDatabase(): Promise<void> {
  const { url, target } = migrationDatabase();
  await dropTestDatabase(url, target);
}

/** Applies (`up`) or reverts (`down`) exactly `count` migrations. Rejects with the migration error. */
export async function migrate(url: string, direction: 'up' | 'down', count: number): Promise<void> {
  await runner({
    databaseUrl: url,
    dir: path.resolve('migrations'),
    migrationsTable: 'pgmigrations',
    direction,
    count,
    checkOrder: true,
    log: () => undefined,
  });
}

/** Runs one statement on a short-lived connection to the migration database. */
export async function sql<T extends object = Record<string, unknown>>(
  url: string,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}
