import { readdirSync } from 'node:fs';
import { describeWithDatabase } from './helpers/database.js';
import {
  dropMigrationDatabase,
  migrate,
  recreateMigrationDatabase,
  sql,
} from './helpers/migration-database.js';

/**
 * Migration behaviour on a disposable database: reversibility, exact schema restoration, and the
 * guards that refuse to destroy data. Positions are counted in the migrations directory.
 */
const MIGRATIONS = readdirSync('migrations')
  .filter((file) => file.endsWith('.sql'))
  .sort();
const position = (name: string) => {
  const index = MIGRATIONS.findIndex((file) => file.endsWith(`_${name}.sql`));
  if (index < 0) throw new Error(`migration ${name} not found`);
  return index;
};
const BEFORE_M1 = position('remove-live-ingestion'); // number of migrations preceding M1
const BEFORE_M2 = position('historical-daily-prices'); // number of migrations preceding M2

/** Columns (in order, with type, nullability, default and collation) and constraints of a table. */
const DEFINITION = `
  SELECT json_build_object(
    'columns', (
      SELECT json_agg(json_build_object(
               'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
               'notNull', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid),
               'collation', c.collname) ORDER BY a.attnum)
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      LEFT JOIN pg_collation c ON c.oid = a.attcollation
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped),
    'constraints', (
      SELECT json_agg(json_build_object('name', conname, 'definition', pg_get_constraintdef(oid))
             ORDER BY conname)
      FROM pg_constraint WHERE conrelid = $1::regclass)
  ) AS definition`;

describeWithDatabase('migrations (disposable database)', () => {
  let url: string;

  beforeEach(async () => {
    url = await recreateMigrationDatabase();
  });
  afterAll(() => dropMigrationDatabase());

  const definitionOf = async (table: string) =>
    (await sql<{ definition: unknown }>(url, DEFINITION, [table]))[0]?.definition;
  const tables = async () =>
    (
      await sql<{ name: string }>(
        url,
        `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
      )
    ).map((row) => row.name);
  const applied = async () =>
    (await sql<{ n: number }>(url, 'SELECT count(*)::int AS n FROM pgmigrations'))[0]?.n;

  it('applies, reverts to zero and re-applies the full chain', async () => {
    await migrate(url, 'up', MIGRATIONS.length);
    expect(await tables()).toEqual([
      'daily_prices',
      'data_imports',
      'dataset_snapshot',
      'pgmigrations',
      'stocks',
    ]);

    await migrate(url, 'down', MIGRATIONS.length);
    expect(await tables()).toEqual(['pgmigrations']);
    expect(await applied()).toBe(0);

    await migrate(url, 'up', MIGRATIONS.length);
    expect(await applied()).toBe(MIGRATIONS.length);
  });

  describe('M2 historical-daily-prices', () => {
    it('reshapes stocks while keeping the UUIDv7 default', async () => {
      await migrate(url, 'up', BEFORE_M2 + 1);

      expect(await definitionOf('stocks')).toEqual({
        columns: [
          { name: 'id', type: 'uuid', notNull: true, default: 'uuidv7()', collation: null },
          {
            name: 'ticker',
            type: 'character varying(32)',
            notNull: true,
            default: null,
            collation: 'C',
          },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            notNull: true,
            default: 'now()',
            collation: null,
          },
        ],
        constraints: expect.arrayContaining([
          expect.objectContaining({ name: 'stocks_pkey', definition: 'PRIMARY KEY (id)' }),
          expect.objectContaining({ name: 'stocks_ticker_key', definition: 'UNIQUE (ticker)' }),
          expect.objectContaining({ name: 'stocks_ticker_format' }),
        ]),
      });
    });

    it('restores the exact previous stocks definition when reverted', async () => {
      await migrate(url, 'up', BEFORE_M2);
      const before = await definitionOf('stocks');

      await migrate(url, 'up', 1);
      await migrate(url, 'down', 1);

      expect(await definitionOf('stocks')).toEqual(before);
      expect(await tables()).toEqual(['pgmigrations', 'stocks']);
      expect(await applied()).toBe(BEFORE_M2);
    });

    it('refuses to run while stocks has rows, changing nothing', async () => {
      await migrate(url, 'up', BEFORE_M2);
      const before = await definitionOf('stocks');
      await sql(
        url,
        `INSERT INTO stocks (symbol, name, exchange, currency) VALUES ('X', 'X', 'X', 'USD')`,
      );

      await expect(migrate(url, 'up', 1)).rejects.toThrow(/stocks is not empty/);

      expect(await definitionOf('stocks')).toEqual(before);
      expect(await applied()).toBe(BEFORE_M2);
      expect((await sql<{ n: number }>(url, 'SELECT count(*)::int AS n FROM stocks'))[0]?.n).toBe(
        1,
      );
    });

    it.each([
      ['stocks', [`INSERT INTO stocks (ticker) VALUES ('AAPL')`]],
      [
        'data_imports',
        [
          `INSERT INTO data_imports (source_file, source_sha256, status, finished_at, error_summary)
           VALUES ('synthetic-fixture.csv', repeat('a', 64), 'failed', now(), 'synthetic failure')`,
        ],
      ],
      [
        'daily_prices',
        [
          `INSERT INTO stocks (ticker) VALUES ('AAPL')`,
          `INSERT INTO data_imports (source_file, source_sha256, status, finished_at, rows_read, stock_count, price_count)
           VALUES ('synthetic-fixture.csv', repeat('a', 64), 'succeeded', now(), 1, 1, 1)`,
          `INSERT INTO daily_prices (stock_id, trade_date, open, high, low, close, adj_close, volume, import_id)
           SELECT s.id, current_date, 1, 1, 1, 1, 1, 1, i.id FROM stocks s, data_imports i`,
        ],
      ],
    ])('refuses to revert while %s has rows, changing nothing', async (_table, statements) => {
      await migrate(url, 'up', BEFORE_M2 + 1);
      for (const statement of statements) await sql(url, statement);
      const before = await definitionOf('stocks');

      await expect(migrate(url, 'down', 1)).rejects.toThrow(/refusing to revert/);

      expect(await tables()).toEqual(['daily_prices', 'data_imports', 'pgmigrations', 'stocks']);
      expect(await definitionOf('stocks')).toEqual(before);
      expect(await applied()).toBe(BEFORE_M2 + 1);
    });
  });

  describe('M1 remove-live-ingestion (guards, previously verified manually)', () => {
    it.each([
      [
        'price_quotes',
        `INSERT INTO price_quotes (stock_id, price, observed_at, provider)
         SELECT id, 1, now(), 'synthetic' FROM stocks`,
      ],
      [
        'provider_api_usage',
        `INSERT INTO provider_api_usage (provider, usage_date, calls_used) VALUES ('synthetic', current_date, 1)`,
      ],
    ])('refuses to run while %s has rows', async (table, insert) => {
      await migrate(url, 'up', BEFORE_M1);
      await sql(
        url,
        `INSERT INTO stocks (symbol, name, exchange, currency) VALUES ('X', 'X', 'X', 'USD')`,
      );
      await sql(url, insert);

      await expect(migrate(url, 'up', 1)).rejects.toThrow(new RegExp(`${table} is not empty`));
      expect(await applied()).toBe(BEFORE_M1);
    });
  });
});
