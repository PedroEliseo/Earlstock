import { loadEnv } from './env.js';

const DATABASE_URL = 'postgres://user:pass@localhost:5432/db';

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
      DATABASE_POOL_MAX: 10,
    });
  });

  it('coerces numeric values', () => {
    const env = loadEnv({ DATABASE_URL, PORT: '8080', DATABASE_POOL_MAX: '20' });

    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_POOL_MAX).toBe(20);
  });

  it('throws on invalid values', () => {
    expect(() => loadEnv({ DATABASE_URL, PORT: 'abc' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects non-postgres URLs', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/postgres/);
  });

  it('ignores variables it does not define, such as obsolete ones left in an existing .env', () => {
    const env = loadEnv({
      DATABASE_URL,
      MARKET_DATA_PROVIDER: 'eodhd', // previously required EODHD_API_KEY; must no longer matter
      EODHD_DAILY_CALL_BUDGET: '15',
    });

    expect(env).not.toHaveProperty('MARKET_DATA_PROVIDER');
    expect(env).not.toHaveProperty('EODHD_DAILY_CALL_BUDGET');
  });
});
