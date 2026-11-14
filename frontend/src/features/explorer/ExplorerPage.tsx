import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import Pagination from '@mui/material/Pagination';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError, describeError } from '../../api/errors';
import { ErrorMessage, StatusMessage } from '../../components/StatusMessage';
import { usePageTitle } from '../../components/usePageTitle';
import { StockTable } from './StockTable';
import { DEFAULT_SORT, PAGE_SIZE, pageCount, readViewState, type SortKey } from './stockListView';
import { useStockPage } from './useStockPage';

/** Typing pauses this long before a search request is sent. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Stock explorer. The view state (search, sort, page) lives in the URL, so every view can be
 * shared and survives reloads; the API searches, orders and pages the list, so each view costs one
 * request for the rows actually shown. The previous rows stay visible while the next view loads.
 */
export function ExplorerPage() {
  usePageTitle('Explorer');
  const [params, setParams] = useSearchParams();
  const { query, sortKey, sortDirection, page } = readViewState(params);
  const result = useStockPage({ query, sortKey, sortDirection, page });
  const searchTerm = query;

  // The search box has its own state. Each keystroke restarts one timer; when typing pauses, the
  // timer writes the typed term to the URL and returns to page 1 (one history replacement, one
  // request). When the URL changes by other means (back, forward, "Clear search"), the box follows
  // it and any pending update is cancelled, so a stale term can never be written back.
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
  const onSearchInput = (value: string) => {
    setInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value.trim()) next.set('q', value);
          else next.delete('q');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }, SEARCH_DEBOUNCE_MS);
  };
  const data = result.data?.data;
  const rows = data?.data ?? [];
  const total = data?.pagination.total ?? 0;
  const pages = pageCount(total);
  const sort = { key: sortKey, direction: sortDirection };
  const refreshing = result.isPlaceholderData && result.isFetching;

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

  // A page number beyond the results (e.g. an old link) moves to the last page that exists.
  const beyondEnd = !result.isPlaceholderData && data !== undefined && total > 0 && page > pages;
  useEffect(() => {
    if (!beyondEnd) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (pages === 1) next.delete('page');
        else next.set('page', String(pages));
        return next;
      },
      { replace: true },
    );
  }, [beyondEnd, pages, setParams]);

  const onSort = (key: SortKey) => {
    const direction = sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc';
    const isDefault = key === DEFAULT_SORT.key && direction === DEFAULT_SORT.direction;
    update({ sort: isDefault ? null : key, dir: isDefault ? null : direction });
  };

  const searching = searchTerm.trim() !== '';
  const from = (page - 1) * PAGE_SIZE + 1;

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h1" gutterBottom>
          Stocks
        </Typography>
        <Typography color="text.secondary">
          Every stock in the active dataset, with its name, ticker and the first and last date for
          which daily prices are available.
        </Typography>
      </Box>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
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
        {data && (
          <Typography
            role="status"
            variant="body2"
            color="text.secondary"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {resultSummary(total, searching ? searchTerm.trim() : '')}
          </Typography>
        )}
      </Stack>

      {result.isError && data && (
        <StatusMessage
          kind="warning"
          title="Could not load the requested stocks"
          description="Showing the stocks loaded earlier."
          action={
            <Button
              color="inherit"
              size="small"
              variant="outlined"
              onClick={() => void result.refetch()}
            >
              Try again
            </Button>
          }
        />
      )}

      {result.isPending && <StockTable rows={[]} sort={sort} onSort={onSort} loading />}

      {result.isError && !data && (
        <ListError error={result.error} onRetry={() => void result.refetch()} />
      )}

      {data && total === 0 && !searching && (
        <StatusMessage
          kind="empty"
          title="The active dataset contains no stocks"
          description="Import a dataset with price data to explore it here."
        />
      )}

      {data && total === 0 && searching && (
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

      {rows.length > 0 && (
        <Stack spacing={2}>
          <Box sx={{ position: 'relative' }}>
            {refreshing && (
              <LinearProgress
                aria-label="Loading stocks"
                sx={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 }}
              />
            )}
            <StockTable rows={rows} sort={sort} onSort={onSort} />
          </Box>
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
              Showing {from}–{from + rows.length - 1} of {total}
            </Typography>
            {pages > 1 && (
              <Box component="nav" aria-label="Stock list pages">
                <Pagination
                  count={pages}
                  page={Math.min(page, pages)}
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

function resultSummary(total: number, query: string): string {
  const noun = total === 1 ? 'stock' : 'stocks';
  return query ? `${String(total)} ${noun} match “${query}”` : `${String(total)} ${noun}`;
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
