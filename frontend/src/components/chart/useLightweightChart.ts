import {
  type ChartOptions,
  ColorType,
  createChart,
  type DeepPartial,
  type IChartApi,
  type MouseEventParams,
} from 'lightweight-charts';
import { type RefObject, useEffect, useRef } from 'react';

/** Charts already removed by useLightweightChart (their series were removed with them). */
const removedCharts = new WeakSet<IChartApi>();

/**
 * True while `chart` has not been removed. Series cleanups use it: on unmount the chart is removed
 * first, together with all its series, so removing a series again must be skipped.
 */
export function isChartAlive(chart: IChartApi): boolean {
  return !removedCharts.has(chart);
}

/**
 * The lifecycle shared by every EarlStock chart: create the lightweight-charts instance once per
 * mount in `containerRef`, keep it sized to the container with a ResizeObserver, forward crosshair
 * moves to the LATEST `onCrosshair` (held in a ref: no stale closure, no resubscription), and on
 * unmount unsubscribe, disconnect and call chart.remove().
 *
 * Call it BEFORE the component's own effects: effects run (and clean up) in declaration order, so
 * the component's series and data effects always find the chart in the returned ref, including
 * across React Strict Mode's simulated remount. `options` are applied at creation only.
 */
export function useLightweightChart(
  containerRef: RefObject<HTMLDivElement | null>,
  options: DeepPartial<ChartOptions>,
  onCrosshair?: (date: string | null) => void,
): RefObject<IChartApi | null> {
  const chartRef = useRef<IChartApi | null>(null);
  const onCrosshairRef = useRef(onCrosshair);
  useEffect(() => {
    onCrosshairRef.current = onCrosshair;
  }, [onCrosshair]);
  // Creation-time options: read once by the mount effect below.
  const optionsRef = useRef(options);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      ...optionsRef.current,
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        fontFamily: 'inherit',
        // The on-chart TradingView logo is off: it is a focusable link inside the chart's
        // role="img" container, which is not accessible.
        attributionLogo: false,
        ...optionsRef.current.layout,
      },
    });

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0 && box.height > 0) {
        chart.resize(Math.floor(box.width), Math.floor(box.height));
      }
    });
    observer.observe(container);

    const handleCrosshair = (param: MouseEventParams) => {
      onCrosshairRef.current?.(typeof param.time === 'string' ? param.time : null);
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    chartRef.current = chart;
    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      observer.disconnect();
      chartRef.current = null;
      removedCharts.add(chart);
      chart.remove();
    };
  }, [containerRef]);

  return chartRef;
}
