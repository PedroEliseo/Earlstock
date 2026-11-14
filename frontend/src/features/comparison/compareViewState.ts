import { type RangeRequest, readRangeRequest } from '../../domain/ranges';
import { parseTickerList, type TickerListResult } from '../../domain/tickers';

export const MIN_TICKERS = 2;
export const MAX_TICKERS = 5;

export interface CompareViewState {
  tickers: string[];
  /** What was dropped from the `tickers` parameter, and why. */
  ignored: Omit<TickerListResult, 'tickers'>;
  range: RangeRequest;
  /** The range parameter was not understood; the default range is shown. */
  invalidSettings: boolean;
}

/**
 * `?tickers=AAA,BBB&range=1Y`; invalid parts fall back to defaults and are reported. Comparisons
 * always use the close; a `basis` parameter from older links is ignored.
 */
export function readCompareViewState(params: URLSearchParams): CompareViewState {
  const { tickers, ...ignored } = parseTickerList(params.get('tickers'), MAX_TICKERS);
  const { request, invalid } = readRangeRequest(params);
  return {
    tickers,
    ignored,
    range: request,
    invalidSettings: invalid,
  };
}

/** Writes changes into URL parameters, omitting defaults. */
export function withCompareChanges(
  current: URLSearchParams,
  changes: { tickers?: readonly string[]; range?: RangeRequest },
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (changes.tickers) {
    if (changes.tickers.length > 0) next.set('tickers', changes.tickers.join(','));
    else next.delete('tickers');
  }
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
  next.delete('basis'); // the former price-basis setting, no longer used
  return next;
}
