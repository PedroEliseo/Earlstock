import { z } from 'zod';

export const syncRequestSchema = z.strictObject({
  /** latest: one current (delayed) quote per stock. daily: daily closes for the last `days` days. */
  mode: z.enum(['latest', 'daily']).default('latest'),
  /** Only used by `daily`. EODHD's free plan covers one year of history. */
  days: z.number().int().min(1).max(365).default(30),
});

export type SyncRequest = z.output<typeof syncRequestSchema>;
