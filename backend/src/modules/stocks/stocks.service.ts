import { DatasetNotLoadedError, NotFoundError } from '../../shared/errors.js';
import { withSpan } from '../../shared/telemetry.js';
import type { DateString } from '../../shared/types.js';
import type { ActiveSnapshot } from '../dataset/dataset.repository.js';
import type { ListStocksQuery } from './stocks.schemas.js';
import type {
  DailyBar,
  DateRange,
  StockDetail,
  StockSummary,
  StocksRepository,
} from './stocks.repository.js';

/** A value plus the snapshot it was read from, so responses can report it (Dataset-Snapshot). */
export interface Snapshotted<T> {
  snapshot: ActiveSnapshot;
  value: T;
}

export interface PriceHistoryPage {
  bars: DailyBar[];
  /** Exclusive cursor for the next page, or null when this is the last page. */
  nextAfter: DateString | null;
}

/**
 * Span attributes use the `earlstock.` namespace and stay low-cardinality: no tickers (the HTTP span's
 * URL already has them), search terms or dates; only whether a filter was supplied. The snapshot id
 * is a trace attribute only and must never become a metric label (each import creates a new value).
 */
const SNAPSHOT_ATTRIBUTE = 'earlstock.dataset.snapshot_id';

function requireSnapshot(snapshot: ActiveSnapshot | null): ActiveSnapshot {
  if (!snapshot) throw new DatasetNotLoadedError();
  return snapshot;
}

export function createStocksService(repository: StocksRepository) {
  return {
    /** One page of the stock list (optionally searched and ordered); `total` counts all matches. */
    async list(
      query: ListStocksQuery,
    ): Promise<Snapshotted<{ items: StockSummary[]; total: number }>> {
      const attributes = {
        'earlstock.page.limit': query.limit,
        'earlstock.page.offset': query.offset,
        'earlstock.stocks.search': query.q !== undefined,
        'earlstock.stocks.sort': query.sort,
        'earlstock.stocks.sort_direction': query.dir,
      };
      return withSpan('stocks.list', attributes, async (span) => {
        const { snapshot, items, total } = await repository.list(query);
        const active = requireSnapshot(snapshot);
        span.setAttributes({
          [SNAPSHOT_ATTRIBUTE]: active.importId,
          'earlstock.result.count': items.length,
          'earlstock.stocks.total': total,
        });
        return { snapshot: active, value: { items, total } };
      });
    },

    async getStock(ticker: string): Promise<Snapshotted<StockDetail>> {
      return withSpan('stocks.detail', {}, async (span) => {
        const { snapshot, stock } = await repository.findDetail(ticker);
        const active = requireSnapshot(snapshot);
        span.setAttributes({ [SNAPSHOT_ATTRIBUTE]: active.importId, 'earlstock.found': !!stock });
        if (!stock) throw new NotFoundError(`Stock ${ticker} not found`);
        return { snapshot: active, value: stock };
      });
    },

    /**
     * One page of price history. Fetches one bar more than requested to learn whether another page
     * exists; dates are unique per stock, so ordering by date is deterministic.
     */
    async getPrices(
      ticker: string,
      range: DateRange,
      limit: number,
    ): Promise<Snapshotted<PriceHistoryPage>> {
      const attributes = {
        'earlstock.page.limit': limit,
        'earlstock.prices.from_set': range.from !== undefined,
        'earlstock.prices.to_set': range.to !== undefined,
        'earlstock.prices.after_set': range.after !== undefined,
      };
      return withSpan('stocks.prices', attributes, async (span) => {
        const { snapshot, stockFound, bars } = await repository.findBars(ticker, range, limit + 1);
        const active = requireSnapshot(snapshot);
        span.setAttributes({
          [SNAPSHOT_ATTRIBUTE]: active.importId,
          'earlstock.found': stockFound,
        });
        if (!stockFound) throw new NotFoundError(`Stock ${ticker} not found`);
        const page = bars.slice(0, limit);
        const nextAfter = bars.length > limit ? (page.at(-1)?.date ?? null) : null;
        span.setAttributes({
          'earlstock.result.count': page.length,
          'earlstock.page.has_more': nextAfter !== null,
        });
        return { snapshot: active, value: { bars: page, nextAfter } };
      });
    },
  };
}

export type StocksService = ReturnType<typeof createStocksService>;
