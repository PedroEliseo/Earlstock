import { loadEnv } from './env.js';

const DATABASE_URL = 'postgres://user:pass@localhost:5432/db';

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
      DATABASE_POOL_MAX: 10,
      MARKET_DATA_PROVIDER: 'demo',
      EODHD_DAILY_CALL_BUDGET: 15,
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

  describe('market data provider', () => {
    it('defaults to demo mode, which needs no API key', () => {
      const env = loadEnv({ DATABASE_URL });

      expect(env.MARKET_DATA_PROVIDER).toBe('demo');
      expect(env.EODHD_API_KEY).toBeUndefined();
    });

    it('accepts demo mode with an empty API key, as in .env.example', () => {
      expect(
        loadEnv({ DATABASE_URL, MARKET_DATA_PROVIDER: 'demo', EODHD_API_KEY: '' }),
      ).toMatchObject({ MARKET_DATA_PROVIDER: 'demo' });
    });

    it.each([
      ['missing', {}],
      ['empty', { EODHD_API_KEY: '' }],
      ['whitespace only', { EODHD_API_KEY: '   ' }],
    ])('fails fast when eodhd is selected and the API key is %s', (_case, key) => {
      expect(() => loadEnv({ DATABASE_URL, MARKET_DATA_PROVIDER: 'eodhd', ...key })).toThrow(
        /is required when MARKET_DATA_PROVIDER=eodhd\s+→ at EODHD_API_KEY/,
      );
    });

    it('accepts eodhd with an API key, trimming whitespace', () => {
      const env = loadEnv({
        DATABASE_URL,
        MARKET_DATA_PROVIDER: 'eodhd',
        EODHD_API_KEY: ' key-123 ',
      });

      expect(env).toMatchObject({ MARKET_DATA_PROVIDER: 'eodhd', EODHD_API_KEY: 'key-123' });
    });

    it('rejects unknown providers', () => {
      expect(() => loadEnv({ DATABASE_URL, MARKET_DATA_PROVIDER: 'yahoo' })).toThrow(
        /MARKET_DATA_PROVIDER/,
      );
    });

    it('validates the daily call budget', () => {
      expect(loadEnv({ DATABASE_URL, EODHD_DAILY_CALL_BUDGET: '5' }).EODHD_DAILY_CALL_BUDGET).toBe(
        5,
      );
      expect(() => loadEnv({ DATABASE_URL, EODHD_DAILY_CALL_BUDGET: '-1' })).toThrow(
        /EODHD_DAILY_CALL_BUDGET/,
      );
    });

    it('never includes the API key in validation errors', () => {
      const error = (() => {
        try {
          loadEnv({
            DATABASE_URL,
            MARKET_DATA_PROVIDER: 'eodhd',
            EODHD_API_KEY: 'secret-key',
            PORT: 'x',
          });
        } catch (err) {
          return err as Error;
        }
        throw new Error('expected loadEnv to throw');
      })();

      expect(error.message).not.toContain('secret-key');
    });
  });
});
