import type { Snapshotted } from './client';
import { SnapshotMismatchError } from './errors';

/**
 * Dataset snapshot coordination: the frontend never combines data from different datasets, and a
 * late response from an older dataset never replaces newer data.
 *
 * Ordering assumption: snapshot ids are import ids, and the importer only ever activates a NEWLY
 * created import (identity column), so a higher id is always the newer dataset. Re-pointing the
 * snapshot to an older import by hand is not a supported operation; if it happens, a page reload
 * resets the coordinator.
 */

export type SnapshotListener = (snapshot: number, previous: number | null) => void;

/** Remembers the newest snapshot seen in this browser session and announces when it changes. */
export class SnapshotCoordinator {
  #current: number | null = null;
  readonly #listeners = new Set<SnapshotListener>();

  get current(): number | null {
    return this.#current;
  }

  /**
   * Records a snapshot seen in a response. Returns 'stale' if it is older than the newest one
   * already seen: such data must be discarded, never displayed or cached.
   */
  observe(snapshot: number): 'current' | 'stale' {
    if (this.#current !== null && snapshot < this.#current) return 'stale';
    if (snapshot !== this.#current) {
      const previous = this.#current;
      this.#current = snapshot;
      for (const listener of this.#listeners) listener(snapshot, previous);
    }
    return 'current';
  }

  subscribe(listener: SnapshotListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/** Performs one request of a consistent operation; resolves to the decoded data only. */
export type ConsistentFetch = <T>(
  request: (signal: AbortSignal) => Promise<Snapshotted<T>>,
) => Promise<T>;

export interface ConsistentLoadOptions {
  coordinator: SnapshotCoordinator;
  /** Cancels the whole operation (e.g. TanStack Query's signal). */
  signal?: AbortSignal | undefined;
  /** Total attempts, including the first (default 3). */
  maxAttempts?: number;
}

/**
 * Runs an operation made of several requests (sequential pages, or parallel requests) so that its
 * result comes from ONE snapshot, and that snapshot is the newest one known:
 *  - the first response pins the snapshot of the attempt;
 *  - any response from another snapshot, or from one older than the newest seen anywhere, abandons
 *    the attempt: its in-flight requests are aborted and everything accumulated is discarded;
 *  - the operation restarts from the beginning, at most `maxAttempts` times in total, then fails
 *    with SnapshotMismatchError (recoverable: the user can retry).
 */
export async function loadConsistent<T>(
  operation: (fetch: ConsistentFetch) => Promise<T>,
  { coordinator, signal, maxAttempts = 3 }: ConsistentLoadOptions,
): Promise<Snapshotted<T>> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    signal?.throwIfAborted();
    const attemptController = new AbortController();
    const forwardAbort = () => {
      attemptController.abort(signal?.reason);
    };
    signal?.addEventListener('abort', forwardAbort, { once: true });

    // Mutated by the requests of this attempt (possibly in parallel).
    const state: { pinned: number | null; restart: boolean } = { pinned: null, restart: false };
    const consistentFetch: ConsistentFetch = async (request) => {
      const { snapshot, data } = await request(attemptController.signal);
      const stale = coordinator.observe(snapshot) === 'stale';
      if (stale || (state.pinned !== null && snapshot !== state.pinned)) {
        state.restart = true;
        attemptController.abort(); // cancel sibling requests of this attempt
        throw new SnapshotMismatchError('responses came from different dataset snapshots');
      }
      state.pinned ??= snapshot;
      return data;
    };

    try {
      const data = await operation(consistentFetch);
      if (state.pinned === null) {
        throw new Error('a consistent operation must make at least one request');
      }
      // A newer snapshot may have been seen elsewhere while this operation was running.
      if (coordinator.current === state.pinned) return { snapshot: state.pinned, data };
      state.restart = true;
    } catch (error) {
      // When restarting, sibling requests fail with AbortError or the mismatch error: both expected.
      if (!state.restart || signal?.aborted) throw error;
    } finally {
      signal?.removeEventListener('abort', forwardAbort);
    }
  }
  throw new SnapshotMismatchError(
    `the dataset changed during each of ${String(maxAttempts)} attempts`,
  );
}
