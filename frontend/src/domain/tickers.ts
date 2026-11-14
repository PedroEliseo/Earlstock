/**
 * Canonical tickers: the same rule as the backend's stocks_ticker_format constraint (upper case
 * A-Z/0-9 segments joined by ".", "-" or "=", optional "^" prefix, at most 32 characters).
 */
const TICKER_PATTERN = /^\^?[A-Z0-9]+([.=-][A-Z0-9]+)*$/;

export function isTicker(text: string): boolean {
  return text.length <= 32 && TICKER_PATTERN.test(text);
}

export interface TickerListResult {
  /** Valid, distinct tickers in their original order, at most `max`. */
  tickers: string[];
  /** Entries that are not tickers (dropped). */
  invalid: string[];
  /** Repeated tickers (later occurrences dropped; the first one is kept). */
  duplicates: string[];
  /** Valid tickers beyond `max` (dropped, in order). */
  overflow: string[];
}

/**
 * Normalizes a comma-separated ticker list (e.g. from a URL): trims and upper-cases each entry,
 * then keeps the FIRST occurrence of each valid ticker, in order, up to `max`. Everything dropped
 * is reported, so the interface can say what was ignored. Deterministic for any input.
 */
export function parseTickerList(raw: string | null, max: number): TickerListResult {
  const result: TickerListResult = { tickers: [], invalid: [], duplicates: [], overflow: [] };
  const seen = new Set<string>();
  for (const part of (raw ?? '').split(',')) {
    const entry = part.trim().toUpperCase();
    if (!entry) continue;
    if (!isTicker(entry)) result.invalid.push(entry);
    else if (seen.has(entry)) result.duplicates.push(entry);
    else if (result.tickers.length >= max) result.overflow.push(entry);
    else result.tickers.push(entry);
    seen.add(entry);
  }
  return result;
}
