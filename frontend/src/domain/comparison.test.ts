import { describe, expect, it } from 'vitest';
import type { Bar } from '../api/schemas';
import { daysAgo } from '../test/fixtures';
import {
  alignOnCommonDates,
  commonCoverage,
  InvalidPriceError,
  normalizeTo100,
} from './comparison';

const d = (n: number) => daysAgo(100 - n); // d(1) < d(2) < … (chronological)
const bar = (date: string, close: string, adjClose = close): Bar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  adjClose,
  volume: 1,
});

describe('commonCoverage', () => {
  const stocks = [
    { ticker: 'AAA', coverage: { firstDate: d(1), lastDate: d(50) } },
    { ticker: 'BBB', coverage: { firstDate: d(10), lastDate: d(60) } },
    { ticker: 'CCC', coverage: { firstDate: d(5), lastDate: d(40) } },
  ];

  it('is the latest first date to the earliest last date', () => {
    expect(commonCoverage(stocks)).toEqual({ firstDate: d(10), lastDate: d(40) });
  });

  it('is null when the histories do not overlap, or there are no stocks', () => {
    expect(
      commonCoverage([
        { ticker: 'A', coverage: { firstDate: d(1), lastDate: d(5) } },
        { ticker: 'B', coverage: { firstDate: d(6), lastDate: d(9) } },
      ]),
    ).toBeNull();
    expect(commonCoverage([])).toBeNull();
  });
});

describe('alignOnCommonDates', () => {
  const aaa = [bar(d(1), '10'), bar(d(2), '11'), bar(d(3), '12'), bar(d(5), '15')];
  const bbb = [bar(d(5), '50.5'), bar(d(2), '20'), bar(d(3), '30'), bar(d(4), '40')]; // unordered

  it('keeps exactly the dates present for every stock, oldest first', () => {
    const { dates } = alignOnCommonDates(
      [
        { ticker: 'AAA', bars: aaa },
        { ticker: 'BBB', bars: bbb },
      ],
      'close',
    );
    expect(dates).toEqual([d(2), d(3), d(5)]);
  });

  it('takes each stock’s own price on each common date: no filling, no interpolation', () => {
    const { series } = alignOnCommonDates(
      [
        { ticker: 'AAA', bars: aaa },
        { ticker: 'BBB', bars: bbb },
      ],
      'close',
    );
    expect(series).toEqual([
      { ticker: 'AAA', prices: ['11', '12', '15'], values: [11, 12, 15] },
      { ticker: 'BBB', prices: ['20', '30', '50.5'], values: [20, 30, 50.5] },
    ]);
    // d(4) exists only for BBB and d(1) only for AAA: neither appears, and AAA has no value invented for d(4).
  });

  it('uses the same price basis for every stock', () => {
    const { series } = alignOnCommonDates(
      [
        { ticker: 'AAA', bars: [bar(d(1), '10', '9.5')] },
        { ticker: 'BBB', bars: [bar(d(1), '20', '19.25')] },
      ],
      'adjClose',
    );
    expect(series.map((s) => s.prices)).toEqual([['9.5'], ['19.25']]);
  });

  it('returns no dates when nothing is common, and one when one is', () => {
    expect(
      alignOnCommonDates(
        [
          { ticker: 'A', bars: [bar(d(1), '1')] },
          { ticker: 'B', bars: [bar(d(2), '1')] },
        ],
        'close',
      ).dates,
    ).toEqual([]);
    expect(
      alignOnCommonDates(
        [
          { ticker: 'A', bars: [bar(d(1), '1'), bar(d(2), '2')] },
          { ticker: 'B', bars: [bar(d(2), '3')] },
        ],
        'close',
      ).dates,
    ).toEqual([d(2)]);
  });

  it('rejects a non-positive aligned price', () => {
    expect(() =>
      alignOnCommonDates(
        [
          { ticker: 'A', bars: [bar(d(1), '0')] },
          { ticker: 'B', bars: [bar(d(1), '1')] },
        ],
        'close',
      ),
    ).toThrow(InvalidPriceError);
  });
});

describe('normalizeTo100', () => {
  it('starts at exactly 100 and scales by the baseline', () => {
    expect(normalizeTo100([20, 30, 10, 25])).toEqual([100, 150, 50, 125]);
  });

  it('keeps the baseline at exactly 100 even when division would round', () => {
    expect(normalizeTo100([0.1 + 0.2, 0.3])[0]).toBe(100);
  });

  it('refuses a zero or negative baseline (no division by zero)', () => {
    expect(() => normalizeTo100([0, 1])).toThrow(InvalidPriceError);
    expect(() => normalizeTo100([-1, 1])).toThrow(InvalidPriceError);
    expect(normalizeTo100([])).toEqual([]);
  });
});
