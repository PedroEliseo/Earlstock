import { jest } from '@jest/globals';
import { createQuoteSchema } from '../quotes/quotes.schemas.js';
import { createDemoProvider } from './demo.provider.js';

const AAPL = { symbol: 'AAPL', exchange: 'NASDAQ' };
const MSFT = { symbol: 'MSFT', exchange: 'NASDAQ' };
const at = (iso: string) => () => new Date(iso);

describe('demo provider', () => {
  it('identifies its quotes as synthetic', () => {
    expect(createDemoProvider().id).toBe('demo');
  });

  it('is deterministic across instances', async () => {
    const range = { from: '2026-11-02', to: '2026-11-13' };
    const first = createDemoProvider({ now: at('2026-11-13T15:30:20Z') });
    const second = createDemoProvider({ now: at('2026-11-13T15:30:59Z') });

    expect(await first.fetchDailyPrices(AAPL, range)).toEqual(
      await second.fetchDailyPrices(AAPL, range),
    );
    expect(await first.fetchLatestQuote(AAPL)).toEqual(await second.fetchLatestQuote(AAPL));
  });

  it('produces different series for different stocks', async () => {
    const provider = createDemoProvider({ now: at('2026-11-13T15:30:00Z') });

    expect((await provider.fetchLatestQuote(AAPL)).price).not.toBe(
      (await provider.fetchLatestQuote(MSFT)).price,
    );
  });

  it('returns one daily close per weekday in the inclusive range, at 00:00 UTC', async () => {
    const quotes = await createDemoProvider().fetchDailyPrices(AAPL, {
      from: '2026-11-07',
      to: '2026-11-16',
    });

    // 2026-11-07 is a Saturday: weekends are skipped, both bounds are included.
    expect(quotes.map((quote) => quote.observedAt)).toEqual([
      '2026-11-09T00:00:00.000Z',
      '2026-11-10T00:00:00.000Z',
      '2026-11-11T00:00:00.000Z',
      '2026-11-12T00:00:00.000Z',
      '2026-11-13T00:00:00.000Z',
      '2026-11-16T00:00:00.000Z',
    ]);
  });

  it('timestamps latest quotes to the minute, so repeated syncs within a minute are duplicates', async () => {
    const quote = await createDemoProvider({
      now: at('2026-11-13T15:30:45.678Z'),
    }).fetchLatestQuote(AAPL);
    const nextMinute = await createDemoProvider({
      now: at('2026-11-13T15:31:00Z'),
    }).fetchLatestQuote(AAPL);

    expect(quote.observedAt).toBe('2026-11-13T15:30:00.000Z');
    expect(nextMinute.observedAt).toBe('2026-11-13T15:31:00.000Z');
  });

  it('only produces quotes that pass the ingestion validation rules', async () => {
    const provider = createDemoProvider({ now: at('2026-11-13T15:30:00Z') });
    const stocks = ['AAPL', 'MSFT', 'GOOG', 'BRK.B', 'X', 'ZZZZZZZZZZZZZZZZ'].map((symbol) => ({
      symbol,
      exchange: 'NYSE',
    }));

    for (const stock of stocks) {
      const quotes = [
        await provider.fetchLatestQuote(stock),
        ...(await provider.fetchDailyPrices(stock, { from: '2025-11-13', to: '2026-11-13' })),
      ];
      for (const quote of quotes) {
        expect(createQuoteSchema.safeParse({ ...quote, provider: 'demo' }).success).toBe(true);
      }
    }
  });

  it('works without network access (independent of EODHD availability)', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network disabled'));

    await expect(createDemoProvider().fetchLatestQuote(AAPL)).resolves.toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
