import { apiPath, getJson, type Snapshotted } from './client';
import { ResponseFormatError } from './errors';
import { type StockListResponse, stockListResponseSchema, type StockSummary } from './schemas';
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
