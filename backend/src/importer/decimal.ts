/**
 * Exact decimal handling for the importer. Values are never converted to JavaScript numbers: the
 * original text is what gets stored, and comparisons use BigInt fixed-point integers.
 *
 * The target column type is NUMERIC(18,6): at most 12 integer digits and 6 decimal places.
 * PostgreSQL silently ROUNDS extra decimal places when storing into NUMERIC(18,6), so the
 * importer rejects them here instead of letting the database change a value.
 */
export const PRICE_SCALE = 6;
const PRICE_INTEGER_DIGITS = 12;
/** Largest volume accepted: 2^53 - 1, as enforced by the daily_prices_volume CHECK. */
export const MAX_VOLUME = 9_007_199_254_740_991n;

const PRICE_PATTERN = new RegExp(
  `^(0|[1-9]\\d{0,${String(PRICE_INTEGER_DIGITS - 1)}})(?:\\.(\\d{1,${String(PRICE_SCALE)}}))?$`,
);
const TOO_MANY_DECIMALS = new RegExp(`^\\d+\\.\\d{${String(PRICE_SCALE + 1)},}$`);
const VOLUME_PATTERN = /^(0|[1-9]\d*)$/;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Parses a non-negative plain decimal ("12", "12.5", "0.000001") into a fixed-point integer scaled
 * by 10^6. No sign, exponent, grouping, leading zeros or surrounding text is accepted.
 */
export function parsePrice(text: string): ParseResult<bigint> {
  const match = PRICE_PATTERN.exec(text);
  if (!match) {
    if (TOO_MANY_DECIMALS.test(text)) {
      return {
        ok: false,
        reason: `has more than ${String(PRICE_SCALE)} decimal places (NUMERIC(18,6) would round it)`,
      };
    }
    return {
      ok: false,
      reason: `is not a plain decimal number (digits with an optional fraction of 1-${String(PRICE_SCALE)} digits, at most ${String(PRICE_INTEGER_DIGITS)} integer digits, no sign or exponent)`,
    };
  }
  const [, integer = '', fraction = ''] = match;
  return { ok: true, value: BigInt(integer + fraction.padEnd(PRICE_SCALE, '0')) };
}

/** Parses a non-negative integer volume within [0, 2^53 - 1]. */
export function parseVolume(text: string): ParseResult<bigint> {
  if (!VOLUME_PATTERN.test(text)) {
    return {
      ok: false,
      reason: 'is not a non-negative integer (digits only, no sign or fraction)',
    };
  }
  const value = BigInt(text);
  if (value > MAX_VOLUME) {
    return { ok: false, reason: 'exceeds the maximum volume of 2^53 - 1' };
  }
  return { ok: true, value };
}
