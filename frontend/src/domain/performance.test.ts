import { describe, expect, it } from 'vitest';
import {
  annualizedVolatility,
  cumulativeReturn,
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

describe('annualizedVolatility', () => {
  it('is the sample SD of daily returns × √252 × 100', () => {
    // Returns +10% and −10%: mean 0, sample variance 0.02, so volatility = √(0.02 × 252) × 100.
    expect(annualizedVolatility([100, 110, 99])).toBeCloseTo(
      Math.sqrt(0.02 * TRADING_DAYS_PER_YEAR) * 100,
      9,
    );
  });

  it('is zero for constant returns and for a flat series', () => {
    expect(annualizedVolatility([100, 110, 121])).toBeCloseTo(0, 9);
    expect(annualizedVolatility([50, 50, 50, 50])).toBe(0);
  });

  it('needs at least three observations (two returns)', () => {
    expect(annualizedVolatility([100, 110])).toBeNull();
    expect(annualizedVolatility([100])).toBeNull();
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
