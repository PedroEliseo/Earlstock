import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';

/**
 * Canonical ticker: the same rule as the stocks_ticker_format CHECK constraint. Input is matched
 * case-insensitively (normalized to upper case); "^" must be percent-encoded in URLs (%5E).
 */
export const TICKER_PATTERN = /^\^?[A-Z0-9]+([.=-][A-Z0-9]+)*$/;

export const tickerParamsSchema = z.object({
  ticker: z
    .string()
    .trim()
    .toUpperCase()
    .max(32)
    .regex(TICKER_PATTERN, 'must be a ticker such as AAPL, BRK.B or ^GSPC'),
});

export const STOCK_SORT_KEYS = ['ticker', 'firstDate', 'lastDate'] as const;
export type StockSortKey = (typeof STOCK_SORT_KEYS)[number];

/**
 * Stock list query: pagination plus optional search and order.
 *  - `q`: case-insensitive substring of the ticker OR the name (blank = no filter; at most 100
 *    characters). Matched literally: SQL LIKE wildcards in it are escaped by the repository.
 *  - `sort` / `dir`: order by ticker, first or last available date; ties are always broken by
 *    ticker ascending, so pages are deterministic.
 */
export const listStocksQuerySchema = z.strictObject({
  ...paginationQuerySchema.shape,
  q: z
    .string()
    .trim()
    .max(100)
    .transform((value) => (value === '' ? undefined : value.toUpperCase()))
    .optional(),
  sort: z.enum(STOCK_SORT_KEYS).default('ticker'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

export type ListStocksQuery = z.output<typeof listStocksQuerySchema>;

const isoDate = z.iso.date({ error: 'must be a calendar date in YYYY-MM-DD format' });

/**
 * Price history query. `from` and `to` are inclusive. `after` is an EXCLUSIVE cursor: the response
 * contains only dates strictly after it. Clients pass the previous page's `nextAfter`, which always
 * lies within [from, to]; a cursor outside that range is rejected rather than silently ignored.
 * Dates are compared as YYYY-MM-DD strings, which order like the dates themselves.
 */
export const pricesQuerySchema = z
  .strictObject({
    from: isoDate.optional(),
    to: isoDate.optional(),
    after: isoDate.optional(),
    limit: z.coerce.number().int().min(1).max(5000).default(1000),
  })
  .superRefine((query, ctx) => {
    if (query.from && query.to && query.from > query.to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'must not be earlier than "from"' });
    }
    if (query.after && query.from && query.after < query.from) {
      ctx.addIssue({ code: 'custom', path: ['after'], message: 'must not be earlier than "from"' });
    }
    if (query.after && query.to && query.after > query.to) {
      ctx.addIssue({ code: 'custom', path: ['after'], message: 'must not be later than "to"' });
    }
  });

export type PricesQuery = z.output<typeof pricesQuerySchema>;
