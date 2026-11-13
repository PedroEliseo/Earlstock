import type { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTestPool, describeWithDatabase, truncateAll } from './helpers/database.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNKNOWN_ID = '019a7d3c-8f2e-7a51-9c3b-2d4e6f8a0b1c';

interface StockJson {
  id: string;
  ticker: string;
  createdAt: string;
}

const tickersOf = (res: request.Response) =>
  (res.body as { data: StockJson[] }).data.map((stock) => stock.ticker);

/** The API is read-only, so test data is inserted directly (as the importer will do). */
async function insertStocks(pool: Pool, ...tickers: string[]): Promise<StockJson[]> {
  const { rows } = await pool.query<StockJson>(
    `INSERT INTO stocks (ticker) SELECT unnest($1::text[])
     RETURNING id, ticker, created_at AS "createdAt"`,
    [tickers],
  );
  return rows;
}

describeWithDatabase('stocks API (database)', () => {
  const pool = createTestPool();
  const app = createApp({ pool });

  beforeEach(() => truncateAll(pool));
  afterAll(() => pool.end());

  describe('GET /api/stocks', () => {
    it('returns an empty page when there are no stocks', async () => {
      const res = await request(app).get('/api/stocks');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], pagination: { limit: 20, offset: 0, total: 0 } });
    });

    it('paginates with limit and offset, ordered by ticker, with the total count', async () => {
      await insertStocks(pool, 'MSFT', 'BRK.B', 'AAPL');

      const first = await request(app).get('/api/stocks?limit=2&offset=0');
      const second = await request(app).get('/api/stocks?limit=2&offset=2');
      const beyond = await request(app).get('/api/stocks?limit=2&offset=10');

      expect(first.status).toBe(200);
      expect(tickersOf(first)).toEqual(['AAPL', 'BRK.B']);
      expect(first.body.pagination).toEqual({ limit: 2, offset: 0, total: 3 });
      expect(tickersOf(second)).toEqual(['MSFT']);
      expect(beyond.body).toEqual({ data: [], pagination: { limit: 2, offset: 10, total: 3 } });
    });

    it('returns id, ticker and createdAt, with a database-generated UUIDv7', async () => {
      await insertStocks(pool, 'AAPL');

      const res = await request(app).get('/api/stocks');

      expect((res.body as { data: StockJson[] }).data).toEqual([
        { id: expect.stringMatching(UUID_V7), ticker: 'AAPL', createdAt: expect.any(String) },
      ]);
    });
  });

  describe('GET /api/stocks/:id', () => {
    it('returns an existing stock', async () => {
      const [stock] = await insertStocks(pool, 'AAPL');

      const res = await request(app).get(`/api/stocks/${String(stock?.id)}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        id: stock?.id,
        ticker: 'AAPL',
        createdAt: expect.any(String),
      });
    });

    it('responds 404 for a nonexistent stock', async () => {
      const res = await request(app).get(`/api/stocks/${UNKNOWN_ID}`);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { message: `Stock ${UNKNOWN_ID} not found` } });
    });
  });
});
