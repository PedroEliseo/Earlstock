import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError, describeError } from '../../api/errors';
import { ErrorMessage, StatusMessage } from '../../components/StatusMessage';
import { usePageTitle } from '../../components/usePageTitle';
import { visuallyHidden } from '../../theme/theme';
import { StockGrid, StockGridSkeleton } from './StockGrid';
import { DEFAULT_SORT, readViewState, SORT_OPTIONS } from './stockListView';
import { useStockPages } from './useStockPages';

/** Typing pauses this long before a search request is sent. */
const SEARCH_DEBOUNCE_MS = 300;
/** Start loading the next page this far before the end of the list comes into view. */
const PREFETCH_MARGIN = '600px';

/**
 * Stock explorer: a grid of stock cards that loads more stocks as the user scrolls. The view state
 * (search, order) lives in the URL; the API searches, orders and pages the list, so each step is one
 * request for 50 stocks. The previous results stay visible while a new search or order loads.
 */
export function ExplorerPage() {
  usePageTitle('Explorer');
  const [params, setParams] = useSearchParams();
  const { query, sortKey, sortDirection } = readViewState(params);
  const list = useStockPages({ query, sortKey, sortDirection });
  const pages = list.data?.pages ?? [];
  const stocks = pages.flatMap((page) => page.data.data);
  const total = pages[0]?.data.pagination.total ?? 0;
  const loaded = list.data !== undefined;
  const refreshing = list.isPlaceholderData && list.isFetching;
  const searching = query.trim() !== '';

  // The search box has its own state. Each keystroke restarts one timer; when typing pauses, the
  // timer writes the typed term to the URL (one history replacement, one request). When the URL
  // changes by other means (back, forward, "Clear search"), the box follows it and any pending
  // update is cancelled, so a stale term can never be written back.
  const [input, setInput] = useState(query);
  const [syncedQuery, setSyncedQuery] = useState(query);
  if (query !== syncedQuery) {
    setSyncedQuery(query);
    setInput(query);
  }
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(searchTimer.current);
  }, [query]);
  useEffect(
    () => () => {
      clearTimeout(searchTimer.current);
    },
    [],
  );
  const updateParams = (changes: Record<string, string | null>, replace: boolean) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value.trim() === '') next.delete(key);
          else next.set(key, value);
        }
        next.delete('page'); // links from the earlier paginated Explorer
        return next;
      },
      { replace },
    );
  };
  const onSearchInput = (value: string) => {
    setInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      updateParams({ q: value }, true);
    }, SEARCH_DEBOUNCE_MS);
  };

  // Infinite scroll: when the sentinel after the grid approaches the viewport, load the next page.
  // The "Show more" button does the same for keyboard users and where IntersectionObserver is
  // unavailable.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isError } = list;
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasNextPage || isError || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);

  const sortValue = `${sortKey}:${sortDirection}`;

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h1" gutterBottom>
          Stocks
        </Typography>
        <Typography color="text.secondary">
          Every stock in the active dataset. Open one to see its price history, or compare several.
        </Typography>
      </Box>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: { sm: 'center' } }}
      >
        <TextField
          label="Search by name or ticker"
          type="search"
          value={input}
          onChange={(event) => {
            onSearchInput(event.target.value);
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
        <TextField
          select
          label="Sort by"
          value={sortValue}
          onChange={(event) => {
            const [key = DEFAULT_SORT.key, direction = DEFAULT_SORT.direction] =
              event.target.value.split(':');
            const isDefault = key === DEFAULT_SORT.key && direction === DEFAULT_SORT.direction;
            updateParams(
              { sort: isDefault ? null : key, dir: isDefault ? null : direction },
              false,
            );
          }}
          sx={{ width: { xs: '100%', sm: 240 } }}
        >
          {SORT_OPTIONS.map((option) => (
            <MenuItem
              key={`${option.key}:${option.direction}`}
              value={`${option.key}:${option.direction}`}
            >
              {option.label}
            </MenuItem>
          ))}
        </TextField>
        {loaded && (
          <Typography
            role="status"
            variant="body2"
            color="text.secondary"
            sx={{ ml: { sm: 'auto' }, fontVariantNumeric: 'tabular-nums' }}
          >
            {resultSummary(stocks.length, total, searching ? query.trim() : '')}
          </Typography>
        )}
      </Stack>

      {list.isError && loaded && (
        <StatusMessage
          kind="warning"
          title="Could not load more stocks"
          description="The stocks loaded so far are still shown."
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

      {list.isPending && (
        <>
          <Box role="status" sx={visuallyHidden}>
            Loading stocks…
          </Box>
          <StockGridSkeleton count={12} />
        </>
      )}

      {list.isError && !loaded && (
        <ListError error={list.error} onRetry={() => void list.refetch()} />
      )}

      {loaded && total === 0 && !searching && (
        <StatusMessage
          kind="empty"
          title="The active dataset contains no stocks"
          description="Import a dataset with price data to explore it here."
        />
      )}

      {loaded && total === 0 && searching && (
        <StatusMessage
          kind="empty"
          title="No stocks match your search"
          description="Check the spelling or search for part of a name or ticker."
          action={
            <Button
              color="inherit"
              size="small"
              variant="outlined"
              onClick={() => {
                updateParams({ q: null }, false);
              }}
            >
              Clear search
            </Button>
          }
        />
      )}

      {stocks.length > 0 && (
        <Box sx={{ position: 'relative' }} aria-busy={refreshing || isFetchingNextPage}>
          {refreshing && (
            <LinearProgress
              aria-label="Loading stocks"
              sx={{ position: 'absolute', top: -12, left: 0, right: 0, zIndex: 1 }}
            />
          )}
          <StockGrid stocks={stocks} />
          {isFetchingNextPage && (
            <Box sx={{ mt: 2 }}>
              <StockGridSkeleton count={4} />
            </Box>
          )}
          <Box ref={sentinel} sx={{ height: 1 }} />
          <Stack sx={{ alignItems: 'center', mt: 3 }}>
            {hasNextPage ? (
              <Button
                variant="outlined"
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                {isFetchingNextPage ? 'Loading more stocks…' : 'Show more stocks'}
              </Button>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {searching ? 'All matching stocks are shown.' : 'All stocks are shown.'}
              </Typography>
            )}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

function resultSummary(shown: number, total: number, query: string): string {
  const noun = total === 1 ? 'stock' : 'stocks';
  const count = shown < total ? `${String(shown)} of ${String(total)}` : String(total);
  return query ? `${count} ${noun} match “${query}”` : `${count} ${noun}`;
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
