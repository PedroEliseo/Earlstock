import { assertSafeTestDatabase, parseDatabaseTarget, testDatabaseUrls } from './global-setup.js';

const TEST = 'postgres://tester:secret@localhost:5432/earlstock_test';
const DEV = 'postgres://dev:other@localhost:5432/earlstock';
const noEnv: NodeJS.ProcessEnv = {};

const check = (testUrl: string, devUrl?: string, env = noEnv) =>
  assertSafeTestDatabase(testUrl, { DATABASE_URL: devUrl }, env);

describe('parseDatabaseTarget', () => {
  it('resolves host, port and database independently of credentials', () => {
    expect(parseDatabaseTarget('X', TEST, noEnv)).toEqual({
      host: 'loopback',
      port: '5432',
      database: 'earlstock_test',
    });
  });

  it.each([
    'postgres://u:p@localhost/db',
    'postgres://u:p@127.0.0.1/db',
    'postgres://u:p@[::1]/db',
    'postgres://u:p@LOCALHOST/db',
  ])('normalizes loopback aliases (%s)', (url) => {
    expect(parseDatabaseTarget('X', url, noEnv).host).toBe('loopback');
  });

  it('uses PGPORT for an implicit port, as node-postgres does', () => {
    expect(parseDatabaseTarget('X', 'postgres://u@localhost/db', { PGPORT: '6543' }).port).toBe(
      '6543',
    );
  });

  it.each([
    ['not a URL', 'earlstock_test'],
    ['another protocol', 'mysql://u:p@localhost/earlstock_test'],
    ['no host (socket or PGHOST fallback)', 'postgres:///earlstock_test'],
    ['no database', 'postgres://u:p@localhost:5432/'],
    ['a nested path', 'postgres://u:p@localhost/a/earlstock_test'],
    ['a host override parameter', 'postgres://u:p@localhost/earlstock_test?host=/tmp'],
    ['a database override parameter', 'postgres://u:p@localhost/earlstock_test?dbname=x'],
    ['an unknown parameter', 'postgres://u:p@localhost/earlstock_test?service=prod'],
    ['an undecodable name', 'postgres://u:p@localhost/earlstock%E0_test'],
  ])('fails closed for %s', (_case, url) => {
    expect(() => parseDatabaseTarget('X', url, noEnv)).toThrow();
  });

  it('accepts parameters that cannot change the target', () => {
    expect(() =>
      parseDatabaseTarget('X', `${TEST}?sslmode=disable&application_name=t`, noEnv),
    ).not.toThrow();
  });
});

describe('assertSafeTestDatabase', () => {
  it('accepts a *_test database distinct from the development database', () => {
    expect(check(TEST, DEV).database).toBe('earlstock_test');
  });

  it('accepts a missing DATABASE_URL (nothing to collide with)', () => {
    expect(check(TEST, undefined).database).toBe('earlstock_test');
  });

  it('requires the "_test" suffix', () => {
    expect(() => check('postgres://u:p@localhost:5432/earlstock', undefined)).toThrow(
      /must end in "_test"/,
    );
  });

  it.each([
    ['identical URLs', TEST],
    ['other credentials', 'postgres://someone:else@localhost:5432/earlstock_test'],
    ['a loopback alias', 'postgres://u:p@127.0.0.1:5432/earlstock_test'],
    ['an implicit default port', 'postgres://u:p@localhost/earlstock_test'],
    ['a percent-encoded name', 'postgres://u:p@localhost:5432/earlstock%5Ftest'],
    ['a different host (could be an alias)', 'postgres://u:p@db.example.com:5432/earlstock_test'],
    ['a different port (could be forwarded)', 'postgres://u:p@localhost:6543/earlstock_test'],
  ])('refuses when DATABASE_URL uses the same database name via %s', (_case, devUrl) => {
    expect(() => check(TEST, devUrl)).toThrow(/same name/);
  });

  it('fails closed when DATABASE_URL cannot be parsed', () => {
    expect(() => check(TEST, 'not a url')).toThrow(/DATABASE_URL is not a valid URL/);
  });

  it('never includes credentials in its errors', () => {
    const error = (() => {
      try {
        check(TEST, 'postgres://dev:hunter2@localhost:5432/earlstock_test');
      } catch (err) {
        return err as Error;
      }
      throw new Error('expected a refusal');
    })();

    expect(error.message).not.toMatch(/secret|hunter2|tester|dev:/);
  });
});

