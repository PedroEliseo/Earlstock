import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router';
import type { StockSummary } from '../../api/schemas';
import { stockPath } from '../../api/stocks';
import { StockLogo } from '../../components/StockLogo';
import { StockName } from '../../components/StockName';

/** Responsive columns: as many cards of at least 15rem as fit. */
const GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))',
  gap: 2,
  m: 0,
  p: 0,
  listStyle: 'none',
} as const;

/**
 * Stocks as a grid of cards: logo, name, ticker and the period with daily prices. Each card is one
 * link to the stock (the whole card is clickable and keyboard-focusable), inside a list so assistive
 * technology announces the count.
 */
export function StockGrid({ stocks }: { stocks: readonly StockSummary[] }) {
  return (
    <Box component="ul" aria-label="Stocks" sx={GRID_SX}>
      {stocks.map((stock) => (
        <li key={stock.ticker}>
          <StockCard stock={stock} />
        </li>
      ))}
    </Box>
  );
}

function StockCard({ stock }: { stock: StockSummary }) {
  return (
    <Card
      sx={{
        height: '100%',
        transition: 'border-color 120ms',
        '&:hover': { borderColor: 'primary.main' },
      }}
    >
      <CardActionArea
        component={RouterLink}
        to={stockPath(stock.ticker)}
        sx={{ height: '100%', p: 2 }}
      >
        <Stack spacing={1.5} sx={{ height: '100%' }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            <StockLogo key={stock.ticker} ticker={stock.ticker} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 700, letterSpacing: '0.02em' }}>
                {stock.ticker}
              </Typography>
              <Box
                sx={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                <StockName name={stock.name} variant="body2" color="text.secondary" />
              </Box>
            </Box>
          </Stack>
        </Stack>
      </CardActionArea>
    </Card>
  );
}

/** Placeholder cards while a page loads (hidden from assistive technology). */
export function StockGridSkeleton({ count }: { count: number }) {
  return (
    <Box aria-hidden="true" sx={GRID_SX}>
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Skeleton variant="rounded" width={44} height={44} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="40%" />
              <Skeleton variant="text" width="80%" />
            </Box>
          </Stack>
          <Skeleton variant="text" width="70%" sx={{ mt: 1.5 }} />
        </Card>
      ))}
    </Box>
  );
}
