import Box from '@mui/material/Box';
import { type IPriceLine, type ISeriesApi, LineSeries, LineStyle } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import { type SeriesPattern, seriesPattern } from '../../components/chart/seriesStyles';
import { useChartColors } from '../../components/chart/useChartColors';
import { isChartAlive, useLightweightChart } from '../../components/chart/useLightweightChart';

const LINE_STYLE: Record<SeriesPattern, LineStyle> = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
  'long dashes': LineStyle.LargeDashed,
  'sparse dots': LineStyle.SparseDotted,
};

export interface ComparisonChartProps {
  /** Common dates, oldest first: the same x values for every series. */
  dates: readonly string[];
  /** One index series per ticker, aligned with `dates`, starting at 100. */
  series: readonly { ticker: string; normalized: readonly number[] }[];
  description: string;
  onHover?: (date: string | null) => void;
}

/**
 * Normalized performance lines (start = 100), one per ticker, drawn by lightweight-charts with the
 * shared chart lifecycle (useLightweightChart: creation, resizing, crosshair, disposal). This
 * component's effects, in order:
 *
 *  1. series: one line series per ticker, re-created only when the SET of tickers changes, plus a
 *     dashed reference line at 100; cleanup removes them unless the chart is already gone.
 *  2. data: setData on every series from the same date list, then fitContent.
 *  3. colors: applyOptions when the theme changes.
 */
export default function ComparisonChart({
  dates,
  series,
  description,
  onHover,
}: ComparisonChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useLightweightChart(
    containerRef,
    {
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderVisible: false },
      handleScale: { axisPressedMouseMove: false },
    },
    onHover,
  );
  const seriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const baselineRef = useRef<IPriceLine | null>(null);
  const colors = useChartColors();
  const tickersKey = series.map((s) => s.ticker).join(',');
  const { text, grid } = colors;
  const seriesColors = colors.series.join(',');

  // 1. One line series per ticker.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const created = tickersKey.split(',').map((ticker, index) =>
      chart.addSeries(LineSeries, {
        title: ticker,
        lineWidth: 2,
        lineStyle: LINE_STYLE[seriesPattern(index).pattern],
        priceLineVisible: false,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      }),
    );
    // Neutral reference line at the common baseline (colored by the theme effect, never red/green).
    baselineRef.current =
      created[0]?.createPriceLine({
        price: 100,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: 'Start',
      }) ?? null;
    seriesRef.current = created;
    return () => {
      seriesRef.current = [];
      baselineRef.current = null;
      if (isChartAlive(chart)) for (const s of created) chart.removeSeries(s);
    };
  }, [chartRef, tickersKey]);

  // 2. Data: every series gets exactly the same dates.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    series.forEach((entry, index) => {
      seriesRef.current[index]?.setData(
        dates.map((time, i) => ({ time, value: entry.normalized[i] ?? Number.NaN })),
      );
    });
    chart.timeScale().fitContent();
  }, [chartRef, dates, series, tickersKey]);

  // 3. Theme colors.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      layout: { textColor: text },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    });
    baselineRef.current?.applyOptions({ color: text });
    const palette = seriesColors.split(',');
    seriesRef.current.forEach((line, index) => {
      line.applyOptions({ color: palette[index % palette.length] ?? text });
    });
  }, [chartRef, tickersKey, text, grid, seriesColors]);

  return (
    <Box
      ref={containerRef}
      role="img"
      aria-label={description}
      sx={{ width: '100%', height: { xs: 300, sm: 380, md: 440 } }}
    />
  );
}
