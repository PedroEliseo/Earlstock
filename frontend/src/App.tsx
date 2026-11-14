import { useState } from 'react';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { SnapshotCoordinator } from './api/snapshot';
import { createQueryClient } from './query/queryClient';
import { SnapshotProvider } from './query/SnapshotProvider';
import { routes } from './routes';

/** Composition root: one query client, one snapshot coordinator and the router per app instance. */
export function App() {
  const [queryClient] = useState(createQueryClient);
  const [coordinator] = useState(() => new SnapshotCoordinator());
  const [router] = useState(() => createBrowserRouter(routes));

  return (
    <SnapshotProvider queryClient={queryClient} coordinator={coordinator}>
      <RouterProvider router={router} />
    </SnapshotProvider>
  );
}
