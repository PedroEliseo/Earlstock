import { describe, expect, it } from 'vitest';
import { daysAgo } from '../test/fixtures';
import { addDays } from './dates';
import {
  annualizedDailyVolatility,
  cumulativeReturn,
  dailyReturns,
  MAX_SESSION_GAP_DAYS,
  MIN_DAILY_RETURNS,
  sessionCalendar,
  maxDrawdown,
  sampleStandardDeviation,
  simpleReturns,
  TRADING_DAYS_PER_YEAR,
} from './performance';

describe('cumulativeReturn', () => {
  it('is (last / first − 1) × 100', () => {
    expect(cumulativeReturn([100, 50, 120])).toBeCloseTo(20, 12);
    expect(cumulativeReturn([80, 60])).toBeCloseTo(-25, 12);
    expect(cumulativeReturn([50, 50, 50])).toBe(0);
  });

  it('needs two observations', () => {
    expect(cumulativeReturn([100])).toBeNull();
    expect(cumulativeReturn([])).toBeNull();
  });
});

describe('returns and sample standard deviation', () => {
  it('computes simple returns between consecutive observations', () => {
    const returns = simpleReturns([100, 110, 99]);
    expect(returns[0]).toBeCloseTo(0.1, 14);
    expect(returns[1]).toBeCloseTo(-0.1, 14);
  });

  it('uses the n − 1 denominator', () => {
    // Values 2, 4, 4, 4, 5, 5, 7, 9: population SD 2, sample SD sqrt(32 / 7).
    expect(sampleStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(sampleStandardDeviation([1])).toBeNull();
  });
});

describe('daily returns between consecutive sessions', () => {
  const start = daysAgo(200);
  /** n consecutive calendar days from `start` (every day a session, for simplicity). */
  const days = (n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));
  const obs = (dates: string[], values: number[]) =>
    dates.map((date, i) => ({ date, value: values[i] ?? Number.NaN }));

  it('builds the session reference from every series, sorted and distinct', () => {
    const [a, b, c] = days(3) as [string, string, string];
    expect(
      sessionCalendar([
        [c, a],
        [b, a],
      ]),
    ).toEqual([a, b, c]);
  });

  it('uses every interval between consecutive sessions', () => {
    const dates = days(4);
    const { returns, excludedIntervals } = dailyReturns(obs(dates, [100, 110, 99, 99]), dates);
    expect(returns.map((r) => Number(r.toFixed(12)))).toEqual([0.1, -0.1, 0]);
    expect(excludedIntervals).toBe(0);
  });

  it('excludes a return spanning a session the stock is missing (another stock traded then)', () => {
    const calendar = days(4); // sessions d0, d1, d2, d3
    const [d0, d1, d2, d3] = calendar as [string, string, string, string];
    // This stock has no bar on d2: its d1 -> d3 change covers two sessions, so it is not daily.
    const result = dailyReturns(obs([d0, d1, d3], [100, 110, 200]), calendar);
    expect(result.returns).toHaveLength(1);
    expect(result.returns[0]).toBeCloseTo(0.1, 12);
    expect(result.excludedIntervals).toBe(1);
    expect(d2 < d3).toBe(true);
  });

  it('accepts a weekend-like gap but excludes one longer than the session gap limit', () => {
    const d0 = start;
    const weekend = addDays(d0, 3); // e.g. Friday -> Monday
    const tooFar = addDays(weekend, MAX_SESSION_GAP_DAYS + 1); // sessions missing for everyone
    const calendar = [d0, weekend, tooFar];
    const result = dailyReturns(obs(calendar, [100, 101, 150]), calendar);
    expect(result.returns).toHaveLength(1);
    expect(result.excludedIntervals).toBe(1);
  });

  it('rejects observations outside the calendar or out of order', () => {
    const calendar = days(3);
    expect(() => dailyReturns(obs([addDays(start, 10), start], [1, 1]), calendar)).toThrow(
      RangeError,
    );
    const [a, b] = calendar as [string, string];
    expect(() => dailyReturns(obs([b, a], [1, 1]), calendar)).toThrow(RangeError);
  });
});

