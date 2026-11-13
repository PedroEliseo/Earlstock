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

  afterAll(() => pool.end());

  it('GET /api/stocks/:id responds 400 for a non-UUID id', async () => {
    const res = await request(app).get('/api/stocks/not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'id', message: expect.any(String) }]);
  });

  it.each(['limit=0', 'limit=101', 'limit=abc', 'limit=1.5', 'offset=-1', 'limit=1&limit=2'])(
    'GET /api/stocks responds 400 for invalid pagination (%s)',
    async (query) => {
      const res = await request(app).get(`/api/stocks?${query}`);

      expect(res.status).toBe(400);
    },
  );

  // The API is read-only: stock data is written exclusively by the data importer.
  it.each([
    ['post', '/api/stocks'],
    ['put', '/api/stocks/019a7d3c-8f2e-7a51-9c3b-2d4e6f8a0b1c'],
    ['patch', '/api/stocks/019a7d3c-8f2e-7a51-9c3b-2d4e6f8a0b1c'],
    ['delete', '/api/stocks/019a7d3c-8f2e-7a51-9c3b-2d4e6f8a0b1c'],
  ] as const)('%s %s is not available (404)', async (method, path) => {
    const res = await request(app)[method](path).send({ ticker: 'AAPL' });

    expect(res.status).toBe(404);
  });
});
