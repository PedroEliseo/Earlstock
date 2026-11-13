import { QuotaExceededError } from '../../shared/errors.js';
import type { CreateQuoteInput } from '../quotes/quotes.schemas.js';
import type { Stock } from '../stocks/stocks.repository.js';
import type { ApiBudget } from './api-budget.js';
import {
  type MarketDataProvider,
  ProviderError,
  type ProviderQuote,
  type StockRef,
} from './market-data.types.js';
import { createSyncService } from './sync.service.js';

const NOW = new Date('2026-11-13T10:00:00Z');
const stock = (symbol: string): Stock => ({
  id: `id-${symbol}`,
  symbol,
  name: symbol,
  exchange: 'NASDAQ',
  currency: 'USD',
  createdAt: NOW,
});
const quote: ProviderQuote = {
  price: '100.5',
  volume: '10',
  observedAt: '2026-11-13T09:59:00.000Z',
};

function setup({
  stocks = [stock('AAPL'), stock('MSFT'), stock('GOOG')],
  latest = () => Promise.resolve(quote),
  daily = () => Promise.resolve([quote]),
  budget = null,
  ingest = (_stockId: string, quotes: CreateQuoteInput[]) =>
    Promise.resolve({ inserted: quotes.length, skippedDuplicates: 0 }),
}: {
  stocks?: Stock[];
  latest?: (stock: StockRef) => Promise<ProviderQuote>;
  daily?: MarketDataProvider['fetchDailyPrices'];
  budget?: ApiBudget | null;
  ingest?: (
    stockId: string,
    quotes: CreateQuoteInput[],
  ) => Promise<{ inserted: number; skippedDuplicates: number }>;
} = {}) {
  const calls: string[] = [];
  const ingested: Record<string, CreateQuoteInput[]> = {};
  const provider: MarketDataProvider = {
    id: 'fake',
    fetchLatestQuote: (ref) => {
      calls.push(ref.symbol);
      return latest(ref);
    },
    fetchDailyPrices: daily,
  };
  const service = createSyncService({
    marketData: { provider, budget },
    stocks: {
      list: ({ limit, offset }) =>
        Promise.resolve({ items: stocks.slice(offset, offset + limit), total: stocks.length }),
    },
    quotes: {
      ingest: (stockId, quotes) => {
        ingested[stockId] = quotes;
        return ingest(stockId, quotes);
      },
    },
    lock: { runExclusive: (task) => task() },
    now: () => NOW,
  });
  return { service, calls, ingested };
}

const failWith =
  (code: ConstructorParameters<typeof ProviderError>[0], symbol: string) => (ref: StockRef) =>
    ref.symbol === symbol
      ? Promise.reject(new ProviderError(code, `${code} for ${symbol}`))
      : Promise.resolve(quote);

describe('sync service', () => {
  it('ingests validated quotes for every stock and summarizes the run', async () => {
    const { service, ingested } = setup();

    const summary = await service.run({ mode: 'latest', days: 30 });

    expect(summary).toMatchObject({
      provider: 'fake',
      mode: 'latest',
      totals: { symbols: 3, succeeded: 3, failed: 0, inserted: 3, skippedDuplicates: 0 },
      apiUsage: null,
    });
    expect(ingested['id-AAPL']).toEqual([{ ...quote, provider: 'fake' }]);
  });

  it('pages through all stocks', async () => {
    const stocks = Array.from({ length: 205 }, (_, index) => stock(`S${String(index)}`));
    const { service, calls } = setup({ stocks });

    await service.run({ mode: 'latest', days: 30 });

    expect(calls).toHaveLength(205);
  });

  it('reports duplicates skipped by ingestion', async () => {
    const { service } = setup({
      ingest: () => Promise.resolve({ inserted: 0, skippedDuplicates: 1 }),
    });

    const { totals } = await service.run({ mode: 'latest', days: 30 });

    expect(totals).toMatchObject({ inserted: 0, skippedDuplicates: 3 });
  });

  it('continues after a non-fatal failure and reports it per symbol (partial failure)', async () => {
    const { service, calls } = setup({ latest: failWith('not_found', 'MSFT') });

    const summary = await service.run({ mode: 'latest', days: 30 });

    expect(calls).toEqual(['AAPL', 'MSFT', 'GOOG']);
    expect(summary.totals).toMatchObject({ succeeded: 2, failed: 1, inserted: 2 });
    expect(summary.symbols[1]).toEqual({
      stockId: 'id-MSFT',
      symbol: 'MSFT',
      exchange: 'NASDAQ',
      status: 'failed',
      inserted: 0,
      skippedDuplicates: 0,
      error: { code: 'not_found', message: 'not_found for MSFT' },
    });
  });

  it('stops calling the provider after a fatal failure and marks the rest as not attempted', async () => {
    const { service, calls } = setup({ latest: failWith('budget_exhausted', 'MSFT') });

    const summary = await service.run({ mode: 'latest', days: 30 });

    expect(calls).toEqual(['AAPL', 'MSFT']);
    expect(summary.totals).toMatchObject({ succeeded: 1, failed: 2 });
    expect(summary.symbols[2]?.error).toEqual({
      code: 'budget_exhausted',
      message: 'Not attempted: budget_exhausted for MSFT',
    });
  });

  it.each([
    ['a zero price', { ...quote, price: '0' }],
    ['exponent notation', { ...quote, price: '1e-7' }],
    ['too many integer digits', { ...quote, price: '1000000000000' }],
    ['a timestamp without offset', { ...quote, observedAt: '2026-11-13T09:59:00' }],
  ])(
    'rejects provider data with %s without ingesting anything for that stock',
    async (_case, bad) => {
      const { service, ingested } = setup({
        latest: (ref) => Promise.resolve(ref.symbol === 'MSFT' ? bad : quote),
      });

      const summary = await service.run({ mode: 'latest', days: 30 });

      expect(summary.symbols[1]).toMatchObject({
        status: 'failed',
        error: { code: 'invalid_response' },
      });
      expect(ingested['id-MSFT']).toBeUndefined();
      expect(summary.totals.succeeded).toBe(2);
    },
  );

  it('requests the last N UTC days, today included, in daily mode', async () => {
    const ranges: unknown[] = [];
    const { service } = setup({
      stocks: [stock('AAPL')],
      daily: (_stock, range) => {
        ranges.push(range);
        return Promise.resolve([]);
      },
    });

    const summary = await service.run({ mode: 'daily', days: 3 });

    expect(ranges).toEqual([{ from: '2026-11-11', to: '2026-11-13' }]);
    expect(summary.totals).toMatchObject({ succeeded: 1, inserted: 0 });
  });

  it('propagates unexpected (non-provider) errors', async () => {
    const failure = new Error('database down');
    const { service } = setup({ ingest: () => Promise.reject(failure) });

    await expect(service.run({ mode: 'latest', days: 30 })).rejects.toBe(failure);
  });

  it('refuses to start when the API budget is already exhausted, without calling the provider', async () => {
    const budget: ApiBudget = {
      reserve: () => Promise.resolve(),
      usage: () =>
        Promise.resolve({ provider: 'fake', date: '2026-11-13', callsUsed: 15, dailyBudget: 15 }),
      markExhausted: () => Promise.resolve(),
    };
    const { service, calls } = setup({ budget });

    const error = await service.run({ mode: 'latest', days: 30 }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(QuotaExceededError);
    expect(error).toMatchObject({ retryAfterSeconds: 14 * 3600 }); // 10:00 UTC -> next midnight
    expect(calls).toEqual([]);
  });
});
