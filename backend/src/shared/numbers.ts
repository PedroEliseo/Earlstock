import type { IntegerString } from './types.js';

/**
 * Converts a stored integer (e.g. BIGINT volume, kept as a string) to a JSON-safe number at the API
 * boundary. Throws instead of silently losing precision; the database constrains volume so that
 * this cannot happen for valid data.
 */
export function toSafeInteger(value: IntegerString): number {
  if (!/^-?\d+$/.test(value)) throw new Error('not an integer string');
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('integer exceeds the safe JSON number range');
  return number;
}
