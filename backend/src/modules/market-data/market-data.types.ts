/** The stock fields a provider needs to identify an instrument. */
export interface StockRef {
  symbol: string;
  exchange: string;
}

/** A quote normalized into our domain: exact decimal strings and an ISO 8601 UTC instant. */
export interface ProviderQuote {
  price: string;
  volume: string | null;
  observedAt: string;
}

/** Inclusive UTC calendar dates, YYYY-MM-DD. */
export interface DateRange {
  from: string;
  to: string;
}

/**
 * Contract every market data source implements. `id` is stored as `price_quotes.provider`,
 * so every persisted quote identifies its source (e.g. synthetic "demo" vs licensed "eodhd").
 */
export interface MarketDataProvider {
  readonly id: string;
  fetchLatestQuote(stock: StockRef): Promise<ProviderQuote>;
  /** One quote per trading day, observed at 00:00 UTC of that day, holding the day's close. */
  fetchDailyPrices(stock: StockRef, range: DateRange): Promise<ProviderQuote[]>;
}

export type ProviderErrorCode =
  | 'budget_exhausted' // our own daily budget would be exceeded; no request was sent
  | 'provider_limit_reached' // the provider rejected the call because its daily limit is used up
  | 'rate_limited' // per-minute rate limit
  | 'unauthorized'
  | 'not_found' // unknown instrument
  | 'timeout'
  | 'network'
  | 'http_error'
  | 'invalid_response';

/** Codes after which further calls in the same run would fail too, so a sync stops early. */
const FATAL_CODES = new Set<ProviderErrorCode>([
  'budget_exhausted',
  'provider_limit_reached',
  'rate_limited',
  'unauthorized',
]);

/**
 * A failed provider operation. Messages are written by us and never include request URLs,
 * which for EODHD carry the API key as a query parameter.
 */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';

  constructor(
    readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
  }

  get fatal(): boolean {
    return FATAL_CODES.has(this.code);
  }
}

/** Converts a provider's JSON number to our decimal string format (8 decimals, no trailing zeros). */
export function toDecimalString(value: number): string {
  return value.toFixed(8).replace(/\.?0+$/, '');
}
