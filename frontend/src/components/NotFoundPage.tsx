import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router';
import { StatusMessage } from './StatusMessage';
import { usePageTitle } from './usePageTitle';

export function NotFoundPage({
  title = 'Page not found',
  description = 'There is nothing at this address.',
}: {
  title?: string;
  description?: string;
}) {
  usePageTitle(title);
  return (
    <Stack spacing={2}>
      <Typography variant="h1">{title}</Typography>
      <StatusMessage
        kind="info"
        title={title}
        description={description}
        action={
          <Button component={RouterLink} to="/" color="inherit" size="small" variant="outlined">
            Explorer
          </Button>
        }
      />
    </Stack>
  );
}
