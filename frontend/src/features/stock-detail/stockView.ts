import type { Bar, StockDetail } from '../../api/schemas';
import type { ConsistentFetch } from '../../api/snapshot';
import { getStockDetail, loadPriceHistory } from '../../api/stocks';
import {
  type RangeRequest,
  readRangeRequest,
  resolveRange,
  type ResolvedRange,
} from '../../domain/ranges';

/** Everything one detail view renders, read from ONE dataset snapshot. */
export interface StockView {
  detail: StockDetail;
  range: ResolvedRange;
  /** Bars within `range`, oldest first. */
  bars: Bar[];
}

/**
 * Loads the stock's metadata, resolves the requested range against ITS coverage, then loads every
 * price page of that range. Run through loadConsistent, the metadata and all price pages share one
 * snapshot: the range is never computed from one dataset and filled from another.
 */
export async function loadStockView(
  fetch: ConsistentFetch,
  ticker: string,
  request: RangeRequest,
): Promise<StockView> {
  const detail = await fetch((signal) => getStockDetail(ticker, signal));
  const range = resolveRange(request, detail.coverage);
  const bars = await loadPriceHistory(fetch, ticker, range);
  return { detail, range, bars };
}

export const CHART_TYPES = ['candles', 'line'] as const;
export type ChartType = (typeof CHART_TYPES)[number];
export const LINE_FIELDS = ['close', 'adjClose'] as const;
export type LineField = (typeof LINE_FIELDS)[number];

export interface DetailViewState {
  range: RangeRequest;
  chartType: ChartType;
  lineField: LineField;
  /** Some URL parameter was not understood and its default is shown instead. */
  invalid: boolean;
}

/** The view state encoded in the URL; unknown values fall back to defaults and are reported. */
export function readDetailViewState(params: URLSearchParams): DetailViewState {
  const { request, invalid: invalidRange } = readRangeRequest(params);
  const chart = params.get('chart');
  const series = params.get('series');
  const chartValid = chart === null || (CHART_TYPES as readonly string[]).includes(chart);
  const seriesValid = series === null || (LINE_FIELDS as readonly string[]).includes(series);
  return {
    range: request,
    chartType: chartValid && chart !== null ? (chart as ChartType) : 'candles',
    lineField: seriesValid && series !== null ? (series as LineField) : 'close',
    invalid: invalidRange || !chartValid || !seriesValid,
  };
}

/** Writes view-state changes into URL parameters (defaults are omitted to keep URLs short). */
export function withViewChanges(
  current: URLSearchParams,
  changes: { range?: RangeRequest; chartType?: ChartType; lineField?: LineField },
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (changes.range) {
    next.delete('range');
    next.delete('from');
    next.delete('to');
    const range = changes.range;
    if (range.kind === 'preset') next.set('range', range.preset);
    if (range.kind === 'custom') {
      next.set('range', 'custom');
      next.set('from', range.from);
      next.set('to', range.to);
    }
  }
  if (changes.chartType) {
    if (changes.chartType === 'candles') next.delete('chart');
    else next.set('chart', changes.chartType);
  }
  if (changes.lineField) {
    if (changes.lineField === 'close') next.delete('series');
    else next.set('series', changes.lineField);
  }
  return next;
}

export const LINE_FIELD_LABEL: Record<LineField, string> = {
  close: 'Close',
  adjClose: 'Adjusted close',
};
