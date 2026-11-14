import { apiPath, getJson, type Snapshotted } from './client';
import { ResponseFormatError } from './errors';
import {
  type Bar,
  type PricesResponse,
  pricesResponseSchema,
  type StockDetail,
  stockDetailResponseSchema,
  type StockListResponse,
  stockListResponseSchema,
  type StockSummary,
} from './schemas';
import type { ConsistentFetch } from './snapshot';

/** The largest page the list endpoint accepts. */
export const STOCK_LIST_PAGE_SIZE = 100;

export function getStockListPage(
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<Snapshotted<StockListResponse>> {
  return getJson(apiPath('/api/stocks', { limit, offset }), stockListResponseSchema, signal);
}

/**
 * Every stock of the active dataset, page by page. Run it through loadConsistent: `fetch` pins all
 * pages to one snapshot (and restarts the whole loop otherwise), so the pages can be concatenated.
 * Within one snapshot the list is fixed, so a changing total, an empty page before the end or a
 * repeated ticker means the response broke the contract.
 */
export async function loadStockList(fetch: ConsistentFetch): Promise<StockSummary[]> {
  const stocks: StockSummary[] = [];
  let total: number | null = null;
  while (total === null || stocks.length < total) {
    const offset = stocks.length;
    const page = await fetch((signal) => getStockListPage(offset, STOCK_LIST_PAGE_SIZE, signal));
    if (total !== null && page.pagination.total !== total) {
      throw new ResponseFormatError('the stock count changed within one dataset snapshot');
    }
    total = page.pagination.total;
    if (page.data.length === 0 && stocks.length < total) {
      throw new ResponseFormatError('the stock list ended before its reported total');
    }
    stocks.push(...page.data);
  }
  if (stocks.length !== total || new Set(stocks.map((s) => s.ticker)).size !== stocks.length) {
    throw new ResponseFormatError('the stock list pages do not form one consistent list');
  }
  return stocks;
}

/** The path of a stock's page. Tickers may contain characters such as "^", so they are encoded. */
export function stockPath(ticker: string): string {
  return `/stocks/${encodeURIComponent(ticker)}`;
}

/** The largest page the prices endpoint accepts. */
export const PRICE_PAGE_SIZE = 5000;

export async function getStockDetail(
  ticker: string,
  signal?: AbortSignal,
): Promise<Snapshotted<StockDetail>> {
  const { snapshot, data } = await getJson(
    `/api/stocks/${encodeURIComponent(ticker)}`,
    stockDetailResponseSchema,
    signal,
  );
  return { snapshot, data: data.data };
}

export interface PriceQuery {
  /** Inclusive. */
  from: string;
  /** Inclusive. */
  to: string;
  /** Exclusive cursor: only dates strictly after it. */
  after?: string | undefined;
  limit?: number;
}

export function getPricePage(
  ticker: string,
  { from, to, after, limit = PRICE_PAGE_SIZE }: PriceQuery,
  signal?: AbortSignal,
): Promise<Snapshotted<PricesResponse>> {
  return getJson(
    apiPath(`/api/stocks/${encodeURIComponent(ticker)}/prices`, { from, to, after, limit }),
    pricesResponseSchema,
    signal,
  );
}

/**
 * Every bar of `ticker` within [from, to], oldest first, following the exclusive `nextAfter`
 * cursor page by page. Run it through loadConsistent so all pages share one snapshot. Each page is
 * checked before it is accepted: dates strictly increasing (so no duplicates, even across pages),
 * inside the requested bounds, and the cursor equal to the page's last date. The cursor therefore
 * always moves forward, so the loop cannot run forever even against a misbehaving server.
 */
export async function loadPriceHistory(
  fetch: ConsistentFetch,
  ticker: string,
  { from, to }: { from: string; to: string },
  pageSize: number = PRICE_PAGE_SIZE,
): Promise<Bar[]> {
  const bars: Bar[] = [];
  let after: string | undefined;
  for (;;) {
    const cursor = after;
    const page = await fetch((signal) =>
      getPricePage(ticker, { from, to, after: cursor, limit: pageSize }, signal),
    );
    let previous = bars.at(-1)?.date ?? cursor;
    for (const bar of page.data) {
      if (bar.date < from || bar.date > to) {
        throw new ResponseFormatError('a price bar lies outside the requested range');
      }
      if (previous !== undefined && bar.date <= previous) {
        throw new ResponseFormatError('price bars are not in strictly increasing date order');
      }
      previous = bar.date;
    }
    bars.push(...page.data);
    const next = page.page.nextAfter;
    if (next === null) return bars;
    if (page.data.length === 0 || next !== page.data.at(-1)?.date) {
      throw new ResponseFormatError('the price page cursor does not match the page contents');
    }
    after = next;
  }
}
