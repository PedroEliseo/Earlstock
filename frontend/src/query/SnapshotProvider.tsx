import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { SnapshotCoordinator } from '../api/snapshot';
import { isSnapshotted, isSnapshottedPages } from './queryClient';

interface DatasetUpdate {
  /** True after a newer dataset than the one first seen was detected (until dismissed). */
  updated: boolean;
  dismiss: () => void;
}

const CoordinatorContext = createContext<SnapshotCoordinator | null>(null);
const DatasetUpdateContext = createContext<DatasetUpdate>({
  updated: false,
  dismiss: () => undefined,
});

/**
 * Wires the snapshot coordinator to TanStack Query. When a response reveals a NEWER dataset, every
 * cached query whose data comes from an older snapshot is invalidated (refetched if in use). The
 * refetched data carries the new snapshot, which is not newer than itself, so this cannot loop.
 */
export function SnapshotProvider({
  queryClient,
  coordinator,
  children,
}: {
  queryClient: QueryClient;
  coordinator: SnapshotCoordinator;
  children: ReactNode;
}) {
  const [updated, setUpdated] = useState(false);

  useEffect(
    () =>
      coordinator.subscribe((snapshot, previous) => {
        if (previous === null) return; // first snapshot of the session: nothing is outdated
        setUpdated(true);
        void queryClient.invalidateQueries({
          predicate: (query) =>
            isSnapshotted(query.state.data) && query.state.data.snapshot < snapshot,
        });
        // Infinite lists are reset, not refetched page by page: their pages must all come from one
        // snapshot, so the list starts again from its first page.
        void queryClient.resetQueries({
          predicate: (query) =>
            isSnapshottedPages(query.state.data) &&
            (query.state.data.pages[0]?.snapshot ?? snapshot) < snapshot,
        });
      }),
    [coordinator, queryClient],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <CoordinatorContext value={coordinator}>
        <DatasetUpdateContext
          value={{
            updated,
            dismiss: () => {
              setUpdated(false);
            },
          }}
        >
          {children}
        </DatasetUpdateContext>
      </CoordinatorContext>
    </QueryClientProvider>
  );
}

export function useSnapshotCoordinator(): SnapshotCoordinator {
  const coordinator = useContext(CoordinatorContext);
  if (!coordinator) throw new Error('useSnapshotCoordinator must be used inside SnapshotProvider');
  return coordinator;
}

export function useDatasetUpdate(): DatasetUpdate {
  return useContext(DatasetUpdateContext);
}
