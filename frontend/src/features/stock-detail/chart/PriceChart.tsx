import Box from '@mui/material/Box';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  type MouseEventParams,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { Bar } from '../../../api/schemas';
import type { ChartType, LineField } from '../stockView';
import { drawnFields, pricePrecision, toCandles, toLine, toVolume } from './chartData';
import { useChartColors } from './useChartColors';

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
 * Price chart (candles or line) with volume, drawn by lightweight-charts. The imperative chart is
 * managed by separate effects, each owning one concern and cleaning up exactly what it created:
 *
 *  1. chart: created once per mount with the volume series, a ResizeObserver and the crosshair
 *     subscription; cleanup unsubscribes, disconnects and calls chart.remove().
 *  2. price series: re-created only when the chart TYPE changes (a candle series cannot become a
 *     line series); cleanup removes it, unless the chart itself is already gone.
 *  3. data: pushed with setData whenever the bars or the displayed value change; no re-creation.
 *  4. colors: applied with applyOptions when the theme changes; no re-creation.
 *
 * Effects run in declaration order within a commit (and clean up in the same order), so effects
 * 2-4 always find the chart created by effect 1, also across React Strict Mode's remount.
 */
export default function PriceChart({
  bars,
  chartType,
  lineField,
  description,
  onHover,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null);
  // The latest callback, read by the stable crosshair handler (no stale closure, no resubscribe).
  const onHoverRef = useRef(onHover);
  useEffect(() => {
    onHoverRef.current = onHover;
  }, [onHover]);
  const { text, grid, up, down, line, volume } = useChartColors();

  // 1. Chart lifecycle.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        fontFamily: 'inherit',
        // Required TradingView attribution (licence link requirement).
        attributionLogo: true,
      },
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.28 } },
      timeScale: { borderVisible: false },
      handleScale: { axisPressedMouseMove: false },
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: VOLUME_SCALE,
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale(VOLUME_SCALE).applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0 && box.height > 0) {
        chart.resize(Math.floor(box.width), Math.floor(box.height));
      }
    });
    observer.observe(container);

    const handleCrosshair = (param: MouseEventParams) => {
      onHoverRef.current?.(typeof param.time === 'string' ? param.time : null);
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    chartRef.current = chart;
    volumeRef.current = volumeSeries;
    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      observer.disconnect();
      chartRef.current = null;
      volumeRef.current = null;
      chart.remove();
    };
  }, []);

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
      if (chartRef.current === chart) chart.removeSeries(series);
    };
  }, [chartType]);

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
  }, [bars, chartType, lineField]);

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
  }, [chartType, text, grid, up, down, line, volume]);

  return (
    <Box
      ref={containerRef}
      role="img"
      aria-label={description}
      sx={{ width: '100%', height: { xs: 300, sm: 380, md: 440 }, position: 'relative' }}
    />
  );
}
