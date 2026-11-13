import { QuotaExceededError } from '../../shared/errors.js';
import { createQuoteSchema, type CreateQuoteInput } from '../quotes/quotes.schemas.js';
import type { QuotesService } from '../quotes/quotes.service.js';
import type { Stock } from '../stocks/stocks.repository.js';
import type { StocksService } from '../stocks/stocks.service.js';
import { type ApiUsage, utcDate } from './api-budget.js';
import type { MarketData } from './market-data.factory.js';
import { ProviderError, type ProviderErrorCode, type ProviderQuote } from './market-data.types.js';
import type { SyncLock } from './sync.lock.js';
import type { SyncRequest } from './sync.schemas.js';

const DAY_MS = 86_400_000;

export interface SyncSymbolResult {
  stockId: string;
  symbol: string;
  exchange: string;
  status: 'ok' | 'failed';
  inserted: number;
  skippedDuplicates: number;
  error?: { code: ProviderErrorCode; message: string };
}

export interface SyncSummary {
  provider: string;
  mode: SyncRequest['mode'];
  startedAt: string;
  finishedAt: string;
  totals: {
    symbols: number;
    succeeded: number;
    failed: number;
    inserted: number;
    skippedDuplicates: number;
  };
  symbols: SyncSymbolResult[];
  /** Null for providers without a metered API (demo). */
  apiUsage: ApiUsage | null;
}

export function createSyncService({
  marketData: { provider, budget },
  stocks,
  quotes,
  lock,
  now = () => new Date(),
}: {
  marketData: MarketData;
  stocks: Pick<StocksService, 'list'>;
  quotes: Pick<QuotesService, 'ingest'>;
  lock: SyncLock;
  now?: () => Date;
}) {
  async function listAllStocks(): Promise<Stock[]> {
    const all: Stock[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await stocks.list({ limit: 100, offset });
      all.push(...page.items);
      if (all.length >= page.total || page.items.length === 0) return all;
    }
  }

  function fetchQuotes(stock: Stock, request: SyncRequest): Promise<ProviderQuote[]> {
    if (request.mode === 'latest') return provider.fetchLatestQuote(stock).then((quote) => [quote]);
    const today = now();
    return provider.fetchDailyPrices(stock, {
      from: utcDate(new Date(today.getTime() - (request.days - 1) * DAY_MS)),
      to: utcDate(today),
    });
  }

  /** Second line of defence: provider output must satisfy the same rules as manual API input. */
  function validate(providerQuotes: ProviderQuote[]): CreateQuoteInput[] {
    return providerQuotes.map((quote) => {
      const result = createQuoteSchema.safeParse({ ...quote, provider: provider.id });
      if (!result.success) {
        const issue = result.error.issues[0];
        throw new ProviderError(
          'invalid_response',
          `${provider.id} returned an invalid quote (${issue ? `${issue.path.join('.')}: ${issue.message}` : 'unknown issue'})`,
        );
      }
      return result.data;
    });
  }

  async function syncStock(stock: Stock, request: SyncRequest): Promise<SyncSymbolResult> {
    const result = { stockId: stock.id, symbol: stock.symbol, exchange: stock.exchange };
    const validated = validate(await fetchQuotes(stock, request));
    return { ...result, status: 'ok', ...(await quotes.ingest(stock.id, validated)) };
  }

  return {
    /**
     * Fetches quotes for every stock and ingests them. Per-stock provider failures are reported in
     * the summary without aborting the run; after a fatal one (budget, auth, rate limit) the
     * remaining stocks are not attempted. Unexpected errors (e.g. database) propagate.
     */
    run(request: SyncRequest): Promise<SyncSummary> {
      return lock.runExclusive(async () => {
        const startedAt = now();
        if (budget) {
          const usage = await budget.usage();
          if (usage.callsUsed >= usage.dailyBudget) {
            const midnight = Date.UTC(
              startedAt.getUTCFullYear(),
              startedAt.getUTCMonth(),
              startedAt.getUTCDate() + 1,
            );
            throw new QuotaExceededError(
              `Daily ${provider.id} API budget exhausted (${String(usage.callsUsed)}/${String(usage.dailyBudget)} calls used today); it resets at 00:00 UTC`,
              Math.ceil((midnight - startedAt.getTime()) / 1000),
            );
          }
        }

        const results: SyncSymbolResult[] = [];
        let fatal: ProviderError | null = null;
        for (const stock of await listAllStocks()) {
          const base = { stockId: stock.id, symbol: stock.symbol, exchange: stock.exchange };
          if (fatal) {
            results.push({
              ...base,
              status: 'failed',
              inserted: 0,
              skippedDuplicates: 0,
              error: { code: fatal.code, message: `Not attempted: ${fatal.message}` },
            });
            continue;
          }
          try {
            results.push(await syncStock(stock, request));
          } catch (err) {
            if (!(err instanceof ProviderError)) throw err;
            if (err.fatal) fatal = err;
            results.push({
              ...base,
              status: 'failed',
              inserted: 0,
              skippedDuplicates: 0,
              error: { code: err.code, message: err.message },
            });
          }
        }

        const ok = results.filter((result) => result.status === 'ok');
        return {
          provider: provider.id,
          mode: request.mode,
          startedAt: startedAt.toISOString(),
          finishedAt: now().toISOString(),
          totals: {
            symbols: results.length,
            succeeded: ok.length,
            failed: results.length - ok.length,
            inserted: ok.reduce((sum, result) => sum + result.inserted, 0),
            skippedDuplicates: ok.reduce((sum, result) => sum + result.skippedDuplicates, 0),
          },
          symbols: results,
          apiUsage: budget ? await budget.usage() : null,
        };
      });
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
