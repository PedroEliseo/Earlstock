import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { StockName } from '../../components/StockName';
import { formatInteger, formatPercent } from '../../domain/decimal';
import {
  MAX_SESSION_GAP_DAYS,
  MIN_DAILY_RETURNS,
  TRADING_DAYS_PER_YEAR,
} from '../../domain/performance';
import { BASIS_LABEL, type ComparisonModel } from './comparisonModel';
import { SeriesSwatch } from './SeriesSwatch';

const NOT_AVAILABLE = 'Not enough data';

/** Per-stock metrics over the common observations, with their definitions stated. */
export function MetricsTable({ model }: { model: ComparisonModel }) {
  const count = formatInteger(model.dates.length);
  return (
    <Paper component="section" aria-labelledby="metrics-heading">
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography id="metrics-heading" variant="h2">
          Performance metrics
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Computed from {BASIS_LABEL[model.basis].toLowerCase()}. Cumulative return and drawdown use
          the common dates; volatility uses each stock’s own daily observations in the same period.
          Historical values describe the past and do not predict future returns.
        </Typography>
      </Box>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-labelledby="metrics-heading">
          <TableHead>
            <TableRow>
              <TableCell>Ticker</TableCell>
              <TableCell align="right">Cumulative return</TableCell>
              <TableCell align="right">Annualized volatility</TableCell>
              <TableCell align="right">Daily returns used</TableCell>
              <TableCell align="right">Max drawdown</TableCell>
              <TableCell align="right">Observations</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {model.stocks.map((stock, index) => (
              <TableRow key={stock.ticker}>
                {/* Wide enough for typical names; the table scrolls on narrow screens. */}
                <TableCell component="th" scope="row" sx={{ minWidth: '11rem' }}>
                  <Box
                    component="span"
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontWeight: 600 }}
                  >
                    <SeriesSwatch index={index} />
                    {stock.ticker}
                  </Box>
                  <StockName name={stock.name} variant="body2" color="text.secondary" />
                </TableCell>
                <TableCell align="right">
                  {stock.cumulativeReturn === null
                    ? NOT_AVAILABLE
                    : formatPercent(stock.cumulativeReturn, { signed: true })}
                </TableCell>
                <TableCell align="right">
                  {stock.volatility.value === null
                    ? NOT_AVAILABLE
                    : formatPercent(stock.volatility.value)}
                </TableCell>
                <TableCell align="right">
                  {formatInteger(stock.volatility.dailyReturns)}
                  {stock.volatility.excludedIntervals > 0 &&
                    ` (${formatInteger(stock.volatility.excludedIntervals)} ${stock.volatility.excludedIntervals === 1 ? 'gap' : 'gaps'} excluded)`}
                </TableCell>
                <TableCell align="right">
                  {stock.maxDrawdown === null ? NOT_AVAILABLE : formatPercent(stock.maxDrawdown)}
                </TableCell>
                <TableCell align="right">{count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Box
        component="dl"
        sx={{
          px: 2,
          pb: 2,
          m: 0,
          '& dt': { fontWeight: 600, mt: 1 },
          '& dd': { m: 0, color: 'text.secondary' },
          typography: 'body2',
        }}
      >
        <dt>Cumulative return</dt>
        <dd>
          Last common price ÷ first common price − 1. The chart index minus 100 at the last date.
        </dd>
        <dt>Annualized volatility</dt>
        <dd>
          Historical realized volatility of each stock’s own daily returns between the first and
          last common date, × √{TRADING_DAYS_PER_YEAR}. Not implied volatility and not a forecast;
          shown only with at least {MIN_DAILY_RETURNS} daily returns.
        </dd>
        <dd>
          Limitation: the dataset has no exchange calendar, so trading sessions are inferred from
          the selected stocks’ dates. Returns across a gap (a session the stock is missing, or more
          than {MAX_SESSION_GAP_DAYS} calendar days) are excluded. Adding or removing a stock can
          therefore change another stock’s volatility.
        </dd>
        <dt>Max drawdown</dt>
        <dd>
          The largest fall from a previous peak (the baseline included) to a later low, as a
          percentage of that peak.
        </dd>
      </Box>
    </Paper>
  );
}
