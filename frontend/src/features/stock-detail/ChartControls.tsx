import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { type ChartType, LINE_FIELD_LABEL, LINE_FIELDS, type LineField } from './stockView';

interface ChartControlsProps {
  chartType: ChartType;
  lineField: LineField;
  onChartType: (type: ChartType) => void;
  onLineField: (field: LineField) => void;
}

/** Chart representation, and for line charts the value drawn (close or adjusted close). */
export function ChartControls({
  chartType,
  lineField,
  onChartType,
  onLineField,
}: ChartControlsProps) {
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
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
      {chartType === 'line' && (
        <ToggleButtonGroup
          size="small"
          exclusive
          value={lineField}
          aria-label="Line value"
          onChange={(_event, value: LineField | null) => {
            if (value) onLineField(value);
          }}
        >
          {LINE_FIELDS.map((field) => (
            <ToggleButton key={field} value={field}>
              {LINE_FIELD_LABEL[field]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      )}
    </Stack>
  );
}
