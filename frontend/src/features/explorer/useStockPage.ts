import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { loadConsistent } from '../../api/snapshot';
import { getStockListPage, type SortDirection, type StockSortKey } from '../../api/stocks';
import { useSnapshotCoordinator } from '../../query/SnapshotProvider';
import { withSignal } from '../../query/withSignal';
import { PAGE_SIZE } from './stockListView';

export interface StockPageRequest {
  query: string;
  sortKey: StockSortKey;
  sortDirection: SortDirection;
  /** 1-based. */
  page: number;
}

/**
 * Exactly the rows of one Explorer view, searched, ordered and paged by the API: one request per
 * view. The previous view stays on screen while the next one loads; leaving the view cancels its
 * request, and the snapshot coordinator rejects responses older than the newest dataset seen.
 */
export function useStockPage({ query, sortKey, sortDirection, page }: StockPageRequest) {
  const coordinator = useSnapshotCoordinator();
  const q = query.trim().toUpperCase();
  return useQuery({
    queryKey: ['stocks', 'page', q, sortKey, sortDirection, page],
    queryFn: withSignal((signal: AbortSignal) =>
      loadConsistent(
        (fetch) =>
          fetch((requestSignal) =>
            getStockListPage(
              {
                limit: PAGE_SIZE,
                offset: (page - 1) * PAGE_SIZE,
                q,
                sort: sortKey,
                dir: sortDirection,
              },
              requestSignal,
            ),
          ),
        { coordinator, signal },
      ),
    ),
    placeholderData: keepPreviousData,
  });
}
