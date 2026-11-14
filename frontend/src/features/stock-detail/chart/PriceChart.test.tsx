import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBars } from '../../../test/fixtures';
import PriceChart from './PriceChart';

/**
 * lightweight-charts replaced by a recording fake: no canvas, and every call is observable, so the
 * component's resource management (create, update, dispose) can be verified exactly.
 */
const lib = vi.hoisted(() => {
  const state = {
    charts: [] as FakeChart[],
  };
  interface FakeSeries {
    type: string;
    setData: ReturnType<typeof vi.fn>;
    applyOptions: ReturnType<typeof vi.fn>;
    removed: boolean;
  }
  interface FakeChart {
    series: FakeSeries[];
    removed: boolean;
    crosshairHandlers: Set<(param: { time?: string }) => void>;
    resize: ReturnType<typeof vi.fn>;
    fitContent: ReturnType<typeof vi.fn>;
    applyOptions: ReturnType<typeof vi.fn>;
  }
  const createChart = vi.fn(() => {
    const chart: FakeChart = {
      series: [],
      removed: false,
      crosshairHandlers: new Set(),
      resize: vi.fn(),
      fitContent: vi.fn(),
      applyOptions: vi.fn(),
    };
    state.charts.push(chart);
    return {
      addSeries: (definition: { type: string }) => {
        if (chart.removed) throw new Error('chart already removed');
        const series = {
          type: definition.type,
          setData: vi.fn(),
          applyOptions: vi.fn(),
          removed: false,
        };
        chart.series.push(series);
        return series;
      },
      removeSeries: (series: FakeSeries) => {
        if (chart.removed) throw new Error('chart already removed');
        series.removed = true;
      },
      remove: () => {
        if (chart.removed) throw new Error('chart removed twice');
        chart.removed = true;
      },
      priceScale: () => ({ applyOptions: vi.fn() }),
      timeScale: () => ({ fitContent: chart.fitContent }),
      applyOptions: chart.applyOptions,
      resize: chart.resize,
      subscribeCrosshairMove: (handler: (param: { time?: string }) => void) =>
        chart.crosshairHandlers.add(handler),
      unsubscribeCrosshairMove: (handler: (param: { time?: string }) => void) =>
        chart.crosshairHandlers.delete(handler),
    };
  });
  return { state, createChart };
});

vi.mock('lightweight-charts', () => ({
  createChart: lib.createChart,
  CandlestickSeries: { type: 'Candlestick' },
  LineSeries: { type: 'Line' },
  HistogramSeries: { type: 'Histogram' },
  ColorType: { Solid: 'solid' },
}));

/** ResizeObserver fake that records observers and lets tests trigger a resize. */
const observers: { callback: ResizeObserverCallback; disconnected: boolean }[] = [];
class FakeResizeObserver {
  private readonly entry: { callback: ResizeObserverCallback; disconnected: boolean };
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, disconnected: false };
    observers.push(this.entry);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.entry.disconnected = true;
  }
}

beforeEach(() => {
  lib.state.charts.length = 0;
  observers.length = 0;
  lib.createChart.mockClear();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

const bars = makeBars(5);
const props = { bars, chartType: 'candles', description: 'Chart' } as const;
const liveCharts = () => lib.state.charts.filter((c) => !c.removed);
const liveSeries = (type: string) =>
  liveCharts().flatMap((c) => c.series.filter((s) => s.type === type && !s.removed));

describe('PriceChart lifecycle', () => {
  it('creates one chart with a volume series and a candlestick series fed with OHLC data', () => {
    render(<PriceChart {...props} />);

    expect(liveCharts()).toHaveLength(1);
    const [candles] = liveSeries('Candlestick');
    const [volume] = liveSeries('Histogram');
    expect(candles?.setData).toHaveBeenLastCalledWith(
      bars.map((b) => ({
        time: b.date,
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
      })),
    );
    expect(volume?.setData).toHaveBeenLastCalledWith(
      bars.map((b) => ({ time: b.date, value: b.volume })),
    );
    expect(lib.state.charts[0]?.fitContent).toHaveBeenCalled();
  });

  it('updates data without re-creating the chart, and swaps only the price series on type change', () => {
    const { rerender } = render(<PriceChart {...props} />);
    const newer = makeBars(8);

    rerender(<PriceChart {...props} bars={newer} />);
    expect(lib.createChart).toHaveBeenCalledOnce();
    expect(liveSeries('Candlestick')[0]?.setData).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ time: newer[7]?.date })]),
    );

    rerender(<PriceChart {...props} bars={newer} chartType="line" />);
    expect(lib.createChart).toHaveBeenCalledOnce();
    expect(liveSeries('Candlestick')).toHaveLength(0);
    expect(liveSeries('Line')).toHaveLength(1);
    expect(liveSeries('Line')[0]?.setData).toHaveBeenLastCalledWith(
      newer.map((b) => ({ time: b.date, value: Number(b.close) })),
    );
    expect(liveSeries('Histogram')).toHaveLength(1);
  });

  it('resizes through ResizeObserver and disposes everything on unmount', () => {
    const { unmount } = render(<PriceChart {...props} />);
    act(() => {
      observers[0]?.callback(
        [{ contentRect: { width: 640.6, height: 380 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(lib.state.charts[0]?.resize).toHaveBeenCalledWith(640, 380);

    unmount();
    expect(lib.state.charts[0]?.removed).toBe(true);
    expect(lib.state.charts[0]?.crosshairHandlers.size).toBe(0);
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });

  it('leaves exactly one live chart, series set and subscription under Strict Mode', () => {
    const { unmount } = render(
      <StrictMode>
        <PriceChart {...props} />
      </StrictMode>,
    );
    expect(liveCharts()).toHaveLength(1);
    expect(liveCharts()[0]?.crosshairHandlers.size).toBe(1);
    expect(liveSeries('Candlestick')).toHaveLength(1);
    expect(observers.filter((o) => !o.disconnected)).toHaveLength(1);

    unmount();
    expect(liveCharts()).toHaveLength(0);
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });

  it('reports the hovered date through the latest callback without resubscribing', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<PriceChart {...props} onHover={first} />);
    rerender(<PriceChart {...props} onHover={second} />);

    const [handler] = lib.state.charts[0]?.crosshairHandlers ?? [];
    act(() => {
      handler?.({ time: bars[2]?.date ?? '' });
      handler?.({});
    });
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([[bars[2]?.date ?? ''], [null]]);
    expect(lib.state.charts[0]?.crosshairHandlers.size).toBe(1);
  });

  it('exposes a text alternative for the canvas', () => {
    const { getByRole } = render(<PriceChart {...props} description="Candlestick chart of AAA" />);
    expect(getByRole('img', { name: 'Candlestick chart of AAA' })).toBeInTheDocument();
  });
});
