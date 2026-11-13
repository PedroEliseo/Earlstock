import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createApiBudget } from '../src/modules/market-data/api-budget.js';
import { createApiUsageRepository } from '../src/modules/market-data/api-usage.repository.js';
import { createDemoProvider } from '../src/modules/market-data/demo.provider.js';
import { createEodhdProvider } from '../src/modules/market-data/eodhd.provider.js';
import {
  createMarketData,
  type MarketData,
} from '../src/modules/market-data/market-data.factory.js';
import type {
  MarketDataProvider,
  ProviderQuote,
} from '../src/modules/market-data/market-data.types.js';
import type { SyncSummary } from '../src/modules/market-data/sync.service.js';
import { createTestPool, describeWithDatabase, truncateAll } from './helpers/database.js';

const API_KEY = 'integration-secret-key';
const TODAY = () => new Date('2026-11-13T15:30:00Z');
const summaryOf = (res: request.Response) => (res.body as { data: SyncSummary }).data;

describeWithDatabase('market data sync (database)', () => {
  const pool = createTestPool();
  const usage = createApiUsageRepository(pool);

  beforeEach(() => truncateAll(pool));
  afterAll(() => pool.end());

  async function createStocks(
    app: ReturnType<typeof createApp>,
    ...symbols: string[]
  ): Promise<void> {
    for (const symbol of symbols) {
      await request(app)
        .post('/api/stocks')
        .send({ symbol, name: symbol, exchange: 'NASDAQ', currency: 'USD' })
        .expect(201);
    }
  }

  const eodhdUsage = async () =>
    (
      await pool.query<{ total: number }>(
        'SELECT coalesce(sum(calls_used), 0)::int AS total FROM provider_api_usage',
      )
    ).rows[0]?.total;

  describe('API budget (persisted in PostgreSQL)', () => {
    const budget = (dailyBudget = 15, now = TODAY) =>
      createApiBudget({ repository: usage, provider: 'eodhd', dailyBudget, now });

    it('never exceeds the budget under concurrent reservations', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 40 }, () => budget().reserve(1)),
      );

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(15);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(25);
      await expect(budget().usage()).resolves.toMatchObject({ callsUsed: 15, dailyBudget: 15 });
    });

    it('accounts for call cost and refuses a reservation that does not fit entirely', async () => {
      await budget().reserve(10);
      await budget().reserve(4);

      await expect(budget().reserve(2)).rejects.toMatchObject({ code: 'budget_exhausted' });
      await expect(budget().usage()).resolves.toMatchObject({ callsUsed: 14 });
      await budget().reserve(1);
      await expect(budget().usage()).resolves.toMatchObject({ callsUsed: 15 });
    });

    it('survives an application restart (a new instance reads the persisted count)', async () => {
      await budget().reserve(7);

      const afterRestart = createApiBudget({
        repository: createApiUsageRepository(pool),
        provider: 'eodhd',
        dailyBudget: 15,
        now: TODAY,
      });
      await expect(afterRestart.usage()).resolves.toMatchObject({ callsUsed: 7 });
    });

    it('starts a fresh count on the next UTC day', async () => {
      await budget().reserve(15);

      const tomorrow = budget(15, () => new Date('2026-11-14T00:00:00Z'));
      await expect(tomorrow.reserve(1)).resolves.toBeUndefined();
      await expect(budget().reserve(1)).rejects.toMatchObject({ code: 'budget_exhausted' });
    });

    it('allows nothing with a zero budget, and markExhausted never lowers usage', async () => {
      await expect(budget(0).reserve(1)).rejects.toMatchObject({ code: 'budget_exhausted' });
      await budget(20).reserve(18);
      await budget(15).markExhausted();
      await expect(budget().usage()).resolves.toMatchObject({ callsUsed: 18 });
    });
  });

  describe('demo mode', () => {
    it('starts and syncs from configuration without an API key, recording no API usage', async () => {
      const env = loadEnv({ DATABASE_URL: 'postgres://x:y@localhost:5432/unused' });
      const marketData = createMarketData(env, pool);
      const app = createApp({ pool, marketData });
      await createStocks(app, 'AAPL', 'MSFT');

      const res = await request(app).post('/api/sync').send({});

      expect(env.EODHD_API_KEY).toBeUndefined();
      expect(res.status).toBe(200);
      expect(summaryOf(res)).toMatchObject({
        provider: 'demo',
        mode: 'latest',
        totals: { symbols: 2, succeeded: 2, failed: 0, inserted: 2, skippedDuplicates: 0 },
        apiUsage: null,
      });
      await expect(eodhdUsage()).resolves.toBe(0);
    });

    it('labels synthetic quotes with provider "demo"', async () => {
      const app = createApp({ pool });
      await createStocks(app, 'AAPL');
      await request(app).post('/api/sync').send({ mode: 'daily', days: 7 }).expect(200);

      const { rows } = await pool.query<{ provider: string }>(
        'SELECT DISTINCT provider FROM price_quotes',
      );
      expect(rows).toEqual([{ provider: 'demo' }]);
    });

    it('skips duplicates when overlapping data is synchronized again', async () => {
      const app = createApp({
        pool,
        marketData: { provider: createDemoProvider({ now: TODAY }), budget: null },
      });
      await createStocks(app, 'AAPL', 'MSFT');

      const first = summaryOf(
        await request(app).post('/api/sync').send({ mode: 'daily', days: 14 }),
      );
      const second = summaryOf(
        await request(app).post('/api/sync').send({ mode: 'daily', days: 14 }),
      );
      const latestTwice = [
        summaryOf(await request(app).post('/api/sync').send({ mode: 'latest' })),
        summaryOf(await request(app).post('/api/sync').send({ mode: 'latest' })),
      ];

      expect(first.totals.inserted).toBeGreaterThan(0);
      expect(first.totals.skippedDuplicates).toBe(0);
      expect(second.totals).toMatchObject({
        inserted: 0,
        skippedDuplicates: first.totals.inserted,
      });
      expect(latestTwice.map((summary) => summary.totals)).toMatchObject([
        { inserted: 2, skippedDuplicates: 0 },
        { inserted: 0, skippedDuplicates: 2 },
      ]);
    });

    it('returns an empty summary when there are no stocks', async () => {
      const res = await request(createApp({ pool })).post('/api/sync');

      expect(summaryOf(res).totals).toEqual({
        symbols: 0,
        succeeded: 0,
        failed: 0,
        inserted: 0,
        skippedDuplicates: 0,
      });
    });
  });

  it('rejects a concurrent sync with 409 and releases the lock afterwards', async () => {
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const providerStarted = new Promise<void>((resolve) => (started = resolve));
    const quote: ProviderQuote = {
      price: '1',
      volume: null,
      observedAt: '2026-11-13T15:30:00.000Z',
    };
    const slowProvider: MarketDataProvider = {
      id: 'slow',
      fetchLatestQuote: async () => {
        started();
        await gate;
        return quote;
      },
      fetchDailyPrices: () => Promise.resolve([]),
    };
    const app = createApp({ pool, marketData: { provider: slowProvider, budget: null } });
    await createStocks(app, 'AAPL');

    const first = request(app)
      .post('/api/sync')
      .then((res) => res);
    await providerStarted;
    const concurrent = await request(app).post('/api/sync');
    release();

    expect(concurrent.status).toBe(409);
    expect(concurrent.body).toEqual({ error: { message: 'A synchronization is already running' } });
    expect((await first).status).toBe(200);
    expect((await request(app).post('/api/sync')).status).toBe(200);
  });

  describe('EODHD mode (HTTP stubbed; no real API calls)', () => {
    /** Answers like EODHD's live endpoint; unknown tickers get a 404 (which EODHD still bills). */
    function eodhdApp({
      dailyBudget = 15,
      respond,
    }: { dailyBudget?: number; respond?: (ticker: string) => Response } = {}) {
      const requested: string[] = [];
      const fetch = ((input: URL) => {
        const ticker = decodeURIComponent(input.pathname.split('/').pop() ?? '');
        requested.push(ticker);
        if (respond) return Promise.resolve(respond(ticker));
        if (ticker === 'NOPE.US') return Promise.resolve(new Response('{}', { status: 404 }));
        return Promise.resolve(
          new Response(
            JSON.stringify({ code: ticker, timestamp: 1_794_583_800, close: 123.45, volume: 1000 }),
          ),
        );
      }) as typeof globalThis.fetch;
      const budget = createApiBudget({ repository: usage, provider: 'eodhd', dailyBudget });
      const marketData: MarketData = {
        provider: createEodhdProvider({ apiKey: API_KEY, budget, fetch }),
        budget,
      };
      return { app: createApp({ pool, marketData }), requested };
    }

    it('reports partial failures, skips duplicates on re-sync and counts every billed call', async () => {
      const { app, requested } = eodhdApp();
      await createStocks(app, 'AAPL', 'NOPE', 'MSFT');

      const first = summaryOf(await request(app).post('/api/sync').send({ mode: 'latest' }));
      const second = summaryOf(await request(app).post('/api/sync').send({ mode: 'latest' }));

      expect(requested).toEqual(['AAPL.US', 'MSFT.US', 'NOPE.US', 'AAPL.US', 'MSFT.US', 'NOPE.US']);
      expect(first.totals).toMatchObject({ symbols: 3, succeeded: 2, failed: 1, inserted: 2 });
      expect(first.symbols.find((result) => result.symbol === 'NOPE')).toMatchObject({
        status: 'failed',
        error: { code: 'not_found' },
      });
      expect(second.totals).toMatchObject({ inserted: 0, skippedDuplicates: 2, failed: 1 });
      expect(second.apiUsage).toMatchObject({ provider: 'eodhd', callsUsed: 6, dailyBudget: 15 });
      const { rows } = await pool.query<{ provider: string }>(
        'SELECT DISTINCT provider FROM price_quotes',
      );
      expect(rows).toEqual([{ provider: 'eodhd' }]);
    });

    it('stops at the budget mid-run, then answers 429 with Retry-After until the UTC day ends', async () => {
      const { app, requested } = eodhdApp({ dailyBudget: 2 });
      await createStocks(app, 'AAPL', 'GOOG', 'MSFT', 'TSLA');

      const run = summaryOf(await request(app).post('/api/sync'));
      const exhausted = await request(app).post('/api/sync');

      expect(requested).toHaveLength(2); // the budget was never exceeded
      expect(run.totals).toMatchObject({ succeeded: 2, failed: 2 });
      expect(run.symbols.map((result) => result.error?.code ?? 'ok')).toEqual([
        'ok',
        'ok',
        'budget_exhausted',
        'budget_exhausted',
      ]);
      expect(exhausted.status).toBe(429);
      expect(Number(exhausted.headers['retry-after'])).toBeGreaterThan(0);
      expect((exhausted.body as { error: { message: string } }).error.message).toMatch(
        /^Daily eodhd API budget exhausted \(2\/2 calls used today\)/,
      );
      expect(requested).toHaveLength(2);
    });

    it('stops for the day when EODHD itself reports its limit reached (HTTP 402)', async () => {
      const { app, requested } = eodhdApp({ respond: () => new Response('{}', { status: 402 }) });
      await createStocks(app, 'AAPL', 'MSFT');

      const run = summaryOf(await request(app).post('/api/sync'));

      expect(requested).toEqual(['AAPL.US']);
      expect(run.symbols.map((result) => result.error?.code)).toEqual([
        'provider_limit_reached',
        'provider_limit_reached',
      ]);
      await request(app).post('/api/sync').expect(429);
    });

    it('never exposes the API key in responses', async () => {
      const { app } = eodhdApp({
        respond: (ticker) =>
          ticker === 'AAPL.US'
            ? new Response(JSON.stringify({ message: `bad token ${API_KEY}` }), { status: 500 })
            : new Response('not json'),
      });
      await createStocks(app, 'AAPL', 'MSFT');

      const res = await request(app).post('/api/sync');

      expect(res.status).toBe(200);
      expect(res.text).not.toContain(API_KEY);
    });
  });
});
