import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';

/**
 * Decimal amounts are accepted only as JSON strings: a JSON number is parsed into a binary double
 * before validation runs, which would silently alter values with more than ~15 significant digits.
 * The digit limits mirror the column types, so PostgreSQL never has to round or reject a value.
 */
const decimalString = (integerDigits: number) =>
  z
    .string({ error: 'must be a decimal string, e.g. "189.25"' })
    .trim()
    .regex(new RegExp(`^(0|[1-9]\\d{0,${String(integerDigits - 1)}})(\\.\\d{1,8})?$`), {
      error: `must be a non-negative decimal string with at most ${String(integerDigits)} integer digits and 8 decimal places`,
      abort: true,
    });

/**
 * ISO 8601 with an explicit offset (`Z` or `+01:00`), so instants are never ambiguous.
 * Limited to millisecond precision: PostgreSQL would store microseconds, but node-postgres returns
 * TIMESTAMPTZ as a JS Date (milliseconds), so finer input would not round-trip.
 */
const timestamp = z.iso
  .datetime({ offset: true, error: 'must be an ISO 8601 date-time with a time zone offset' })
  .refine((value) => !/\.\d{4,}/.test(value), 'must have at most millisecond precision');

export const createQuoteSchema = z.strictObject({
  price: decimalString(12).refine((value) => /[1-9]/.test(value), 'must be greater than 0'), // NUMERIC(20,8)
  volume: decimalString(16) // NUMERIC(24,8)
    .nullish()
    .transform((value) => value ?? null),
  observedAt: timestamp,
  provider: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { abort: true })
    .max(32)
    .regex(/^[a-z0-9._-]+$/, 'may only contain letters, digits, ".", "_" and "-"'),
});

export type CreateQuoteInput = z.output<typeof createQuoteSchema>;

export const stockIdParamsSchema = z.object({ stockId: z.uuid() });

/** `from` is inclusive and `to` exclusive: [from, to). Either bound may be omitted. */
export const quoteHistoryQuerySchema = paginationQuerySchema
  .extend({ from: timestamp.optional(), to: timestamp.optional() })
  .refine((query) => !query.from || !query.to || Date.parse(query.from) < Date.parse(query.to), {
    path: ['to'],
    error: 'must be later than "from"',
  });

export type QuoteHistoryQuery = z.output<typeof quoteHistoryQuerySchema>;
