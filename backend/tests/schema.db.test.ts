import type { Pool } from 'pg';
import { createFixturePool, describeWithDatabase, truncateAll } from './helpers/database.js';

/**
 * Database-level rules of the historical data model (stocks, daily_prices, data_imports).
 * These are PostgreSQL integration tests: the rules live in the schema, so they are exercised
 * with direct SQL rather than through application code. All values are synthetic fixtures;
 * dates are relative to current_date, so no calendar date is hard-coded.
 */

const SQLSTATE = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  notNullViolation: '23502',
  stringTooLong: '22001',
  numericOutOfRange: '22003',
} as const;

const SHA256 = 'a'.repeat(64);
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Resolves to the SQLSTATE an operation failed with, or undefined if it succeeded. */
async function sqlstateOf(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code ?? 'no-sqlstate';
  }
}

type ImportValues = Partial<{
  source_file: string | null;
  source_sha256: string | null;
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
  rows_read: number | null;
  stock_count: number | null;
  price_count: number | null;
  error_summary: string | null;
}>;

const SUCCEEDED: ImportValues = {
  source_file: 'synthetic-fixture.csv',
  source_sha256: SHA256,
  status: 'succeeded',
  // Both explicit (rather than started_at defaulting to now() at insert time) so they stay ordered.
  started_at: new Date(Date.now() - 60_000).toISOString(),
  finished_at: new Date(Date.now() - 30_000).toISOString(),
  rows_read: 10,
  stock_count: 2,
  price_count: 10,
};

type BarValues = Partial<{
  stock_id: string | null;
  day_offset: number;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string | null;
  adj_close: string | null;
  volume: string | null;
  import_id: number | null;
}>;

