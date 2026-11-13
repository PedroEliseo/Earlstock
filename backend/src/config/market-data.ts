import { z } from 'zod';

/** Market data settings, validated as part of the application environment (see env.ts). */
export const marketDataEnvSchema = z.object({
  MARKET_DATA_PROVIDER: z.enum(['demo', 'eodhd']).default('demo'),
  // Empty or whitespace-only values count as "not set".
  EODHD_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
  EODHD_DAILY_CALL_BUDGET: z.coerce.number().int().min(0).max(1_000_000).default(15),
});

export type MarketDataEnv = z.infer<typeof marketDataEnvSchema>;

/** Cross-field rule: EODHD cannot run without a key. Applied to the full env schema. */
export function hasRequiredProviderCredentials(env: MarketDataEnv): boolean {
  return env.MARKET_DATA_PROVIDER !== 'eodhd' || env.EODHD_API_KEY !== undefined;
}
