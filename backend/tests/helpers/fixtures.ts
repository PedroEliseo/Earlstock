import type { Pool } from 'pg';

/**
 * Synthetic test data, written as the owner role (fixture pool), never through the API role.
 * Dates are computed by PostgreSQL relative to current_date, so no calendar date is hard-coded.
 */

export interface FixtureBar {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  adjClose: string;
  volume: string;
}

export async function insertImport(
  pool: Pool,
  status: 'succeeded' | 'failed' = 'succeeded',
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    status === 'succeeded'
      ? `INSERT INTO data_imports (source_file, source_sha256, status, started_at, finished_at, rows_read, stock_count, price_count)
         VALUES ('synthetic-fixture.csv', repeat('a', 64), 'succeeded', now() - interval '1 minute', now(), 1000000, 1000, 1000000)
         RETURNING id`
      : `INSERT INTO data_imports (source_file, source_sha256, status, started_at, finished_at, error_summary)
         VALUES ('synthetic-fixture.csv', repeat('b', 64), 'failed', now() - interval '1 minute', now(), 'synthetic failure')
         RETURNING id`,
  );
  return rows[0]?.id ?? 0;
}

/** Points dataset_snapshot at an import (inserting or replacing the single row). */
export async function activate(pool: Pool, importId: number): Promise<void> {
  await pool.query(
    `INSERT INTO dataset_snapshot (import_id) VALUES ($1)
     ON CONFLICT (singleton) DO UPDATE SET import_id = EXCLUDED.import_id, activated_at = now()`,
    [importId],
  );
}

export async function insertStock(pool: Pool, ticker: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO stocks (ticker) VALUES ($1)
     ON CONFLICT (ticker) DO UPDATE SET ticker = EXCLUDED.ticker RETURNING id`,
    [ticker],
  );
  return rows[0]?.id ?? '';
}

/**
 * Inserts `days` consecutive calendar days of bars, ending `endOffset` days from current_date,
 * with deterministic values derived from `base` and the day index. Returns the bars as the API
 * represents stored values (trimmed decimal strings, volume as a string), oldest first.
 */
export async function insertBars(
  pool: Pool,
  {
    stockId,
    importId,
    days,
    endOffset = 0,
    base = 100,
  }: { stockId: string; importId: number; days: number; endOffset?: number; base?: number },
): Promise<FixtureBar[]> {
  const { rows } = await pool.query<FixtureBar>(
    `INSERT INTO daily_prices (stock_id, trade_date, open, high, low, close, adj_close, volume, import_id)
     SELECT $1, current_date + $2::int - ($3::int - 1) + i,
            $4::numeric + i, $4::numeric + i + 1.5, $4::numeric + i - 1.25, $4::numeric + i + 0.5,
            $4::numeric + i + 0.25, 1000 + i, $5
     FROM generate_series(0, $3::int - 1) AS i
     RETURNING to_char(trade_date, 'YYYY-MM-DD') AS "date", trim_scale(open)::text AS "open",
               trim_scale(high)::text AS "high", trim_scale(low)::text AS "low",
               trim_scale(close)::text AS "close", trim_scale(adj_close)::text AS "adjClose",
               volume::text AS "volume"`,
    [stockId, endOffset, days, base, importId],
  );
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** A complete, active snapshot: one succeeded import, its stocks and bars, and the pointer. */
export async function seedActiveDataset(
  pool: Pool,
  stocks: { ticker: string; days: number; endOffset?: number; base?: number }[],
): Promise<{ importId: number; bars: Record<string, FixtureBar[]> }> {
  const importId = await insertImport(pool);
  const bars: Record<string, FixtureBar[]> = {};
  for (const stock of stocks) {
    const stockId = await insertStock(pool, stock.ticker);
    bars[stock.ticker] = await insertBars(pool, { stockId, importId, ...stock });
  }
  await activate(pool, importId);
  return { importId, bars };
}
