import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { StockDetail } from '../../api/schemas';
import { formatDecimal, formatInteger } from '../../domain/decimal';
import { ValueList } from '../../components/ValueList';

/**
 * Ticker, historical coverage and the latest available bar. Only what the dataset provides is
 * shown: there is no company name or description to display.
 */
export function StockHeader({ detail }: { detail: StockDetail }) {
  const { coverage, latest } = detail;
  return (
    <Stack spacing={2}>
      <div>
        <Typography variant="h1">{detail.ticker}</Typography>
        <Typography color="text.secondary">
          Daily prices as provided by the imported dataset.
        </Typography>
      </div>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Paper component="section" aria-labelledby="coverage-heading" sx={{ p: 2, flex: 1 }}>
          <Typography id="coverage-heading" variant="h2" gutterBottom>
            Coverage
          </Typography>
          <ValueList
            items={[
              { label: 'First date', value: coverage.firstDate },
              { label: 'Last date', value: coverage.lastDate },
              { label: 'Trading days', value: formatInteger(coverage.tradingDays) },
            ]}
          />
        </Paper>
        <Paper component="section" aria-labelledby="latest-heading" sx={{ p: 2, flex: 2 }}>
          <Typography id="latest-heading" variant="h2" gutterBottom>
            Latest bar · {latest.date}
          </Typography>
          <ValueList
            minColumnWidth={110}
            items={[
              { label: 'Open', value: formatDecimal(latest.open) },
              { label: 'High', value: formatDecimal(latest.high) },
              { label: 'Low', value: formatDecimal(latest.low) },
              { label: 'Close', value: formatDecimal(latest.close) },
              { label: 'Adjusted close', value: formatDecimal(latest.adjClose) },
              { label: 'Volume', value: formatInteger(latest.volume) },
            ]}
          />
        </Paper>
      </Stack>
    </Stack>
  );
}