describe('testDatabaseUrls', () => {
  const env: NodeJS.ProcessEnv = {
    DATABASE_URL: 'postgres://admin:admin-pw@localhost:5432/earlstock',
    TEST_DATABASE_URL: 'postgres://admin:admin-pw@localhost:5432/earlstock_test',
    MIGRATION_DATABASE_URL: 'postgres://owner_role:owner-pw@localhost:5432/earlstock',
    MARKET_DATA_DATABASE_URL: 'postgres://api_role:api-pw@localhost:5432/earlstock',
    IMPORTER_DATABASE_URL: 'postgres://importer_role:importer-pw@localhost:5432/earlstock',
  };

  const errorOf = (overrides: NodeJS.ProcessEnv): Error => {
    try {
      testDatabaseUrls({ ...env, ...overrides });
    } catch (err) {
      return err as Error;
    }
    throw new Error('expected a refusal');
  };

  it('returns null when TEST_DATABASE_URL is unset (database tests are skipped)', () => {
    expect(testDatabaseUrls({ ...env, TEST_DATABASE_URL: undefined })).toBeNull();
  });

  it('retargets the role credentials at the test database (single source of credentials)', () => {
    const urls = testDatabaseUrls(env);

    expect(urls?.migration).toBe('postgres://owner_role:owner-pw@localhost:5432/earlstock_test');
    expect(urls?.api).toBe('postgres://api_role:api-pw@localhost:5432/earlstock_test');
    expect(urls?.importer).toBe(
      'postgres://importer_role:importer-pw@localhost:5432/earlstock_test',
    );
    expect(urls?.lifecycle).toBe(env['TEST_DATABASE_URL']);
    expect(urls?.target.database).toBe('earlstock_test');
  });

  it.each(['MIGRATION_DATABASE_URL', 'MARKET_DATA_DATABASE_URL', 'IMPORTER_DATABASE_URL'])(
    'fails closed when %s is missing, instead of using the administrative role',
    (variable) => {
      expect(errorOf({ [variable]: undefined }).message).toMatch(/are required too/);
    },
  );

  it('refuses when the API role is the migration role', () => {
    expect(
      errorOf({ MARKET_DATA_DATABASE_URL: 'postgres://owner_role:x@localhost:5432/earlstock' })
        .message,
    ).toMatch(/distinct from the migration and administrative roles/);
  });

  it('refuses when the API role is the administrative role', () => {
    expect(
      errorOf({ MARKET_DATA_DATABASE_URL: 'postgres://admin:x@localhost:5432/earlstock' }).message,
    ).toMatch(/distinct from the migration and administrative roles/);
  });

  it.each([
    ['API', 'postgres://api_role:x@localhost:5432/earlstock'],
    ['migration', 'postgres://owner_role:x@localhost:5432/earlstock'],
    ['administrative', 'postgres://admin:x@localhost:5432/earlstock'],
  ])('refuses when the importer role is the %s role', (_name, url) => {
    expect(errorOf({ IMPORTER_DATABASE_URL: url }).message).toMatch(
      /IMPORTER_DATABASE_URL must use a role distinct/,
    );
  });

  it('refuses when the migration role is the administrative role', () => {
    expect(
      errorOf({ MIGRATION_DATABASE_URL: 'postgres://admin:x@localhost:5432/earlstock' }).message,
    ).toMatch(/MIGRATION_DATABASE_URL must use a role distinct/);
  });

  it.each(['MIGRATION_DATABASE_URL', 'MARKET_DATA_DATABASE_URL', 'IMPORTER_DATABASE_URL'])(
    'refuses when %s uses the test database name itself',
    (variable) => {
      expect(
        errorOf({ [variable]: 'postgres://other_role:x@localhost:5432/earlstock_test' }).message,
      ).toMatch(/same name/);
    },
  );

  it('fails closed on an unparseable role URL', () => {
    expect(errorOf({ MARKET_DATA_DATABASE_URL: 'not a url' }).message).toMatch(/not a valid URL/);
  });

  it('never includes credentials in its errors', () => {
    const messages = [
      errorOf({ MIGRATION_DATABASE_URL: undefined }),
      errorOf({
        MARKET_DATA_DATABASE_URL: 'postgres://owner_role:owner-pw@localhost:5432/earlstock',
      }),
      errorOf({ MIGRATION_DATABASE_URL: 'postgres://admin:admin-pw@localhost:5432/earlstock' }),
      errorOf({ IMPORTER_DATABASE_URL: 'postgres://api_role:api-pw@localhost:5432/earlstock' }),
    ].map((error) => error.message);

    for (const message of messages) {
      expect(message).not.toMatch(/-pw|owner_role|api_role|importer_role|admin:/);
    }
  });
});
