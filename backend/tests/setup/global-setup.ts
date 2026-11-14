import path from 'node:path';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';

/**
 * Prepares the isolated test database once per `npm test` run: recreates it from scratch (owned by
 * the migration role) and applies every migration as that role, so each run starts empty and
 * exercises the full migration chain with production-like privileges.
 * Database tests are skipped when TEST_DATABASE_URL is unset.
 */
export default async function globalSetup(): Promise<void> {
  const urls = testDatabaseUrls();
  if (!urls) {
    console.warn('\nTEST_DATABASE_URL is not set: database tests will be skipped.\n');
    return;
  }

  await recreateTestDatabase(urls.lifecycle, urls.target, roleOf(urls.migration));
  await runner({
    databaseUrl: urls.migration,
    dir: path.resolve('migrations'),
    migrationsTable: 'pgmigrations',
    direction: 'up',
    checkOrder: true,
    log: () => undefined,
  });
}

export interface TestDatabaseUrls {
  /** TEST_DATABASE_URL: administrative (superuser) connection, used ONLY to drop/create the database. */
  lifecycle: string;
  /** Migration-role credentials on the test database: migrations, fixtures, cleanup. */
  migration: string;
  /** API-role credentials on the test database: everything the application does. */
  api: string;
  /** Importer-role credentials on the test database: everything the dataset importer does. */
  importer: string;
  target: DatabaseTarget;
}

/**
 * Resolves the test-database URLs, or null when TEST_DATABASE_URL is unset (database tests skip).
 * Role credentials are not configured twice: they come from MIGRATION_DATABASE_URL,
 * MARKET_DATA_DATABASE_URL and IMPORTER_DATABASE_URL (the single source), retargeted at
 * TEST_DATABASE_URL's server and database. Fails closed if anything is missing, ambiguous, or would share a database or a role.
 */
export function testDatabaseUrls(env: NodeJS.ProcessEnv = process.env): TestDatabaseUrls | null {
  const lifecycle = env['TEST_DATABASE_URL'];
  if (!lifecycle) return null;
  const migrationSource = env['MIGRATION_DATABASE_URL'];
  const apiSource = env['MARKET_DATA_DATABASE_URL'];
  const importerSource = env['IMPORTER_DATABASE_URL'];
  if (!migrationSource || !apiSource || !importerSource) {
    throw new Error(
      'TEST_DATABASE_URL is set, so MIGRATION_DATABASE_URL, MARKET_DATA_DATABASE_URL and IMPORTER_DATABASE_URL are required too (test roles use their credentials)',
    );
  }

  const target = assertSafeTestDatabase(
    lifecycle,
    {
      DATABASE_URL: env['DATABASE_URL'],
      MIGRATION_DATABASE_URL: migrationSource,
      MARKET_DATA_DATABASE_URL: apiSource,
      IMPORTER_DATABASE_URL: importerSource,
    },
    env,
  );
  const migration = withCredentialsOf(migrationSource, lifecycle, 'MIGRATION_DATABASE_URL');
  const api = withCredentialsOf(apiSource, lifecycle, 'MARKET_DATA_DATABASE_URL');
  const importer = withCredentialsOf(importerSource, lifecycle, 'IMPORTER_DATABASE_URL');

  for (const [variable, url] of [
    ['MIGRATION_DATABASE_URL', migration],
    ['MARKET_DATA_DATABASE_URL', api],
    ['IMPORTER_DATABASE_URL', importer],
  ] as const) {
    const derived = parseDatabaseTarget(variable, url, env);
    if (
      derived.host !== target.host ||
      derived.port !== target.port ||
      derived.database !== target.database
    ) {
      throw new Error(`${variable}: derived test URL does not target the test database`);
    }
  }
  const roles = {
    lifecycle: roleOf(lifecycle),
    migration: roleOf(migration),
    api: roleOf(api),
    importer: roleOf(importer),
  };
  if (!roles.migration || !roles.api || !roles.importer) {
    throw new Error(
      'MIGRATION_DATABASE_URL, MARKET_DATA_DATABASE_URL and IMPORTER_DATABASE_URL must name their roles',
    );
  }
  if (roles.api === roles.migration || roles.api === roles.lifecycle) {
    throw new Error(
      'MARKET_DATA_DATABASE_URL must use a role distinct from the migration and administrative roles',
    );
  }
  if (roles.migration === roles.lifecycle) {
    throw new Error(
      'MIGRATION_DATABASE_URL must use a role distinct from the administrative TEST_DATABASE_URL role',
    );
  }
  if ([roles.lifecycle, roles.migration, roles.api].includes(roles.importer)) {
    throw new Error(
      'IMPORTER_DATABASE_URL must use a role distinct from the API, migration and administrative roles',
    );
  }
  return { lifecycle, migration, api, importer, target };
}

/** The role (user name) a connection URL authenticates as. */
export function roleOf(url: string): string {
  return decodeURIComponent(new URL(url).username);
}

