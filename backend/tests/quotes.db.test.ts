import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTestPool, describeWithDatabase, truncateAll } from './helpers/database.js';

const UNKNOWN_ID = '019a7d3c-8f2e-7a51-9c3b-2d4e6f8a0b1c';

interface QuoteJson {
  id: string;
  stockId: string;
  price: string;
  volume: string | null;
  observedAt: string;
  provider: string;
  createdAt: string;
}

const quoteOf = (res: request.Response) => (res.body as { data: QuoteJson }).data;
const quotesOf = (res: request.Response) => (res.body as { data: QuoteJson[] }).data;
const idOf = (res: request.Response) => (res.body as { data: { id: string } }).data.id;
const summarize = (res: request.Response) =>
  quotesOf(res).map((quote) => `${quote.observedAt} ${quote.provider}`);

describeWithDatabase('quotes API (database)', () => {
  const pool = createTestPool();
  const app = createApp({ pool });
  let stockId: string;
  let quotesPath: string;

  beforeEach(async () => {
    await truncateAll(pool);
    const res = await request(app)
      .post('/api/stocks')
      .send({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD' })
      .expect(201);
    stockId = idOf(res);
    quotesPath = `/api/stocks/${stockId}/quotes`;
  });
  afterAll(() => pool.end());

  async function addQuote(observedAt: string, provider = 'alpha', price = '100'): Promise<void> {
    await request(app).post(quotesPath).send({ price, observedAt, provider }).expect(201);
  }

  describe('POST /api/stocks/:stockId/quotes', () => {
    it('creates a quote and returns it with 201', async () => {
      const res = await request(app).post(quotesPath).send({
        price: '189.25',
        volume: '1500000',
        observedAt: '2026-01-02T16:30:00.123+01:00',
        provider: 'Manual',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        data: {
          id: expect.stringMatching(/^\d+$/),
          stockId,
          price: '189.25',
          volume: '1500000',
          observedAt: '2026-01-02T15:30:00.123Z', // same instant, normalized to UTC
          provider: 'manual',
          createdAt: expect.any(String),
        },
      });
    });

    it('preserves decimal precision beyond what a JS number can represent', async () => {
      const res = await request(app).post(quotesPath).send({
        price: '999999999999.99999999',
        volume: '1234567890123456.12345678',
        observedAt: '2026-01-02T15:30:00Z',
        provider: 'alpha',
      });

      expect(quoteOf(res)).toMatchObject({
        price: '999999999999.99999999',
        volume: '1234567890123456.12345678',
      });
      // Read back from the table as text, independent of the API's own SELECT.
      const { rows } = await pool.query<{ price: string }>(
        'SELECT price::text AS price FROM price_quotes',
      );
      expect(rows).toEqual([{ price: '999999999999.99999999' }]);
    });

    it('stores a missing volume as null and drops trailing zeros without changing the value', async () => {
      const res = await request(app)
        .post(quotesPath)
        .send({ price: '189.50000000', observedAt: '2026-01-02T15:30:00Z', provider: 'alpha' });

      expect(quoteOf(res)).toMatchObject({ price: '189.5', volume: null });
    });

    it('responds 404 for a nonexistent stock', async () => {
      const res = await request(app)
        .post(`/api/stocks/${UNKNOWN_ID}/quotes`)
        .send({ price: '1', observedAt: '2026-01-02T15:30:00Z', provider: 'alpha' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { message: `Stock ${UNKNOWN_ID} not found` } });
    });

    it('responds 409 for a duplicate and keeps the original quote', async () => {
      await addQuote('2026-01-02T15:30:00Z', 'alpha', '100');

      // Same instant written with a different offset, and provider in a different case.
      const res = await request(app)
        .post(quotesPath)
        .send({ price: '999', observedAt: '2026-01-02T16:30:00+01:00', provider: 'ALPHA' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          message: `A quote from provider "alpha" observed at 2026-01-02T16:30:00+01:00 already exists for stock ${stockId}`,
        },
      });
      const history = await request(app).get(quotesPath);
      expect(quotesOf(history).map((quote) => quote.price)).toEqual(['100']);
    });

    it('accepts quotes for the same instant from different providers', async () => {
      await addQuote('2026-01-02T15:30:00Z', 'alpha');
      await addQuote('2026-01-02T15:30:00Z', 'beta');

      const res = await request(app).get(quotesPath);
      expect(quotesOf(res)).toHaveLength(2);
    });

    it('makes the stock undeletable (409) once it has a quote', async () => {
      await addQuote('2026-01-02T15:30:00Z');

      await request(app).delete(`/api/stocks/${stockId}`).expect(409);
    });
  });

  describe('GET /api/stocks/:stockId/quotes/latest', () => {
    it('returns the most recent quote by observation time, not insertion order', async () => {
      await addQuote('2026-01-02T15:31:00Z', 'alpha', '101');
      await addQuote('2026-01-02T15:30:00Z', 'alpha', '100'); // inserted later, observed earlier

      const res = await request(app).get(`${quotesPath}/latest`);

      expect(res.status).toBe(200);
      expect(quoteOf(res)).toMatchObject({
        price: '101',
        observedAt: '2026-01-02T15:31:00.000Z',
      });
    });

    it('breaks ties at the same instant deterministically by provider (descending)', async () => {
      await addQuote('2026-01-02T15:30:00Z', 'beta');
      await addQuote('2026-01-02T15:30:00Z', 'gamma');
      await addQuote('2026-01-02T15:30:00Z', 'alpha');

      const res = await request(app).get(`${quotesPath}/latest`);

      expect(quoteOf(res).provider).toBe('gamma');
    });

    it('responds 200 with data: null when the stock exists but has no quotes', async () => {
      const res = await request(app).get(`${quotesPath}/latest`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: null });
    });

    it('responds 404 for a nonexistent stock', async () => {
      await request(app).get(`/api/stocks/${UNKNOWN_ID}/quotes/latest`).expect(404);
    });
  });

  describe('GET /api/stocks/:stockId/quotes', () => {
    it('returns an empty page for a stock without quotes', async () => {
      const res = await request(app).get(quotesPath);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], pagination: { limit: 20, offset: 0, total: 0 } });
    });

    it('responds 404 for a nonexistent stock', async () => {
      await request(app).get(`/api/stocks/${UNKNOWN_ID}/quotes`).expect(404);
    });

    it('treats "from" as inclusive and "to" as exclusive', async () => {
      for (const minute of ['00', '01', '02', '03']) await addQuote(`2026-01-02T10:${minute}:00Z`);

      const res = await request(app).get(quotesPath).query({
        from: '2026-01-02T10:01:00Z',
        to: '2026-01-02T10:03:00Z',
      });

      expect(summarize(res)).toEqual([
        '2026-01-02T10:02:00.000Z alpha',
        '2026-01-02T10:01:00.000Z alpha',
      ]);
      expect((res.body as { pagination: { total: number } }).pagination.total).toBe(2);
    });

    it('compares bounds as instants regardless of offset, at millisecond resolution', async () => {
      await addQuote('2026-01-02T10:00:00.000Z');
      await addQuote('2026-01-02T10:00:00.001Z');

      const fromOffset = await request(app)
        .get(quotesPath)
        .query({ from: '2026-01-02T11:00:00.001+01:00' });
      const toOffset = await request(app)
        .get(quotesPath)
        .query({ to: '2026-01-02T11:00:00.001+01:00' });

      expect(summarize(fromOffset)).toEqual(['2026-01-02T10:00:00.001Z alpha']);
      expect(summarize(toOffset)).toEqual(['2026-01-02T10:00:00.000Z alpha']);
    });

    it('supports open-ended ranges', async () => {
      for (const minute of ['00', '01', '02']) await addQuote(`2026-01-02T10:${minute}:00Z`);

      const onlyFrom = await request(app).get(quotesPath).query({ from: '2026-01-02T10:01:00Z' });
      const onlyTo = await request(app).get(quotesPath).query({ to: '2026-01-02T10:01:00Z' });

      expect(summarize(onlyFrom)).toHaveLength(2);
      expect(summarize(onlyTo)).toEqual(['2026-01-02T10:00:00.000Z alpha']);
    });

    it('paginates newest first with a deterministic provider tie-breaker and a filtered total', async () => {
      await addQuote('2026-01-02T10:00:00Z', 'alpha');
      await addQuote('2026-01-02T10:01:00Z', 'beta');
      await addQuote('2026-01-02T10:01:00Z', 'alpha');
      await addQuote('2026-01-02T10:02:00Z', 'alpha');
      await addQuote('2026-01-02T10:01:00Z', 'gamma');

      const pages = await Promise.all(
        [0, 2, 4].map((offset) => request(app).get(quotesPath).query({ limit: 2, offset })),
      );

      expect(pages.map(summarize)).toEqual([
        ['2026-01-02T10:02:00.000Z alpha', '2026-01-02T10:01:00.000Z gamma'],
        ['2026-01-02T10:01:00.000Z beta', '2026-01-02T10:01:00.000Z alpha'],
        ['2026-01-02T10:00:00.000Z alpha'],
      ]);
      for (const [index, page] of pages.entries()) {
        expect(page.body).toMatchObject({ pagination: { limit: 2, offset: index * 2, total: 5 } });
      }
    });

    it('only returns quotes of the requested stock', async () => {
      await addQuote('2026-01-02T10:00:00Z');
      const other = await request(app)
        .post('/api/stocks')
        .send({ symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ', currency: 'USD' });
      const otherId = idOf(other);

      const res = await request(app).get(`/api/stocks/${otherId}/quotes`);

      expect(res.body).toEqual({ data: [], pagination: { limit: 20, offset: 0, total: 0 } });
    });
  });
});
