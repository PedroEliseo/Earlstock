import request from 'supertest';
import { createApp } from '../src/app.js';
import { createUnreachablePool } from './helpers/database.js';

/**
 * Validation must reject bad input before any database access. The pool here can never connect,
 * so a request that reached the repository would fail with 500 instead of the expected 400.
 */
describe('stocks API input validation', () => {
  const pool = createUnreachablePool();
  const app = createApp({ pool });
  const valid = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD' };

  afterAll(() => pool.end());

  describe('POST /api/stocks', () => {
    it.each([
      ['an empty body', {}, ['symbol', 'name', 'exchange', 'currency']],
      ['a missing name', { ...valid, name: undefined }, ['name']],
      ['a blank symbol', { ...valid, symbol: '   ' }, ['symbol']],
      ['a symbol over 16 characters', { ...valid, symbol: 'A'.repeat(17) }, ['symbol']],
      ['a symbol with invalid characters', { ...valid, symbol: 'AA PL' }, ['symbol']],
      ['a non-ISO currency', { ...valid, currency: 'US' }, ['currency']],
      ['a wrong type', { ...valid, name: 42 }, ['name']],
      ['an unknown field', { ...valid, id: 'client-chosen' }, ['']],
    ])('responds 400 for %s', async (_case, body, paths) => {
      const res = await request(app).post('/api/stocks').send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Request validation failed');
      const { details } = (res.body as { error: { details: { path: string }[] } }).error;
      expect(details.map((issue) => issue.path).sort()).toEqual([...paths].sort());
    });

    it('responds 400 for malformed JSON', async () => {
      const res = await request(app)
        .post('/api/stocks')
        .set('Content-Type', 'application/json')
        .send('{"symbol": ');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toEqual(expect.any(String));
    });
  });

  it.each(['get', 'delete'] as const)(
    '%s /api/stocks/:id responds 400 for a non-UUID id',
    async (method) => {
      const res = await request(app)[method]('/api/stocks/not-a-uuid');

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: 'id', message: expect.any(String) }]);
    },
  );

  it.each(['limit=0', 'limit=101', 'limit=abc', 'limit=1.5', 'offset=-1', 'limit=1&limit=2'])(
    'GET /api/stocks responds 400 for invalid pagination (%s)',
    async (query) => {
      const res = await request(app).get(`/api/stocks?${query}`);

      expect(res.status).toBe(400);
    },
  );
});
