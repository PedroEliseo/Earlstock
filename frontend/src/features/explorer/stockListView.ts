import type { StockSummary } from '../../api/schemas';

/**
 * Pure view logic for the explorer: filtering, sorting and pagination of the stock list. Inputs are
 * never mutated (the list comes from the query cache).
 */

export const SORT_KEYS = ['ticker', 'firstDate', 'lastDate'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDirection = 'asc' | 'desc';
export interface SortOrder {
  key: SortKey;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortOrder = { key: 'ticker', direction: 'asc' };
export const PAGE_SIZE = 50;

/** Case-insensitive substring match on the ticker; a blank query matches everything. */
export function filterStocks(stocks: readonly StockSummary[], query: string): StockSummary[] {
  const needle = query.trim().toUpperCase();
  if (!needle) return [...stocks];
  return stocks.filter((stock) => stock.ticker.toUpperCase().includes(needle));
}

/**
 * Code-unit comparison: the same byte-wise order the backend uses for tickers (COLLATE "C"),
 * independent of the browser's locale. YYYY-MM-DD dates sort correctly the same way.
 */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sorted copy. Dates tie often (many stocks share coverage), so ties are always broken by ticker
 * ascending, whatever the direction: the order is total and deterministic.
 */
export function sortStocks(stocks: readonly StockSummary[], order: SortOrder): StockSummary[] {
  const sign = order.direction === 'asc' ? 1 : -1;
  return [...stocks].sort(
    (a, b) => sign * compareText(a[order.key], b[order.key]) || compareText(a.ticker, b.ticker),
  );
}

export interface PageSlice<T> {
  items: T[];
  /** 1-based page actually shown (clamped into range). */
  page: number;
  pageCount: number;
  /** 1-based index of the first item shown, 0 when there are none. */
  from: number;
  to: number;
  total: number;
}

/** One page of `items`; out-of-range or invalid page numbers are clamped. */
export function paginate<T>(
  items: readonly T[],
  page: number,
  size: number = PAGE_SIZE,
): PageSlice<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Number.isInteger(page) ? Math.min(Math.max(page, 1), pageCount) : 1;
  const start = (current - 1) * size;
  const slice = items.slice(start, start + size);
  return {
    items: slice,
    page: current,
    pageCount,
    from: slice.length > 0 ? start + 1 : 0,
    to: start + slice.length,
    total,
  };
}

/** Reads the view state from URL search parameters, falling back to defaults for invalid values. */
export function readViewState(params: URLSearchParams): {
  query: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
  page: number;
} {
  const key = params.get('sort');
  const direction = params.get('dir');
  const page = Number(params.get('page') ?? '1');
  return {
    query: params.get('q') ?? '',
    sortKey: (SORT_KEYS as readonly string[]).includes(key ?? '')
      ? (key as SortKey)
      : DEFAULT_SORT.key,
    sortDirection:
      direction === 'desc' ? 'desc' : direction === 'asc' ? 'asc' : DEFAULT_SORT.direction,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}
