import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';
import Pagination from '@mui/material/Pagination';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useDeferredValue } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError, describeError } from '../../api/errors';
import { ErrorMessage, StatusMessage } from '../../components/StatusMessage';
import { usePageTitle } from '../../components/usePageTitle';
import { StockTable } from './StockTable';
import {
  DEFAULT_SORT,
  filterStocks,
  paginate,
  readViewState,
  type SortKey,
  sortStocks,
} from './stockListView';
import { useStockList } from './useStockList';

/**
 * Stock explorer. Server state (the complete list) comes from TanStack Query; the view state
 * (search, sort, page) lives in the URL, so every view can be shared and survives reloads. Search,
 * sort and pagination run on the client and never trigger requests.
 */
export function ExplorerPage() {
  usePageTitle('Explorer');
  const [params, setParams] = useSearchParams();
  const { query, sortKey, sortDirection, page } = readViewState(params);
  // Typing stays responsive: filtering a large list renders at lower priority.
  const deferredQuery = useDeferredValue(query);
  const list = useStockList();
  const stocks = list.data?.data;

  const sort = { key: sortKey, direction: sortDirection };
  // Filtering and sorting the list is O(n log n) on a few hundred tickers: cheap enough to run on
  // every render without manual memoization.
  const matching = stocks ? sortStocks(filterStocks(stocks, deferredQuery), sort) : [];
  const slice = paginate(matching, page);

  /** Updates URL parameters; any change other than the page returns to page 1. */
  const update = (changes: Record<string, string | null>, replace = false) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
        }
        if (!('page' in changes)) next.delete('page');
        return next;
      },
      { replace },
    );
  };

  const onSort = (key: SortKey) => {
    const direction = sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc';
    const isDefault = key === DEFAULT_SORT.key && direction === DEFAULT_SORT.direction;
    update({ sort: isDefault ? null : key, dir: isDefault ? null : direction });
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h1" gutterBottom>
          Stocks
        </Typography>
        <Typography color="text.secondary">
          Every stock in the active dataset, with the first and last date for which daily prices are
          available.
        </Typography>
      </Box>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <TextField
          label="Search tickers"
          type="search"
          value={query}
          onChange={(event) => {
            update({ q: event.target.value }, true);
          }}
          sx={{ width: { xs: '100%', sm: 320 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
            htmlInput: { autoComplete: 'off', spellCheck: false },
          }}
        />
        {stocks && (
          <Typography
            role="status"
            variant="body2"
            color="text.secondary"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {resultSummary(matching.length, stocks.length, deferredQuery)}
          </Typography>
        )}
      </Stack>

      {list.isError && stocks && (
        <StatusMessage
          kind="warning"
          title="Could not refresh the stock list"
          description="Showing the list loaded earlier."
          action={
            <Button
              color="inherit"
              size="small"
              variant="outlined"
              onClick={() => void list.refetch()}
            >
              Try again
            </Button>
          }
        />
      )}

      {list.isPending && <StockTable rows={[]} sort={sort} onSort={onSort} loading />}

      {list.isError && !stocks && (
        <ListError error={list.error} onRetry={() => void list.refetch()} />
      )}

      {stocks && stocks.length === 0 && (
        <StatusMessage
          kind="empty"
          title="The active dataset contains no stocks"
          description="Import a dataset with price data to explore it here."
        />
      )}

      {stocks && stocks.length > 0 && matching.length === 0 && (
        <StatusMessage
          kind="empty"
          title="No tickers match your search"
          description="Check the spelling or search for part of a ticker."
          action={
            <Button
              color="inherit"
              size="small"
              variant="outlined"
              onClick={() => {
                update({ q: null });
              }}
            >
              Clear search
            </Button>
          }
        />
      )}

      {matching.length > 0 && (
        <Stack spacing={2}>
          <StockTable rows={slice.items} sort={sort} onSort={onSort} />
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              Showing {slice.from}–{slice.to} of {slice.total}
            </Typography>
            {slice.pageCount > 1 && (
              <Box component="nav" aria-label="Stock list pages">
                <Pagination
                  count={slice.pageCount}
                  page={slice.page}
                  onChange={(_event, value) => {
                    update({ page: value === 1 ? null : String(value) });
                  }}
                  shape="rounded"
                  siblingCount={1}
                />
              </Box>
            )}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}

function resultSummary(matching: number, total: number, query: string): string {
  const noun = (n: number) => (n === 1 ? 'stock' : 'stocks');
  if (!query.trim()) return `${total} ${noun(total)}`;
  return `${matching} of ${total} ${noun(total)} match “${query.trim()}”`;
}

/** No list at all: a dedicated explanation when no dataset is loaded, else the generic error. */
function ListError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError && error.code === 'DATASET_NOT_LOADED') {
    const { title, description } = describeError(error);
    return (
      <StatusMessage
        kind="info"
        title={title}
        description={description}
        action={
          <Button color="inherit" size="small" variant="outlined" onClick={onRetry}>
            Check again
          </Button>
        }
      />
    );
  }
  return <ErrorMessage error={error} onRetry={onRetry} />;
}