describe('annualizedDailyVolatility', () => {
  const start = daysAgo(200);
  const days = (n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));
  /** Prices alternating +10% and −10%: daily returns of exactly ±0.1. */
  const alternating = (n: number) => {
    const values = [100];
    for (let i = 1; i < n; i += 1) values.push((values[i - 1] ?? 0) * (i % 2 === 1 ? 1.1 : 0.9));
    return values;
  };

  it('is the sample SD of daily returns × √252 × 100', () => {
    const dates = days(MIN_DAILY_RETURNS + 1); // exactly MIN_DAILY_RETURNS returns: 10 × +0.1, 10 × −0.1
    const values = alternating(dates.length);
    const result = annualizedDailyVolatility(
      dates.map((date, i) => ({ date, value: values[i] ?? 0 })),
      dates,
    );
    // Mean 0, sample variance = 20 × 0.01 / 19.
    const expected =
      Math.sqrt(((MIN_DAILY_RETURNS * 0.01) / (MIN_DAILY_RETURNS - 1)) * TRADING_DAYS_PER_YEAR) *
      100;
    expect(result.value).toBeCloseTo(expected, 9);
    expect(result).toMatchObject({ dailyReturns: MIN_DAILY_RETURNS, excludedIntervals: 0 });
  });

  it('is zero for a flat series', () => {
    const dates = days(MIN_DAILY_RETURNS + 5);
    const result = annualizedDailyVolatility(
      dates.map((date) => ({ date, value: 50 })),
      dates,
    );
    expect(result.value).toBe(0);
  });

  it('leaves multi-session jumps out instead of scaling them as daily moves', () => {
    const calendar = days(MIN_DAILY_RETURNS + 10);
    // Flat prices, except a +50% move across a session this stock is missing.
    const missing = calendar[10] ?? '';
    const observations = calendar
      .filter((date) => date !== missing)
      .map((date) => ({ date, value: date > missing ? 150 : 100 }));
    const result = annualizedDailyVolatility(observations, calendar);
    expect(result.excludedIntervals).toBe(1);
    expect(result.value).toBe(0);
  });

  it('is unavailable with too few daily returns, still reporting the counts', () => {
    const dates = days(MIN_DAILY_RETURNS); // one return short
    const result = annualizedDailyVolatility(
      dates.map((date, i) => ({ date, value: 100 + i })),
      dates,
    );
    expect(result).toEqual({
      value: null,
      dailyReturns: MIN_DAILY_RETURNS - 1,
      excludedIntervals: 0,
    });
  });

  it('is unavailable when gaps leave too few daily returns', () => {
    // Every other session missing: no interval between this stock's observations is daily.
    const calendar = days(2 * MIN_DAILY_RETURNS + 2);
    const observations = calendar
      .filter((_, i) => i % 2 === 0)
      .map((date) => ({ date, value: 100 }));
    const result = annualizedDailyVolatility(observations, calendar);
    expect(result.value).toBeNull();
    expect(result.dailyReturns).toBe(0);
    expect(result.excludedIntervals).toBe(observations.length - 1);
  });
});

describe('maxDrawdown', () => {
  it('is the deepest fall from a running peak, as a negative percentage', () => {
    // Peaks 120 then 130: falls of 25% (120 → 90) and 10% (130 → 117). The deepest counts.
    expect(maxDrawdown([100, 120, 90, 130, 117])).toBeCloseTo(-25, 12);
  });

  it('includes the baseline as a peak', () => {
    expect(maxDrawdown([100, 80, 90])).toBeCloseTo(-20, 12);
  });

  it('is zero, never negative zero, when prices never fall below a peak', () => {
    expect(Object.is(maxDrawdown([10, 11, 12]), 0)).toBe(true);
    expect(Object.is(maxDrawdown([5, 5, 5]), 0)).toBe(true);
  });

  it('is not the largest daily loss', () => {
    // Daily losses of 10% each compound to a 19% drawdown.
    expect(maxDrawdown([100, 90, 81])).toBeCloseTo(-19, 12);
  });

  it('needs two observations', () => {
    expect(maxDrawdown([100])).toBeNull();
  });
});
