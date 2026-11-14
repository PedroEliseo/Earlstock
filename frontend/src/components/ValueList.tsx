import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

/** Labelled values as a description list (<dl>), laid out as a responsive grid. */
export function ValueList({
  items,
  minColumnWidth = 120,
}: {
  items: { label: string; value: string }[];
  minColumnWidth?: number;
}) {
  return (
    <Box
      component="dl"
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${String(minColumnWidth)}px, 1fr))`,
        gap: 2,
        m: 0,
      }}
    >
      {items.map((item) => (
        <div key={item.label}>
          <Typography component="dt" variant="body2" color="text.secondary">
            {item.label}
          </Typography>
          <Typography
            component="dd"
            sx={{ m: 0, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
          >
            {item.value}
          </Typography>
        </div>
      ))}
    </Box>
  );
}
