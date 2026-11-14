import type { SortDirection, StockSortKey } from '../../api/stocks';

/**
 * Explorer view state, kept in the URL (`?q=…&sort=…&dir=…`). Searching, sorting and paging are
 * done by the API; this module only reads and validates the parameters.
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
/** Stocks per request while scrolling. */
export const PAGE_SIZE = 50;

/** The orders offered in the Explorer, with their labels. */
export const SORT_OPTIONS: { key: SortKey; direction: SortDirection; label: string }[] = [
  { key: 'ticker', direction: 'asc', label: 'Ticker (A–Z)' },
  { key: 'ticker', direction: 'desc', label: 'Ticker (Z–A)' },
  { key: 'firstDate', direction: 'asc', label: 'Longest history first' },
  { key: 'firstDate', direction: 'desc', label: 'Shortest history first' },
  { key: 'lastDate', direction: 'desc', label: 'Most recent data first' },
  { key: 'lastDate', direction: 'asc', label: 'Oldest data first' },
];

/** Reads the view state from URL search parameters, falling back to defaults for invalid values. */
export function readViewState(params: URLSearchParams): {
  query: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
} {
  const key = params.get('sort');
  const direction = params.get('dir');
  return {
    query: params.get('q') ?? '',
    sortKey: (SORT_KEYS as readonly string[]).includes(key ?? '')
      ? (key as SortKey)
      : DEFAULT_SORT.key,
    sortDirection:
      direction === 'desc' ? 'desc' : direction === 'asc' ? 'asc' : DEFAULT_SORT.direction,
  };
}
