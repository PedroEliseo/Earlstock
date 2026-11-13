import path from 'node:path';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';

/**
 * Prepares the isolated test database once per `npm test` run: recreates it from scratch and
 * applies every migration, so each run starts empty and exercises the full migration chain.
 * Database tests are skipped when TEST_DATABASE_URL is unset.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    console.warn('\nTEST_DATABASE_URL is not set: database tests will be skipped.\n');
    return;
  }

  const target = assertSafeTestDatabase(url, { DATABASE_URL: process.env['DATABASE_URL'] });
  await recreateTestDatabase(url, target);
  await runner({
    databaseUrl: url,
    dir: path.resolve('migrations'),
    migrationsTable: 'pgmigrations',
    direction: 'up',
    checkOrder: true,
    log: () => undefined,
  });
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
 * Drops and recreates the test database through a separate maintenance connection. The server is
 * asked which database that connection is on, so the DROP can never run from the target itself.
 */
export async function recreateTestDatabase(testUrl: string, target: DatabaseTarget): Promise<void> {
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
    const name = client.escapeIdentifier(target.database);
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
}
