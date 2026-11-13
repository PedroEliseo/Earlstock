import { z } from 'zod';
import { databaseEnvSchema } from './database.js';

/**
 * Single source of truth for runtime configuration.
 * Values are read from process.env once, validated, and exposed as a typed,
 * immutable object. The process fails fast at startup if anything is invalid.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  ...databaseEnvSchema.shape,
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return Object.freeze(result.data);
}
