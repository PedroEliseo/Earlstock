import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import { NotFoundPage } from './components/NotFoundPage';
import { ExplorerPage } from './features/explorer/ExplorerPage';

/**
 * Route table. Feature pages are added by their own steps (and lazy-loaded when they pull in heavy
 * dependencies such as the chart library).
 */
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <ExplorerPage /> },
      {
        // Lazy: the detail page (and, inside it, the chart library) is not part of the Explorer bundle.
        path: 'stocks/:ticker',
        lazy: async () => ({
          Component: (await import('./features/stock-detail/StockDetailPage')).StockDetailPage,
        }),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
