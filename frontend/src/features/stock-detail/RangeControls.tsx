import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { type SyntheticEvent, useState } from 'react';
import {
  availablePresets,
  type Coverage,
  type CustomRangeError,
  RANGE_PRESETS,
  type RangePreset,
  type RangeRequest,
  type ResolvedRange,
  validateCustomRange,
} from '../../domain/ranges';

const ERROR_TEXT: Record<CustomRangeError, string> = {
  'invalid-from': 'Enter a valid start date.',
  'invalid-to': 'Enter a valid end date.',
  reversed: 'The start date must not be after the end date.',
  'outside-coverage': 'Choose dates within the available history.',
};

interface RangeControlsProps {
  coverage: Coverage;
  range: ResolvedRange;
  onChange: (request: RangeRequest) => void;
}

/**
 * Range presets (anchored to the last available date) and a custom range form. Presets that would
 * only repeat the whole history are disabled. The resolved bounds are always stated, including
 * when a request was limited to the available history.
 */
export function RangeControls({ coverage, range, onChange }: RangeControlsProps) {
  const available = availablePresets(coverage);
  const [customOpen, setCustomOpen] = useState(range.selection === 'custom');

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={customOpen ? 'custom' : range.selection}
          aria-label="Time range"
          onChange={(_event, value: RangePreset | 'custom' | null) => {
            if (value === null) return;
            if (value === 'custom') {
              setCustomOpen(true);
              return;
            }
            setCustomOpen(false);
            onChange({ kind: 'preset', preset: value });
          }}
          sx={{ flexWrap: 'wrap' }}
        >
          {RANGE_PRESETS.map((preset) => (
            <ToggleButton key={preset} value={preset} disabled={!available.has(preset)}>
              {preset}
            </ToggleButton>
          ))}
          <ToggleButton value="custom">Custom</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ fontVariantNumeric: 'tabular-nums' }}
      >
        Showing {range.from} to {range.to}
        {range.limited && ' (limited to the available history)'}
      </Typography>
      <Collapse in={customOpen} unmountOnExit>
        <CustomRangeForm
          key={`${range.from}..${range.to}`}
          coverage={coverage}
          initial={range}
          onApply={(from, to) => {
            onChange({ kind: 'custom', from, to });
          }}
        />
      </Collapse>
    </Stack>
  );
}

function CustomRangeForm({
  coverage,
  initial,
  onApply,
}: {
  coverage: Coverage;
  initial: ResolvedRange;
  onApply: (from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [error, setError] = useState<CustomRangeError | null>(null);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const problem = validateCustomRange(from, to, coverage);
    setError(problem);
    if (!problem) onApply(from, to);
  };

  const dateLimits = { min: coverage.firstDate, max: coverage.lastDate };
  return (
    <Box component="form" noValidate onSubmit={submit} aria-label="Custom range">
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { sm: 'flex-start' } }}
      >
        <TextField
          label="From"
          type="date"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
          }}
          error={error === 'invalid-from' || error === 'reversed' || error === 'outside-coverage'}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: dateLimits }}
        />
        <TextField
          label="To"
          type="date"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
          }}
          error={error === 'invalid-to' || error === 'reversed' || error === 'outside-coverage'}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: dateLimits }}
        />
        <Button type="submit" variant="contained">
          Apply
        </Button>
      </Stack>
      <Typography
        role={error ? 'alert' : undefined}
        variant="body2"
        color={error ? 'error' : 'text.secondary'}
        sx={{ mt: 1 }}
      >
        {error ? ERROR_TEXT[error] : `Available: ${coverage.firstDate} to ${coverage.lastDate}.`}
      </Typography>
    </Box>
  );
}
