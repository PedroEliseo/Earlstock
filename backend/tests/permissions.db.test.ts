import type { Pool, PoolClient } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  createFixturePool,
  createTestPool,
  describeWithDatabase,
  truncateAll,
} from './helpers/database.js';
import { roleOf, testDatabaseUrls } from './setup/global-setup.js';

/**
 * Actual PostgreSQL permissions of the EarlStock roles, exercised by running statements as each
 * role (not by inspecting GRANT statements). The API role sessions start read-only, so the negative
 * tests for schema and administrative operations run with read-only explicitly switched OFF: they
 * can only pass because PostgreSQL refuses on privileges (42501), which is the real guarantee.
 */
const SQLSTATE = { insufficientPrivilege: '42501', readOnlyTransaction: '25006' } as const;
const DATA_TABLES = ['daily_prices', 'data_imports', 'stocks'];
/** Everything the API role may read: the data tables plus the active-snapshot pointer. */
const READABLE_TABLES = ['daily_prices', 'data_imports', 'dataset_snapshot', 'stocks'];
/** A real column of each data table, for UPDATE statements. */
const SOME_COLUMN: Record<string, string> = {
  daily_prices: 'volume',
  data_imports: 'status',
  dataset_snapshot: 'activated_at',
  stocks: 'ticker',
};
const writesTo = (table: string) => [
  `INSERT INTO ${table} DEFAULT VALUES`,
  `UPDATE ${table} SET ${String(SOME_COLUMN[table])} = ${String(SOME_COLUMN[table])}`,
  `DELETE FROM ${table}`,
  `TRUNCATE ${table}`,
];

async function sqlstateOf(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code ?? 'no-sqlstate';
  }
}

