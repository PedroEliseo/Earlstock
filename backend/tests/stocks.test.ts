import request from 'supertest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/shared/logger.js';
import { createUnreachablePool } from './helpers/database.js';

/**
 * Validation must reject bad input before any database access. The pool here can never connect,
 * so a request that reached the database would fail with 503 instead of the expected 400.
 */
/** Syntactically valid dates relative to today; validation tests need no particular date. */
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const IMPOSSIBLE_DATE = `${day(0).slice(0, 4)}-02-30`;

describe('stocks API without a database', () => {
  const pool = createUnreachablePool();
  const lines: string[] = [];
  const app = createApp({ pool, logger: createLogger((_level, line) => lines.push(line)) });

  afterAll(() => pool.end());

  type ErrorBody = { error: { code: string; message: string; details?: { path: string }[] } };
  const errorOf = (res: request.Response) => (res.body as ErrorBody).error;

  describe('validation (400 VALIDATION_FAILED)', () => {
    it.each([
      ['a lowercase-invalid ticker', '/api/stocks/aa%20pl', ['ticker']],
      ['a ticker with a slash-like character', '/api/stocks/A$', ['ticker']],
      ['a doubled separator', '/api/stocks/A..B', ['ticker']],
      ['a ticker over 32 characters', `/api/stocks/${'A'.repeat(33)}`, ['ticker']],
      ['an invalid ticker on prices', '/api/stocks/A..B/prices', ['ticker']],
    ])('rejects %s', async (_case, path, paths) => {
      const res = await request(app).get(path);

      expect(res.status).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
      expect(errorOf(res).details?.map((issue) => issue.path)).toEqual(paths);
    });

    it.each([
      ['limit=0', ['limit']],
      ['limit=101', ['limit']],
      ['offset=-1', ['offset']],
      ['limit=1&limit=2', ['limit']],
      ['unknown=1', ['']],
      ['sort=price', ['sort']],
      ['dir=up', ['dir']],
      [`q=${'A'.repeat(33)}`, ['q']],
      ['q=a&q=b', ['q']],
    ])('rejects list query %s', async (query, paths) => {
      const res = await request(app).get(`/api/stocks?${query}`);

      expect(res.status).toBe(400);
      expect(errorOf(res).details?.map((issue) => issue.path)).toEqual(paths);
    });

    it.each([
      ['an impossible date', `from=${IMPOSSIBLE_DATE}`, ['from']],
      ['a non-date', 'to=yesterday', ['to']],
      ['a timestamp instead of a date', `from=${day(0)}T00:00:00Z`, ['from']],
      ['from after to', `from=${day(1)}&to=${day(0)}`, ['to']],
      ['a cursor before from', `from=${day(1)}&after=${day(0)}`, ['after']],
      ['a cursor after to', `to=${day(0)}&after=${day(1)}`, ['after']],
      ['limit 0', 'limit=0', ['limit']],
      ['limit above 5000', 'limit=5001', ['limit']],
      ['an unknown parameter', 'offset=10', ['']],
    ])('rejects prices query with %s', async (_case, query, paths) => {
      const res = await request(app).get(`/api/stocks/AAPL/prices?${query}`);

      expect(res.status).toBe(400);
      expect(errorOf(res).details?.map((issue) => issue.path)).toEqual(paths);
    });

    it('rejects a malformed percent-encoded path with 400 BAD_REQUEST', async () => {
      const res = await request(app).get('/api/stocks/%E0');

      expect(res.status).toBe(400);
      expect(errorOf(res).code).toBe('BAD_REQUEST');
    });
  });

  it.each(['/api/stocks', '/api/stocks/AAPL', '/api/stocks/AAPL/prices'])(
    'GET %s responds 503 DATABASE_UNAVAILABLE with Retry-After when the database is unreachable',
    async (path) => {
      lines.length = 0;
      const res = await request(app).get(path);

      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBe('5');
      expect(res.body).toEqual({
        error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is temporarily unavailable' },
      });
      // The failure is logged with its cause and query name, but nothing internal is in the response.
      const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(logged).toEqual([
        expect.objectContaining({
          level: 'error',
          message: 'request failed',
          code: 'DATABASE_UNAVAILABLE',
          error: expect.objectContaining({
            name: 'DatabaseUnavailableError',
            context: expect.objectContaining({ query: expect.stringMatching(/^stocks\./) }),
            cause: expect.objectContaining({ code: 'ECONNREFUSED' }),
          }),
        }),
      ]);
    },
  );

  // The API is read-only and has no UUID endpoint: stock data is written only by the importer.
  it.each([
    ['post', '/api/stocks'],
    ['put', '/api/stocks/AAPL'],
    ['patch', '/api/stocks/AAPL'],
    ['delete', '/api/stocks/AAPL'],
  ] as const)('%s %s is not available (404 NOT_FOUND)', async (method, path) => {
    const res = await request(app)[method](path);

    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe('NOT_FOUND');
  });
});
