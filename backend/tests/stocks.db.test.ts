import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import {
  createFixturePool,
  createTestPool,
  describeWithDatabase,
  truncateAll,
} from './helpers/database.js';
import {
  activate,
  type FixtureBar,
  insertBars,
  insertImport,
  insertStock,
  seedActiveDataset,
} from './helpers/fixtures.js';
import { testDatabaseUrls } from './setup/global-setup.js';

interface ApiBar extends Omit<FixtureBar, 'volume'> {
  volume: number;
}

const toApiBar = (bar: FixtureBar): ApiBar => ({ ...bar, volume: Number(bar.volume) });
const tickersOf = (res: request.Response) =>
  (res.body as { data: { ticker: string }[] }).data.map((stock) => stock.ticker);

describeWithDatabase('stocks API (database, API role)', () => {
  const pool = createTestPool(); // the application's role, as in production
  const fixtures = createFixturePool(); // owner role: test data only
  const app = createApp({ pool });

  beforeEach(() => truncateAll(fixtures));
  afterAll(async () => {
    await pool.end();
    await fixtures.end();
  });

  describe('without an active snapshot', () => {
    it.each(['/api/stocks', '/api/stocks/AAPL', '/api/stocks/AAPL/prices'])(
      'GET %s responds 503 DATASET_NOT_LOADED, without Retry-After, even when data exists',
      async (path) => {
        // A succeeded import with data that was never activated must not be served.
        const importId = await insertImport(fixtures);
        await insertBars(fixtures, {
          stockId: await insertStock(fixtures, 'AAPL'),
          importId,
          days: 3,
        });

        const res = await request(app).get(path);

        expect(res.status).toBe(503);
        expect(res.headers['retry-after']).toBeUndefined();
        expect(res.headers['dataset-snapshot']).toBeUndefined();
        expect(res.body).toEqual({
          error: { code: 'DATASET_NOT_LOADED', message: 'No dataset is loaded yet' },
        });
      },
    );
  });

  describe('GET /api/stocks', () => {
    it('distinguishes an active snapshot without stocks (200, empty) from no snapshot', async () => {
      const importId = await insertImport(fixtures);
      await activate(fixtures, importId);

      const res = await request(app).get('/api/stocks');

      expect(res.status).toBe(200);
      expect(res.headers['dataset-snapshot']).toBe(String(importId));
      expect(res.body).toEqual({ data: [], pagination: { limit: 20, offset: 0, total: 0 } });
    });

    it('lists stocks byte-wise by ticker with their date coverage and the snapshot header', async () => {
      const { importId, bars } = await seedActiveDataset(fixtures, [
        { ticker: 'BFA', days: 2 },
        { ticker: 'BF.B', days: 3 },
        { ticker: '^GSPC', days: 1 },
        { ticker: 'B', days: 2, endOffset: -5 },
      ]);

      const res = await request(app).get('/api/stocks');

      expect(res.headers['dataset-snapshot']).toBe(String(importId));
      expect((res.body as { data: unknown[] }).data).toEqual(
        ['B', 'BF.B', 'BFA', '^GSPC'].map((ticker) => ({
          ticker,
          name: null,
          firstDate: bars[ticker]?.at(0)?.date,
          lastDate: bars[ticker]?.at(-1)?.date,
        })),
      );
    });

    it('paginates with a total that stays consistent, including a page beyond the end', async () => {
      await seedActiveDataset(
        fixtures,
        ['AA', 'BB', 'CC', 'DD', 'EE'].map((ticker) => ({ ticker, days: 1 })),
      );

      const pages = await Promise.all(
        [0, 2, 4, 10].map((offset) =>
          request(app).get(`/api/stocks?limit=2&offset=${String(offset)}`),
        ),
      );

      expect(pages.map(tickersOf)).toEqual([['AA', 'BB'], ['CC', 'DD'], ['EE'], []]);
      expect(
        pages.map((res) => (res.body as { pagination: { total: number } }).pagination.total),
      ).toEqual([5, 5, 5, 5]);
    });

    it('excludes stocks that have no bars in the active snapshot', async () => {
      const { importId } = await seedActiveDataset(fixtures, [{ ticker: 'LIVE', days: 2 }]);
      // Bars for OLD exist only in another (failed) import; ORPHAN has no bars at all.
      const failed = await insertImport(fixtures, 'failed');
      await insertBars(fixtures, {
        stockId: await insertStock(fixtures, 'OLD'),
        importId: failed,
        days: 2,
        endOffset: -100,
      });
      await insertStock(fixtures, 'ORPHAN');

      const res = await request(app).get('/api/stocks');

      expect(res.headers['dataset-snapshot']).toBe(String(importId));
      expect(tickersOf(res)).toEqual(['LIVE']);
      expect((res.body as { pagination: { total: number } }).pagination.total).toBe(1);
    });

    it('searches tickers by case-insensitive substring; total counts the matches', async () => {
      await seedActiveDataset(
        fixtures,
        ['BRK.A', 'BRK.B', 'ABRK', 'MSFT', 'BF.B'].map((ticker) => ({ ticker, days: 1 })),
      );

      const all = await request(app).get('/api/stocks?q=brk');
      const firstPage = await request(app).get('/api/stocks?q=BRK&limit=2');
      const blank = await request(app).get('/api/stocks?q=%20%20');

      expect(tickersOf(all)).toEqual(['ABRK', 'BRK.A', 'BRK.B']);
      expect((all.body as { pagination: unknown }).pagination).toEqual({
        limit: 20,
        offset: 0,
        total: 3,
      });
      expect(tickersOf(firstPage)).toEqual(['ABRK', 'BRK.A']);
      expect((firstPage.body as { pagination: { total: number } }).pagination.total).toBe(3);
      expect((blank.body as { pagination: { total: number } }).pagination.total).toBe(5);
    });

    it.each(['%', '_', '\\', '.%', 'B_'])(
      'matches the search term %j literally, never as a LIKE wildcard',
      async (term) => {
        await seedActiveDataset(
          fixtures,
          ['BF.B', 'BRK.B', 'MSFT'].map((ticker) => ({ ticker, days: 1 })),
        );
        const res = await request(app).get(`/api/stocks?q=${encodeURIComponent(term)}`);
        expect(res.status).toBe(200);
        expect(tickersOf(res)).toEqual([]);
      },
    );

    it('returns stored names (null when unknown) and searches them case-insensitively', async () => {
      await seedActiveDataset(
        fixtures,
        ['AAPL', 'BRK.B', 'EL', 'MSFT'].map((ticker) => ({ ticker, days: 1 })),
      );
      await fixtures.query(
        `UPDATE stocks SET name = v.name FROM (VALUES ('AAPL', 'Apple Inc.'), ('BRK.B', 'Berkshire Hathaway'),
           ('EL', 'Estée Lauder Companies (The)')) AS v(ticker, name) WHERE stocks.ticker = v.ticker`,
      );

      const all = await request(app).get('/api/stocks');
      const byName = await request(app).get('/api/stocks?q=hathaway');
      const accented = await request(app).get(`/api/stocks?q=${encodeURIComponent('estée')}`);
      const tickerOrName = await request(app).get('/api/stocks?q=a');
      const literal = await request(app).get('/api/stocks?q=%25');

      expect(
        (all.body as { data: { ticker: string; name: string | null }[] }).data.map((s) => [
          s.ticker,
          s.name,
        ]),
      ).toEqual([
        ['AAPL', 'Apple Inc.'],
        ['BRK.B', 'Berkshire Hathaway'],
        ['EL', 'Estée Lauder Companies (The)'],
        ['MSFT', null],
      ]);
      expect(tickersOf(byName)).toEqual(['BRK.B']);
      expect(tickersOf(accented)).toEqual(['EL']);
      expect(tickersOf(tickerOrName)).toEqual(['AAPL', 'BRK.B', 'EL']); // ticker or name contains "A"
      expect(tickersOf(literal)).toEqual([]);
    });

    it('returns the name with the stock detail', async () => {
      await seedActiveDataset(fixtures, [{ ticker: 'AAPL', days: 2 }]);
      await fixtures.query(`UPDATE stocks SET name = 'Apple Inc.' WHERE ticker = 'AAPL'`);
      const res = await request(app).get('/api/stocks/AAPL');
      expect((res.body as { data: { ticker: string; name: string } }).data).toMatchObject({
        ticker: 'AAPL',
        name: 'Apple Inc.',
      });
    });

    it('orders by first or last date in both directions, ties broken by ticker ascending', async () => {
      await seedActiveDataset(fixtures, [
        { ticker: 'CCC', days: 10, endOffset: 0 }, // first date: day -9
        { ticker: 'AAA', days: 3, endOffset: 0 }, // first date: day -2
        { ticker: 'BBB', days: 3, endOffset: 0 }, // same coverage as AAA
        { ticker: 'DDD', days: 2, endOffset: -5 }, // ends earliest
      ]);
      const order = async (query: string) =>
        tickersOf(await request(app).get(`/api/stocks?${query}`));

      expect(await order('sort=firstDate')).toEqual(['CCC', 'DDD', 'AAA', 'BBB']);
      expect(await order('sort=firstDate&dir=desc')).toEqual(['AAA', 'BBB', 'DDD', 'CCC']);
      expect(await order('sort=lastDate')).toEqual(['DDD', 'AAA', 'BBB', 'CCC']);
      expect(await order('sort=lastDate&dir=desc')).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
      expect(await order('dir=desc')).toEqual(['DDD', 'CCC', 'BBB', 'AAA']);
      // Paging follows the same total order.
      expect(await order('sort=lastDate&dir=desc&limit=2&offset=2')).toEqual(['CCC', 'DDD']);
    });
  });

  describe('GET /api/stocks/:ticker', () => {
    it('returns coverage and the latest bar: prices as exact strings, volume as a number', async () => {
      const { importId, bars } = await seedActiveDataset(fixtures, [{ ticker: 'AAPL', days: 4 }]);
      const aapl = bars['AAPL'] ?? [];

      const res = await request(app).get('/api/stocks/AAPL');

      expect(res.status).toBe(200);
      expect(res.headers['dataset-snapshot']).toBe(String(importId));
      expect(res.body).toEqual({
        data: {
          ticker: 'AAPL',
          name: null,
          coverage: { firstDate: aapl.at(0)?.date, lastDate: aapl.at(-1)?.date, tradingDays: 4 },
          latest: toApiBar(aapl.at(-1) as FixtureBar),
        },
      });
      const latest = (res.body as { data: { latest: ApiBar } }).data.latest;
      expect(typeof latest.close).toBe('string');
      expect(typeof latest.volume).toBe('number');
    });

    it.each([
      ['lower case', '/api/stocks/brk.b', 'BRK.B'],
      ['an index symbol (percent-encoded ^)', '/api/stocks/%5EGSPC', '^GSPC'],
    ])('accepts %s', async (_case, path, ticker) => {
      await seedActiveDataset(fixtures, [{ ticker, days: 1 }]);

      const res = await request(app).get(path);

      expect(res.status).toBe(200);
      expect((res.body as { data: { ticker: string } }).data.ticker).toBe(ticker);
    });

    it('responds 404 NOT_FOUND for an unknown ticker and for one present only in an inactive import', async () => {
      await seedActiveDataset(fixtures, [{ ticker: 'AAPL', days: 1 }]);
      const inactive = await insertImport(fixtures);
      await insertBars(fixtures, {
        stockId: await insertStock(fixtures, 'OLD'),
        importId: inactive,
        days: 2,
      });

      for (const ticker of ['NOPE', 'OLD']) {
        const res = await request(app).get(`/api/stocks/${ticker}`);
        expect(res.status).toBe(404);
        expect(res.body).toEqual({
          error: { code: 'NOT_FOUND', message: `Stock ${ticker} not found` },
        });
      }
    });
  });

  describe('GET /api/stocks/:ticker/prices', () => {
    it('returns the full history oldest first by default', async () => {
      const { bars } = await seedActiveDataset(fixtures, [{ ticker: 'AAPL', days: 5 }]);

      const res = await request(app).get('/api/stocks/AAPL/prices');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: (bars['AAPL'] ?? []).map(toApiBar),
        page: { limit: 1000, nextAfter: null },
      });
    });

    it('treats from and to as inclusive bounds', async () => {
      const { bars } = await seedActiveDataset(fixtures, [{ ticker: 'AAPL', days: 5 }]);
      const dates = (bars['AAPL'] ?? []).map((bar) => bar.date);

      const res = await request(app).get(
        `/api/stocks/AAPL/prices?from=${String(dates[1])}&to=${String(dates[3])}`,
      );

      expect((res.body as { data: ApiBar[] }).data.map((bar) => bar.date)).toEqual(
        dates.slice(1, 4),
      );
    });

    it('pages deterministically with an exclusive cursor until nextAfter is null', async () => {
      const { bars } = await seedActiveDataset(fixtures, [{ ticker: 'AAPL', days: 7 }]);
      const dates = (bars['AAPL'] ?? []).map((bar) => bar.date);
      const from = String(dates[1]);
      const to = String(dates[6]);

      const seen: string[] = [];
      const cursors: (string | null)[] = [];
      let after: string | null = null;
      do {
        const query: string = `from=${from}&to=${to}&limit=2${after ? `&after=${after}` : ''}`;
        const res = await request(app).get(`/api/stocks/AAPL/prices?${query}`);
        const page = res.body as { data: ApiBar[]; page: { nextAfter: string | null } };
        seen.push(...page.data.map((bar) => bar.date));
        after = page.page.nextAfter;
        cursors.push(after);
        if (after) expect(page.data.at(-1)?.date).toBe(after); // cursor = last returned date
      } while (after);

      expect(seen).toEqual(dates.slice(1, 7)); // every bar exactly once, in order
      expect(cursors).toEqual([dates[2], dates[4], null]);
    });

    it('returns an empty page (200) for a known stock with no bars in the range', async () => {
      const { bars } = await seedActiveDataset(fixtures, [{ ticker: 'AAPL', days: 2 }]);
      const last = String(bars['AAPL']?.at(-1)?.date);

      const res = await request(app).get(`/api/stocks/AAPL/prices?after=${last}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], page: { limit: 1000, nextAfter: null } });
    });

    it('never returns bars of a failed or inactive import, even for the same stock', async () => {
      const { bars } = await seedActiveDataset(fixtures, [{ ticker: 'AAPL', days: 2 }]);
      const stockId = await insertStock(fixtures, 'AAPL');
      const failed = await insertImport(fixtures, 'failed');
      const inactive = await insertImport(fixtures);
      await insertBars(fixtures, { stockId, importId: failed, days: 3, endOffset: -10, base: 500 });
      await insertBars(fixtures, {
        stockId,
        importId: inactive,
        days: 3,
        endOffset: -20,
        base: 700,
      });

      const res = await request(app).get('/api/stocks/AAPL/prices');

      expect((res.body as { data: ApiBar[] }).data).toEqual((bars['AAPL'] ?? []).map(toApiBar));
    });

    it('responds 404 for an unknown ticker', async () => {
      await seedActiveDataset(fixtures, [{ ticker: 'AAPL', days: 1 }]);

      const res = await request(app).get('/api/stocks/NOPE/prices');

      expect(res.status).toBe(404);
      expect((res.body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    });
  });

  describe('value representation', () => {
    it('preserves exact decimals and the largest volume, trimming only trailing zeros', async () => {
      const importId = await insertImport(fixtures);
      const stockId = await insertStock(fixtures, 'EXACT');
      await fixtures.query(
        `INSERT INTO daily_prices (stock_id, trade_date, open, high, low, close, adj_close, volume, import_id)
         VALUES ($1, current_date, '0.000001', '999999999999.999999', '0.000001', '243.850000', '1.100000',
                 9007199254740991, $2)`,
        [stockId, importId],
      );
      await activate(fixtures, importId);

      const res = await request(app).get('/api/stocks/EXACT/prices');

      expect(res.text).toContain('"volume":9007199254740991');
      expect((res.body as { data: ApiBar[] }).data[0]).toMatchObject({
        open: '0.000001',
        high: '999999999999.999999',
        close: '243.85',
        adjClose: '1.1',
        volume: 9007199254740991,
      });
    });

    it('returns the same dates whatever the session TimeZone and DateStyle', async () => {
      const { bars } = await seedActiveDataset(fixtures, [{ ticker: 'AAPL', days: 3 }]);
      const settings = encodeURIComponent('-c TimeZone=Pacific/Kiritimati -c DateStyle=SQL,DMY');
      const url = `${testDatabaseUrls()?.api ?? ''}?options=${settings}`;
      const exotic = createPool({ MARKET_DATA_DATABASE_URL: url, DATABASE_POOL_MAX: 1 });
      const westernmost = createPool({
        MARKET_DATA_DATABASE_URL: `${testDatabaseUrls()?.api ?? ''}?options=${encodeURIComponent('-c TimeZone=Etc/GMT+12')}`,
        DATABASE_POOL_MAX: 1,
      });
      try {
        const expected = {
          data: (bars['AAPL'] ?? []).map(toApiBar),
          page: { limit: 1000, nextAfter: null },
        };
        for (const custom of [exotic, westernmost]) {
          const res = await request(createApp({ pool: custom })).get('/api/stocks/AAPL/prices');
          expect(res.body).toEqual(expected);
        }
      } finally {
        await exotic.end();
        await westernmost.end();
      }
    });
  });
});
