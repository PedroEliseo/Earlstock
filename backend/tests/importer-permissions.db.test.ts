import { Client, type Pool } from 'pg';
import { findImporterPrivilegeViolations } from '../src/importer/import.repository.js';
import {
  connectImporter,
  createFixturePool,
  describeWithDatabase,
  truncateAll,
} from './helpers/database.js';
import { seedActiveDataset } from './helpers/fixtures.js';
import { roleOf, testDatabaseUrls } from './setup/global-setup.js';

/**
 * Actual PostgreSQL permissions of the importer role, exercised by running statements as that role.
 * Permitted writes run inside transactions that are rolled back; refused ones must fail with
 * insufficient_privilege (42501), which is the real guarantee.
 */
const DENIED = '42501';

async function sqlstateOf(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code ?? 'no-sqlstate';
  }
}

describeWithDatabase('importer role permissions', () => {
  const urls = testDatabaseUrls();
  const importerRole = roleOf(urls?.importer ?? 'postgres://x@x/x');
  const ownerRole = roleOf(urls?.migration ?? 'postgres://x@x/x');
  let importer: Client;
  let fixtures: Pool;
  let activeImportId: number;

  beforeAll(async () => {
    fixtures = createFixturePool();
    await truncateAll(fixtures);
    ({ importId: activeImportId } = await seedActiveDataset(fixtures, [
      { ticker: 'AAPL', days: 2 },
    ]));
    importer = await connectImporter();
  });
  afterAll(async () => {
    await importer.end();
    await truncateAll(fixtures);
    await fixtures.end();
  });

  /** Runs statements in a transaction that is always rolled back; returns the result of the last. */
  async function inRolledBackTransaction(...statements: string[]): Promise<string | undefined> {
    await importer.query('BEGIN');
    try {
      let code: string | undefined;
      for (const statement of statements) {
        code = await sqlstateOf(importer.query(statement));
        if (code) break;
      }
      return code;
    } finally {
      await importer.query('ROLLBACK');
    }
  }

  it('connects as the importer role: not superuser, no privileged attributes', async () => {
    const { rows } = await importer.query<Record<string, unknown>>(
      `SELECT current_user AS role, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication,
              rolinherit
       FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows[0]).toEqual({
      role: importerRole,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolbypassrls: false,
      rolreplication: false,
      rolinherit: true,
    });
    expect(importerRole).not.toBe(ownerRole);
    expect(importerRole).not.toBe(roleOf(urls?.api ?? 'postgres://x@x/x'));
  });

  it('owns nothing and belongs to market_data_writer only', async () => {
    const { rows } = await importer.query(
      `SELECT
         (SELECT count(*)::int FROM pg_class WHERE relowner = r.oid)
           + (SELECT count(*)::int FROM pg_proc WHERE proowner = r.oid)
           + (SELECT count(*)::int FROM pg_namespace WHERE nspowner = r.oid) AS owned,
         (SELECT datdba = r.oid FROM pg_database WHERE datname = current_database()) AS database_owner,
         ARRAY(SELECT g.rolname::text FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
               WHERE m.member = r.oid ORDER BY 1) AS member_of
       FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(rows[0]).toEqual({ owned: 0, database_owner: false, member_of: ['market_data_writer'] });
  });

  it('has exactly the granted table privileges (effective, including inherited)', async () => {
    const { rows } = await importer.query<{ table: string; privileges: string[] }>(
      `SELECT c.relname AS "table",
              ARRAY(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS p
                    WHERE has_table_privilege(c.oid, p)) AS privileges
       FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
       ORDER BY 1`,
    );
    expect(rows).toEqual([
      { table: 'daily_prices', privileges: ['SELECT', 'INSERT', 'DELETE'] },
      { table: 'data_imports', privileges: ['SELECT', 'INSERT'] },
      { table: 'dataset_snapshot', privileges: ['SELECT', 'INSERT'] },
      { table: 'pgmigrations', privileges: [] },
      { table: 'stocks', privileges: ['SELECT', 'INSERT', 'DELETE'] },
    ]);
  });

  it('can UPDATE only stocks.name, the status/result columns of data_imports and the pointer columns of dataset_snapshot', async () => {
    const { rows } = await importer.query<{ table: string; columns: string[] }>(
      `SELECT c.relname AS "table",
              ARRAY(SELECT a.attname::text FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                      AND has_column_privilege(c.oid, a.attnum, 'UPDATE') ORDER BY a.attnum) AS columns
       FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       ORDER BY 1`,
    );
    expect(rows).toEqual([
      { table: 'daily_prices', columns: [] },
      {
        table: 'data_imports',
        columns: [
          'status',
          'finished_at',
          'rows_read',
          'stock_count',
          'price_count',
          'error_summary',
        ],
      },
      { table: 'dataset_snapshot', columns: ['import_id', 'activated_at'] },
      { table: 'pgmigrations', columns: [] },
      { table: 'stocks', columns: ['name'] },
    ]);
  });

  it('meets its own least-privilege self-check; the owner role does not', async () => {
    expect(await findImporterPrivilegeViolations(importer)).toEqual([]);

    const owner = new Client({ connectionString: urls?.migration });
    await owner.connect();
    try {
      expect(await findImporterPrivilegeViolations(owner)).toEqual(
        expect.arrayContaining(['owns_objects', 'can_create_objects', 'can_truncate_or_maintain']),
      );
    } finally {
      await owner.end();
    }
  });

  describe('permitted: every statement the importer runs (rolled back)', () => {
    it('records an import without any sequence privilege (identity column)', async () => {
      expect(
        await inRolledBackTransaction(
          `INSERT INTO data_imports (source_file, source_sha256, status) VALUES ('probe.csv', repeat('c', 64), 'running')`,
          `UPDATE data_imports SET status = 'failed', finished_at = clock_timestamp(), error_summary = 'probe'
           WHERE source_file = 'probe.csv'`,
        ),
      ).toBeUndefined();
    });

    it('replaces stocks and prices and moves the pointer', async () => {
      expect(
        await inRolledBackTransaction(
          `SELECT import_id FROM dataset_snapshot FOR UPDATE`,
          `INSERT INTO stocks (ticker, name) VALUES ('NEW', 'Newco')
           ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name WHERE EXCLUDED.name IS NOT NULL`,
          `DELETE FROM daily_prices`,
          `INSERT INTO data_imports (source_file, source_sha256, status) VALUES ('probe.csv', repeat('c', 64), 'running')`,
          `INSERT INTO daily_prices (stock_id, trade_date, open, high, low, close, adj_close, volume, import_id)
           SELECT s.id, current_date, 1, 1, 1, 1, 1, 1, i.id FROM stocks s, data_imports i
           WHERE s.ticker = 'NEW' AND i.source_file = 'probe.csv'`,
          `DELETE FROM stocks s WHERE NOT EXISTS (SELECT 1 FROM daily_prices d WHERE d.stock_id = s.id)`,
          `UPDATE data_imports SET status = 'succeeded', finished_at = clock_timestamp(), rows_read = 1,
             stock_count = 1, price_count = 1 WHERE source_file = 'probe.csv'`,
          `INSERT INTO dataset_snapshot (import_id) SELECT id FROM data_imports WHERE source_file = 'probe.csv'
           ON CONFLICT (singleton) DO UPDATE SET import_id = EXCLUDED.import_id, activated_at = clock_timestamp()`,
        ),
      ).toBeUndefined();
      // Rolled back: the fixture dataset is still active.
      const { rows } = await fixtures.query<{ importId: number }>(
        'SELECT import_id AS "importId" FROM dataset_snapshot',
      );
      expect(rows[0]?.importId).toBe(activeImportId);
    });

    it('takes and releases the importer advisory lock', async () => {
      const { rows } = await importer.query<{ locked: boolean; released: boolean }>(
        `SELECT pg_try_advisory_lock(1) AS locked, pg_advisory_unlock(1) AS released`,
      );
      expect(rows[0]).toEqual({ locked: true, released: true });
    });
  });

  describe('refused', () => {
    it.each([
      `UPDATE stocks SET ticker = ticker`,
      `UPDATE stocks SET id = id`,
      `UPDATE stocks SET created_at = created_at`,
      `UPDATE daily_prices SET volume = volume`,
      `UPDATE daily_prices SET import_id = import_id`,
      `UPDATE data_imports SET source_sha256 = source_sha256`,
      `UPDATE data_imports SET source_file = source_file`,
      `UPDATE data_imports SET started_at = started_at`,
      `UPDATE dataset_snapshot SET import_status = import_status`,
      `DELETE FROM data_imports`,
      `DELETE FROM dataset_snapshot`,
      `TRUNCATE stocks`,
      `TRUNCATE daily_prices`,
      `TRUNCATE data_imports`,
      `TRUNCATE dataset_snapshot`,
    ])('cannot rewrite history or bypass row-level replacement: %s', async (statement) => {
      expect(await sqlstateOf(importer.query(statement))).toBe(DENIED);
    });

    it.each([
      'CREATE TABLE probe (id int)',
      'CREATE INDEX ON stocks (created_at)',
      'ALTER TABLE stocks ADD COLUMN probe int',
      'ALTER TABLE daily_prices DROP CONSTRAINT daily_prices_ohlc',
      'DROP TABLE daily_prices',
      'CREATE VIEW probe AS SELECT 1',
      'CREATE SCHEMA probe',
      'CREATE FUNCTION probe() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$',
      'COMMENT ON TABLE stocks IS $$probe$$',
      'GRANT SELECT ON pgmigrations TO PUBLIC',
      'REINDEX TABLE daily_prices',
      'CLUSTER daily_prices USING daily_prices_pkey',
    ])('cannot run DDL or maintenance: %s', async (statement) => {
      expect(await sqlstateOf(importer.query(statement))).toBe(DENIED);
    });

    it.each(['VACUUM daily_prices', 'ANALYZE daily_prices', 'GRANT SELECT ON stocks TO PUBLIC'])(
      'is refused with a warning, changing nothing: %s',
      async (statement) => {
        // PostgreSQL does not raise an error here: it skips the table (VACUUM/ANALYZE) or grants
        // nothing (no grant option), and says so in a WARNING.
        const notices: string[] = [];
        const onNotice = (notice: { message?: string | undefined }) => {
          notices.push(notice.message ?? '');
        };
        importer.on('notice', onNotice);
        try {
          expect(await sqlstateOf(importer.query(statement))).toBeUndefined();
        } finally {
          importer.off('notice', onNotice);
        }
        expect(notices.join('\n')).toMatch(
          /permission denied|skipping|no privileges were granted/i,
        );
        const { rows } = await fixtures.query<{ public_select: boolean }>(
          `SELECT has_table_privilege('public', 'stocks', 'SELECT') AS public_select`,
        );
        expect(rows[0]?.public_select).toBe(false);
      },
    );

    it.each([
      'SELECT * FROM pgmigrations',
      `INSERT INTO pgmigrations (name, run_on) VALUES ('probe', now())`,
      'DELETE FROM pgmigrations',
      `SELECT nextval('data_imports_id_seq')`,
      `SELECT setval('data_imports_id_seq', 1)`,
    ])('has no access to migrations or sequences: %s', async (statement) => {
      expect(await sqlstateOf(importer.query(statement))).toBe(DENIED);
    });

    it.each([
      'CREATE ROLE probe',
      'CREATE DATABASE probe',
      `ALTER ROLE CURRENT_USER CREATEDB`,
      `SELECT pg_read_file('postgresql.conf')`,
      `SELECT pg_ls_dir('.')`,
      `COPY stocks TO '/tmp/earlstock-probe.csv'`,
      `COPY stocks (ticker) FROM '/etc/hostname'`,
      `COPY stocks TO PROGRAM 'true'`,
    ])('cannot perform administrative or file-system operations: %s', async (statement) => {
      expect(await sqlstateOf(importer.query(statement))).toBe(DENIED);
    });

    it('cannot assume or alter the owner or API roles', async () => {
      for (const role of [ownerRole, roleOf(urls?.api ?? 'postgres://x@x/x')]) {
        const quoted = role.replaceAll('"', '""');
        expect(await sqlstateOf(importer.query(`SET ROLE "${quoted}"`))).toBe(DENIED);
        expect(await sqlstateOf(importer.query(`ALTER ROLE "${quoted}" NOLOGIN`))).toBe(DENIED);
      }
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
      'market_data_reader',
    ])('has no membership, direct or inherited, in %s', async (role) => {
      const { rows } = await importer.query<{ member: boolean }>(
        `SELECT pg_has_role(current_user, $1, 'MEMBER') AS member`,
        [role],
      );
      expect(rows[0]?.member).toBe(false);
    });
  });
});
