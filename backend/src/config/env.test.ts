import { loadEnv } from './env.js';

const MARKET_DATA_DATABASE_URL = 'postgres://api_role:pass@localhost:5432/db';
const ADMIN_DATABASE_URL = 'postgres://superuser:pass@localhost:5432/db';

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv({ MARKET_DATA_DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      MARKET_DATA_DATABASE_URL,
      DATABASE_POOL_MAX: 10,
      DATABASE_STATEMENT_TIMEOUT_MS: 5000,
    });
  });

  it('coerces numeric values', () => {
    const env = loadEnv({ MARKET_DATA_DATABASE_URL, PORT: '8080', DATABASE_POOL_MAX: '20' });

    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_POOL_MAX).toBe(20);
  });

  it('throws on invalid values', () => {
    expect(() => loadEnv({ MARKET_DATA_DATABASE_URL, PORT: 'abc' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('requires MARKET_DATA_DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow(/MARKET_DATA_DATABASE_URL/);
  });

  it('never falls back to DATABASE_URL (the administrative connection)', () => {
    expect(() => loadEnv({ DATABASE_URL: ADMIN_DATABASE_URL })).toThrow(/MARKET_DATA_DATABASE_URL/);
  });

  it('ignores DATABASE_URL and MIGRATION_DATABASE_URL when both are present', () => {
    const env = loadEnv({
      MARKET_DATA_DATABASE_URL,
      DATABASE_URL: ADMIN_DATABASE_URL,
      MIGRATION_DATABASE_URL: 'postgres://owner_role:pass@localhost:5432/db',
    });

    expect(env.MARKET_DATA_DATABASE_URL).toBe(MARKET_DATA_DATABASE_URL);
    expect(env).not.toHaveProperty('DATABASE_URL');
    expect(env).not.toHaveProperty('MIGRATION_DATABASE_URL');
  });

  it('rejects non-postgres URLs', () => {
    expect(() => loadEnv({ MARKET_DATA_DATABASE_URL: 'mysql://localhost/db' })).toThrow(/postgres/);
  });

  it('ignores variables it does not define, such as obsolete ones left in an existing .env', () => {
    const env = loadEnv({
      MARKET_DATA_DATABASE_URL,
      MARKET_DATA_PROVIDER: 'eodhd', // previously required EODHD_API_KEY; must no longer matter
      EODHD_DAILY_CALL_BUDGET: '15',
    });

    expect(env).not.toHaveProperty('MARKET_DATA_PROVIDER');
    expect(env).not.toHaveProperty('EODHD_DAILY_CALL_BUDGET');
  });

  it('validates the API statement timeout', () => {
    expect(
      loadEnv({ MARKET_DATA_DATABASE_URL, DATABASE_STATEMENT_TIMEOUT_MS: '250' })
        .DATABASE_STATEMENT_TIMEOUT_MS,
    ).toBe(250);
    expect(() =>
      loadEnv({ MARKET_DATA_DATABASE_URL, DATABASE_STATEMENT_TIMEOUT_MS: '50' }),
    ).toThrow(/DATABASE_STATEMENT_TIMEOUT_MS/);
  });
});
