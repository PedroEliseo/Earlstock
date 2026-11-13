import { isPgError, PgErrorCode } from '../../db/errors.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import type { Page } from '../../shared/http/pagination.js';
import type { StocksService } from '../stocks/stocks.service.js';
import type { Quote, QuotesRepository } from './quotes.repository.js';
import type { CreateQuoteInput, QuoteHistoryQuery } from './quotes.schemas.js';

/** Depends on the Stocks module through its service (its public API), not its repository. */
export function createQuotesService(
  repository: QuotesRepository,
  stocks: Pick<StocksService, 'getById'>,
) {
  return {
    /**
     * Existing quotes are never overwritten: a second quote for the same stock, instant and
     * provider is a conflict. Both checks rely on constraints (FK, UNIQUE) rather than pre-reads,
     * so they are atomic under concurrent writes.
     */
    async create(stockId: string, input: CreateQuoteInput): Promise<Quote> {
      try {
        return await repository.create(stockId, input);
      } catch (err) {
        if (isPgError(err, PgErrorCode.ForeignKeyViolation)) {
          throw new NotFoundError(`Stock ${stockId} not found`, { cause: err });
        }
        if (isPgError(err, PgErrorCode.UniqueViolation)) {
          throw new ConflictError(
            `A quote from provider "${input.provider}" observed at ${input.observedAt} already exists for stock ${stockId}`,
            { cause: err },
          );
        }
        throw err;
      }
    },

    /**
     * Bulk ingestion (used by market data synchronization). Unlike `create`, duplicates are an
     * expected outcome of re-fetching overlapping data, so they are counted rather than rejected.
     * Existing quotes are still never overwritten.
     */
    async ingest(
      stockId: string,
      quotes: CreateQuoteInput[],
    ): Promise<{ inserted: number; skippedDuplicates: number }> {
      if (quotes.length === 0) return { inserted: 0, skippedDuplicates: 0 };
      let inserted: number;
      try {
        inserted = await repository.insertMany(stockId, quotes);
      } catch (err) {
        if (isPgError(err, PgErrorCode.ForeignKeyViolation)) {
          throw new NotFoundError(`Stock ${stockId} not found`, { cause: err });
        }
        throw err;
      }
      return { inserted, skippedDuplicates: quotes.length - inserted };
    },

    /** Throws NotFoundError for an unknown stock; resolves to null when the stock has no quotes. */
    async getLatest(stockId: string): Promise<Quote | null> {
      await stocks.getById(stockId);
      return repository.findLatest(stockId);
    },

    async listHistory(stockId: string, query: QuoteHistoryQuery): Promise<Page<Quote>> {
      await stocks.getById(stockId);
      return repository.findPage(stockId, query);
    },
  };
}

export type QuotesService = ReturnType<typeof createQuotesService>;
