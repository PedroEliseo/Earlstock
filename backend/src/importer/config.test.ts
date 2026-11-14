import { loadImporterConfig } from './config.js';

describe('loadImporterConfig', () => {
  const importer = 'postgres://earlstock_importer:importer-pw@localhost:5432/earlstock';

  it('uses IMPORTER_DATABASE_URL and nothing else', () => {
    expect(
      loadImporterConfig({
        IMPORTER_DATABASE_URL: importer,
        MARKET_DATA_DATABASE_URL: 'postgres://earlstock_api:x@localhost:5432/earlstock',
      }),
    ).toEqual({ databaseUrl: importer });
  });

  it('fails closed without IMPORTER_DATABASE_URL, never falling back to another URL', () => {
    expect(() =>
      loadImporterConfig({
        MIGRATION_DATABASE_URL: 'postgres://earlstock_owner:x@localhost:5432/earlstock',
        DATABASE_URL: 'postgres://admin:x@localhost:5432/earlstock',
      }),
    ).toThrow(/IMPORTER_DATABASE_URL/);
  });

  it.each(['MARKET_DATA_DATABASE_URL', 'MIGRATION_DATABASE_URL', 'DATABASE_URL'])(
    'refuses to reuse the role of %s',
    (variable) => {
      const error = (() => {
        try {
          loadImporterConfig({
            IMPORTER_DATABASE_URL: importer,
            [variable]: 'postgres://earlstock_importer:other@localhost:5432/earlstock',
          });
        } catch (err) {
          return err as Error;
        }
        throw new Error('expected a refusal');
      })();
      expect(error.message).toBe(`IMPORTER_DATABASE_URL must not use the same role as ${variable}`);
      expect(error.message).not.toMatch(/importer-pw|other/);
    },
  );

  it('rejects a non-postgres URL', () => {
    expect(() => loadImporterConfig({ IMPORTER_DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(
      /postgres:\/\/ URL/,
    );
  });
});
