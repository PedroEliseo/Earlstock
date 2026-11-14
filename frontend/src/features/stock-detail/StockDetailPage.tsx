import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router';
import { ApiError, describeError } from '../../api/errors';
import { NotFoundPage } from '../../components/NotFoundPage';
import { ErrorMessage, StatusMessage } from '../../components/StatusMessage';
import { usePageTitle } from '../../components/usePageTitle';
import type { RangeRequest } from '../../domain/ranges';
import { visuallyHidden } from '../../theme/theme';
import { ChartPanel } from './ChartPanel';
import { PriceTable } from './PriceTable';
import { RangeControls } from '../../components/RangeControls';
import { StockHeader } from './StockHeader';
import { type ChartType, type LineField, readDetailViewState, withViewChanges } from './stockView';
import { useStockView } from './useStockView';

/**
 * One stock: coverage, latest bar, range selection, chart and table. Server state comes from one
 * snapshot-consistent query; the range and chart view live in the URL (each change is one history
 * entry, so back/forward step through views).
 */
export function StockDetailPage() {
  const { ticker = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const view = readDetailViewState(params);
  const query = useStockView(ticker, view.range);
  const loadedName = query.data?.data.detail.name;
  usePageTitle(loadedName ? `${loadedName} (${ticker})` : ticker);

  const change = (changes: {
    range?: RangeRequest;
    chartType?: ChartType;
    lineField?: LineField;
  }) => {
    const next = withViewChanges(params, changes);
    if (next.toString() !== params.toString()) setParams(next);
  };

  const breadcrumbs = (
    <Breadcrumbs aria-label="Breadcrumb">
      <Link component={RouterLink} to="/" underline="hover" color="inherit">
        Stocks
      </Link>
      <Typography color="text.primary" aria-current="page">
        {ticker}
      </Typography>
    </Breadcrumbs>
  );

  if (query.isPending) {
    return (
      <Stack spacing={3}>
        {breadcrumbs}
        <Box role="status" sx={visuallyHidden}>
          Loading {ticker}…
        </Box>
        <DetailSkeleton />
      </Stack>
    );
  }

  if (query.isError && !query.data) {
    const error = query.error;
    if (
      error instanceof ApiError &&
      (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_FAILED')
    ) {
      return (
        <NotFoundPage
          title="Stock not found"
          description="There is no stock with this ticker in the current dataset."
        />
      );
    }
    const datasetMissing = error instanceof ApiError && error.code === 'DATASET_NOT_LOADED';
    return (
      <Stack spacing={3}>
        {breadcrumbs}
        {datasetMissing ? (
          <StatusMessage
            kind="info"
            title={describeError(error).title}
            description={describeError(error).description}
            action={
              <Button
                color="inherit"
                size="small"
                variant="outlined"
                onClick={() => void query.refetch()}
              >
                Check again
              </Button>
            }
          />
        ) : (
          <ErrorMessage error={error} onRetry={() => void query.refetch()} />
        )}
      </Stack>
    );
  }

  const { detail, range, bars } = query.data.data;
  const refreshing = query.isPlaceholderData && query.isFetching;

  return (
    <Stack spacing={3}>
      {breadcrumbs}
      <StockHeader detail={detail} />
      {view.invalid && (
        <StatusMessage
          kind="info"
          title="Some view settings in the address were not recognized"
          description="The default view is shown for those settings."
        />
      )}
      {query.isError && (
        <StatusMessage
          kind="warning"
          title="Could not load the requested view"
          description="Showing the previously loaded data."
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
      <Paper sx={{ p: 2 }}>
        <RangeControls
          // Remount when the URL-driven selection changes (e.g. browser back), so local UI state
          // such as an open custom-range form always matches the address.
          key={range.selection}
          coverage={detail.coverage}
          range={range}
          onChange={(request) => {
            change({ range: request });
          }}
        />
      </Paper>
      {bars.length === 0 ? (
        <StatusMessage
          kind="empty"
          title="No trading days in the selected range"
          description="The dataset has no prices for this stock between these dates. Choose a wider range."
        />
      ) : (
        <>
          <ChartPanel
            ticker={detail.ticker}
            bars={bars}
            chartType={view.chartType}
            lineField={view.lineField}
            refreshing={refreshing}
            onChartType={(chartType) => {
              change({ chartType });
            }}
            onLineField={(lineField) => {
              change({ lineField });
            }}
          />
          <PriceTable key={`${range.from}..${range.to}`} bars={bars} />
        </>
      )}
    </Stack>
  );
}

function DetailSkeleton() {
  return (
    <Stack spacing={2} aria-hidden="true">
      <Skeleton variant="text" width={140} height={48} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Skeleton variant="rounded" height={120} sx={{ flex: 1 }} />
        <Skeleton variant="rounded" height={120} sx={{ flex: 2 }} />
      </Stack>
      <Skeleton variant="rounded" height={64} />
      <Skeleton variant="rounded" sx={{ height: { xs: 300, sm: 380, md: 440 } }} />
    </Stack>
  );
}

export default StockDetailPage;
