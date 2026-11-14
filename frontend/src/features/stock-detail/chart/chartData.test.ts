import { describe, expect, it } from 'vitest';
import { makeBars } from '../../../test/fixtures';
import { drawnFields, pricePrecision, toCandles, toLine, toVolume } from './chartData';

const bars = makeBars(3);
const [firstBar] = makeBars(1);
if (!firstBar) throw new Error('fixture');

describe('chart data', () => {
  it('builds candles from open, high, low and close only (never adjusted close)', () => {
    const candles = toCandles(bars);
    expect(candles[0]).toEqual({
      time: bars[0]?.date,
      open: Number(bars[0]?.open),
      high: Number(bars[0]?.high),
      low: Number(bars[0]?.low),
      close: Number(bars[0]?.close),
    });
    expect(candles.some((c, i) => c.close === Number(bars[i]?.adjClose))).toBe(false);
  });

  it('draws the close as the line value', () => {
    expect(toLine(bars).map((p) => p.value)).toEqual(bars.map((b) => Number(b.close)));
    // The line always shows the close, never the adjusted close.
    expect(toLine(bars).some((p, i) => p.value === Number(bars[i]?.adjClose))).toBe(false);
  });

  it('aligns volume with the price dates', () => {
    expect(toVolume(bars).map((p) => p.time)).toEqual(toCandles(bars).map((c) => c.time));
    expect(toVolume(bars).map((p) => p.value)).toEqual(bars.map((b) => b.volume));
  });

  it('chooses the axis precision from the decimals of the drawn values only (2 to 6)', () => {
    const candles = drawnFields('candles');
    expect(candles).toEqual(['open', 'high', 'low', 'close']);
    expect(pricePrecision(bars, candles)).toBe(2);
    const precise = [{ ...firstBar, adjClose: '1.1234' }];
    expect(pricePrecision(precise, candles)).toBe(2); // adjusted close is not drawn by candles
    expect(pricePrecision(precise, drawnFields('line'))).toBe(2); // the line draws the close only
    expect(pricePrecision([{ ...firstBar, close: '1.12345678' }], ['close'])).toBe(6);
  });
});
