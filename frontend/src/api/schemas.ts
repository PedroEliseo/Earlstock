import * as z from 'zod/mini';

/**
 * Runtime contracts for every API response, checked before any data reaches the application.
 * Objects are not strict: fields the backend adds later are ignored, but every field the frontend
 * reads must be present and well-formed. Prices stay decimal STRINGS (exact); volume is a JSON
 * number the backend guarantees to be a safe integer.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

export const dateString = z.string().check(z.regex(DATE_PATTERN));
export const decimalString = z.string().check(z.regex(DECIMAL_PATTERN));
const nonNegativeInteger = z
  .number()
  .check(z.refine((n) => Number.isSafeInteger(n) && n >= 0, 'must be a non-negative safe integer'));

export const barSchema = z.object({
  date: dateString,
  open: decimalString,
  high: decimalString,
  low: decimalString,
  close: decimalString,
  adjClose: decimalString,
  volume: nonNegativeInteger,
});

/** A stock's human-readable name, or null when the dataset does not provide one. */
const stockName = z.nullable(z.string().check(z.minLength(1)));

export const stockSummarySchema = z.object({
  ticker: z.string().check(z.minLength(1)),
  name: stockName,
  firstDate: dateString,
  lastDate: dateString,
});

export const stockListResponseSchema = z.object({
  data: z.array(stockSummarySchema),
  pagination: z.object({
    limit: nonNegativeInteger,
    offset: nonNegativeInteger,
    total: nonNegativeInteger,
  }),
});

export const stockDetailResponseSchema = z.object({
  data: z.object({
    ticker: z.string().check(z.minLength(1)),
    name: stockName,
    coverage: z.object({
      firstDate: dateString,
      lastDate: dateString,
      tradingDays: nonNegativeInteger,
    }),
    latest: barSchema,
  }),
});

export const pricesResponseSchema = z.object({
  data: z.array(barSchema),
  page: z.object({ limit: nonNegativeInteger, nextAfter: z.nullable(dateString) }),
});

export const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.optional(z.string()) }),
});

export type Bar = z.infer<typeof barSchema>;
export type StockSummary = z.infer<typeof stockSummarySchema>;
export type StockListResponse = z.infer<typeof stockListResponseSchema>;
export type StockDetailResponse = z.infer<typeof stockDetailResponseSchema>;
export type StockDetail = StockDetailResponse['data'];
export type PricesResponse = z.infer<typeof pricesResponseSchema>;
