import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import { NotFoundPage } from './components/NotFoundPage';
import { StatusMessage } from './components/StatusMessage';

/**
 * Route table. Feature pages are added by their own steps (and lazy-loaded when they pull in heavy
 * dependencies such as the chart library).
 */
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      {
        index: true,
        element: (
          <StatusMessage
            kind="info"
            title="EarlStock"
            description="The stock explorer is being built."
          />
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
