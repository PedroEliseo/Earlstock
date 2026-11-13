import type { Pool } from 'pg';

/** SQL for provider_api_usage. All updates are single atomic statements. */
export function createApiUsageRepository(db: Pool) {
  return {
    /**
     * Adds `cost` to the day's usage only if the total stays within `limit`, in one statement.
     * Concurrent callers serialize on the row lock, so the limit can never be exceeded.
     * Returns the new total, or null when the reservation was refused.
     */
    async reserve(
      provider: string,
      date: string,
      cost: number,
      limit: number,
    ): Promise<number | null> {
      const { rows } = await db.query<{ callsUsed: number }>(
        `INSERT INTO provider_api_usage AS usage (provider, usage_date, calls_used)
         SELECT $1, $2, $3::int WHERE $3::int <= $4::int
         ON CONFLICT (provider, usage_date) DO UPDATE
           SET calls_used = usage.calls_used + EXCLUDED.calls_used, updated_at = now()
           WHERE usage.calls_used + EXCLUDED.calls_used <= $4::int
         RETURNING calls_used AS "callsUsed"`,
        [provider, date, cost, limit],
      );
      return rows[0]?.callsUsed ?? null;
    },

    async getUsed(provider: string, date: string): Promise<number> {
      const { rows } = await db.query<{ callsUsed: number }>(
        `SELECT calls_used AS "callsUsed" FROM provider_api_usage WHERE provider = $1 AND usage_date = $2`,
        [provider, date],
      );
      return rows[0]?.callsUsed ?? 0;
    },

    /** Raises the day's usage to at least `limit` (never lowers it). */
    async markExhausted(provider: string, date: string, limit: number): Promise<void> {
      await db.query(
        `INSERT INTO provider_api_usage AS usage (provider, usage_date, calls_used)
         VALUES ($1, $2, $3)
         ON CONFLICT (provider, usage_date) DO UPDATE
           SET calls_used = GREATEST(usage.calls_used, EXCLUDED.calls_used), updated_at = now()`,
        [provider, date, limit],
      );
    },
  };
}

export type ApiUsageRepository = ReturnType<typeof createApiUsageRepository>;
