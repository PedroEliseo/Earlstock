import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { lazy, Suspense, useState } from 'react';
import type { Bar } from '../../api/schemas';
import { formatDecimal, formatInteger } from '../../domain/decimal';
import { ChartControls } from './ChartControls';
import { type ChartType, LINE_FIELD_LABEL, type LineField } from './stockView';

// The chart library is loaded only when a chart is actually shown (its own chunk).
const PriceChart = lazy(() => import('./chart/PriceChart'));

interface ChartPanelProps {
  ticker: string;
  bars: readonly Bar[];
  chartType: ChartType;
  lineField: LineField;
  refreshing: boolean;
  onChartType: (type: ChartType) => void;
  onLineField: (field: LineField) => void;
}

/**
 * Chart controls, an exact-value legend for the bar under the crosshair (or the last bar), the
 * chart itself and its text alternative. Legend values come from the original decimal strings.
 */
export function ChartPanel({
  ticker,
  bars,
  chartType,
  lineField,
  refreshing,
  onChartType,
  onLineField,
}: ChartPanelProps) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const shown =
    (hoveredDate ? bars.find((bar) => bar.date === hoveredDate) : undefined) ?? bars.at(-1);
  const description = describeChart(ticker, bars, chartType, lineField);

  return (
    <Paper component="section" aria-labelledby="chart-heading" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
        >
          <Typography id="chart-heading" variant="h2">
            Price history
          </Typography>
          <ChartControls
            chartType={chartType}
            lineField={lineField}
            onChartType={onChartType}
            onLineField={onLineField}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {chartType === 'candles'
            ? 'Candles use open, high, low and close as provided by the dataset; hollow candles closed above their open. Volume is shown below.'
            : `${LINE_FIELD_LABEL[lineField]} as provided by the dataset${lineField === 'adjClose' ? '; the adjustment method is not stated by the source' : ''}. Volume is shown below.`}
        </Typography>
        {shown && <Legend bar={shown} />}
        <Box sx={{ position: 'relative' }} aria-busy={refreshing}>
          {refreshing && (
            <LinearProgress
              aria-label="Updating chart"
              sx={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 }}
            />
          )}
          <Suspense
            fallback={
              <Skeleton
                variant="rectangular"
                sx={{ height: { xs: 300, sm: 380, md: 440 } }}
                aria-label="Loading chart"
              />
            }
          >
            <PriceChart
              bars={bars}
              chartType={chartType}
              lineField={lineField}
              description={description}
              onHover={setHoveredDate}
            />
          </Suspense>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Charts by{' '}
          <Link href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">
            TradingView Lightweight Charts
          </Link>
          . The table below lists every value shown in the chart.
        </Typography>
      </Stack>
    </Paper>
  );
}

function Legend({ bar }: { bar: Bar }) {
  const items: [string, string][] = [
    ['O', formatDecimal(bar.open)],
    ['H', formatDecimal(bar.high)],
    ['L', formatDecimal(bar.low)],
    ['C', formatDecimal(bar.close)],
    ['Adj', formatDecimal(bar.adjClose)],
    ['Vol', formatInteger(bar.volume)],
  ];
  return (
    <Typography
      variant="body2"
      component="p"
      aria-hidden="true"
      sx={{ fontVariantNumeric: 'tabular-nums', display: 'flex', flexWrap: 'wrap', columnGap: 2 }}
    >
      <span>{bar.date}</span>
      {items.map(([label, value]) => (
        <span key={label}>
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {label}
          </Box>{' '}
          {value}
        </span>
      ))}
    </Typography>
  );
}

/** A short text alternative for the canvas chart. */
export function describeChart(
  ticker: string,
  bars: readonly Bar[],
  chartType: ChartType,
  lineField: LineField,
): string {
  const first = bars[0];
  const last = bars.at(-1);
  if (!first || !last) return `${ticker}: no prices in the selected range.`;
  const kind =
    chartType === 'candles'
      ? 'Candlestick chart'
      : `Line chart of ${LINE_FIELD_LABEL[lineField].toLowerCase()}`;
  const field = chartType === 'candles' ? 'close' : lineField;
  return `${kind} with volume for ${ticker}, ${String(bars.length)} trading days from ${first.date} to ${last.date}. ${LINE_FIELD_LABEL[field]} went from ${formatDecimal(first[field])} to ${formatDecimal(last[field])}. The price table below lists every value.`;
}
