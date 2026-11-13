import type { Pool } from 'pg';
import { ConflictError } from '../../shared/errors.js';

// Arbitrary application-wide key for pg_advisory_lock (distinct from node-pg-migrate's lock id).
const SYNC_LOCK_KEY = 4_729_301_118;

/**
 * Guarantees at most one synchronization at a time, across requests *and* app instances, using a
 * PostgreSQL session-level advisory lock. The lock is tied to one pooled connection; if that
 * connection dies, PostgreSQL releases the lock automatically.
 */
export function createSyncLock(pool: Pool) {
  return {
    async runExclusive<T>(task: () => Promise<T>): Promise<T> {
      const client = await pool.connect();
      let discardConnection = false;
      try {
        const { rows } = await client.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1) AS locked',
          [SYNC_LOCK_KEY],
        );
        if (!rows[0]?.locked) throw new ConflictError('A synchronization is already running');
        try {
          return await task();
        } finally {
          try {
            await client.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK_KEY]);
          } catch {
            discardConnection = true; // closing the session releases the lock
          }
        }
      } finally {
        client.release(discardConnection);
      }
    },
  };
}

export type SyncLock = ReturnType<typeof createSyncLock>;
