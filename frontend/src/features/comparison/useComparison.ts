import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { loadConsistent } from '../../api/snapshot';
import { rangeKey, type RangeRequest } from '../../domain/ranges';
import { useSnapshotCoordinator } from '../../query/SnapshotProvider';
import { loadComparison } from './comparisonData';
import { MIN_TICKERS } from './compareViewState';

/**
 * The comparison data of the selected tickers and range, from one snapshot. Changing the selection
 * switches to another query key: the previous query loses its observer and TanStack Query aborts
 * it (its signal is passed down), so an obsolete selection can never overwrite the current one.
 * The previous result stays visible only while the SAME tickers load a different range.
 */
export function useComparison(tickers: readonly string[], range: RangeRequest) {
  const coordinator = useSnapshotCoordinator();
  const tickersKey = tickers.join(',');
  return useQuery({
    queryKey: ['compare', tickersKey, rangeKey(range)],
    queryFn: ({ signal }) =>
      loadConsistent((fetch) => loadComparison(fetch, tickers, range), { coordinator, signal }),
    enabled: tickers.length >= MIN_TICKERS,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === tickersKey ? keepPreviousData(previous) : undefined,
  });
}
