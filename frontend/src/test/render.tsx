import { ThemeProvider } from '@mui/material/styles';
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { SnapshotCoordinator } from '../api/snapshot';
import { SnapshotProvider } from '../query/SnapshotProvider';
import { theme } from '../theme/theme';

/**
 * Renders routes with the real providers (theme, query client, snapshot coordinator, router).
 * Retries are disabled so error states appear immediately.
 */
export function renderRoutes(routes: RouteObject[], initialEntry = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const coordinator = new SnapshotCoordinator();
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  const result = render(
    <ThemeProvider theme={theme}>
      <SnapshotProvider queryClient={queryClient} coordinator={coordinator}>
        <RouterProvider router={router} />
      </SnapshotProvider>
    </ThemeProvider>,
  );
  return { ...result, router, queryClient, coordinator };
}
