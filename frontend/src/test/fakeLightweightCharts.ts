import { vi } from 'vitest';

/**
 * A recording stand-in for lightweight-charts (no canvas). Use with:
 *   vi.mock('lightweight-charts', async () => (await import('../../test/fakeLightweightCharts')).module);
 * and inspect `charts` to verify creation, series, data, subscriptions and disposal.
 */
export interface FakeSeries {
  type: string;
  options: Record<string, unknown>;
  setData: ReturnType<typeof vi.fn>;
  applyOptions: ReturnType<typeof vi.fn>;
  priceLines: unknown[];
  removed: boolean;
}

export interface FakeChart {
  series: FakeSeries[];
  removed: boolean;
  crosshairHandlers: Set<(param: { time?: string }) => void>;
  resize: ReturnType<typeof vi.fn>;
  fitContent: ReturnType<typeof vi.fn>;
  applyOptions: ReturnType<typeof vi.fn>;
}

export const charts: FakeChart[] = [];

export const createChart = vi.fn(() => {
  const chart: FakeChart = {
    series: [],
    removed: false,
    crosshairHandlers: new Set(),
    resize: vi.fn(),
    fitContent: vi.fn(),
    applyOptions: vi.fn(),
  };
  charts.push(chart);
  return {
    addSeries: (definition: { type: string }, options: Record<string, unknown> = {}) => {
      if (chart.removed) throw new Error('chart already removed');
      const series: FakeSeries = {
        type: definition.type,
        options,
        setData: vi.fn(),
        applyOptions: vi.fn(),
        priceLines: [],
        removed: false,
      };
      chart.series.push(series);
      return {
        setData: series.setData,
        applyOptions: series.applyOptions,
        createPriceLine: (line: unknown) => {
          series.priceLines.push(line);
          return { applyOptions: vi.fn() };
        },
        __fake: series,
      };
    },
    removeSeries: (api: { __fake: FakeSeries }) => {
      if (chart.removed) throw new Error('chart already removed');
      api.__fake.removed = true;
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

export const module = {
  createChart,
  CandlestickSeries: { type: 'Candlestick' },
  LineSeries: { type: 'Line' },
  HistogramSeries: { type: 'Histogram' },
  ColorType: { Solid: 'solid' },
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
};

export function resetFakeCharts(): void {
  charts.length = 0;
  createChart.mockClear();
}

export const liveCharts = () => charts.filter((chart) => !chart.removed);
export const liveSeries = (type: string) =>
  liveCharts().flatMap((chart) => chart.series.filter((s) => s.type === type && !s.removed));

/** ResizeObserver fake recording observers; tests can trigger a resize. */
export const observers: { callback: ResizeObserverCallback; disconnected: boolean }[] = [];
export class FakeResizeObserver {
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
