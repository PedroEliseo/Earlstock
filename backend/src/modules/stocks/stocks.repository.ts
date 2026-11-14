import type { Database } from '../../db/database.js';
import type { DateString, DecimalString, IntegerString } from '../../shared/types.js';
import { ISO_UTC, toActiveSnapshot } from '../dataset/dataset.repository.js';
import type { ListStocksQuery, StockSortKey } from './stocks.schemas.js';

export interface DailyBar {
  date: DateString;
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  close: DecimalString;
  adjClose: DecimalString;
  volume: IntegerString;
}

export interface StockSummary {
  ticker: string;
  firstDate: DateString;
  lastDate: DateString;
}

export interface StockDetail {
  ticker: string;
  coverage: { firstDate: DateString; lastDate: DateString; tradingDays: number };
  latest: DailyBar;
}

export interface DateRange {
  from?: DateString | undefined;
  to?: DateString | undefined;
  /** Exclusive cursor. */
  after?: DateString | undefined;
}

/*
 * Query design (all constants; every value is a bound parameter):
 *  - ONE statement per operation: PostgreSQL gives each statement a single consistent view, so a
 *    response can never mix two dataset snapshots, without explicit transactions.
 *  - Every statement starts FROM a one-row sentinel and LEFT JOINs the active snapshot, so it always
 *    returns at least one row: NULL snapshot columns mean "no active snapshot", which stays
 *    distinguishable from "no stocks" and from "page beyond the end".
 *  - Prices are read only from the active snapshot's import; a stock belongs to the dataset only if
 *    it has bars in it.
 *  - Values keep their PostgreSQL representation: NUMERIC as trimmed decimal text, BIGINT as text,
 *    DATE formatted with to_char (independent of DateStyle, TimeZone and the Node process).
 */
const ACTIVE = `active AS (
  SELECT import_id, ${ISO_UTC('activated_at')} AS activated_at FROM dataset_snapshot)`;

const BAR_COLUMNS = (alias: string) => `
  to_char(${alias}.trade_date, 'YYYY-MM-DD') AS "date",
  trim_scale(${alias}.open)::text AS "open",
  trim_scale(${alias}.high)::text AS "high",
  trim_scale(${alias}.low)::text AS "low",
  trim_scale(${alias}.close)::text AS "close",
  trim_scale(${alias}.adj_close)::text AS "adjClose",
  ${alias}.volume::text AS "volume"`;

/**
 * Stock list: every stock with bars in the active snapshot, its first and last date, optionally
 * filtered by ticker substring, ordered, and paged. The first/last dates are computed for every
 * listed stock (each a MIN/MAX probe on the (stock_id, trade_date) primary key) because ordering by
 * them must consider all stocks, not only the page. `position` carries the order through to the
 * final SELECT. The ORDER BY comes from a fixed whitelist (STOCK_LIST_SQL), never from input.
 */
const SORT_COLUMN: Record<StockSortKey, string> = {
  ticker: 'l.ticker',
  firstDate: 'l.first_date',
  lastDate: 'l.last_date',
};

function listSql(sort: StockSortKey, dir: 'asc' | 'desc'): string {
  const direction = dir === 'desc' ? 'DESC' : 'ASC';
  const order =
    sort === 'ticker' ? `l.ticker ${direction}` : `${SORT_COLUMN[sort]} ${direction}, l.ticker ASC`;
  return `
  WITH ${ACTIVE},
  listed AS (
    SELECT st.ticker, c.first_date, c.last_date
    FROM stocks st
    CROSS JOIN active a
    CROSS JOIN LATERAL (
      SELECT min(d.trade_date) AS first_date, max(d.trade_date) AS last_date
      FROM daily_prices d WHERE d.stock_id = st.id AND d.import_id = a.import_id
    ) c
    WHERE c.first_date IS NOT NULL
      AND ($3::text IS NULL OR st.ticker LIKE '%' || $3::text || '%' ESCAPE '\\')
  ),
  page AS (
    SELECT l.*, row_number() OVER (ORDER BY ${order}) AS position
    FROM listed l
    ORDER BY position
    LIMIT $1 OFFSET $2
  )
  SELECT a.import_id AS "importId", a.activated_at AS "activatedAt",
         (SELECT count(*)::int FROM listed) AS "total",
         p.ticker, to_char(p.first_date, 'YYYY-MM-DD') AS "firstDate",
         to_char(p.last_date, 'YYYY-MM-DD') AS "lastDate"
  FROM (SELECT 1) AS sentinel
  LEFT JOIN active a ON true
  LEFT JOIN page p ON true
  ORDER BY p.position`;
}

/** The six possible list statements, built once from constants. */
const STOCK_LIST_SQL = Object.fromEntries(
  (['ticker', 'firstDate', 'lastDate'] as const).flatMap((sort) =>
    (['asc', 'desc'] as const).map((dir) => [`${sort}:${dir}`, listSql(sort, dir)] as const),
  ),
) as Record<`${StockSortKey}:${'asc' | 'desc'}`, string>;