/** `target`'s server and database, with `credentialsFrom`'s user name and password. */
function withCredentialsOf(credentialsFrom: string, target: string, variable: string): string {
  let source: URL;
  try {
    source = new URL(credentialsFrom);
  } catch {
    throw new Error(`${variable} is not a valid URL`);
  }
  const url = new URL(target);
  url.username = source.username;
  url.password = source.password;
  return url.toString();
}

/*
 * Safety checks for the destructive test-database setup. Every function fails closed: anything
 * that cannot be resolved unambiguously is treated as unsafe. They live in this file (exported for
 * their unit tests) because Jest loads globalSetup with Node's own module loader, which does not
 * resolve `./x.js` imports to `.ts` files.
 */

/** Query parameters that cannot change which server or database a URL connects to. */
const SAFE_QUERY_PARAMETERS = new Set(['sslmode', 'application_name', 'connect_timeout']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const MAINTENANCE_DATABASE = 'postgres';

export interface DatabaseTarget {
  /** Lower-cased host; every loopback alias is normalized to "loopback". */
  host: string;
  /** Explicit port, else PGPORT (as node-postgres would use), else 5432. */
  port: string;
  database: string;
}

/** Resolves the server and database a connection URL targets, independently of its credentials. */
export function parseDatabaseTarget(
  variable: string,
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): DatabaseTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${variable} is not a valid URL`);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`${variable} must be a postgres:// URL`);
  }
  for (const name of parsed.searchParams.keys()) {
    if (!SAFE_QUERY_PARAMETERS.has(name)) {
      throw new Error(
        `${variable} has the query parameter "${name}", which could change the target server or database`,
      );
    }
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) {
    throw new Error(`${variable} must name its host explicitly`);
  }
  let database: string;
  try {
    database = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error(`${variable} has an undecodable database name`);
  }
  if (!database || database.includes('/')) {
    throw new Error(`${variable} must name exactly one database`);
  }
  return {
    host: LOOPBACK_HOSTS.has(host) ? 'loopback' : host,
    port: parsed.port || env['PGPORT'] || '5432',
    database,
  };
}

const describeTarget = ({ host, port, database }: DatabaseTarget) =>
  `"${database}" on ${host}:${port}`;

/**
 * Returns the test database target, or throws unless TEST_DATABASE_URL names a *_test database
 * that cannot be any of the databases in `otherUrls`.
 *
 * Databases with different names are always different databases. Databases with the SAME name are
 * refused even when host or port differ: aliases (host names, IPs, port forwarding) can reach the
 * same server, so "different" cannot be verified.
 */
export function assertSafeTestDatabase(
  testUrl: string,
  otherUrls: Record<string, string | undefined>,
  env: NodeJS.ProcessEnv = process.env,
): DatabaseTarget {
  const test = parseDatabaseTarget('TEST_DATABASE_URL', testUrl, env);
  if (!/^\w+_test$/.test(test.database)) {
    throw new Error(
      `Refusing to use ${describeTarget(test)} for tests: the database name must end in "_test"`,
    );
  }
  for (const [variable, url] of Object.entries(otherUrls)) {
    if (url === undefined || url === '') continue;
    const other = parseDatabaseTarget(variable, url, env);
    if (other.database === test.database) {
      throw new Error(
        `Refusing to use ${describeTarget(test)} for tests: ${variable} uses a database with the same name (${describeTarget(other)})`,
      );
    }
  }
  return test;
}

/**
 * Runs `action` on a separate maintenance connection (to the `postgres` database), after asking the
 * server which database that connection is on, so a DROP can never run from the target itself.
 */
async function withMaintenanceConnection(
  testUrl: string,
  target: DatabaseTarget,
  action: (client: Client, quotedName: string) => Promise<void>,
): Promise<void> {
  if (target.database === MAINTENANCE_DATABASE) {
    throw new Error('Refusing to drop the maintenance database');
  }
  const maintenanceUrl = new URL(testUrl);
  maintenanceUrl.pathname = `/${MAINTENANCE_DATABASE}`;
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
    const { rows } = await client.query<{ name: string }>('SELECT current_database() AS name');
    const connectedTo = rows[0]?.name;
    if (connectedTo !== MAINTENANCE_DATABASE || connectedTo === target.database) {
      throw new Error(
        `Refusing to drop "${target.database}": the maintenance connection is on "${String(connectedTo)}"`,
      );
    }
    // Identifiers cannot be bound as parameters; escapeIdentifier quotes the validated name.
    await action(client, client.escapeIdentifier(target.database));
  } finally {
    await client.end();
  }
}

/**
 * Drops (if present) and recreates a validated test database through the maintenance connection,
 * owned by `owner` (the migration role), so migrations and fixtures never need the superuser.
 */
export function recreateTestDatabase(
  testUrl: string,
  target: DatabaseTarget,
  owner: string,
): Promise<void> {
  return withMaintenanceConnection(testUrl, target, async (client, name) => {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name} OWNER ${client.escapeIdentifier(owner)}`);
  });
}

/** Drops a validated test database through the maintenance connection. */
export function dropTestDatabase(testUrl: string, target: DatabaseTarget): Promise<void> {
  return withMaintenanceConnection(testUrl, target, async (client, name) => {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  });
}
