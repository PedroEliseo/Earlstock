import type { ApiUsageRepository } from './api-usage.repository.js';
import { ProviderError } from './market-data.types.js';

export interface ApiUsage {
  provider: string;
  date: string;
  callsUsed: number;
  dailyBudget: number;
}

/** The provider's billing day: a UTC calendar date (EODHD resets at midnight GMT). */
export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Daily API call budget for one provider, persisted in PostgreSQL. Calls are reserved *before*
 * a request is sent, so accounting is conservative: a request that fails still counts.
 */
export function createApiBudget({
  repository,
  provider,
  dailyBudget,
  now = () => new Date(),
}: {
  repository: ApiUsageRepository;
  provider: string;
  dailyBudget: number;
  now?: () => Date;
}) {
  return {
    /** Throws ProviderError('budget_exhausted') when `cost` calls would exceed the budget. */
    async reserve(cost: number): Promise<void> {
      const total = await repository.reserve(provider, utcDate(now()), cost, dailyBudget);
      if (total === null) {
        throw new ProviderError(
          'budget_exhausted',
          `Daily ${provider} API budget of ${String(dailyBudget)} calls is exhausted; it resets at 00:00 UTC`,
        );
      }
    },

    async usage(): Promise<ApiUsage> {
      const date = utcDate(now());
      return { provider, date, callsUsed: await repository.getUsed(provider, date), dailyBudget };
    },

    /** Used when the provider itself reports its daily limit as reached, despite our count. */
    async markExhausted(): Promise<void> {
      await repository.markExhausted(provider, utcDate(now()), dailyBudget);
    },
  };
}

export type ApiBudget = ReturnType<typeof createApiBudget>;
