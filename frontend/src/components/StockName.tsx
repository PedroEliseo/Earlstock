import Typography, { type TypographyProps } from '@mui/material/Typography';
import type { ElementType } from 'react';

/** Shown where a stock's name is expected but the dataset does not provide one. */
export const NAME_NOT_AVAILABLE = 'Name not available';

interface StockNameProps {
  name: string | null;
  variant?: TypographyProps['variant'];
  component?: ElementType;
  color?: string;
}

/**
 * A stock's name, or an explicit "not available" in muted italics when the dataset has none. The
 * ticker is never shown in its place: it is always displayed separately as the identifier.
 */
export function StockName({ name, variant = 'body2', component = 'span', color }: StockNameProps) {
  if (name) {
    return (
      <Typography variant={variant} component={component} sx={color ? { color } : undefined}>
        {name}
      </Typography>
    );
  }
  return (
    <Typography
      variant={variant}
      component={component}
      sx={{ color: 'text.secondary', fontStyle: 'italic', fontWeight: 400 }}
    >
      {NAME_NOT_AVAILABLE}
    </Typography>
  );
}
