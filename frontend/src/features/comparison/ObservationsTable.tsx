import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { formatDecimal, formatIndex, formatInteger } from '../../domain/decimal';
import { visuallyHidden } from '../../theme/theme';
import { BASIS_LABEL, type ComparisonModel } from './comparisonModel';

/**
 * The aligned observations behind the chart and metrics: common dates only, newest first, in pages.
 * For each stock: the exact source price on the selected basis and its index value.
 * Remount (key) when the model changes so it starts at the newest page.
 */
export function ObservationsTable({ model }: { model: ComparisonModel }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const total = model.dates.length;
  const start = page * rowsPerPage;
  // Newest first: row r shows the date at position total-1-r.
  const positions = Array.from(
    { length: Math.max(0, Math.min(rowsPerPage, total - start)) },
    (_, r) => total - 1 - (start + r),
  );
  const basis = BASIS_LABEL[model.basis];

  return (
    <Paper component="section" aria-labelledby="observations-heading">
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography id="observations-heading" variant="h2">
          Aligned observations
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {formatInteger(total)} common trading dates, newest first. Dates missing for any selected
          stock are not listed; no values were filled in.
        </Typography>
      </Box>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-labelledby="observations-heading">
          <Box component="caption" sx={visuallyHidden}>
            {basis} and index (baseline 100) for each stock on each common date, newest first.
          </Box>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              {model.stocks.map((stock) => [
                <TableCell key={`${stock.ticker}-price`} align="right">
                  {stock.ticker} {basis.toLowerCase()}
                </TableCell>,
                <TableCell key={`${stock.ticker}-index`} align="right">
                  {stock.ticker} index
                </TableCell>,
              ])}
            </TableRow>
          </TableHead>
          <TableBody>
            {positions.map((position) => (
              <TableRow key={model.dates[position]} hover>
                <TableCell component="th" scope="row" sx={{ whiteSpace: 'nowrap' }}>
                  {model.dates[position]}
                </TableCell>
                {model.stocks.map((stock) => [
                  <TableCell key={`${stock.ticker}-price`} align="right">
                    {formatDecimal(stock.prices[position] ?? '0')}
                  </TableCell>,
                  <TableCell key={`${stock.ticker}-index`} align="right">
                    {formatIndex(stock.normalized[position] ?? Number.NaN)}
                  </TableCell>,
                ])}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        page={page}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={[25, 50, 100]}
        onPageChange={(_event, next) => {
          setPage(next);
        }}
        onRowsPerPageChange={(event) => {
          setRowsPerPage(Number(event.target.value));
          setPage(0);
        }}
      />
    </Paper>
  );
}
