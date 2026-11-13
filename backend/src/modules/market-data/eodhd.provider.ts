import { z } from 'zod';
import type { ApiBudget } from './api-budget.js';
import {
  type DateRange,
  type MarketDataProvider,
  ProviderError,
  type ProviderQuote,
  type StockRef,
  toDecimalString,
} from './market-data.types.js';

const BASE_URL = 'https://eodhd.com/api';

/**
 * Billed API calls per request, from https://eodhd.com/financial-apis/api-limits.
 * Requests are charged even when they fail (e.g. 404 for an unknown ticker).
 */
export const EODHD_CALL_COST = {
  endOfDay: 1, // per request, regardless of the date range
  liveQuote: 1, // per symbol; we request one symbol at a time
} as const;

/** EODHD lists all US venues under the "US" exchange code; other codes are used as-is. */
const US_VENUES = new Set([
  'US',
  'NASDAQ',
  'NYSE',
  'AMEX',
  'NYSEARCA',
  'NYSEMKT',
  'BATS',
  'CBOE',
  'OTC',
]);

/** EODHD tickers are SYMBOL.EXCHANGE, with class-share dots as dashes (BRK.B -> BRK-B.US). */
export function toEodhdTicker({ symbol, exchange }: StockRef): string {
  const code = US_VENUES.has(exchange) ? 'US' : exchange;
  return `${symbol.replaceAll('.', '-')}.${code}`;
}

// z.number() already rejects NaN and Infinity in Zod 4.
const positiveNumber = z.number().positive();
const volume = z.number().nonnegative().nullable().optional();

const liveQuoteSchema = z.object({
  code: z.string(),
  timestamp: z.number().int().positive(),
  close: positiveNumber,
  volume,
});

const endOfDaySchema = z.array(
  z.object({
    date: z.iso.date(),
    close: positiveNumber, // raw close; adjusted_close is ignored
    volume,
  }),
);

export interface EodhdProviderOptions {
  apiKey: string;
  budget: ApiBudget;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}

export function createEodhdProvider({
  apiKey,
  budget,
  timeoutMs = 10_000,
  fetch = globalThis.fetch,
  baseUrl = BASE_URL,
}: EodhdProviderOptions): MarketDataProvider {
  /** Reserves budget, sends one GET and returns validated JSON. Never leaks the URL (it holds the key). */
  async function get<T>(
    path: string,
    params: Record<string, string>,
    cost: number,
    schema: z.ZodType<T>,
  ): Promise<T> {
    await budget.reserve(cost);

    const url = new URL(`${baseUrl}${path}`);
    for (const [name, value] of Object.entries({ ...params, fmt: 'json', api_token: apiKey })) {
      url.searchParams.set(name, value);
    }

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === 'TimeoutError' || err.name === 'AbortError')
      ) {
        throw new ProviderError('timeout', `EODHD did not respond within ${String(timeoutMs)} ms`);
      }
      throw new ProviderError('network', 'Could not reach EODHD');
    }

    if (!response.ok) await throwForStatus(response);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProviderError('invalid_response', 'EODHD returned a body that is not valid JSON');
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ProviderError('invalid_response', 'EODHD returned data in an unexpected format');
    }
    return parsed.data;
  }

  async function throwForStatus(response: Response): Promise<never> {
    await response.body?.cancel();
    switch (response.status) {
      case 402:
        // EODHD's own daily limit is used up (e.g. the key is also used elsewhere): stop for today.
        await budget.markExhausted();
        throw new ProviderError(
          'provider_limit_reached',
          'EODHD reports its daily API limit as reached',
        );
      case 429: {
        const retryAfter = response.headers.get('retry-after');
        throw new ProviderError(
          'rate_limited',
          `EODHD rate limit exceeded${retryAfter ? `; retry after ${retryAfter} s` : ''}`,
        );
      }
      case 401:
      case 403:
        throw new ProviderError(
          'unauthorized',
          'EODHD rejected the API key or the plan does not cover this data',
        );
      case 404:
        throw new ProviderError('not_found', 'EODHD does not know this ticker');
      default:
        throw new ProviderError(
          'http_error',
          `EODHD responded with HTTP ${String(response.status)}`,
        );
    }
  }

  return {
    id: 'eodhd',

    async fetchLatestQuote(stock: StockRef): Promise<ProviderQuote> {
      const ticker = toEodhdTicker(stock);
      const quote = await get(
        `/real-time/${encodeURIComponent(ticker)}`,
        {},
        EODHD_CALL_COST.liveQuote,
        liveQuoteSchema,
      );
      if (quote.code.toUpperCase() !== ticker.toUpperCase()) {
        throw new ProviderError(
          'invalid_response',
          `EODHD returned data for ${quote.code} instead of ${ticker}`,
        );
      }
      return {
        price: toDecimalString(quote.close),
        volume: quote.volume == null ? null : toDecimalString(quote.volume),
        observedAt: new Date(quote.timestamp * 1000).toISOString(),
      };
    },

    async fetchDailyPrices(stock: StockRef, { from, to }: DateRange): Promise<ProviderQuote[]> {
      const rows = await get(
        `/eod/${encodeURIComponent(toEodhdTicker(stock))}`,
        { from, to, period: 'd', order: 'a' },
        EODHD_CALL_COST.endOfDay,
        endOfDaySchema,
      );
      return rows.map((row) => ({
        price: toDecimalString(row.close),
        volume: row.volume == null ? null : toDecimalString(row.volume),
        observedAt: `${row.date}T00:00:00.000Z`,
      }));
    },
  };
}
