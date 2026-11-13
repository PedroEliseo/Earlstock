import type { Pool } from 'pg';
import type { MarketDataEnv } from '../../config/market-data.js';
import { type ApiBudget, createApiBudget } from './api-budget.js';
import { createApiUsageRepository } from './api-usage.repository.js';
import { createDemoProvider } from './demo.provider.js';
import { createEodhdProvider } from './eodhd.provider.js';
import type { MarketDataProvider } from './market-data.types.js';

/** The configured provider, plus its API budget when it calls a metered external API. */
export interface MarketData {
  provider: MarketDataProvider;
  budget: ApiBudget | null;
}

export function createMarketData(env: MarketDataEnv, pool: Pool): MarketData {
  if (env.MARKET_DATA_PROVIDER === 'demo') {
    return { provider: createDemoProvider(), budget: null };
  }
  if (!env.EODHD_API_KEY) {
    // Unreachable after loadEnv() validation; kept so a misconfiguration can never send an empty key.
    throw new Error('EODHD_API_KEY is required when MARKET_DATA_PROVIDER=eodhd');
  }
  const budget = createApiBudget({
    repository: createApiUsageRepository(pool),
    provider: 'eodhd',
    dailyBudget: env.EODHD_DAILY_CALL_BUDGET,
  });
  return { provider: createEodhdProvider({ apiKey: env.EODHD_API_KEY, budget }), budget };
}
