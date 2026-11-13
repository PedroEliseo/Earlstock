import type { ApiBudget } from './api-budget.js';
import { createEodhdProvider, toEodhdTicker } from './eodhd.provider.js';
import { ProviderError } from './market-data.types.js';

const API_KEY = 'test-secret-key-123';
const AAPL = { symbol: 'AAPL', exchange: 'NASDAQ' };

interface FakeBudget extends ApiBudget {
  reserved: number[];
  exhausted: boolean;
}

function fakeBudget({ refuse = false } = {}): FakeBudget {
  const budget: FakeBudget = {
    reserved: [],
    exhausted: false,
    reserve(cost) {
      if (refuse) return Promise.reject(new ProviderError('budget_exhausted', 'budget exhausted'));
      budget.reserved.push(cost);
      return Promise.resolve();
    },
    usage: () =>
      Promise.resolve({ provider: 'eodhd', date: '2026-11-13', callsUsed: 0, dailyBudget: 15 }),
    markExhausted() {
      budget.exhausted = true;
      return Promise.resolve();
    },
  };
  return budget;
}

/** A fetch double that records request URLs and answers with a fixed response. */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const urls: URL[] = [];
  const fetch = (input: string | URL | Request) => {
    urls.push(new URL(input instanceof Request ? input.url : input));
    return Promise.resolve(respond());
  };
  return { urls, fetch };
}

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);
const liveQuote = {
  code: 'AAPL.US',
  timestamp: 1_783_974_420,
  gmtoffset: 0,
  close: 317.31,
  volume: 43_138_419,
};

function setup(respond: () => Response | Promise<Response>, options: { refuse?: boolean } = {}) {
  const budget = fakeBudget(options);
  const { urls, fetch } = fakeFetch(respond);
  const provider = createEodhdProvider({ apiKey: API_KEY, budget, fetch, timeoutMs: 50 });
  return { provider, budget, urls };
}

