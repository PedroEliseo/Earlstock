import { describe, expect, it } from 'vitest';
import type { Bar } from '../../api/schemas';
import { daysAgo } from '../../test/fixtures';
import { buildComparisonModel } from './comparisonModel';

const bar = (n: number, close: string, adjClose = close): Bar => ({
  date: daysAgo(100 - n),
  open: close,
  high: close,
  low: close,
  close,
  adjClose,
  volume: 1,
});

describe('buildComparisonModel', () => {
  const stocks = [
    { ticker: 'AAA', bars: [bar(1, '100'), bar(2, '120'), bar(3, '90'), bar(4, '110')] },
    {
      ticker: 'BBB',
      bars: [bar(2, '50', '40'), bar(3, '55', '44'), bar(4, '60', '48'), bar(5, '70')],
    },
  ];

  it('derives chart values, metrics and table values from the same common observations', () => {
    const model = buildComparisonModel(stocks, 'close');
    expect(model.dates).toEqual([daysAgo(98), daysAgo(97), daysAgo(96)]);
    const [aaa, bbb] = model.stocks;
    expect(aaa?.prices).toEqual(['120', '90', '110']);
    expect(aaa?.normalized).toEqual([100, 75, (110 / 120) * 100]);
    expect(aaa?.cumulativeReturn).toBeCloseTo((110 / 120 - 1) * 100, 12);
    expect(aaa?.maxDrawdown).toBeCloseTo(-25, 12);
    expect(bbb?.normalized[0]).toBe(100);
    expect(bbb?.cumulativeReturn).toBeCloseTo(20, 12);
    expect(model.stocks.every((s) => s.normalized.length === model.dates.length)).toBe(true);
  });

  it('uses one basis for all stocks', () => {
    const model = buildComparisonModel(stocks, 'adjClose');
    expect(model.basis).toBe('adjClose');
    expect(model.stocks[1]?.prices).toEqual(['40', '44', '48']);
  });

  it('reports metrics needing more observations as unavailable', () => {
    const one = buildComparisonModel(
      [
        { ticker: 'A', bars: [bar(1, '10'), bar(2, '11')] },
        { ticker: 'B', bars: [bar(2, '20')] },
      ],
      'close',
    );
    expect(one.dates).toHaveLength(1);
    expect(one.stocks[0]).toMatchObject({
      normalized: [100],
      cumulativeReturn: null,
      volatility: null,
      maxDrawdown: null,
    });
  });
});
