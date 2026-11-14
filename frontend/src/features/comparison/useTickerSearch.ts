import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { loadConsistent } from '../../api/snapshot';
import { getStockListPage } from '../../api/stocks';
import { useDebouncedValue } from '../../components/useDebouncedValue';
import { useSnapshotCoordinator } from '../../query/SnapshotProvider';

/** Suggestions shown per search. */
export const SUGGESTION_LIMIT = 20;

/**
 * Ticker suggestions for the comparison picker, searched by the API (one request per typed term,
 * debounced), never by downloading the whole list. An empty term suggests the first tickers.
 */
export function useTickerSearch(input: string) {
  const coordinator = useSnapshotCoordinator();
  const term = useDebouncedValue(input.trim().toUpperCase(), 250);
  return useQuery({
    queryKey: ['stocks', 'search', term],
    queryFn: ({ signal }) =>
      loadConsistent(
        (fetch) =>
          fetch((requestSignal) =>
            getStockListPage(
              { limit: SUGGESTION_LIMIT, offset: 0, q: term, sort: 'ticker' },
              requestSignal,
            ),
          ),
        { coordinator, signal },
      ),
    placeholderData: keepPreviousData,
  });
}
