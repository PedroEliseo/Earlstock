import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useSearchParams } from 'react-router';
import { ApiError, describeError } from '../../api/errors';
import { RangeControls } from '../../components/RangeControls';
import { ErrorMessage, StatusMessage } from '../../components/StatusMessage';
import { usePageTitle } from '../../components/usePageTitle';
import { coverageConstraints, PRICE_BASES, type PriceBasis } from '../../domain/comparison';
import type { RangeRequest } from '../../domain/ranges';
import { visuallyHidden } from '../../theme/theme';
import { ComparisonChartPanel } from './ComparisonChartPanel';
import { StockNotFoundError } from './comparisonData';
import { buildComparisonModel } from './comparisonModel';
import { BASIS_LABEL, ComparisonSummary } from './ComparisonSummary';
import { MIN_TICKERS, readCompareViewState, withCompareChanges } from './compareViewState';
import { MetricsTable } from './MetricsTable';
import { ObservationsTable } from './ObservationsTable';
import { TickerPicker } from './TickerPicker';
import { useComparison } from './useComparison';

/**
 * Comparison of 2–5 stocks on their common trading dates. Selection, range and price basis live in
 * the URL (one history entry per change). Chart, metrics and table are all derived from ONE model,
 * built from one snapshot-consistent query result.
 */
export function ComparePage() {
  usePageTitle('Compare');
  const [params, setParams] = useSearchParams();
  const view = readCompareViewState(params);
  const query = useComparison(view.tickers, view.range);
  const result = query.data?.data;
  const basis = view.basis;

  // Derived on each render of this page (URL or query changes only). Hovering re-renders just the
  // chart panel, which keeps receiving the same model object, so the chart is not re-fed.
  const model = result?.range
    ? buildComparisonModel(
        result.stocks.map((s) => ({ ticker: s.ticker, name: s.detail.name, bars: s.bars })),
        basis,
      )
    : null;

  const change = (changes: {
    tickers?: readonly string[];
    range?: RangeRequest;
    basis?: PriceBasis;
  }) => {
    const next = withCompareChanges(params, changes);
    if (next.toString() !== params.toString()) setParams(next);
  };
  const ignored = [...view.ignored.invalid, ...view.ignored.duplicates, ...view.ignored.overflow];

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h1" gutterBottom>
          Compare stocks
        </Typography>
        <Typography color="text.secondary">
          Relative performance of two to five stocks on the trading dates they have in common.
        </Typography>
      </Box>

      <Paper sx={{ p: 2 }}>
        <TickerPicker
          selected={view.tickers}
          onChange={(tickers) => {
            change({ tickers });
          }}
        />
      </Paper>

      {ignored.length > 0 && (
        <StatusMessage
          kind="info"
          title="Some tickers in the address were ignored"
          description={ignoredDescription(view.ignored)}
        />
      )}
      {view.invalidSettings && (
        <StatusMessage
          kind="info"
          title="Some settings in the address were not recognized"
          description="The default range or price basis is shown instead."
        />
      )}

      {view.tickers.length < MIN_TICKERS ? (
        <StatusMessage
          kind="info"
          title="Select at least two stocks to compare"
          description="Search for tickers above. The comparison appears once two or more are selected."
        />
      ) : query.isPending ? (
        <ComparisonSkeleton />
      ) : query.isError && !result ? (
        <ComparisonError
          error={query.error}
          onRetry={() => void query.refetch()}
          onRemove={(ticker) => {
            change({ tickers: view.tickers.filter((t) => t !== ticker) });
          }}
        />
      ) : (
        result && (
          <Stack spacing={3}>
            {query.isError && (
              <StatusMessage
                kind="warning"
                title="Could not load the requested comparison"
                description="Showing the previously loaded comparison."
                action={
                  <Button
                    color="inherit"
                    size="small"
                    variant="outlined"
                    onClick={() => void query.refetch()}
                  >
                    Try again
                  </Button>
                }
              />
            )}
            {!result.common || !result.range ? (
              <StatusMessage
                kind="empty"
                title="These stocks have no period in common"
                description="Their histories do not overlap, so there are no common trading dates to compare."
              />
            ) : (
              <>
                <Paper sx={{ p: 2 }}>
                  <Stack spacing={2}>
                    <RangeControls
                      key={result.range.selection}
                      coverage={result.common}
                      range={result.range}
                      onChange={(range) => {
                        change({ range });
                      }}
                    />
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      value={basis}
                      aria-label="Price basis"
                      onChange={(_event, value: PriceBasis | null) => {
                        if (value) change({ basis: value });
                      }}
                    >
                      {PRICE_BASES.map((b) => (
                        <ToggleButton key={b} value={b}>
                          {BASIS_LABEL[b]}
                        </ToggleButton>
                      ))}
                    </ToggleButtonGroup>
                  </Stack>
                </Paper>
                {model && (
                  <ComparisonSummary
                    range={result.range}
                    dates={model.dates}
                    basis={basis}
                    {...coverageConstraints(
                      result.stocks.map((s) => ({ ticker: s.ticker, coverage: s.detail.coverage })),
                      result.common,
                    )}
                  />
                )}
                {model && model.dates.length === 0 && (
                  <StatusMessage
                    kind="empty"
                    title="No common trading dates in this range"
                    description="The selected stocks have no trading date in common between these dates. Choose a wider range."
                  />
                )}
                {model && model.dates.length === 1 && (
                  <StatusMessage
                    kind="info"
                    title="Only one common trading date"
                    description="Returns, volatility and drawdown need at least two common observations. Choose a wider range."
                  />
                )}
                {model && model.dates.length >= 2 && (
                  <ComparisonChartPanel
                    model={model}
                    refreshing={query.isPlaceholderData && query.isFetching}
                  />
                )}
                {model && model.dates.length >= 1 && (
                  <>
                    <MetricsTable model={model} />
                    <ObservationsTable
                      key={`${model.dates[0] ?? ''}..${model.dates.at(-1) ?? ''}:${basis}`}
                      model={model}
                    />
                  </>
                )}
              </>
            )}
          </Stack>
        )
      )}
    </Stack>
  );
}

