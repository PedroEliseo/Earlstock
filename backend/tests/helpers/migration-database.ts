import path from 'node:path';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import {
  assertSafeTestDatabase,
  type DatabaseTarget,
  dropTestDatabase,
  recreateTestDatabase,
  roleOf,
  testDatabaseUrls,
} from '../setup/global-setup.js';

/**
 * A second, disposable database for migration tests, so migrations can be run up and down to any
 * point without disturbing the shared test database. It is the test database renamed
 * (earlstock_test -> earlstock_migrations_test) and passes the same fail-closed checks: it must end
 * in "_test" and its name must differ from every other configured database, the test one included.
 * The superuser URL only drops/creates it; migrations and statements run as the migration role.
 */
export function migrationDatabase(): {
  lifecycle: string;
  migration: string;
  target: DatabaseTarget;
} {
  const urls = testDatabaseUrls();
  if (!urls) throw new Error('TEST_DATABASE_URL is not set');
  const rename = (raw: string) => {
    const url = new URL(raw);
    const testName = decodeURIComponent(url.pathname.slice(1));
    url.pathname = `/${testName.replace(/_test$/, '_migrations_test')}`;
    return url.toString();
  };
  const lifecycle = rename(urls.lifecycle);
  const target = assertSafeTestDatabase(lifecycle, {
    DATABASE_URL: process.env['DATABASE_URL'],
    TEST_DATABASE_URL: urls.lifecycle,
    MIGRATION_DATABASE_URL: process.env['MIGRATION_DATABASE_URL'],
    MARKET_DATA_DATABASE_URL: process.env['MARKET_DATA_DATABASE_URL'],
    IMPORTER_DATABASE_URL: process.env['IMPORTER_DATABASE_URL'],
  });
  return { lifecycle, migration: rename(urls.migration), target };
}

/** Recreates the disposable database (owned by the migration role); returns the migration-role URL. */
export async function recreateMigrationDatabase(): Promise<string> {
  const { lifecycle, migration, target } = migrationDatabase();
  await recreateTestDatabase(lifecycle, target, roleOf(migration));
  return migration;
}

export async function dropMigrationDatabase(): Promise<void> {
  const { lifecycle, target } = migrationDatabase();
  await dropTestDatabase(lifecycle, target);
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

/** Runs one statement, as the migration role, on a short-lived connection to the migration database. */
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
