import { jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createUnreachablePool } from './helpers/database.js';

const STOCK_ID = '019a7d3c-8f2e-7a51-9c3b-2d4e6f8a0b1c';
const QUOTES = `/api/stocks/${STOCK_ID}/quotes`;
const valid = { price: '189.25', observedAt: '2026-01-02T15:30:00Z', provider: 'manual' };

type ErrorResponse = { error: { message: string; details?: { path: string }[] } };
const pathsOf = (res: request.Response) =>
  ((res.body as ErrorResponse).error.details ?? []).map((issue) => issue.path);

/**
 * Validation must reject bad input before any database access. The pool here can never connect,
 * so a request that reached the repository would fail with 500 instead of the expected 400.
 */
describe('quotes API input validation', () => {
  const pool = createUnreachablePool();
  const app = createApp({ pool });

  afterAll(() => pool.end());

  describe('POST /api/stocks/:stockId/quotes', () => {
    it.each([
      ['an empty body', {}, ['price', 'observedAt', 'provider']],
      ['a numeric price', { ...valid, price: 189.25 }, ['price']],
      ['a zero price', { ...valid, price: '0' }, ['price']],
      ['a negative price', { ...valid, price: '-1.5' }, ['price']],
      ['a price with 9 decimals', { ...valid, price: '1.123456789' }, ['price']],
      ['a negative volume', { ...valid, volume: '-10' }, ['volume']],
      ['a numeric volume', { ...valid, volume: 10 }, ['volume']],
      [
        'a timestamp without offset',
        { ...valid, observedAt: '2026-01-02T15:30:00' },
        ['observedAt'],
      ],
      ['an invalid timestamp', { ...valid, observedAt: 'not-a-date' }, ['observedAt']],
      ['a blank provider', { ...valid, provider: ' ' }, ['provider']],
      ['a provider over 32 chars', { ...valid, provider: 'p'.repeat(33) }, ['provider']],
      ['an unknown field', { ...valid, stockId: STOCK_ID }, ['']],
    ])('responds 400 for %s', async (_case, body, paths) => {
      const res = await request(app).post(QUOTES).send(body);

      expect(res.status).toBe(400);
      expect(pathsOf(res).sort()).toEqual([...paths].sort());
    });

    it('responds 400 for a non-UUID stock id', async () => {
      const res = await request(app).post('/api/stocks/not-a-uuid/quotes').send(valid);

      expect(res.status).toBe(400);
      expect(pathsOf(res)).toEqual(['stockId']);
    });
  });

  it.each(['/api/stocks/not-a-uuid/quotes', '/api/stocks/not-a-uuid/quotes/latest'])(
    'GET %s responds 400 for a non-UUID stock id',
    async (path) => {
      const res = await request(app).get(path);

      expect(res.status).toBe(400);
      expect(pathsOf(res)).toEqual(['stockId']);
    },
  );

  it.each([
    ['from=yesterday', ['from']],
    ['to=2026-01-02', ['to']],
    ['from=2026-01-02T10:00:00Z&to=2026-01-02T10:00:00Z', ['to']],
    ['from=2026-01-03T00:00:00Z&to=2026-01-02T00:00:00Z', ['to']],
    ['limit=0', ['limit']],
    ['limit=101', ['limit']],
    ['offset=-1', ['offset']],
  ])('GET history responds 400 for %s', async (query, paths) => {
    const res = await request(app).get(`${QUOTES}?${query}`);

    expect(res.status).toBe(400);
    expect(pathsOf(res)).toEqual(paths);
  });

  it('accepts an offset written with "+" when URL-encoded', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // An unencoded "+" decodes to a space and is rejected; encoded, it passes validation and
    // reaches the (unreachable) database, which surfaces as a generic 500.
    const unencoded = await request(app).get(`${QUOTES}?from=2026-01-02T10:00:00+01:00`);
    const encoded = await request(app).get(
      `${QUOTES}?from=${encodeURIComponent('2026-01-02T10:00:00+01:00')}`,
    );

    expect(unencoded.status).toBe(400);
    expect(encoded.status).toBe(500);
  });

  it('responds 500 with the standard error body, without leaking details, when the database fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await request(app).post(QUOTES).send(valid);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { message: 'Internal Server Error' } });
  });
});
