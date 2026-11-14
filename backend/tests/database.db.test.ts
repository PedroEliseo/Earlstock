import type { Pool } from 'pg';
import { createDatabase } from '../src/db/database.js';
import { createPool } from '../src/db/pool.js';
import {
  DatabaseQueryError,
  DatabaseTimeoutError,
  DatabaseUnavailableError,
} from '../src/shared/errors.js';
import { createLogger } from '../src/shared/logger.js';
import { createUnreachablePool, describeWithDatabase } from './helpers/database.js';
import { testDatabaseUrls } from './setup/global-setup.js';

/** The Database layer against real PostgreSQL, connected as the read-only API role. */
describeWithDatabase('Database.query (API role)', () => {
  const apiUrl = testDatabaseUrls()?.api ?? '';
  const pools: Pool[] = [];
  const pool = (statementTimeoutMs?: number) => {
    const created = createPool({
      MARKET_DATA_DATABASE_URL: apiUrl,
      DATABASE_POOL_MAX: 2,
      ...(statementTimeoutMs ? { DATABASE_STATEMENT_TIMEOUT_MS: statementTimeoutMs } : {}),
    });
    pools.push(created);
    return created;
  };
  const captured = () => {
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger((_level, line) =>
      lines.push(JSON.parse(line) as Record<string, unknown>),
    );
    return { lines, logger };
  };

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
  });

  it('configures API sessions: application name, statement and idle-in-transaction timeouts', async () => {
    const db = createDatabase(pool());

    const [row] = await db.query<Record<string, string>>(
      'test.settings',
      `SELECT current_setting('application_name') AS "applicationName",
              current_setting('statement_timeout') AS "statementTimeout",
              current_setting('idle_in_transaction_session_timeout') AS "idleInTransaction",
              current_user AS "role"`,
    );

    expect(row).toEqual({
      applicationName: 'earlstock-api',
      statementTimeout: '5s',
      idleInTransaction: '10s',
      role: expect.stringMatching(/./),
    });
  });

  it('returns rows and logs slow queries by name only: no SQL text, no parameters', async () => {
    const { lines, logger } = captured();
    const db = createDatabase(pool(), { logger, slowQueryMs: 0 });

    const rows = await db.query<{ value: string }>('test.echo', 'SELECT $1::text AS value', [
      'PARAM-VALUE',
    ]);

    expect(rows).toEqual([{ value: 'PARAM-VALUE' }]);
    expect(lines).toEqual([
      expect.objectContaining({
        level: 'warn',
        message: 'slow database query',
        query: 'test.echo',
        durationMs: expect.any(Number),
        rowCount: 1,
      }),
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/PARAM-VALUE|SELECT/);
  });

  it('does not log queries below the slow threshold', async () => {
    const { lines, logger } = captured();

    await createDatabase(pool(), { logger, slowQueryMs: 10_000 }).query('test.fast', 'SELECT 1');

    expect(lines).toEqual([]);
  });

  it('classifies a statement timeout as DatabaseTimeoutError', async () => {
    const db = createDatabase(pool(100));

    const error = await db.query('test.sleep', 'SELECT pg_sleep(2)').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DatabaseTimeoutError);
    expect(error).toMatchObject({ context: { query: 'test.sleep' } });
  });

  it('classifies an explicit cancellation (also SQLSTATE 57014) as an internal error, not unavailability', async () => {
    const sleeping = pool();
    const controller = pool();
    const db = createDatabase(sleeping);

    const running = db.query('test.cancelled', 'SELECT pg_sleep(5)').catch((err: unknown) => err);
    let cancelled = false;
    for (let attempt = 0; attempt < 50 && !cancelled; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const { rows } = await controller.query<{ cancelled: boolean }>(
        `SELECT pg_cancel_backend(pid) AS cancelled FROM pg_stat_activity
         WHERE usename = current_user AND pid <> pg_backend_pid() AND query = 'SELECT pg_sleep(5)'`,
      );
      cancelled = rows.some((row) => row.cancelled);
    }
    const error = await running;

    expect(cancelled).toBe(true);
    expect(error).toBeInstanceOf(DatabaseQueryError);
    expect((error as Error & { cause: { code?: string } }).cause.code).toBe('57014');
  });

  it('classifies an unreachable server as DatabaseUnavailableError', async () => {
    const unreachable = createUnreachablePool();
    pools.push(unreachable);

    const error = await createDatabase(unreachable)
      .query('test.unreachable', 'SELECT 1')
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DatabaseUnavailableError);
  });
});
