import { DatasetNotLoadedError, NotFoundError } from '../../shared/errors.js';
import type { Pagination } from '../../shared/http/pagination.js';
import type { DateString } from '../../shared/types.js';
import type { ActiveSnapshot } from '../dataset/dataset.repository.js';
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

function requireSnapshot(snapshot: ActiveSnapshot | null): ActiveSnapshot {
  if (!snapshot) throw new DatasetNotLoadedError();
  return snapshot;
}

export function createStocksService(repository: StocksRepository) {
  return {
    async list(
      pagination: Pagination,
    ): Promise<Snapshotted<{ items: StockSummary[]; total: number }>> {
      const { snapshot, items, total } = await repository.list(pagination);
      return { snapshot: requireSnapshot(snapshot), value: { items, total } };
    },

    async getStock(ticker: string): Promise<Snapshotted<StockDetail>> {
      const { snapshot, stock } = await repository.findDetail(ticker);
      const active = requireSnapshot(snapshot);
      if (!stock) throw new NotFoundError(`Stock ${ticker} not found`);
      return { snapshot: active, value: stock };
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
      const { snapshot, stockFound, bars } = await repository.findBars(ticker, range, limit + 1);
      const active = requireSnapshot(snapshot);
      if (!stockFound) throw new NotFoundError(`Stock ${ticker} not found`);
      const page = bars.slice(0, limit);
      const nextAfter = bars.length > limit ? (page.at(-1)?.date ?? null) : null;
      return { snapshot: active, value: { bars: page, nextAfter } };
    },
  };
}

export type StocksService = ReturnType<typeof createStocksService>;
