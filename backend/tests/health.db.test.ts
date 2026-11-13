import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTestPool, describeWithDatabase } from './helpers/database.js';

describeWithDatabase('GET /health/ready with a real database', () => {
  const pool = createTestPool();
  const app = createApp({ pool });

  afterAll(() => pool.end());

  it('responds 200 when the database is reachable', async () => {
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up' } });
  });
});
