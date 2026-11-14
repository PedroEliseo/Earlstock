import { seriesPattern } from '../../components/chart/seriesStyles';
import { useChartColors } from '../../components/chart/useChartColors';

/** A short line sample in the series' color and pattern (decorative; the ticker is the label). */
export function SeriesSwatch({ index }: { index: number }) {
  const { series } = useChartColors();
  return (
    <svg width="28" height="10" aria-hidden="true" style={{ flexShrink: 0 }}>
      <line
        x1="1"
        y1="5"
        x2="27"
        y2="5"
        stroke={series[index % series.length]}
        strokeWidth="2.5"
        strokeDasharray={seriesPattern(index).dashArray}
        strokeLinecap="round"
      />
    </svg>
  );
}
