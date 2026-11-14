import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { PriceBasis } from '../../domain/comparison';
import { formatInteger } from '../../domain/decimal';
import type { ResolvedRange } from '../../domain/ranges';
import { ValueList } from '../../components/ValueList';

export const BASIS_LABEL: Record<PriceBasis, string> = {
  close: 'Close',
  adjClose: 'Adjusted close',
};

interface ComparisonSummaryProps {
  range: ResolvedRange;
  dates: readonly string[];
  basis: PriceBasis;
  startsLate: readonly string[];
  endsEarly: readonly string[];
}

/**
 * States exactly what is compared: the selected range, the common dates actually used (which can
 * be fewer), the baseline date and the price basis, plus which stocks limit the period.
 */
export function ComparisonSummary({
  range,
  dates,
  basis,
  startsLate,
  endsEarly,
}: ComparisonSummaryProps) {
  const first = dates[0];
  const last = dates.at(-1);
  return (
    <Paper component="section" aria-labelledby="summary-heading" sx={{ p: 2 }}>
      <Typography id="summary-heading" variant="h2" gutterBottom>
        What is compared
      </Typography>
      <ValueList
        minColumnWidth={170}
        items={[
          { label: 'Selected range', value: `${range.from} to ${range.to}` },
          { label: 'Common trading dates', value: first && last ? `${first} to ${last}` : 'None' },
          { label: 'Common observations', value: formatInteger(dates.length) },
          { label: 'Baseline (= 100)', value: first ?? '—' },
          { label: 'Price basis', value: BASIS_LABEL[basis] },
        ]}
      />
      <Stack spacing={0.5} sx={{ mt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Only dates on which every selected stock has a price are compared. Other dates are left
          out for all stocks; no price is filled in or interpolated.
        </Typography>
        {range.limited && (
          <Typography variant="body2" color="text.secondary">
            The selected range was limited to the period all selected stocks have data for.
          </Typography>
        )}
        {startsLate.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            The common period starts later because the history of {startsLate.join(', ')} begins
            then.
          </Typography>
        )}
        {endsEarly.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            The common period ends earlier because the history of {endsEarly.join(', ')} ends then.
          </Typography>
        )}
        {basis === 'adjClose' && (
          <Typography variant="body2" color="text.secondary">
            Adjusted close is used as provided by the dataset; its adjustment method is not stated
            by the source.
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}
