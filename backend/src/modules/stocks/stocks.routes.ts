import { Router } from 'express';
import { createStocksController } from './stocks.controller.js';
import type { StocksService } from './stocks.service.js';

/** Read-only, addressed by ticker: stock data is written exclusively by the data importer. */
export function stocksRouter(service: StocksService): Router {
  const controller = createStocksController(service);
  const router = Router();
  router.get('/', controller.list);
  router.get('/:ticker', controller.getStock);
  router.get('/:ticker/prices', controller.getPrices);
  return router;
}
