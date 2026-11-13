import { z } from 'zod';

/** Ticker-style codes are case-insensitive: normalize to upper case so the UNIQUE constraint holds. */
const code = (maxLength: number) =>
  z
    .string()
    .trim()
    .toUpperCase()
    // `abort` stops later checks, so a blank value reports one issue rather than also failing the regex.
    .min(1, { abort: true })
    .max(maxLength)
    .regex(/^[A-Z0-9.-]+$/, 'may only contain letters, digits, "." and "-"');

export const createStockSchema = z.strictObject({
  symbol: code(16),
  name: z.string().trim().min(1).max(255),
  exchange: code(32),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'must be a 3-letter ISO 4217 code'),
});

export type CreateStockInput = z.output<typeof createStockSchema>;

export const stockIdParamsSchema = z.object({ id: z.uuid() });