describeWithDatabase('historical data model schema (database)', () => {
  let pool: Pool;

  beforeAll(() => {
    // Constraints are exercised by writing, so this suite uses the migration (owner) role.
    pool = createFixturePool();
  });
  beforeEach(() => truncateAll(pool));
  afterAll(() => pool.end());

  const insertStock = async (ticker: string): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO stocks (ticker) VALUES ($1) RETURNING id',
      [ticker],
    );
    return rows[0]?.id ?? '';
  };

  /** Column names come from the fixed ImportValues keys; every value is a bound parameter. */
  const insertImport = async (values: ImportValues = SUCCEEDED): Promise<number> => {
    const columns = Object.keys(values);
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO data_imports (${columns.join(', ')})
       VALUES (${columns.map((_, index) => `$${String(index + 1)}`).join(', ')}) RETURNING id`,
      Object.values(values),
    );
    return rows[0]?.id ?? 0;
  };

  const insertBar = async (values: BarValues): Promise<void> => {
    const bar = {
      day_offset: 0,
      open: '10',
      high: '12',
      low: '9',
      close: '11',
      adj_close: '10.5',
      volume: '1000',
      ...values,
    };
    await pool.query(
      `INSERT INTO daily_prices (stock_id, trade_date, open, high, low, close, adj_close, volume, import_id)
       VALUES ($1, current_date + $2::int, $3, $4, $5, $6, $7, $8, $9)`,
      [
        bar.stock_id,
        bar.day_offset,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.adj_close,
        bar.volume,
        bar.import_id,
      ],
    );
  };

  /** A stock and a succeeded import to hang daily prices on. */
  const fixture = async () => ({
    stockId: await insertStock('AAPL'),
    importId: await insertImport(),
  });

  describe('stocks', () => {
    it('generates UUIDv7 identifiers in the database', async () => {
      await insertStock('AAPL');

      const { rows } = await pool.query<{ id: string; version: number; default: string }>(
        `SELECT id, uuid_extract_version(id) AS version,
                (SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef
                  WHERE adrelid = 'stocks'::regclass AND adnum = 1) AS default
         FROM stocks`,
      );
      expect(rows[0]).toEqual({
        id: expect.stringMatching(UUID_V7),
        version: 7,
        default: 'uuidv7()',
      });
    });

    it('rejects a duplicate ticker', async () => {
      await insertStock('AAPL');

      expect(await sqlstateOf(insertStock('AAPL'))).toBe(SQLSTATE.uniqueViolation);
    });

    it.each([
      'A',
      'AAPL',
      'BRK.B',
      'BF.B',
      'BRK-B',
      'BTC-USD',
      'EURUSD=X',
      'GC=F',
      '^GSPC',
      '0700.HK',
      'X1',
    ])('accepts the ticker %s', async (ticker) => {
      expect(await sqlstateOf(insertStock(ticker))).toBeUndefined();
    });

    it.each([
      'aapl',
      'Aapl',
      '',
      ' AAPL',
      'AAPL ',
      'AA PL',
      '.A',
      'A.',
      'A..B',
      'A.-B',
      '^',
      '^^A',
      'A^B',
      'BRK/B',
      'A$',
      'A_B',
    ])('rejects the ticker %p', async (ticker) => {
      expect(await sqlstateOf(insertStock(ticker))).toBe(SQLSTATE.checkViolation);
    });

    it('rejects tickers longer than 32 characters', async () => {
      expect(await sqlstateOf(insertStock('A'.repeat(32)))).toBeUndefined();
      expect(await sqlstateOf(insertStock('B'.repeat(33)))).toBe(SQLSTATE.stringTooLong);
    });

    it('orders tickers byte-wise (COLLATE "C"), independent of the database locale', async () => {
      for (const ticker of ['BFA', 'BF.B', 'B', 'BF-B', '^GSPC']) await insertStock(ticker);

      const { rows } = await pool.query<{ ticker: string }>(
        'SELECT ticker FROM stocks ORDER BY ticker',
      );
      expect(rows.map((row) => row.ticker)).toEqual(['B', 'BF-B', 'BF.B', 'BFA', '^GSPC']);
    });
  });

  describe('daily_prices', () => {
    it('accepts a valid bar, including one where open, high, low and close are equal', async () => {
      const { stockId, importId } = await fixture();

      expect(
        await sqlstateOf(insertBar({ stock_id: stockId, import_id: importId })),
      ).toBeUndefined();
      expect(
        await sqlstateOf(
          insertBar({
            stock_id: stockId,
            import_id: importId,
            day_offset: 1,
            open: '5',
            high: '5',
            low: '5',
            close: '5',
          }),
        ),
      ).toBeUndefined();
    });

    it('rejects a second bar for the same stock and date (primary key)', async () => {
      const { stockId, importId } = await fixture();
      await insertBar({ stock_id: stockId, import_id: importId });

      expect(await sqlstateOf(insertBar({ stock_id: stockId, import_id: importId }))).toBe(
        SQLSTATE.uniqueViolation,
      );
    });

    it('rejects references to an unknown stock or import', async () => {
      const { stockId, importId } = await fixture();

      expect(
        await sqlstateOf(
          insertBar({ stock_id: '019a7d3c-8f2e-7a51-9c3b-2d4e6f8a0b1c', import_id: importId }),
        ),
      ).toBe(SQLSTATE.foreignKeyViolation);
      expect(await sqlstateOf(insertBar({ stock_id: stockId, import_id: importId + 1000 }))).toBe(
        SQLSTATE.foreignKeyViolation,
      );
    });

    it('prevents deleting a stock or an import that still has prices (no cascade)', async () => {
      const { stockId, importId } = await fixture();
      await insertBar({ stock_id: stockId, import_id: importId });

      expect(await sqlstateOf(pool.query('DELETE FROM stocks WHERE id = $1', [stockId]))).toBe(
        SQLSTATE.foreignKeyViolation,
      );
      expect(
        await sqlstateOf(pool.query('DELETE FROM data_imports WHERE id = $1', [importId])),
      ).toBe(SQLSTATE.foreignKeyViolation);
      const { rows } = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM daily_prices',
      );
      expect(rows[0]?.n).toBe(1);
    });

    it.each([
      ['low above open', { open: '9', low: '9.5' }],
      ['low above close', { close: '8.5' }],
      ['high below open', { open: '12.5' }],
      ['high below close', { close: '12.5' }],
      ['low of zero', { open: '0', low: '0', close: '1', high: '2' }],
      ['negative low', { open: '-1', low: '-1', close: '1', high: '2' }],
      ['adjusted close of zero', { adj_close: '0' }],
      ['negative adjusted close', { adj_close: '-1' }],
    ])('rejects a bar with %s', async (_case, values) => {
      const { stockId, importId } = await fixture();

      expect(
        await sqlstateOf(insertBar({ stock_id: stockId, import_id: importId, ...values })),
      ).toBe(SQLSTATE.checkViolation);
    });

    it('accepts volumes from 0 to 2^53 - 1 and rejects values outside that range', async () => {
      const { stockId, importId } = await fixture();
      const bar = (day_offset: number, volume: string) =>
        insertBar({ stock_id: stockId, import_id: importId, day_offset, volume });

      expect(await sqlstateOf(bar(0, '0'))).toBeUndefined();
      expect(await sqlstateOf(bar(1, '9007199254740991'))).toBeUndefined();
      expect(await sqlstateOf(bar(2, '-1'))).toBe(SQLSTATE.checkViolation);
      expect(await sqlstateOf(bar(3, '9007199254740992'))).toBe(SQLSTATE.checkViolation);
    });

    it.each([
      'stock_id',
      'open',
      'high',
      'low',
      'close',
      'adj_close',
      'volume',
      'import_id',
    ] as const)('requires %s', async (column) => {
      const { stockId, importId } = await fixture();

      expect(
        await sqlstateOf(insertBar({ stock_id: stockId, import_id: importId, [column]: null })),
      ).toBe(SQLSTATE.notNullViolation);
    });
  });

  describe('data_imports', () => {
    it.each([
      [
        'running',
        {
          ...SUCCEEDED,
          status: 'running',
          finished_at: null,
          rows_read: null,
          stock_count: null,
          price_count: null,
        },
      ],
      ['succeeded', SUCCEEDED],
      [
        'failed',
        {
          ...SUCCEEDED,
          status: 'failed',
          rows_read: null,
          stock_count: null,
          price_count: null,
          error_summary: 'line 2: invalid date',
        },
      ],
    ])('accepts a valid %s import', async (_case, values) => {
      expect(await sqlstateOf(insertImport(values))).toBeUndefined();
    });

    it.each(['rows_read', 'stock_count', 'price_count'] as const)(
      'rejects a succeeded import whose %s is NULL, zero or negative',
      async (statistic) => {
        expect(await sqlstateOf(insertImport({ ...SUCCEEDED, [statistic]: null }))).toBe(
          SQLSTATE.checkViolation,
        );
        expect(await sqlstateOf(insertImport({ ...SUCCEEDED, [statistic]: 0 }))).toBe(
          SQLSTATE.checkViolation,
        );
        expect(await sqlstateOf(insertImport({ ...SUCCEEDED, [statistic]: -1 }))).toBe(
          SQLSTATE.checkViolation,
        );
      },
    );

    it.each([
      ['more stocks than prices', { stock_count: 11 }],
      ['more prices than rows read', { price_count: 11 }],
      ['a running import with finished_at', { status: 'running' }],
      ['a finished import without finished_at', { finished_at: null }],
      [
        'finished_at before started_at',
        {
          started_at: new Date().toISOString(),
          finished_at: new Date(Date.now() - 1000).toISOString(),
        },
      ],
      ['a failed import without error_summary', { status: 'failed' }],
      ['a succeeded import with error_summary', { error_summary: 'unexpected' }],
      ['an unknown status', { status: 'done' }],
      ['an upper-case checksum', { source_sha256: 'A'.repeat(64) }],
      ['a short checksum', { source_sha256: 'a'.repeat(63) }],
      ['a path as source_file', { source_file: 'data/synthetic-fixture.csv' }],
      ['an empty source_file', { source_file: '' }],
    ])('rejects %s', async (_case, values) => {
      expect(await sqlstateOf(insertImport({ ...SUCCEEDED, ...values }))).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });

  describe('numeric precision and node-postgres representation', () => {
    const readBack = async (expression: string) => {
      const { rows } = await pool.query<{ value: unknown }>(
        `SELECT ${expression} AS value FROM daily_prices LIMIT 1`,
      );
      return rows[0]?.value;
    };

    it('stores the extremes of NUMERIC(18,6) exactly and returns them as strings', async () => {
      const { stockId, importId } = await fixture();
      const max = '999999999999.999999';
      await insertBar({
        stock_id: stockId,
        import_id: importId,
        open: max,
        high: max,
        low: max,
        close: max,
        adj_close: max,
      });
      await insertBar({
        stock_id: stockId,
        import_id: importId,
        day_offset: 1,
        open: '0.000001',
        high: '0.000001',
        low: '0.000001',
        close: '0.000001',
        adj_close: '0.000001',
      });

      const { rows } = await pool.query<{ open: unknown }>(
        'SELECT open FROM daily_prices ORDER BY trade_date',
      );
      expect(rows.map((row) => row.open)).toEqual([max, '0.000001']);
      expect(typeof rows[0]?.open).toBe('string');
    });

    it('drops only trailing zeros with trim_scale, without changing the value', async () => {
      const { stockId, importId } = await fixture();
      await insertBar({ stock_id: stockId, import_id: importId, close: '11.850000' });

      expect(await readBack('close')).toBe('11.850000');
      expect(await readBack('trim_scale(close)::text')).toBe('11.85');
    });

    it('rejects values with more than 12 integer digits', async () => {
      const { stockId, importId } = await fixture();

      expect(
        await sqlstateOf(
          insertBar({ stock_id: stockId, import_id: importId, high: '1000000000000' }),
        ),
      ).toBe(SQLSTATE.numericOutOfRange);
    });

    it('ROUNDS a 7th decimal instead of rejecting it, so the importer must validate decimals itself', async () => {
      const { stockId, importId } = await fixture();
      const v = '10.1234567';
      await insertBar({
        stock_id: stockId,
        import_id: importId,
        open: v,
        high: v,
        low: v,
        close: v,
        adj_close: v,
      });

      expect(await readBack('open')).toBe('10.123457');
    });

    it('returns BIGINT volume as a string that converts to a safe integer', async () => {
      const { stockId, importId } = await fixture();
      await insertBar({ stock_id: stockId, import_id: importId, volume: '9007199254740991' });

      const volume = await readBack('volume');
      expect(volume).toBe('9007199254740991');
      expect(Number.isSafeInteger(Number(volume))).toBe(true);
    });

    it('formats trade_date as a YYYY-MM-DD string with to_char (the default parser yields a Date)', async () => {
      const { stockId, importId } = await fixture();
      await insertBar({ stock_id: stockId, import_id: importId });

      expect(await readBack(`to_char(trade_date, 'YYYY-MM-DD')`)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(await readBack('trade_date')).toBeInstanceOf(Date);
    });
  });
});
