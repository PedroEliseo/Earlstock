import { MAX_VOLUME, parsePrice, parseVolume } from './decimal.js';

describe('parsePrice', () => {
  it.each([
    ['0', 0n],
    ['7', 7_000_000n],
    ['12.5', 12_500_000n],
    ['8543', 8_543_000_000n],
    ['6.8348', 6_834_800n],
    ['0.000001', 1n],
    ['999999999999.999999', 999_999_999_999_999_999n],
  ])('parses %s exactly as a fixed-point integer scaled by 10^6', (text, scaled) => {
    expect(parsePrice(text)).toEqual({ ok: true, value: scaled });
  });

  it('keeps precision a JavaScript number would lose', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; the fixed-point values compare exactly.
    const a = parsePrice('0.1');
    const b = parsePrice('0.2');
    const c = parsePrice('0.3');
    expect(a.ok && b.ok && c.ok && a.value + b.value === c.value).toBe(true);
    expect(parsePrice('123456789012.123456')).toEqual({ ok: true, value: 123456789012123456n });
  });

  it('rejects a 7th decimal place instead of rounding it', () => {
    const result = parsePrice('1.1234567');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/more than 6 decimal places/);
  });

  it.each([
    '',
    ' 1',
    '1 ',
    '-1',
    '+1',
    '1e3',
    '1E3',
    '01',
    '00.5',
    '.5',
    '5.',
    '1,000',
    '1_000',
    'NaN',
    'Infinity',
    '0x10',
    '１２', // full-width digits
    '1234567890123', // 13 integer digits: beyond NUMERIC(18,6)
  ])('rejects %j', (text) => {
    expect(parsePrice(text).ok).toBe(false);
  });
});

describe('parseVolume', () => {
  it.each([
    ['0', 0n],
    ['6500', 6500n],
    ['818830900', 818830900n],
    ['9007199254740991', MAX_VOLUME],
  ])('parses %s', (text, value) => {
    expect(parseVolume(text)).toEqual({ ok: true, value });
  });

  it('rejects 2^53 and above (the database and JSON limit)', () => {
    expect(parseVolume('9007199254740992')).toEqual({
      ok: false,
      reason: 'exceeds the maximum volume of 2^53 - 1',
    });
    expect(parseVolume('9223372036854775808').ok).toBe(false); // beyond BIGINT too
  });

  it.each(['', '-1', '+1', '1.0', '1.5', '1e6', '01', ' 1', '1,000'])('rejects %j', (text) => {
    expect(parseVolume(text).ok).toBe(false);
  });
});