/** Escapes LIKE wildcards so a search term is matched literally. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const DETAIL_SQL = `
  WITH ${ACTIVE},
  stock AS (SELECT id, ticker FROM stocks WHERE ticker = $1),
  bars AS (
    SELECT d.* FROM daily_prices d
    JOIN stock s ON d.stock_id = s.id
    JOIN active a ON d.import_id = a.import_id
  ),
  coverage AS (
    SELECT min(trade_date) AS first_date, max(trade_date) AS last_date, count(*)::int AS trading_days
    FROM bars
  ),
  latest AS (SELECT * FROM bars ORDER BY trade_date DESC LIMIT 1)
  SELECT a.import_id AS "importId", a.activated_at AS "activatedAt",
         s.ticker,
         to_char(c.first_date, 'YYYY-MM-DD') AS "firstDate",
         to_char(c.last_date, 'YYYY-MM-DD') AS "lastDate",
         c.trading_days AS "tradingDays",
         ${BAR_COLUMNS('l')}
  FROM (SELECT 1) AS sentinel
  LEFT JOIN active a ON true
  LEFT JOIN stock s ON true
  LEFT JOIN coverage c ON c.trading_days > 0
  LEFT JOIN latest l ON true`;

const PRICES_SQL = `
  WITH ${ACTIVE},
  stock AS (SELECT id FROM stocks WHERE ticker = $1),
  membership AS (
    SELECT EXISTS (
      SELECT 1 FROM daily_prices d
      JOIN stock s ON d.stock_id = s.id
      JOIN active a ON d.import_id = a.import_id) AS found
  ),
  page AS (
    SELECT d.* FROM daily_prices d
    JOIN stock s ON d.stock_id = s.id
    JOIN active a ON d.import_id = a.import_id
    WHERE d.trade_date >= coalesce($2::date, '-infinity'::date)
      AND d.trade_date <= coalesce($3::date, 'infinity'::date)
      AND d.trade_date >  coalesce($4::date, '-infinity'::date)
    ORDER BY d.trade_date
    LIMIT $5
  )
  SELECT a.import_id AS "importId", a.activated_at AS "activatedAt",
         m.found AS "stockFound",
         ${BAR_COLUMNS('p')}
  FROM (SELECT 1) AS sentinel
  LEFT JOIN active a ON true
  CROSS JOIN membership m
  LEFT JOIN page p ON true
  ORDER BY p.trade_date`;

// Row shape checks: catch drift (e.g. a removed ::text) that TypeScript generics cannot see.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;
const INTEGER = /^-?\d+$/;

function expectMatch(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`unexpected database value for ${field}`);
  }
  return value;
}

type BarRow = Record<keyof DailyBar, unknown>;

function toDailyBar(row: BarRow): DailyBar {
  return {
    date: expectMatch(row.date, DATE, 'date'),
    open: expectMatch(row.open, DECIMAL, 'open'),
    high: expectMatch(row.high, DECIMAL, 'high'),
    low: expectMatch(row.low, DECIMAL, 'low'),
    close: expectMatch(row.close, DECIMAL, 'close'),
    adjClose: expectMatch(row.adjClose, DECIMAL, 'adjClose'),
    volume: expectMatch(row.volume, INTEGER, 'volume'),
  };
}

interface SnapshotColumns {
  importId: unknown;
  activatedAt: unknown;
}

export function createStocksRepository(db: Database) {
  return {
    /** Stocks of the active snapshot, ordered by ticker ("C" collation), with the total count. */
    async list({ limit, offset, q, sort, dir }: ListStocksQuery) {
      const rows = await db.query<
        SnapshotColumns & {
          total: number | null;
          ticker: string | null;
          firstDate: unknown;
          lastDate: unknown;
        }
      >(`stocks.list.${sort}.${dir}`, STOCK_LIST_SQL[`${sort}:${dir}`], [
        limit,
        offset,
        q === undefined ? null : escapeLike(q),
      ]);
      const snapshot = toActiveSnapshot(rows[0]);
      const items: StockSummary[] = rows
        .filter((row) => row.ticker !== null)
        .map((row) => ({
          ticker: String(row.ticker),
          firstDate: expectMatch(row.firstDate, DATE, 'firstDate'),
          lastDate: expectMatch(row.lastDate, DATE, 'lastDate'),
        }));
      return { snapshot, total: rows[0]?.total ?? 0, items };
    },

    /** One stock with its coverage and latest bar; `stock` is null if it has no bars in the snapshot. */
    async findDetail(ticker: string) {
      const [row] = await db.query<
        SnapshotColumns &
          BarRow & {
            ticker: string | null;
            firstDate: unknown;
            lastDate: unknown;
            tradingDays: number | null;
          }
      >('stocks.detail', DETAIL_SQL, [ticker]);
      const snapshot = toActiveSnapshot(row);
      if (!row || !snapshot || row.ticker === null || row.tradingDays === null) {
        return { snapshot, stock: null };
      }
      const stock: StockDetail = {
        ticker: row.ticker,
        coverage: {
          firstDate: expectMatch(row.firstDate, DATE, 'firstDate'),
          lastDate: expectMatch(row.lastDate, DATE, 'lastDate'),
          tradingDays: row.tradingDays,
        },
        latest: toDailyBar(row),
      };
      return { snapshot, stock };
    },

    /** Up to `limit` bars in ascending date order within the range (after = exclusive cursor). */
    async findBars(ticker: string, range: DateRange, limit: number) {
      const rows = await db.query<SnapshotColumns & BarRow & { stockFound: boolean }>(
        'stocks.prices',
        PRICES_SQL,
        [ticker, range.from ?? null, range.to ?? null, range.after ?? null, limit],
      );
      const snapshot = toActiveSnapshot(rows[0]);
      const bars = rows.filter((row) => row.date !== null).map(toDailyBar);
      return { snapshot, stockFound: rows[0]?.stockFound === true, bars };
    },
  };
}

export type StocksRepository = ReturnType<typeof createStocksRepository>;
