import { z } from 'zod';

/**
 * Importer configuration. The importer connects ONLY with IMPORTER_DATABASE_URL (the
 * earlstock_importer role) and never falls back to another URL. The other role URLs are read only
 * to refuse a configuration that reuses one of their roles.
 */
const importerEnvSchema = z.object({
  IMPORTER_DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: 'must be a postgres:// URL for the importer role',
  }),
});

export interface ImporterConfig {
  databaseUrl: string;
}

const OTHER_ROLE_URLS = ['MARKET_DATA_DATABASE_URL', 'MIGRATION_DATABASE_URL', 'DATABASE_URL'];

export function loadImporterConfig(env: NodeJS.ProcessEnv = process.env): ImporterConfig {
  const result = importerEnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid importer configuration:\n${z.prettifyError(result.error)}`);
  }
  const databaseUrl = result.data.IMPORTER_DATABASE_URL;
  const role = userOf(databaseUrl);
  if (!role) throw new Error('IMPORTER_DATABASE_URL must name its role');
  for (const variable of OTHER_ROLE_URLS) {
    const other = env[variable];
    if (other && userOf(other) === role) {
      throw new Error(`IMPORTER_DATABASE_URL must not use the same role as ${variable}`);
    }
  }
  return { databaseUrl };
}

function userOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).username);
  } catch {
    return '';
  }
}
