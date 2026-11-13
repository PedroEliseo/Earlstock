import { z } from 'zod';

/**
 * Database settings, validated as part of the application environment (see env.ts).
 * The backend connects ONLY with MARKET_DATA_DATABASE_URL, a read-only role. It deliberately has no
 * fallback to DATABASE_URL (the administrative superuser connection), so a missing value fails
 * startup instead of silently running with elevated privileges.
 */
export const databaseEnvSchema = z.object({
  MARKET_DATA_DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: 'must be a postgres:// URL for the read-only API role',
  }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
