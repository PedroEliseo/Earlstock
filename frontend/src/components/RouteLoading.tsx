import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';

/**
 * Shown while the code of a lazily loaded route arrives on a direct page load (React Router's
 * hydrate fallback), so the page is never blank and the wait is announced.
 */
export function RouteLoading() {
  return (
    <Box
      role="status"
      aria-label="Loading page"
      sx={{ position: 'fixed', top: 0, left: 0, right: 0 }}
    >
      <LinearProgress />
    </Box>
  );
}
