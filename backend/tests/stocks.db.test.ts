import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTestPool, describeWithDatabase, truncateAll } from './helpers/database.js';

const apple = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD' };
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNKNOWN_ID = '019a7d3c-8f2e-7a51-9c3b-2d4e6f8a0b1c';

interface StockJson {
  id: string;
  symbol: string;
}

const symbolsOf = (res: request.Response) =>
  (res.body as { data: StockJson[] }).data.map((stock) => stock.symbol);

describeWithDatabase('stocks API (database)', () => {
  const pool = createTestPool();
  const app = createApp({ pool });

  beforeEach(() => truncateAll(pool));
  afterAll(() => pool.end());

  async function createStock(body: object = apple): Promise<StockJson> {
    const res = await request(app).post('/api/stocks').send(body).expect(201);
    return (res.body as { data: StockJson }).data;
  }

  describe('POST /api/stocks', () => {
    it('creates a stock with a database-generated UUIDv7 and returns 201', async () => {
      const res = await request(app)
        .post('/api/stocks')
        .send({ symbol: ' aapl ', name: 'Apple Inc.', exchange: 'nasdaq', currency: 'usd' });

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({
        id: expect.stringMatching(UUID_V7),
        ...apple,
        createdAt: expect.any(String),
      });
      const { id } = (res.body as { data: StockJson }).data;
      expect(res.headers['location']).toBe(`/api/stocks/${id}`);
    });

    it('responds 409 for a duplicate exchange and symbol, regardless of case', async () => {
      await createStock();

      const res = await request(app)
        .post('/api/stocks')
        .send({ ...apple, symbol: 'aapl', name: 'Different name' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: { message: 'Stock NASDAQ:AAPL already exists' } });
    });

    it('allows the same symbol on a different exchange', async () => {
      await createStock();

      await request(app)
        .post('/api/stocks')
        .send({ ...apple, exchange: 'XETRA', currency: 'EUR' })
        .expect(201);
    });
  });

  describe('GET /api/stocks', () => {
    it('returns an empty page when there are no stocks', async () => {
      const res = await request(app).get('/api/stocks');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], pagination: { limit: 20, offset: 0, total: 0 } });
    });

    it('paginates with limit and offset, ordered by exchange and symbol, with the total count', async () => {
      for (const symbol of ['MSFT', 'AAPL', 'GOOG']) await createStock({ ...apple, symbol });

      const first = await request(app).get('/api/stocks?limit=2&offset=0');
      const second = await request(app).get('/api/stocks?limit=2&offset=2');
      const beyond = await request(app).get('/api/stocks?limit=2&offset=10');

      expect(first.status).toBe(200);
      expect(symbolsOf(first)).toEqual(['AAPL', 'GOOG']);
      expect(first.body.pagination).toEqual({ limit: 2, offset: 0, total: 3 });
      expect(symbolsOf(second)).toEqual(['MSFT']);
      expect(second.body.pagination).toEqual({ limit: 2, offset: 2, total: 3 });
      expect(beyond.body).toEqual({ data: [], pagination: { limit: 2, offset: 10, total: 3 } });
    });
  });

  describe('GET /api/stocks/:id', () => {
    it('returns an existing stock', async () => {
      const { id } = await createStock();

      const res = await request(app).get(`/api/stocks/${id}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ id, ...apple, createdAt: expect.any(String) });
    });

    it('responds 404 for a nonexistent stock', async () => {
      const res = await request(app).get(`/api/stocks/${UNKNOWN_ID}`);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { message: `Stock ${UNKNOWN_ID} not found` } });
    });
  });

  describe('DELETE /api/stocks/:id', () => {
    it('deletes a stock and responds 204', async () => {
      const { id } = await createStock();

      const res = await request(app).delete(`/api/stocks/${id}`);

      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      await request(app).get(`/api/stocks/${id}`).expect(404);
    });

    it('responds 404 for a nonexistent stock', async () => {
      await request(app).delete(`/api/stocks/${UNKNOWN_ID}`).expect(404);
    });
  });
});
