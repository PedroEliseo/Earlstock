import { jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createUnreachablePool } from './helpers/database.js';

describe('health endpoints', () => {
  const pool = createUnreachablePool();
  const app = createApp({ pool });

  afterAll(() => pool.end());

  describe('GET /health', () => {
    it('responds 200 with service status, regardless of the database', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({
        status: 'ok',
        uptime: expect.any(Number),
        timestamp: expect.any(String),
      });
      expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
    });
  });

  describe('GET /health/ready', () => {
    it('responds 503 when the database is unreachable', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const res = await request(app).get('/health/ready');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'unavailable', checks: { database: 'down' } });
    });
  });

  it('responds 404 for unknown routes', async () => {
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
  });
});
