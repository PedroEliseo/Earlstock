import type { RequestHandler, Response } from 'express';
import { parseInput } from '../../shared/http/validation.js';
import { toSafeInteger } from '../../shared/numbers.js';
import type { ActiveSnapshot } from '../dataset/dataset.repository.js';
import type { DailyBar } from './stocks.repository.js';
import { listStocksQuerySchema, pricesQuerySchema, tickerParamsSchema } from './stocks.schemas.js';
import type { StocksService } from './stocks.service.js';

/** API representation of a bar: prices stay exact decimal strings; volume becomes a JSON number. */
function toApiBar(bar: DailyBar) {
  return { ...bar, volume: toSafeInteger(bar.volume) };
}

/**
 * Every data response names the snapshot it was read from. If it changes between requests (e.g.
 * while paging), the client knows the dataset was replaced and restarts.
 */
function setSnapshotHeader(res: Response, snapshot: ActiveSnapshot): void {
  res.set('Dataset-Snapshot', String(snapshot.importId));
}

export function createStocksController(service: StocksService) {
  return {
    list: async (req, res) => {
      const query = parseInput(listStocksQuerySchema, req.query);
      const { snapshot, value } = await service.list(query);
      setSnapshotHeader(res, snapshot);
      res.json({ data: value.items, pagination: { ...query, total: value.total } });
    },

    getStock: async (req, res) => {
      const { ticker } = parseInput(tickerParamsSchema, req.params);
      const { snapshot, value } = await service.getStock(ticker);
      setSnapshotHeader(res, snapshot);
      res.json({ data: { ...value, latest: toApiBar(value.latest) } });
    },

    getPrices: async (req, res) => {
      const { ticker } = parseInput(tickerParamsSchema, req.params);
      const { limit, ...range } = parseInput(pricesQuerySchema, req.query);
      const { snapshot, value } = await service.getPrices(ticker, range, limit);
      setSnapshotHeader(res, snapshot);
      res.json({ data: value.bars.map(toApiBar), page: { limit, nextAfter: value.nextAfter } });
    },
  } satisfies Record<string, RequestHandler>;
}
