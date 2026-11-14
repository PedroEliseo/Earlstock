import { type PriceBasis, PRICE_BASES } from '../../domain/comparison';
import { type RangeRequest, readRangeRequest } from '../../domain/ranges';
import { parseTickerList, type TickerListResult } from '../../domain/tickers';

export const MIN_TICKERS = 2;
export const MAX_TICKERS = 5;

export interface CompareViewState {
  tickers: string[];
  /** What was dropped from the `tickers` parameter, and why. */
  ignored: Omit<TickerListResult, 'tickers'>;
  range: RangeRequest;
  basis: PriceBasis;
  /** The range or basis parameter was not understood; defaults are shown. */
  invalidSettings: boolean;
}

/** `?tickers=AAA,BBB&range=1Y&basis=adjClose`; invalid parts fall back to defaults and are reported. */
export function readCompareViewState(params: URLSearchParams): CompareViewState {
  const { tickers, ...ignored } = parseTickerList(params.get('tickers'), MAX_TICKERS);
  const { request, invalid } = readRangeRequest(params);
  const basisParam = params.get('basis');
  const basisValid = basisParam === null || (PRICE_BASES as readonly string[]).includes(basisParam);
  return {
    tickers,
    ignored,
    range: request,
    basis: basisValid && basisParam !== null ? (basisParam as PriceBasis) : 'close',
    invalidSettings: invalid || !basisValid,
  };
}

/** Writes changes into URL parameters, omitting defaults. */
export function withCompareChanges(
  current: URLSearchParams,
  changes: { tickers?: readonly string[]; range?: RangeRequest; basis?: PriceBasis },
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
  if (changes.basis) {
    if (changes.basis === 'close') next.delete('basis');
    else next.set('basis', changes.basis);
  }
  return next;
}
