import { useQuery } from '@tanstack/react-query';
import { loadConsistent } from '../api/snapshot';
import { loadStockList } from '../api/stocks';
import { useSnapshotCoordinator } from './SnapshotProvider';

export const stockListQueryKey = ['stocks', 'list'] as const;

/**
 * The complete stock list of the active dataset, all pages from ONE snapshot. TanStack Query
 * supplies the AbortSignal: leaving the page or refetching cancels in-flight page requests, and a
 * cancelled run never writes its result.
 */
export function useStockList() {
  const coordinator = useSnapshotCoordinator();
  return useQuery({
    queryKey: stockListQueryKey,
    queryFn: ({ signal }) => loadConsistent(loadStockList, { coordinator, signal }),
  });
}
