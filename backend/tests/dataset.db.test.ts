import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/database.js';
import { createDatasetRepository } from '../src/modules/dataset/dataset.repository.js';
import { createLogger } from '../src/shared/logger.js';
import {
  createFixturePool,
  createTestPool,
  describeWithDatabase,
  truncateAll,
} from './helpers/database.js';
import { activate, insertImport, seedActiveDataset } from './helpers/fixtures.js';

describeWithDatabase('dataset repository and readiness', () => {
  const api = createTestPool();
  const fixtures = createFixturePool();
  const datasetAsApi = createDatasetRepository(createDatabase(api));

  beforeEach(() => truncateAll(fixtures));
  afterAll(async () => {
    await api.end();
    await fixtures.end();
  });

  describe('getStatus', () => {
    it('reports no snapshot when none is active, even if succeeded imports exist', async () => {
      await insertImport(fixtures);

      await expect(datasetAsApi.getStatus()).resolves.toEqual({ snapshot: null });
    });

    it('reports the active snapshot (id and activation instant)', async () => {
      const { importId } = await seedActiveDataset(fixtures, [{ ticker: 'AAPL', days: 2 }]);

      const { snapshot } = await datasetAsApi.getStatus();

      expect(snapshot?.importId).toBe(importId);
      expect(snapshot?.activatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('follows the pointer, not the highest import id', async () => {
      const older = await insertImport(fixtures);
      await insertImport(fixtures); // newer succeeded import, not activated
      await insertImport(fixtures, 'failed'); // newest, failed
      await activate(fixtures, older);

      await expect(datasetAsApi.getStatus()).resolves.toMatchObject({
        snapshot: { importId: older },
      });
    });
  });

  describe('findPrivilegeViolations (evaluated for the connected role)', () => {
    it('finds none for the API role', async () => {
      await expect(datasetAsApi.findPrivilegeViolations()).resolves.toEqual([]);
    });

    it('detects an over-privileged role (here: the schema owner)', async () => {
      const asOwner = createDatasetRepository(createDatabase(fixtures));

      const violations = await asOwner.findPrivilegeViolations();

      expect(violations).toEqual(
        expect.arrayContaining([
          'owns_objects',
          'can_create_objects',
          'can_write_data',
          'privileged_membership',
        ]),
      );
      expect(violations).not.toContain('superuser');
    });
  });

  it('readiness refuses an over-privileged role without revealing details in the response', async () => {
    await seedActiveDataset(fixtures, [{ ticker: 'AAPL', days: 2 }]);
    const lines: string[] = [];
    const app = createApp({
      pool: fixtures,
      logger: createLogger((_level, line) => lines.push(line)),
    });

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'unavailable',
      checks: { database: 'up', dataset: 'loaded', privileges: 'excessive' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/owns_objects|earlstock|public/);
    expect(lines.map((line) => JSON.parse(line) as Record<string, unknown>)).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'database role has excessive privileges',
        violations: expect.arrayContaining(['can_write_data']),
      }),
    );
  });
});
