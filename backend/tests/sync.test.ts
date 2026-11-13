import request from 'supertest';
import { createApp } from '../src/app.js';
import { createUnreachablePool } from './helpers/database.js';

/** Request validation must fail before the sync lock or any database access (pool cannot connect). */
describe('POST /api/sync input validation', () => {
  const pool = createUnreachablePool();
  const app = createApp({ pool });

  afterAll(() => pool.end());

  it.each([
    ['an unknown mode', { mode: 'weekly' }, ['mode']],
    ['days below 1', { mode: 'daily', days: 0 }, ['days']],
    ['days above 365', { mode: 'daily', days: 366 }, ['days']],
    ['days as a string', { mode: 'daily', days: '30' }, ['days']],
    ['an unknown field', { mode: 'latest', symbols: ['AAPL'] }, ['']],
  ])('responds 400 for %s', async (_case, body, paths) => {
    const res = await request(app).post('/api/sync').send(body);

    expect(res.status).toBe(400);
    const { details } = (res.body as { error: { details: { path: string }[] } }).error;
    expect(details.map((issue) => issue.path)).toEqual(paths);
  });

  it('only accepts POST', async () => {
    await request(app).get('/api/sync').expect(404);
  });
});
