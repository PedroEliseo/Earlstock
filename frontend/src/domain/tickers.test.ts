import { describe, expect, it } from 'vitest';
import { isTicker, parseTickerList } from './tickers';

describe('isTicker', () => {
  it.each(['A', 'BRK.B', 'BF.B', 'BRK-B', '^GSPC', 'EURUSD=X', 'X'.repeat(32)])(
    'accepts %s',
    (t) => {
      expect(isTicker(t)).toBe(true);
    },
  );
  it.each(['', 'aapl', 'BRK/B', 'BRK..B', ' A', 'X'.repeat(33), 'A,B'])('rejects %j', (t) => {
    expect(isTicker(t)).toBe(false);
  });
});

describe('parseTickerList', () => {
  it('trims and upper-cases, keeping order', () => {
    expect(parseTickerList(' aapl , msft,brk.b', 5).tickers).toEqual(['AAPL', 'MSFT', 'BRK.B']);
  });

  it('keeps the first of duplicates and reports the rest, deterministically', () => {
    expect(parseTickerList('AAA,BBB,aaa,AAA', 5)).toEqual({
      tickers: ['AAA', 'BBB'],
      invalid: [],
      duplicates: ['AAA', 'AAA'],
      overflow: [],
    });
  });

  it('drops invalid entries and those beyond the maximum, reporting both', () => {
    expect(parseTickerList('A,B!,C,D,E,F,G', 5)).toEqual({
      tickers: ['A', 'C', 'D', 'E', 'F'],
      invalid: ['B!'],
      duplicates: [],
      overflow: ['G'],
    });
  });

  it('handles a missing or empty parameter', () => {
    expect(parseTickerList(null, 5).tickers).toEqual([]);
    expect(parseTickerList(',, ,', 5).tickers).toEqual([]);
  });
});
