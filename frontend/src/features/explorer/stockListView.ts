import type { SortDirection, StockSortKey } from '../../api/stocks';

/**
 * Explorer view state, kept in the URL (`?q=…&sort=…&dir=…&page=…`). Searching, sorting and paging
 * are done by the API; this module only reads and validates the parameters.
 */

export const SORT_KEYS = [
  'ticker',
  'firstDate',
  'lastDate',
] as const satisfies readonly StockSortKey[];
export type SortKey = StockSortKey;
export type { SortDirection };
export interface SortOrder {
  key: SortKey;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortOrder = { key: 'ticker', direction: 'asc' };
export const PAGE_SIZE = 50;

/** Number of pages for `total` rows (at least 1, so an empty result is "page 1 of 1"). */
export function pageCount(total: number, size: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
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
