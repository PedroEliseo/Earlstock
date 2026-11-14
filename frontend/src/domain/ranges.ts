import {
  addMonths,
  addYears,
  type IsoDate,
  isIsoDate,
  maxDate,
  minDate,
  startOfYear,
} from './dates';

/**
 * Historical date ranges for one stock. Every preset is anchored to the stock's LAST AVAILABLE
 * trading date, never to today's date: the dataset is historical, so "the last year" means the last
 * year of data. Bounds are inclusive, like the API's `from` and `to`.
 */

export const RANGE_PRESETS = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'MAX'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export interface Coverage {
  firstDate: IsoDate;
  lastDate: IsoDate;
}

/** What the user asked for (from the URL): a preset, a custom range, or nothing (the default). */
export type RangeRequest =
  | { kind: 'default' }
  | { kind: 'preset'; preset: RangePreset }
  | { kind: 'custom'; from: IsoDate; to: IsoDate };

export interface ResolvedRange {
  from: IsoDate;
  to: IsoDate;
  /** The preset shown as selected, or 'custom'. */
  selection: RangePreset | 'custom';
  /** True when the request reached outside the coverage and was limited to it. */
  limited: boolean;
}

/** The unclamped start of a preset ending at `last`. */
function presetStart(preset: Exclude<RangePreset, 'MAX'>, last: IsoDate): IsoDate {
  switch (preset) {
    case '1M':
      return addMonths(last, -1);
    case '3M':
      return addMonths(last, -3);
    case '6M':
      return addMonths(last, -6);
    case 'YTD':
      return startOfYear(last);
    case '1Y':
      return addYears(last, -1);
    case '3Y':
      return addYears(last, -3);
    case '5Y':
      return addYears(last, -5);
  }
}

const LENGTH_PRESETS = ['1M', '3M', '6M', '1Y', '3Y', '5Y'] as const;

/**
 * Presets worth offering for this coverage. A length preset that reaches back past the first date
 * would only repeat the whole history, so only the SHORTEST such preset stays enabled (shown as
 * limited to the available history); longer ones are disabled. YTD and MAX are always available.
 */
export function availablePresets(coverage: Coverage): Set<RangePreset> {
  const available = new Set<RangePreset>(['YTD', 'MAX']);
  for (const preset of LENGTH_PRESETS) {
    available.add(preset);
    if (presetStart(preset, coverage.lastDate) <= coverage.firstDate) break;
  }
  return available;
}

/** The default view: one year if offered, else the whole history. */
export function defaultPreset(coverage: Coverage): RangePreset {
  return availablePresets(coverage).has('1Y') ? '1Y' : 'MAX';
}

/** Turns a request into concrete, inclusive bounds within the coverage. */
export function resolveRange(request: RangeRequest, coverage: Coverage): ResolvedRange {
  const { firstDate, lastDate } = coverage;
  if (request.kind === 'custom') {
    const from = maxDate(request.from, firstDate);
    const to = minDate(request.to, lastDate);
    return {
      from: minDate(from, to),
      to,
      selection: 'custom',
      limited: from !== request.from || to !== request.to,
    };
  }
  let preset = request.kind === 'preset' ? request.preset : defaultPreset(coverage);
  // A disabled preset in a shared URL falls back to the whole history (and says so).
  const disabled = !availablePresets(coverage).has(preset);
  if (disabled) preset = 'MAX';
  if (preset === 'MAX')
    return { from: firstDate, to: lastDate, selection: 'MAX', limited: disabled };
  const start = presetStart(preset, lastDate);
  return {
    from: maxDate(start, firstDate),
    to: lastDate,
    selection: preset,
    limited: start < firstDate,
  };
}

export type CustomRangeError = 'invalid-from' | 'invalid-to' | 'reversed' | 'outside-coverage';

/** Validates a custom range typed by the user (dates must lie within the coverage). */
export function validateCustomRange(
  from: string,
  to: string,
  coverage: Coverage,
): CustomRangeError | null {
  if (!isIsoDate(from)) return 'invalid-from';
  if (!isIsoDate(to)) return 'invalid-to';
  if (from > to) return 'reversed';
  if (from < coverage.firstDate || to > coverage.lastDate) return 'outside-coverage';
  return null;
}

/** Reads the range request from URL parameters; anything invalid is reported, not guessed. */
export function readRangeRequest(params: URLSearchParams): {
  request: RangeRequest;
  invalid: boolean;
} {
  const range = params.get('range');
  if (range === null) return { request: { kind: 'default' }, invalid: false };
  if ((RANGE_PRESETS as readonly string[]).includes(range)) {
    return { request: { kind: 'preset', preset: range as RangePreset }, invalid: false };
  }
  if (range === 'custom') {
    const from = params.get('from') ?? '';
    const to = params.get('to') ?? '';
    if (isIsoDate(from) && isIsoDate(to) && from <= to) {
      return { request: { kind: 'custom', from, to }, invalid: false };
    }
  }
  return { request: { kind: 'default' }, invalid: true };
}

/** A stable cache-key fragment for a request. */
export function rangeKey(request: RangeRequest): string {
  switch (request.kind) {
    case 'default':
      return 'default';
    case 'preset':
      return request.preset;
    case 'custom':
      return `${request.from}..${request.to}`;
  }
}
