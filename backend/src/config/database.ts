import { z } from 'zod';

/** Database settings, validated as part of the application environment (see env.ts). */
export const databaseEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
