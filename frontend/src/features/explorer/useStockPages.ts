import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import type { Snapshotted } from '../../api/client';
import { SnapshotMismatchError } from '../../api/errors';
import type { StockListResponse } from '../../api/schemas';
import { loadConsistent } from '../../api/snapshot';
import { getStockListPage, type SortDirection, type StockSortKey } from '../../api/stocks';
import { useSnapshotCoordinator } from '../../query/SnapshotProvider';
import { withSignal } from '../../query/withSignal';
import { PAGE_SIZE } from './stockListView';

/** Where the next page starts, and the snapshot every page of this list must belong to. */
interface PageParam {
  offset: number;
  /** The first page's snapshot; null for the first page itself. */
  snapshot: number | null;
}

export interface StockListRequest {
  query: string;
  sortKey: StockSortKey;
  sortDirection: SortDirection;
}

/**
 * The Explorer's list, loaded page by page as the user scrolls (one request per page of 50, searched
 * and ordered by the API). Pages are only combined within one dataset snapshot: a page from another
 * snapshot is never appended; a newer dataset resets the list (SnapshotProvider), which then starts
 * again from its first page. Leaving the view cancels an in-flight page.
 */
export function useStockPages({ query, sortKey, sortDirection }: StockListRequest) {
  const coordinator = useSnapshotCoordinator();
  const q = query.trim().toUpperCase();
  return useInfiniteQuery({
    queryKey: ['stocks', 'pages', q, sortKey, sortDirection],
    initialPageParam: { offset: 0, snapshot: null },
    queryFn: withSignal<
      Snapshotted<StockListResponse>,
      { readonly signal: AbortSignal; pageParam: PageParam }
    >(async (signal, { pageParam }) => {
      const page = await loadConsistent(
        (fetch) =>
          fetch((requestSignal) =>
            getStockListPage(
              { limit: PAGE_SIZE, offset: pageParam.offset, q, sort: sortKey, dir: sortDirection },
              requestSignal,
            ),
          ),
        { coordinator, signal },
      );
      if (pageParam.snapshot !== null && page.snapshot !== pageParam.snapshot) {
        throw new SnapshotMismatchError(
          'a page of the stock list came from another dataset snapshot',
        );
      }
      return page;
    }),
    getNextPageParam: (lastPage, pages): PageParam | undefined => {
      const loaded = pages.reduce((count, page) => count + page.data.data.length, 0);
      const first = pages[0];
      if (!first || lastPage.data.data.length === 0 || loaded >= lastPage.data.pagination.total) {
        return undefined;
      }
      return { offset: loaded, snapshot: first.snapshot };
    },
    placeholderData: keepPreviousData,
  });
}