async function providerErrorOf(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => {
      throw new Error('expected a ProviderError');
    },
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('toEodhdTicker', () => {
  it.each([
    [{ symbol: 'AAPL', exchange: 'NASDAQ' }, 'AAPL.US'],
    [{ symbol: 'IBM', exchange: 'NYSE' }, 'IBM.US'],
    [{ symbol: 'BRK.B', exchange: 'NYSE' }, 'BRK-B.US'],
    [{ symbol: 'VOD', exchange: 'LSE' }, 'VOD.LSE'],
  ])('maps %o to %s', (stock, ticker) => {
    expect(toEodhdTicker(stock)).toBe(ticker);
  });
});

describe('EODHD provider', () => {
  describe('fetchLatestQuote', () => {
    it('requests one symbol as JSON and normalizes the response', async () => {
      const { provider, urls, budget } = setup(() => json(liveQuote));

      await expect(provider.fetchLatestQuote(AAPL)).resolves.toEqual({
        price: '317.31',
        volume: '43138419',
        observedAt: '2026-07-13T20:27:00.000Z', // 1783974420 s since the epoch
      });
      expect(urls).toHaveLength(1);
      expect(urls[0]?.origin).toBe('https://eodhd.com');
      expect(urls[0]?.pathname).toBe('/api/real-time/AAPL.US');
      expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
        fmt: 'json',
        api_token: API_KEY,
      });
      expect(budget.reserved).toEqual([1]);
    });

    it('maps a missing volume to null', async () => {
      const { provider } = setup(() => json({ ...liveQuote, volume: null }));

      await expect(provider.fetchLatestQuote(AAPL)).resolves.toMatchObject({ volume: null });
    });

    it.each([
      ['a non-numeric price', { ...liveQuote, close: 'NA' }],
      ['a zero price', { ...liveQuote, close: 0 }],
      ['a missing timestamp', { ...liveQuote, timestamp: undefined }],
      ['a negative volume', { ...liveQuote, volume: -1 }],
      ['an array', [liveQuote]],
      ['another ticker', { ...liveQuote, code: 'MSFT.US' }],
    ])('rejects %s as invalid_response', async (_case, body) => {
      const { provider } = setup(() => json(body));

      expect((await providerErrorOf(provider.fetchLatestQuote(AAPL))).code).toBe(
        'invalid_response',
      );
    });

    it('rejects a body that is not JSON', async () => {
      const { provider } = setup(() => new Response('<html>maintenance</html>'));

      expect((await providerErrorOf(provider.fetchLatestQuote(AAPL))).code).toBe(
        'invalid_response',
      );
    });
  });

  describe('fetchDailyPrices', () => {
    it('requests the date range and normalizes daily closes to 00:00 UTC of the trading day', async () => {
      const { provider, urls } = setup(() =>
        json([
          {
            date: '2026-11-12',
            open: 1,
            high: 2,
            low: 0.5,
            close: 297.04,
            adjusted_close: 277.9465,
            volume: 4_458_400,
          },
          {
            date: '2026-11-13',
            open: 1,
            high: 2,
            low: 0.5,
            close: 0.00012345,
            adjusted_close: 1,
            volume: 0,
          },
        ]),
      );

      await expect(
        provider.fetchDailyPrices(AAPL, { from: '2026-11-12', to: '2026-11-13' }),
      ).resolves.toEqual([
        { price: '297.04', volume: '4458400', observedAt: '2026-11-12T00:00:00.000Z' },
        { price: '0.00012345', volume: '0', observedAt: '2026-11-13T00:00:00.000Z' },
      ]);
      expect(urls[0]?.pathname).toBe('/api/eod/AAPL.US');
      expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toMatchObject({
        from: '2026-11-12',
        to: '2026-11-13',
        period: 'd',
        order: 'a',
        fmt: 'json',
      });
    });

    it('returns an empty list when there are no trading days in range', async () => {
      const { provider } = setup(() => json([]));

      await expect(
        provider.fetchDailyPrices(AAPL, { from: '2026-11-14', to: '2026-11-15' }),
      ).resolves.toEqual([]);
    });

    it.each([
      ['an object instead of an array', { date: '2026-11-12', close: 1 }],
      ['an invalid date', [{ date: '2026-13-01', close: 1 }]],
      [
        'one malformed row among valid ones',
        [
          { date: '2026-11-12', close: 1 },
          { date: '2026-11-13', close: null },
        ],
      ],
    ])('rejects %s as invalid_response', async (_case, body) => {
      const { provider } = setup(() => json(body));

      const error = await providerErrorOf(
        provider.fetchDailyPrices(AAPL, { from: '2026-11-12', to: '2026-11-13' }),
      );
      expect(error.code).toBe('invalid_response');
    });
  });

  describe('failures', () => {
    it.each([
      [402, 'provider_limit_reached', true],
      [401, 'unauthorized', true],
      [403, 'unauthorized', true],
      [404, 'not_found', false],
      [500, 'http_error', false],
    ])('maps HTTP %i to %s (fatal: %s)', async (status, code, fatal) => {
      const { provider } = setup(() => json({ error: 'x' }, { status }));

      const error = await providerErrorOf(provider.fetchLatestQuote(AAPL));
      expect(error.code).toBe(code);
      expect(error.fatal).toBe(fatal);
    });

    it('maps HTTP 429 to a fatal rate_limited error including Retry-After', async () => {
      const { provider } = setup(() => json({}, { status: 429, headers: { 'Retry-After': '42' } }));

      const error = await providerErrorOf(provider.fetchLatestQuote(AAPL));
      expect(error).toMatchObject({ code: 'rate_limited', fatal: true });
      expect(error.message).toContain('retry after 42 s');
    });

    it('marks the local budget as exhausted when EODHD reports its daily limit reached (402)', async () => {
      const { provider, budget } = setup(() => json({}, { status: 402 }));

      await providerErrorOf(provider.fetchLatestQuote(AAPL));
      expect(budget.exhausted).toBe(true);
    });

    it('times out a request that does not answer in time', async () => {
      const budget = fakeBudget();
      const hangingFetch = ((_input: URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        })) as typeof globalThis.fetch;
      const provider = createEodhdProvider({
        apiKey: API_KEY,
        budget,
        fetch: hangingFetch,
        timeoutMs: 20,
      });

      const error = await providerErrorOf(provider.fetchLatestQuote(AAPL));
      expect(error).toMatchObject({ code: 'timeout', fatal: false });
      expect(budget.reserved).toEqual([1]); // a timed-out request may still have been billed
    });

    it('maps network failures without exposing the request URL', async () => {
      const budget = fakeBudget();
      const failingFetch = ((input: URL) =>
        Promise.reject(
          new TypeError(`fetch failed for ${input.toString()}`),
        )) as typeof globalThis.fetch;
      const provider = createEodhdProvider({ apiKey: API_KEY, budget, fetch: failingFetch });

      const error = await providerErrorOf(provider.fetchLatestQuote(AAPL));
      expect(error.code).toBe('network');
      expect(error.message).not.toContain(API_KEY);
      expect(error.cause).toBeUndefined();
    });

    it('sends no request when the budget refuses the call', async () => {
      const { provider, urls } = setup(() => json(liveQuote), { refuse: true });

      expect((await providerErrorOf(provider.fetchLatestQuote(AAPL))).code).toBe(
        'budget_exhausted',
      );
      expect(urls).toHaveLength(0);
    });

    it.each([200, 401, 402, 404, 429, 500])(
      'never includes the API key in error messages (HTTP %i)',
      async (status) => {
        const { provider } = setup(() => json({ api_token: API_KEY }, { status }));

        const error = await provider.fetchLatestQuote(AAPL).catch((err: unknown) => err as Error);
        expect(error).toBeInstanceOf(ProviderError);
        expect(JSON.stringify({ message: (error as Error).message })).not.toContain(API_KEY);
      },
    );
  });
});
