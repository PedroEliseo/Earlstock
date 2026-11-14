import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Link from '@mui/material/Link';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useEffect, useRef } from 'react';
import { NavLink, Link as RouterLink, Outlet, useLocation } from 'react-router';
import { ColorModeToggle } from './ColorModeToggle';
import { DatasetUpdatedNotice } from './DatasetUpdatedNotice';
import { ErrorBoundary } from './ErrorBoundary';

/** Primary navigation; each feature adds its entry when it exists. */
const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Explorer', end: true },
  { to: '/compare', label: 'Compare' },
];

/**
 * Application shell: skip link, app bar with navigation, main landmark and footer. After client-side
 * navigation, focus moves to <main> so keyboard and screen-reader users start at the new content
 * (the initial page load keeps the browser's default focus, so the first Tab reaches the skip link).
 */
export function Layout() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  // Focus moves only when the path actually changes. Comparing with the previous path (rather than
  // skipping a "first render") stays correct when effects run twice, as in React Strict Mode.
  const previousPath = useRef(pathname);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    mainRef.current?.focus();
  }, [pathname]);

  return (
    <>
      <Link
        href="#main"
        sx={{
          position: 'absolute',
          left: 8,
          top: -48,
          zIndex: 'tooltip',
          px: 1.5,
          py: 1,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          borderRadius: 1,
          '&:focus': { top: 8 },
        }}
      >
        Skip to content
      </Link>
      <AppBar
        position="static"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Container maxWidth="lg">
          <Toolbar disableGutters sx={{ gap: { xs: 1, sm: 3 }, flexWrap: 'wrap' }}>
            <Typography
              component={RouterLink}
              to="/"
              variant="h6"
              sx={{ color: 'text.primary', textDecoration: 'none', fontWeight: 700, mr: 1 }}
            >
              EarlStock
            </Typography>
            <Box component="nav" aria-label="Main" sx={{ flexGrow: 1 }}>
              <Box component="ul" sx={{ display: 'flex', gap: 1, m: 0, p: 0, listStyle: 'none' }}>
                {NAV_ITEMS.map((item) => (
                  <li key={item.to}>
                    <Button
                      component={NavLink}
                      to={item.to}
                      end={item.end ?? false}
                      color="inherit"
                      sx={{
                        color: 'text.secondary',
                        '&[aria-current="page"]': {
                          color: 'text.primary',
                          bgcolor: 'action.selected',
                        },
                      }}
                    >
                      {item.label}
                    </Button>
                  </li>
                ))}
              </Box>
            </Box>
            <ColorModeToggle />
          </Toolbar>
        </Container>
      </AppBar>
      <DatasetUpdatedNotice />
      <Container
        component="main"
        id="main"
        ref={mainRef}
        tabIndex={-1}
        maxWidth="lg"
        sx={{ py: { xs: 3, sm: 4 }, minHeight: '60vh', '&:focus': { outline: 'none' } }}
      >
        {/* Keyed by path: a crash on one page does not stick after navigating away. */}
        <ErrorBoundary key={pathname}>
          <Outlet />
        </ErrorBoundary>
      </Container>
      <Box component="footer" sx={{ borderTop: 1, borderColor: 'divider', py: 2 }}>
        <Container maxWidth="lg">
          <Typography variant="body2" color="text.secondary">
            Historical daily prices as provided by the imported dataset. Not real-time data.{' '}
            <Link href="/third-party-notices.txt" color="inherit">
              Third-party notices
            </Link>
          </Typography>
        </Container>
      </Box>
    </>
  );
}
