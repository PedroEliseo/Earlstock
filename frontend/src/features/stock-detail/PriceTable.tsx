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
import type { Bar } from '../../api/schemas';
import { formatDecimal, formatInteger } from '../../domain/decimal';
import { visuallyHidden } from '../../theme/theme';

const COLUMNS = ['Open', 'High', 'Low', 'Close', 'Adjusted close', 'Volume'] as const;
const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];

/**
 * Every bar of the selected range, newest first, in pages (the chart's accessible alternative).
 * The caption and pagination state the full count, so a page is never mistaken for all the data.
 * Remount it (key) when the range changes so it starts again at the newest page.
 */
export function PriceTable({ bars }: { bars: readonly Bar[] }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const newestFirst = [...bars].reverse();
  const rows = newestFirst.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
  const first = bars[0]?.date ?? '';
  const last = bars.at(-1)?.date ?? '';

  return (
    <Paper component="section" aria-labelledby="table-heading">
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography id="table-heading" variant="h2">
          Daily prices
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {formatInteger(bars.length)} trading days from {first} to {last}, newest first.
        </Typography>
      </Box>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-labelledby="table-heading">
          <Box component="caption" sx={visuallyHidden}>
            Daily open, high, low, close, adjusted close and volume from {first} to {last}, newest
            first. Page {page + 1} of {Math.max(1, Math.ceil(bars.length / rowsPerPage))}.
          </Box>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              {COLUMNS.map((column) => (
                <TableCell key={column} align="right">
                  {column}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((bar) => (
              <TableRow key={bar.date} hover>
                <TableCell component="th" scope="row" sx={{ whiteSpace: 'nowrap' }}>
                  {bar.date}
                </TableCell>
                <TableCell align="right">{formatDecimal(bar.open)}</TableCell>
                <TableCell align="right">{formatDecimal(bar.high)}</TableCell>
                <TableCell align="right">{formatDecimal(bar.low)}</TableCell>
                <TableCell align="right">{formatDecimal(bar.close)}</TableCell>
                <TableCell align="right">{formatDecimal(bar.adjClose)}</TableCell>
                <TableCell align="right">{formatInteger(bar.volume)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={bars.length}
        page={page}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
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
