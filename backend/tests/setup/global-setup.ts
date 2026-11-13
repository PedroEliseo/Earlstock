import path from 'node:path';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';

/**
 * Prepares the isolated test database once per `npm test` run: creates it if missing and applies
 * all migrations. Database tests are skipped when TEST_DATABASE_URL is unset.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    console.warn('\nTEST_DATABASE_URL is not set: database tests will be skipped.\n');
    return;
  }

  const databaseName = assertIsTestDatabase(url);
  await createDatabaseIfMissing(url, databaseName);
  await runner({
    databaseUrl: url,
    dir: path.resolve('migrations'),
    migrationsTable: 'pgmigrations',
    direction: 'up',
    checkOrder: true,
    log: () => undefined,
  });
}

/** Guards against ever truncating a real database: the target must be explicitly named *_test. */
function assertIsTestDatabase(url: string): string {
  const databaseName = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/^\w+_test$/.test(databaseName)) {
    throw new Error(
      `Refusing to run tests against "${databaseName}": TEST_DATABASE_URL must name a database ending in "_test".`,
    );
  }
  const devUrl = process.env['DATABASE_URL'];
  if (devUrl && new URL(devUrl).pathname === new URL(url).pathname) {
    throw new Error(
      'Refusing to run tests: TEST_DATABASE_URL points at the DATABASE_URL database.',
    );
  }
  return databaseName;
}

async function createDatabaseIfMissing(url: string, databaseName: string): Promise<void> {
  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = '/postgres';
  const client = new Client({ connectionString: maintenanceUrl.toString() });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      'Cannot reach PostgreSQL for TEST_DATABASE_URL. Is it running? (docker compose up -d --wait)',
      { cause: err },
    );
  }
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);
    if (rowCount === 0) {
      // Identifiers cannot be bound as parameters; escapeIdentifier quotes the (already validated) name.
      await client.query(`CREATE DATABASE ${client.escapeIdentifier(databaseName)}`);
    }
  } finally {
    await client.end();
  }
}
