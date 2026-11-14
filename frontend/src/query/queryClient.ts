import { QueryClient } from '@tanstack/react-query';
import type { Snapshotted } from '../api/client';
import { isPermanentError } from '../api/errors';

/**
 * Query defaults. The dataset changes rarely (only when a new import is activated), so data stays
 * fresh for several minutes; a dataset replacement is detected through the snapshot header and
 * invalidates outdated queries explicitly (see SnapshotProvider). Permanent errors are not retried.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => !isPermanentError(error) && failureCount < 2,
      },
    },
  });
}

/** True for query data produced by a snapshot-aware query function. */
export function isSnapshotted(data: unknown): data is Snapshotted<unknown> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'snapshot' in data &&
    typeof data.snapshot === 'number'
  );
}
