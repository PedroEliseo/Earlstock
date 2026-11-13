import type { Pool } from 'pg';
import type { Page } from '../../shared/http/pagination.js';
import type { CreateQuoteInput, QuoteHistoryQuery } from './quotes.schemas.js';

/**
 * Decimal and BIGINT values stay strings end to end: node-postgres returns NUMERIC and INT8 as
 * strings by default, and converting them to `number` would lose precision.
 */
export interface Quote {
  id: string;
  stockId: string;
  price: string;
  volume: string | null;
  observedAt: Date;
  provider: string;
  createdAt: Date;
}

// A constant, never user input. trim_scale() drops trailing zeros (189.50000000 -> 189.5) without
// changing the value; ::text makes the string representation explicit.
const QUOTE_COLUMNS = `id::text AS id, stock_id AS "stockId",
  trim_scale(price)::text AS price, trim_scale(volume)::text AS volume,
  observed_at AS "observedAt", provider, created_at AS "createdAt"`;

// Newest first. (observed_at, provider) is unique per stock, so provider is a deterministic
// tie-breaker, and both columns come straight from the UNIQUE (stock_id, observed_at, provider)
// index read backwards: no sort step and no extra index needed.
const NEWEST_FIRST = 'ORDER BY observed_at DESC, provider DESC';

// Optional bounds without dynamic SQL: a missing bound becomes +/- infinity.
const IN_RANGE = `stock_id = $1
  AND observed_at >= COALESCE($2::timestamptz, '-infinity')
  AND observed_at < COALESCE($3::timestamptz, 'infinity')`;

export function createQuotesRepository(db: Pool) {
  return {
    async create(stockId: string, quote: CreateQuoteInput): Promise<Quote> {
      const { rows } = await db.query<Quote>(
        `INSERT INTO price_quotes (stock_id, price, volume, observed_at, provider)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${QUOTE_COLUMNS}`,
        [stockId, quote.price, quote.volume, quote.observedAt, quote.provider],
      );
      const [created] = rows;
      if (!created) throw new Error('INSERT ... RETURNING returned no row');
      return created;
    },

    /**
     * Bulk insert for ingestion. Rows that already exist (same stock, instant and provider) are
     * skipped, never overwritten. Decimals travel as text and are cast in SQL, so no precision is
     * lost. Returns the number of rows actually inserted.
     */
    async insertMany(stockId: string, quotes: CreateQuoteInput[]): Promise<number> {
      const { rowCount } = await db.query(
        `INSERT INTO price_quotes (stock_id, price, volume, observed_at, provider)
         SELECT $1, q.price, q.volume, q.observed_at, q.provider
         FROM unnest($2::numeric[], $3::numeric[], $4::timestamptz[], $5::varchar[])
           AS q (price, volume, observed_at, provider)
         ON CONFLICT (stock_id, observed_at, provider) DO NOTHING`,
        [
          stockId,
          quotes.map((quote) => quote.price),
          quotes.map((quote) => quote.volume),
          quotes.map((quote) => quote.observedAt),
          quotes.map((quote) => quote.provider),
        ],
      );
      return rowCount ?? 0;
    },

    async findLatest(stockId: string): Promise<Quote | null> {
      const { rows } = await db.query<Quote>(
        `SELECT ${QUOTE_COLUMNS} FROM price_quotes WHERE stock_id = $1 ${NEWEST_FIRST} LIMIT 1`,
        [stockId],
      );
      return rows[0] ?? null;
    },

    async findPage(
      stockId: string,
      { from, to, limit, offset }: QuoteHistoryQuery,
    ): Promise<Page<Quote>> {
      const range = [stockId, from ?? null, to ?? null];
      const [items, count] = await Promise.all([
        db.query<Quote>(
          `SELECT ${QUOTE_COLUMNS} FROM price_quotes WHERE ${IN_RANGE} ${NEWEST_FIRST} LIMIT $4 OFFSET $5`,
          [...range, limit, offset],
        ),
        db.query<{ total: number }>(
          `SELECT count(*)::int AS total FROM price_quotes WHERE ${IN_RANGE}`,
          range,
        ),
      ]);
      return { items: items.rows, total: count.rows[0]?.total ?? 0 };
    },
  };
}

export type QuotesRepository = ReturnType<typeof createQuotesRepository>;
