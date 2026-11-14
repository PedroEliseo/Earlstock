/**
 * Display formatting for exact values. Prices arrive as decimal strings and are formatted as
 * strings: digits are grouped and padded, never rounded, so what is displayed is exactly what is
 * stored. (Chart coordinates are a separate, approximate representation; see chart/chartData.ts.)
 */

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

interface Separators {
  group: string;
  decimal: string;
}

const separatorCache = new Map<string, Separators>();

/** The locale's grouping and decimal symbols (taken from Intl, so the output matches the locale). */
function separators(locale: string | undefined): Separators {
  const key = locale ?? '';
  const cached = separatorCache.get(key);
  if (cached) return cached;
  const formatted = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const result = {
    group: formatted.find((part) => part.type === 'group')?.value ?? ',',
    decimal: formatted.find((part) => part.type === 'decimal')?.value ?? '.',
  };
  separatorCache.set(key, result);
  return result;
}

/**
 * Formats a non-negative decimal string exactly: thousands grouping and at least
 * `minFractionDigits` decimals (padding with zeros). Extra decimals are kept, never rounded.
 */
export function formatDecimal(
  value: string,
  { minFractionDigits = 2, locale }: { minFractionDigits?: number; locale?: string } = {},
): string {
  const match = DECIMAL.exec(value);
  if (!match) throw new Error('not a plain decimal string');
  const [, integer = '0', fraction = ''] = match;
  const { group, decimal } = separators(locale);
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const digits = fraction.padEnd(minFractionDigits, '0');
  return digits ? `${grouped}${decimal}${digits}` : grouped;
}

/** Formats a safe integer (e.g. volume) with grouping. Exact for every safe integer. */
export function formatInteger(value: number, locale?: string): string {
  if (!Number.isSafeInteger(value)) throw new Error('not a safe integer');
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** Number of decimal places written in a decimal string ("12.50" -> 2). */
export function decimalPlaces(value: string): number {
  const dot = value.indexOf('.');
  return dot < 0 ? 0 : value.length - dot - 1;
}
