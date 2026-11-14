import { describe, expect, it } from 'vitest';
import { decimalPlaces, formatDecimal, formatInteger } from './decimal';

describe('formatDecimal', () => {
  it.each([
    ['8543', '8,543.00'],
    ['12.5', '12.50'],
    ['6.8348', '6.8348'],
    ['1234567.123456', '1,234,567.123456'],
    ['0.000001', '0.000001'],
    ['999999999999.999999', '999,999,999,999.999999'],
  ])('formats %s exactly as %s (en-US)', (value, formatted) => {
    expect(formatDecimal(value, { locale: 'en-US' })).toBe(formatted);
  });

  it('never rounds, unlike floating point', () => {
    // As a JavaScript number this would print as 0.30000000000000004 or round to 0.3.
    expect(formatDecimal('0.300000', { locale: 'en-US' })).toBe('0.300000');
    expect(formatDecimal('123456789012.123456', { locale: 'en-US' })).toBe(
      '123,456,789,012.123456',
    );
  });

  it('uses the locale’s separators', () => {
    expect(formatDecimal('1234.5', { locale: 'de-DE' })).toBe('1.234,50');
  });

  it('respects a different minimum of decimals', () => {
    expect(formatDecimal('7', { minFractionDigits: 0, locale: 'en-US' })).toBe('7');
  });

  it.each(['-1', '1e3', '', 'abc'])('rejects %j', (value) => {
    expect(() => formatDecimal(value)).toThrow();
  });
});

describe('formatInteger and decimalPlaces', () => {
  it('formats safe integers exactly', () => {
    expect(formatInteger(9007199254740991, 'en-US')).toBe('9,007,199,254,740,991');
    expect(() => formatInteger(1.5)).toThrow();
  });

  it('counts written decimals', () => {
    expect(decimalPlaces('12')).toBe(0);
    expect(decimalPlaces('12.50')).toBe(2);
  });
});
