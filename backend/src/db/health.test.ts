import { jest } from '@jest/globals';
import { isDatabaseReachable } from './health.js';

describe('isDatabaseReachable', () => {
  it('returns true when the query succeeds', async () => {
    await expect(isDatabaseReachable({ query: () => Promise.resolve({}) })).resolves.toBe(true);
  });

  it('returns false when the query fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      isDatabaseReachable({ query: () => Promise.reject(new Error('connection refused')) }),
    ).resolves.toBe(false);
  });
});