describeWithDatabase('database permissions', () => {
  const urls = testDatabaseUrls();
  const apiRole = roleOf(urls?.api ?? 'postgres://x@x/x');
  const ownerRole = roleOf(urls?.migration ?? 'postgres://x@x/x');
  let api: Pool;
  let fixtures: Pool;

  beforeAll(async () => {
    api = createTestPool();
    fixtures = createFixturePool();
    await truncateAll(fixtures);
    // One row per table, written as the owner (the API role cannot write).
    await fixtures.query(`INSERT INTO stocks (ticker) VALUES ('AAPL')`);
    await fixtures.query(
      `INSERT INTO data_imports (source_file, source_sha256, status, started_at, finished_at, rows_read, stock_count, price_count)
       VALUES ('synthetic-fixture.csv', repeat('a', 64), 'succeeded', now() - interval '1 minute', now(), 1, 1, 1)`,
    );
    await fixtures.query(
      `INSERT INTO daily_prices (stock_id, trade_date, open, high, low, close, adj_close, volume, import_id)
       SELECT s.id, current_date, 10, 12, 9, 11, 10.5, 1000, i.id FROM stocks s, data_imports i`,
    );
    await fixtures.query('INSERT INTO dataset_snapshot (import_id) SELECT id FROM data_imports');
  });
  afterAll(async () => {
    await truncateAll(fixtures);
    await api.end();
    await fixtures.end();
  });

  /** Runs `statements` on one API-role session with read-only switched off; returns each SQLSTATE. */
  async function asApiWithReadOnlyOff(...statements: string[]): Promise<(string | undefined)[]> {
    const client: PoolClient = await api.connect();
    try {
      await client.query('SET default_transaction_read_only = off');
      const codes: (string | undefined)[] = [];
      for (const statement of statements) codes.push(await sqlstateOf(client.query(statement)));
      return codes;
    } finally {
      client.release(true); // discard: never return a session with altered settings to the pool
    }
  }

  describe('API role', () => {
    it('connects as the API role, which is neither superuser nor able to create roles or databases', async () => {
      const { rows } = await api.query<Record<string, unknown>>(
        `SELECT current_user AS role, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls, r.rolreplication
         FROM pg_roles r WHERE r.rolname = current_user`,
      );
      expect(rows[0]).toEqual({
        role: apiRole,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolbypassrls: false,
        rolreplication: false,
      });
      expect(apiRole).not.toBe(ownerRole);
    });

    it('starts every session read-only (defense in depth)', async () => {
      const { rows } = await api.query<{ value: string }>(
        `SELECT current_setting('default_transaction_read_only') AS value`,
      );
      expect(rows[0]?.value).toBe('on');
    });

    it.each(DATA_TABLES)('can SELECT from %s', async (table) => {
      const { rows } = await api.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows[0]?.n).toBe(1);
    });

    it('can read exactly the data tables and the snapshot pointer, nothing else in the schema', async () => {
      const { rows } = await api.query<{ name: string }>(
        `SELECT c.relname AS name FROM pg_class c
         WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
           AND (has_table_privilege(current_user, c.oid, 'SELECT')
                OR (c.relkind = 'S' AND has_sequence_privilege(current_user, c.oid, 'USAGE')))
         ORDER BY 1`,
      );
      expect(rows.map((row) => row.name)).toEqual(READABLE_TABLES);
    });

    it.each(READABLE_TABLES.flatMap(writesTo))('cannot write: %s', async (statement) => {
      // With read-only on, PostgreSQL may report either the read-only state or the missing privilege.
      expect([SQLSTATE.readOnlyTransaction, SQLSTATE.insufficientPrivilege]).toContain(
        await sqlstateOf(api.query(statement)),
      );
    });

    it('still cannot write after switching read-only off: the grants are the real barrier', async () => {
      const writes = READABLE_TABLES.flatMap(writesTo);

      expect(await asApiWithReadOnlyOff(...writes)).toEqual(
        writes.map(() => SQLSTATE.insufficientPrivilege),
      );
      const { rows } = await fixtures.query<{ n: number }>(
        'SELECT (SELECT count(*) FROM stocks) + (SELECT count(*) FROM daily_prices) + (SELECT count(*) FROM data_imports) AS n',
      );
      expect(Number(rows[0]?.n)).toBe(3); // nothing changed
    });

    it.each([
      'CREATE TABLE probe (id int)',
      'CREATE INDEX ON stocks (created_at)',
      'ALTER TABLE stocks ADD COLUMN probe int',
      'ALTER TABLE stocks DROP CONSTRAINT stocks_ticker_format',
      'DROP TABLE stocks',
      'CREATE VIEW probe AS SELECT 1',
      'CREATE SCHEMA probe',
      'CREATE FUNCTION probe() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$',
      'COMMENT ON TABLE stocks IS $$probe$$',
    ])('cannot change the schema: %s', async (statement) => {
      expect(await asApiWithReadOnlyOff(statement)).toEqual([SQLSTATE.insufficientPrivilege]);
    });

    it.each([
      'SELECT * FROM pgmigrations',
      `INSERT INTO pgmigrations (name, run_on) VALUES ('probe', now())`,
      'DELETE FROM pgmigrations',
      'UPDATE pgmigrations SET name = name',
    ])('has no access to migration history: %s', async (statement) => {
      expect(await asApiWithReadOnlyOff(statement)).toEqual([SQLSTATE.insufficientPrivilege]);
    });

    it.each([`SELECT nextval('data_imports_id_seq')`, `SELECT setval('data_imports_id_seq', 1)`])(
      'has no access to sequences: %s',
      async (statement) => {
        expect(await asApiWithReadOnlyOff(statement)).toEqual([SQLSTATE.insufficientPrivilege]);
      },
    );

    it.each([
      'CREATE ROLE probe',
      'CREATE DATABASE probe',
      `SELECT pg_read_file('postgresql.conf')`,
      `COPY stocks TO '/tmp/earlstock-probe.csv'`,
    ])('cannot perform administrative operations: %s', async (statement) => {
      expect(await asApiWithReadOnlyOff(statement)).toEqual([SQLSTATE.insufficientPrivilege]);
    });

    it('cannot assume or alter the owner role', async () => {
      const owner = ownerRole.replaceAll('"', '""');
      expect(
        await asApiWithReadOnlyOff(
          `SET ROLE "${owner}"`,
          `SET SESSION AUTHORIZATION "${owner}"`,
          `ALTER ROLE "${owner}" NOLOGIN`,
        ),
      ).toEqual([
        SQLSTATE.insufficientPrivilege,
        SQLSTATE.insufficientPrivilege,
        SQLSTATE.insufficientPrivilege,
      ]);
    });

    it('owns nothing and belongs to no role other than market_data_reader', async () => {
      const { rows } = await api.query<{
        owned: number;
        database_owner: boolean;
        member_of: string[];
      }>(
        `SELECT
           (SELECT count(*)::int FROM pg_class WHERE relowner = r.oid)
             + (SELECT count(*)::int FROM pg_proc WHERE proowner = r.oid)
             + (SELECT count(*)::int FROM pg_namespace WHERE nspowner = r.oid) AS owned,
           (SELECT datdba = r.oid FROM pg_database WHERE datname = current_database()) AS database_owner,
           ARRAY(SELECT g.rolname::text FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
                 WHERE m.member = r.oid ORDER BY 1) AS member_of
         FROM pg_roles r WHERE r.rolname = current_user`,
      );
      expect(rows[0]).toEqual({
        owned: 0,
        database_owner: false,
        member_of: ['market_data_reader'],
      });
    });

    it.each([
      'pg_read_all_data',
      'pg_write_all_data',
      'pg_read_server_files',
      'pg_write_server_files',
      'pg_execute_server_program',
      'pg_signal_backend',
      'pg_maintain',
      'pg_database_owner',
    ])('has no membership, direct or inherited, in %s', async (role) => {
      const { rows } = await api.query<{ member: boolean }>(
        `SELECT pg_has_role(current_user, $1, 'MEMBER') AS member`,
        [role],
      );
      expect(rows[0]?.member).toBe(false);
    });

    it('is enough to run the application: health checks and stock reads succeed', async () => {
      const app = createApp({ pool: api });

      const ready = await request(app).get('/health/ready');
      const stocks = await request(app).get('/api/stocks');

      expect(ready.status).toBe(200);
      expect(ready.body).toEqual({
        status: 'ok',
        checks: { database: 'up', dataset: 'loaded', privileges: 'ok' },
      });
      expect(stocks.status).toBe(200);
      expect((stocks.body as { data: { ticker: string }[] }).data.map((s) => s.ticker)).toEqual([
        'AAPL',
      ]);
    });
  });

  describe('migration (owner) role', () => {
    it('is neither superuser nor able to create roles or databases', async () => {
      const { rows } = await fixtures.query<Record<string, unknown>>(
        `SELECT current_user AS role, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user`,
      );
      expect(rows[0]).toEqual({
        role: ownerRole,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
      });
      expect(await sqlstateOf(fixtures.query('CREATE ROLE probe'))).toBe(
        SQLSTATE.insufficientPrivilege,
      );
      expect(await sqlstateOf(fixtures.query('CREATE DATABASE probe'))).toBe(
        SQLSTATE.insufficientPrivilege,
      );
    });

    it('owns the database and every object in the schema', async () => {
      const { rows } = await fixtures.query<{ database_owner: string; foreign_owned: number }>(
        `SELECT
           (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) AS database_owner,
           (SELECT count(*)::int FROM pg_class
             WHERE relnamespace = 'public'::regnamespace AND relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user))
             AS foreign_owned`,
      );
      expect(rows[0]).toEqual({ database_owner: ownerRole, foreign_owned: 0 });
    });

    it('can change the schema (checked inside a transaction that is rolled back)', async () => {
      const client = await fixtures.connect();
      try {
        await client.query('BEGIN');
        await client.query('CREATE TABLE probe (id int)');
        await client.query('ALTER TABLE stocks ADD COLUMN probe int');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      const { rows } = await fixtures.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'stocks' AND column_name = 'probe'`,
      );
      expect(rows[0]?.n).toBe(0);
    });
  });
});
