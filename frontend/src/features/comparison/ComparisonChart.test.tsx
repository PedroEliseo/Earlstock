import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  charts,
  createChart,
  FakeResizeObserver,
  liveCharts,
  liveSeries,
  observers,
  resetFakeCharts,
} from '../../test/fakeLightweightCharts';
import { daysAgo } from '../../test/fixtures';
import ComparisonChart from './ComparisonChart';

vi.mock(
  'lightweight-charts',
  async () => (await import('../../test/fakeLightweightCharts')).module,
);

beforeEach(() => {
  resetFakeCharts();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

const dates = [daysAgo(3), daysAgo(2), daysAgo(1)];
const series = [
  { ticker: 'AAA', normalized: [100, 110, 105] },
  { ticker: 'BBB', normalized: [100, 90, 95] },
];

describe('ComparisonChart', () => {
  it('draws one line per ticker, all on the same dates and starting at 100', () => {
    render(<ComparisonChart dates={dates} series={series} description="Comparison" />);
    const lines = liveSeries('Line');
    expect(lines.map((l) => l.options['title'])).toEqual(['AAA', 'BBB']);
    const sent = lines.map(
      (l) => l.setData.mock.lastCall?.[0] as { time: string; value: number }[],
    );
    expect(sent.map((points) => points.map((p) => p.time))).toEqual([dates, dates]);
    expect(sent.map((points) => points[0]?.value)).toEqual([100, 100]);
    expect(lines[0]?.priceLines).toEqual([expect.objectContaining({ price: 100 })]);
  });

  it('uses a different line style per series (not color alone)', () => {
    render(<ComparisonChart dates={dates} series={series} description="Comparison" />);
    const styles = liveSeries('Line').map((l) => l.options['lineStyle']);
    expect(new Set(styles).size).toBe(2);
  });

  it('updates data without re-creating the chart, and re-creates series only when tickers change', () => {
    const { rerender } = render(<ComparisonChart dates={dates} series={series} description="c" />);
    const firstLines = liveSeries('Line');
    rerender(
      <ComparisonChart
        dates={dates.slice(1)}
        series={series.map((s) => ({ ...s, normalized: s.normalized.slice(1) }))}
        description="c"
      />,
    );
    expect(createChart).toHaveBeenCalledOnce();
    expect(liveSeries('Line')).toEqual(firstLines);

    rerender(
      <ComparisonChart
        dates={dates}
        series={[...series, { ticker: 'CCC', normalized: [100, 101, 102] }]}
        description="c"
      />,
    );
    expect(createChart).toHaveBeenCalledOnce();
    expect(liveSeries('Line').map((l) => l.options['title'])).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('resizes with the container and disposes everything on unmount', () => {
    const { unmount } = render(<ComparisonChart dates={dates} series={series} description="c" />);
    act(() => {
      observers[0]?.callback(
        [{ contentRect: { width: 500.9, height: 300 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(charts[0]?.resize).toHaveBeenCalledWith(500, 300);
    unmount();
    expect(liveCharts()).toHaveLength(0);
    expect(charts[0]?.crosshairHandlers.size).toBe(0);
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });

  it('leaves exactly one chart, one series per ticker and one subscription under Strict Mode', () => {
    render(
      <StrictMode>
        <ComparisonChart dates={dates} series={series} description="c" />
      </StrictMode>,
    );
    expect(liveCharts()).toHaveLength(1);
    expect(liveSeries('Line')).toHaveLength(2);
    expect(liveCharts()[0]?.crosshairHandlers.size).toBe(1);
    expect(observers.filter((o) => !o.disconnected)).toHaveLength(1);
  });

  it('reports the hovered date', () => {
    const onHover = vi.fn();
    render(<ComparisonChart dates={dates} series={series} description="c" onHover={onHover} />);
    const [handler] = charts[0]?.crosshairHandlers ?? [];
    act(() => {
      handler?.({ time: dates[1] ?? '' });
    });
    expect(onHover).toHaveBeenCalledWith(dates[1]);
  });
});
