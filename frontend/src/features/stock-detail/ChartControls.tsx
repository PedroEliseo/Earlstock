import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import type { ChartType } from './stockView';

interface ChartControlsProps {
  chartType: ChartType;
  onChartType: (type: ChartType) => void;
}

/** Chart representation: candlesticks (open, high, low, close) or a line of the close. */
export function ChartControls({ chartType, onChartType }: ChartControlsProps) {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={chartType}
      aria-label="Chart type"
      onChange={(_event, value: ChartType | null) => {
        if (value) onChartType(value);
      }}
    >
      <ToggleButton value="candles">Candlestick</ToggleButton>
      <ToggleButton value="line">Line</ToggleButton>
    </ToggleButtonGroup>
  );
}
