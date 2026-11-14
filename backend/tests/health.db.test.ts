import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  createFixturePool,
  createTestPool,
  describeWithDatabase,
  truncateAll,
} from './helpers/database.js';
import { seedActiveDataset } from './helpers/fixtures.js';

describeWithDatabase('GET /health/ready with a real database (API role)', () => {
  const pool = createTestPool();
  const fixtures = createFixturePool();
  const app = createApp({ pool });

  beforeEach(() => truncateAll(fixtures));
  afterAll(async () => {
    await pool.end();
    await fixtures.end();
  });

  it('responds 503 while no dataset snapshot is active, even though the database is up', async () => {
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'unavailable',
      checks: { database: 'up', dataset: 'empty', privileges: 'ok' },
    });
  });

  it('responds 200 once a snapshot is active and the role is least-privileged', async () => {
    await seedActiveDataset(fixtures, [{ ticker: 'AAPL', days: 3 }]);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: 'up', dataset: 'loaded', privileges: 'ok' },
    });
  });
});
