import Box from '@mui/material/Box';
import {
  CandlestickSeries,
  HistogramSeries,
  type ISeriesApi,
  LineSeries,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { Bar } from '../../../api/schemas';
import { useChartColors } from '../../../components/chart/useChartColors';
import { isChartAlive, useLightweightChart } from '../../../components/chart/useLightweightChart';
import type { ChartType, LineField } from '../stockView';
import { drawnFields, pricePrecision, toCandles, toLine, toVolume } from './chartData';

export interface PriceChartProps {
  /** Bars of the selected range, oldest first. */
  bars: readonly Bar[];
  chartType: ChartType;
  lineField: LineField;
  /** Text alternative for the canvas (the price table holds the full data). */
  description: string;
  /** Called with the date under the crosshair, or null when it leaves the chart. */
  onHover?: (date: string | null) => void;
}

const VOLUME_SCALE = 'volume';

/**
 * Price chart (candles or line) with volume, drawn by lightweight-charts. The chart instance,
 * resizing and crosshair subscription come from useLightweightChart; this component adds effects
 * that each own one concern and clean up exactly what they created:
 *
 *  1. volume series: created once per chart.
 *  2. price series: re-created only when the chart TYPE changes (a candle series cannot become a
 *     line series); cleanup removes it, unless the chart itself is already gone.
 *  3. data: pushed with setData whenever the bars or the displayed value change; no re-creation.
 *  4. colors: applied with applyOptions when the theme changes; no re-creation.
 *
 * Effects run in declaration order within a commit (and clean up in the same order), so these
 * always find the chart created by the hook, also across React Strict Mode's remount.
 */
export default function PriceChart({
  bars,
  chartType,
  lineField,
  description,
  onHover,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useLightweightChart(
    containerRef,
    {
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.28 } },
      timeScale: { borderVisible: false },
      handleScale: { axisPressedMouseMove: false },
    },
    onHover,
  );
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null);
  const { text, grid, up, down, line, volume } = useChartColors();

  // 1. Volume series, on its own scale in the lower part of the chart.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const series = chart.addSeries(HistogramSeries, {
      priceScaleId: VOLUME_SCALE,
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale(VOLUME_SCALE).applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeRef.current = series;
    return () => {
      volumeRef.current = null;
      if (isChartAlive(chart)) chart.removeSeries(series);
    };
  }, [chartRef]);

  // 2. Price series, per chart type.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const series =
      chartType === 'candles'
        ? chart.addSeries(CandlestickSeries, { priceLineVisible: false })
        : chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false });
    priceRef.current = series;
    return () => {
      priceRef.current = null;
      // If the whole chart was removed first (unmount), its series went with it.
      if (isChartAlive(chart)) chart.removeSeries(series);
    };
  }, [chartRef, chartType]);

  // 3. Data: the same dates feed the price and volume series.
  useEffect(() => {
    const chart = chartRef.current;
    const price = priceRef.current;
    if (!chart || !price) return;
    const precision = pricePrecision(bars, drawnFields(chartType, lineField));
    price.applyOptions({
      priceFormat: { type: 'price', precision, minMove: 10 ** -precision },
    });
    if (chartType === 'candles') {
      (price as ISeriesApi<'Candlestick'>).setData(toCandles(bars));
    } else {
      (price as ISeriesApi<'Line'>).setData(toLine(bars, lineField));
    }
    volumeRef.current?.setData(toVolume(bars));
    chart.timeScale().fitContent();
  }, [chartRef, bars, chartType, lineField]);

  // 4. Theme colors. Rising candles are hollow and falling ones filled, so direction is not
  // conveyed by color alone.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      layout: { textColor: text },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    });
    volumeRef.current?.applyOptions({ color: volume });
    const price = priceRef.current;
    if (chartType === 'candles') {
      (price as ISeriesApi<'Candlestick'> | null)?.applyOptions({
        upColor: 'rgba(0, 0, 0, 0)',
        borderUpColor: up,
        wickUpColor: up,
        downColor: down,
        borderDownColor: down,
        wickDownColor: down,
      });
    } else {
      (price as ISeriesApi<'Line'> | null)?.applyOptions({ color: line });
    }
  }, [chartRef, chartType, text, grid, up, down, line, volume]);

  return (
    <Box
      ref={containerRef}
      role="img"
      aria-label={description}
      sx={{ width: '100%', height: { xs: 300, sm: 380, md: 440 }, position: 'relative' }}
    />
  );
}
