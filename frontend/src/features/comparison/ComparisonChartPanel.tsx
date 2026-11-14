import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { lazy, Suspense, useState } from 'react';
import { formatDecimal, formatIndex, formatPercent } from '../../domain/decimal';
import type { ComparisonModel } from './comparisonModel';
import { BASIS_LABEL } from './ComparisonSummary';
import { SeriesSwatch } from './SeriesSwatch';

// The chart library is loaded only when a comparison chart is shown.
const ComparisonChart = lazy(() => import('./ComparisonChart'));

/**
 * The normalized chart with a legend that labels every ticker (color, line pattern and name) and
 * shows its index value and exact price on the hovered (or last) common date.
 */
export function ComparisonChartPanel({
  model,
  refreshing,
}: {
  model: ComparisonModel;
  refreshing: boolean;
}) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const hoveredIndex = hoveredDate === null ? -1 : model.dates.indexOf(hoveredDate);
  const index = hoveredIndex >= 0 ? hoveredIndex : model.dates.length - 1;
  const date = model.dates[index] ?? '';

  return (
    <Paper
      component="section"
      aria-labelledby="comparison-chart-heading"
      sx={{ p: { xs: 1.5, sm: 2 } }}
    >
      <Stack spacing={1.5}>
        <Typography id="comparison-chart-heading" variant="h2">
          Relative performance
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Index of {BASIS_LABEL[model.basis].toLowerCase()}: each stock = 100 on {model.dates[0]}. A
          value of 110 means 10% above its baseline price.
        </Typography>
        <Box
          component="ul"
          aria-label={`Values on ${date}`}
          sx={{
            m: 0,
            p: 0,
            listStyle: 'none',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 20px',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <Typography component="li" variant="body2" color="text.secondary">
            {date}
          </Typography>
          {model.stocks.map((stock, i) => (
            <Typography
              component="li"
              variant="body2"
              key={stock.ticker}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
            >
              <SeriesSwatch index={i} />
              <strong>{stock.ticker}</strong> {formatIndex(stock.normalized[index] ?? Number.NaN)}
              <Box component="span" sx={{ color: 'text.secondary' }}>
                ({formatDecimal(stock.prices[index] ?? '0')})
              </Box>
            </Typography>
          ))}
        </Box>
        <Box sx={{ position: 'relative' }} aria-busy={refreshing}>
          {refreshing && (
            <LinearProgress
              aria-label="Updating comparison"
              sx={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 }}
            />
          )}
          <Suspense
            fallback={
              <Skeleton variant="rectangular" sx={{ height: { xs: 300, sm: 380, md: 440 } }} />
            }
          >
            <ComparisonChart
              dates={model.dates}
              series={model.stocks}
              description={describeComparison(model)}
              onHover={setHoveredDate}
            />
          </Suspense>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Charts by{' '}
          <Link href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">
            TradingView Lightweight Charts
          </Link>
          . The tables below list every value shown in the chart.
        </Typography>
      </Stack>
    </Paper>
  );
}

/** Text alternative for the comparison chart. */
export function describeComparison(model: ComparisonModel): string {
  const first = model.dates[0];
  const last = model.dates.at(-1);
  const results = model.stocks
    .map(
      (s) =>
        `${s.ticker} ${s.cumulativeReturn === null ? 'n/a' : formatPercent(s.cumulativeReturn, { signed: true })}`,
    )
    .join(', ');
  return `Line chart of ${BASIS_LABEL[model.basis].toLowerCase()} indexed to 100 on ${first ?? ''}, ${String(model.dates.length)} common trading dates to ${last ?? ''}. Cumulative return: ${results}.`;
}
