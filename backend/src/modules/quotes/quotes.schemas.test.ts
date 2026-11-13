import { createQuoteSchema, quoteHistoryQuerySchema } from './quotes.schemas.js';

const valid = { price: '189.25', observedAt: '2026-01-02T15:30:00Z', provider: 'manual' };

describe('createQuoteSchema', () => {
  it('normalizes provider and defaults volume to null', () => {
    expect(createQuoteSchema.parse({ ...valid, provider: ' Manual ' })).toEqual({
      ...valid,
      volume: null,
    });
  });

  it.each([
    '0.00000001',
    '1',
    '999999999999.99999999', // NUMERIC(20,8) maximum
    '12345678901.12345678', // beyond double precision
  ])('accepts price %s unchanged', (price) => {
    expect(createQuoteSchema.parse({ ...valid, price }).price).toBe(price);
  });

  it.each([
    ['a JSON number', 189.25],
    ['zero', '0'],
    ['zero with decimals', '0.00000000'],
    ['a negative value', '-1'],
    ['more than 8 decimal places', '1.123456789'],
    ['more than 12 integer digits', '1000000000000'],
    ['a leading zero', '0189.25'],
    ['exponent notation', '1e3'],
    ['a trailing dot', '1.'],
    ['an empty string', ''],
  ])('rejects price as %s', (_case, price) => {
    expect(createQuoteSchema.safeParse({ ...valid, price }).success).toBe(false);
  });

  it('accepts a volume of up to 16 integer digits, and zero', () => {
    expect(createQuoteSchema.parse({ ...valid, volume: '9999999999999999.99999999' }).volume).toBe(
      '9999999999999999.99999999',
    );
    expect(createQuoteSchema.parse({ ...valid, volume: '0' }).volume).toBe('0');
  });

  it.each([['-5'], ['10000000000000000'], [1000]])('rejects volume %p', (volume) => {
    expect(createQuoteSchema.safeParse({ ...valid, volume }).success).toBe(false);
  });

  it.each([
    '2026-01-02T15:30:00', // no offset
    '2026-01-02', // date only
    '2026-02-30T10:00:00Z', // impossible date
    '2026-01-02T15:30:00.1234Z', // finer than milliseconds
    'yesterday',
  ])('rejects observedAt %s', (observedAt) => {
    expect(createQuoteSchema.safeParse({ ...valid, observedAt }).success).toBe(false);
  });

  it('accepts observedAt with an offset and millisecond precision', () => {
    const observedAt = '2026-01-02T16:30:00.123+01:00';
    expect(createQuoteSchema.parse({ ...valid, observedAt }).observedAt).toBe(observedAt);
  });

  it.each(['', '   ', 'a'.repeat(33), 'with space', 'émoji'])('rejects provider %p', (provider) => {
    expect(createQuoteSchema.safeParse({ ...valid, provider }).success).toBe(false);
  });
});

describe('quoteHistoryQuerySchema', () => {
  it('applies pagination defaults and leaves bounds open', () => {
    expect(quoteHistoryQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it('requires "from" to be earlier than "to", comparing instants across offsets', () => {
    const from = '2026-01-02T10:00:00Z';
    expect(quoteHistoryQuerySchema.safeParse({ from, to: from }).success).toBe(false);
    expect(
      quoteHistoryQuerySchema.safeParse({ from, to: '2026-01-02T10:30:00+01:00' }).success,
    ).toBe(false);
    expect(
      quoteHistoryQuerySchema.safeParse({ from, to: '2026-01-02T10:00:00.001Z' }).success,
    ).toBe(true);
  });
});