function ignoredDescription(ignored: {
  invalid: string[];
  duplicates: string[];
  overflow: string[];
}): string {
  const parts: string[] = [];
  if (ignored.invalid.length > 0) parts.push(`not valid tickers: ${ignored.invalid.join(', ')}`);
  if (ignored.duplicates.length > 0) parts.push(`repeated: ${ignored.duplicates.join(', ')}`);
  if (ignored.overflow.length > 0)
    parts.push(`beyond the limit of five: ${ignored.overflow.join(', ')}`);
  return `Ignored ${parts.join('; ')}.`;
}

function ComparisonError({
  error,
  onRetry,
  onRemove,
}: {
  error: unknown;
  onRetry: () => void;
  onRemove: (ticker: string) => void;
}) {
  if (error instanceof StockNotFoundError) {
    return (
      <StatusMessage
        kind="error"
        title={`${error.ticker} is not in the current dataset`}
        description="Remove it from the selection to compare the other stocks."
        action={
          <Button
            color="inherit"
            size="small"
            variant="outlined"
            onClick={() => {
              onRemove(error.ticker);
            }}
          >
            Remove {error.ticker}
          </Button>
        }
      />
    );
  }
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

function ComparisonSkeleton() {
  return (
    <Stack spacing={2}>
      <Box role="status" sx={visuallyHidden}>
        Loading comparison…
      </Box>
      <Skeleton variant="rounded" height={96} aria-hidden="true" />
      <Skeleton variant="rounded" height={140} aria-hidden="true" />
      <Skeleton
        variant="rounded"
        sx={{ height: { xs: 300, sm: 380, md: 440 } }}
        aria-hidden="true"
      />
    </Stack>
  );
}

export default ComparePage;
