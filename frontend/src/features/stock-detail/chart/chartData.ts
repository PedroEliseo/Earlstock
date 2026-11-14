import type { Bar } from '../../../api/schemas';
import { decimalPlaces } from '../../../domain/decimal';
import type { ChartType } from '../stockView';

export type PriceField = 'open' | 'high' | 'low' | 'close' | 'adjClose';

/**
 * Conversion of exact bars into chart coordinates. The chart library needs JavaScript numbers, so
 * prices are converted here and ONLY here: chart coordinates are a visual approximation (binary
 * floating point), while every displayed value (legend, header, table) comes from the original
 * decimal strings. Dates stay YYYY-MM-DD business days, so no time zone can shift a bar.
 */

export interface CandlePoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ValuePoint {
  time: string;
  value: number;
}

/** OHLC candles, always from open/high/low/close (never mixed with adjusted close). */
export function toCandles(bars: readonly Bar[]): CandlePoint[] {
  return bars.map((bar) => ({
    time: bar.date,
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
  }));
}

/** The close of each day, for the line chart. */
export function toLine(bars: readonly Bar[]): ValuePoint[] {
  return bars.map((bar) => ({ time: bar.date, value: Number(bar.close) }));
}

/** Volume per day, on the same dates as the price series. */
export function toVolume(bars: readonly Bar[]): ValuePoint[] {
  return bars.map((bar) => ({ time: bar.date, value: bar.volume }));
}

/** The fields a chart draws: OHLC for candles, the close for a line. */
export function drawnFields(chartType: ChartType): readonly PriceField[] {
  return chartType === 'candles' ? ['open', 'high', 'low', 'close'] : ['close'];
}

/** Axis precision: the most decimals written in the DRAWN values, between 2 and 6. */
export function pricePrecision(bars: readonly Bar[], fields: readonly PriceField[]): number {
  let places = 2;
  for (const bar of bars) {
    for (const field of fields) places = Math.max(places, decimalPlaces(bar[field]));
  }
  return Math.min(places, 6);
}
