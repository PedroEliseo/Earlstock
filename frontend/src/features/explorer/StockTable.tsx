import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Paper from '@mui/material/Paper';
import { Link as RouterLink } from 'react-router';
import type { StockSummary } from '../../api/schemas';
import { stockPath } from '../../api/stocks';
import { StockName } from '../../components/StockName';
import { visuallyHidden } from '../../theme/theme';
import type { SortKey, SortOrder } from './stockListView';

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'ticker', label: 'Ticker', numeric: false },
  { key: 'firstDate', label: 'First date', numeric: true },
  { key: 'lastDate', label: 'Last date', numeric: true },
];

const DIRECTION_TEXT = { asc: 'ascending', desc: 'descending' } as const;
const SKELETON_ROWS = 10;

interface StockTableProps {
  rows: readonly StockSummary[];
  sort: SortOrder;
  onSort: (key: SortKey) => void;
  loading?: boolean;
}

/**
 * The stock list as a sortable table. Each ticker is a real link (keyboard and middle-click work);
 * the sorted column carries aria-sort. While loading, placeholder rows keep the layout stable and a
 * single status message is announced.
 */
export function StockTable({ rows, sort, onSort, loading = false }: StockTableProps) {
  const sortedLabel = COLUMNS.find((column) => column.key === sort.key)?.label ?? '';
  return (
    <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
      {loading && (
        <Box role="status" sx={visuallyHidden}>
          Loading stocks…
        </Box>
      )}
      <Table size="small" aria-busy={loading} aria-label="Stocks">
        <Box component="caption" sx={visuallyHidden}>
          Stocks in the active dataset with their name, ticker and first and last available dates,
          sorted by {sortedLabel.toLowerCase()} {DIRECTION_TEXT[sort.direction]}.
        </Box>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            {COLUMNS.map((column) => {
              const active = sort.key === column.key;
              return (
                <TableCell
                  key={column.key}
                  align={column.numeric ? 'right' : 'left'}
                  sortDirection={active ? sort.direction : false}
                >
                  <TableSortLabel
                    active={active}
                    direction={active ? sort.direction : 'asc'}
                    onClick={() => {
                      onSort(column.key);
                    }}
                  >
                    {column.label}
                    {active && (
                      <Box component="span" sx={visuallyHidden}>
                        , sorted {DIRECTION_TEXT[sort.direction]}
                      </Box>
                    )}
                  </TableSortLabel>
                </TableCell>
              );
            })}
          </TableRow>
        </TableHead>
        <TableBody>
          {loading
            ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <TableRow key={index} aria-hidden="true">
                  <TableCell>
                    <Skeleton variant="text" width="10em" sx={{ display: 'inline-block' }} />
                  </TableCell>
                  {COLUMNS.map((column) => (
                    <TableCell key={column.key} align={column.numeric ? 'right' : 'left'}>
                      <Skeleton
                        variant="text"
                        width={column.numeric ? '5.5em' : '3.5em'}
                        sx={{ display: 'inline-block' }}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rows.map((stock) => (
                <TableRow key={stock.ticker} hover>
                  {/* The name leads; the ticker stays the identifier. The row's link is on the
                      name when it is known, otherwise on the ticker (never shown as a name). */}
                  <TableCell component="th" scope="row">
                    {stock.name ? (
                      <Link
                        component={RouterLink}
                        to={stockPath(stock.ticker)}
                        underline="hover"
                        sx={{ fontWeight: 600 }}
                      >
                        {stock.name}
                      </Link>
                    ) : (
                      <StockName name={null} variant="body2" component="span" />
                    )}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {stock.name ? (
                      <Box component="span" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                        {stock.ticker}
                      </Box>
                    ) : (
                      <Link
                        component={RouterLink}
                        to={stockPath(stock.ticker)}
                        underline="hover"
                        sx={{ fontWeight: 600 }}
                      >
                        {stock.ticker}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell align="right">{stock.firstDate}</TableCell>
                  <TableCell align="right">{stock.lastDate}</TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
