import type {
  DateRange,
  MarketDataProvider,
  ProviderQuote,
  StockRef,
} from './market-data.types.js';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** FNV-1a: a small, stable string hash. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Deterministic pseudo-random number in [0, 1) for a (seed, n) pair. */
function unit(seed: number, n: number): number {
  return hash(`${String(seed)}:${String(n)}`) / 2 ** 32;
}

/**
 * Synthetic, deterministic market data: every value is a pure function of the stock and the
 * date/time, so demos are reproducible and need no network access or third-party data.
 * Quotes are stored with provider "demo", which keeps them distinguishable from real data.
 */
export function createDemoProvider({
  now = () => new Date(),
}: { now?: () => Date } = {}): MarketDataProvider {
  function seedOf(stock: StockRef): number {
    return hash(`${stock.exchange}:${stock.symbol}`);
  }

  /** Close for a UTC day index: a slow cycle around a per-stock base price, plus daily noise. */
  function dailyClose(seed: number, day: number): number {
    const base = 20 + (seed % 48_000) / 100; // 20.00 .. 499.99
    const cycle = 0.15 * Math.sin((2 * Math.PI * day) / 120 + (seed % 360));
    const noise = 0.04 * (2 * unit(seed, day) - 1);
    return base * (1 + cycle + noise);
  }

  function dailyVolume(seed: number, day: number): string {
    return String(100_000 + Math.floor(unit(seed + 1, day) * 5_000_000));
  }

  return {
    id: 'demo',

    fetchLatestQuote(stock: StockRef): Promise<ProviderQuote> {
      const seed = seedOf(stock);
      const minute = Math.floor(now().getTime() / MINUTE_MS);
      const day = Math.floor((minute * MINUTE_MS) / DAY_MS);
      const price = dailyClose(seed, day) * (1 + 0.01 * (2 * unit(seed, minute) - 1));
      return Promise.resolve({
        price: price.toFixed(2),
        volume: dailyVolume(seed, day),
        observedAt: new Date(minute * MINUTE_MS).toISOString(),
      });
    },

    fetchDailyPrices(stock: StockRef, { from, to }: DateRange): Promise<ProviderQuote[]> {
      const seed = seedOf(stock);
      const quotes: ProviderQuote[] = [];
      for (let day = Date.parse(from) / DAY_MS; day <= Date.parse(to) / DAY_MS; day++) {
        const weekday = new Date(day * DAY_MS).getUTCDay();
        if (weekday === 0 || weekday === 6) continue; // no trading on weekends
        quotes.push({
          price: dailyClose(seed, day).toFixed(2),
          volume: dailyVolume(seed, day),
          observedAt: new Date(day * DAY_MS).toISOString(),
        });
      }
      return Promise.resolve(quotes);
    },
  };
}
