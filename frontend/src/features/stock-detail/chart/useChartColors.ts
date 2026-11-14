import { alpha, useColorScheme } from '@mui/material/styles';
import { SCHEME_COLORS } from '../../../theme/theme';

export interface ChartColors {
  text: string;
  grid: string;
  up: string;
  down: string;
  line: string;
  volume: string;
}

/**
 * Concrete colors for the canvas chart, from the shared theme palette of the color scheme in use
 * (canvas drawing cannot read CSS variables).
 */
export function useChartColors(): ChartColors {
  const { mode, systemMode } = useColorScheme();
  const scheme = (mode === 'system' ? systemMode : mode) ?? 'light';
  const colors = SCHEME_COLORS[scheme];
  return {
    text: colors.textSecondary,
    grid: alpha(colors.divider, 0.6),
    up: colors.up,
    down: colors.down,
    line: colors.primary,
    volume: alpha(colors.textSecondary, 0.35),
  };
}
