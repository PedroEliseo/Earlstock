import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { loadConsistent } from '../../api/snapshot';
import { rangeKey, type RangeRequest } from '../../domain/ranges';
import { useSnapshotCoordinator } from '../../query/SnapshotProvider';
import { loadStockView } from './stockView';

/**
 * One stock's metadata and the bars of the requested range, from one snapshot. Changing the range
 * of the SAME stock keeps the previous view on screen while the new one loads (no page-wide
 * spinner); switching to another stock never shows the previous stock's data.
 */
export function useStockView(ticker: string, range: RangeRequest) {
  const coordinator = useSnapshotCoordinator();
  return useQuery({
    queryKey: ['stocks', 'detail', ticker, rangeKey(range)],
    queryFn: ({ signal }) =>
      loadConsistent((fetch) => loadStockView(fetch, ticker, range), { coordinator, signal }),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === ticker ? keepPreviousData(previous) : undefined,
  });
}
